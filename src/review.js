/**
 * 把各部分串起来：读数据 → 统计 → 原话 → 材料 → 报价 / 生成。
 * 不依赖 dsh：sessionQuery、模型适配器、外部来源读取器都从外面传进来，测试里全换成假的。
 */
import { loadDsh } from './sources/dsh.js'
import { loadClaude, loadCodex, loadCursor, describeSources } from './sources/files.js'
import { clip, computeStats, defaultRange } from './core/stats.js'
import { pickQuotes } from './core/quotes.js'
import { buildMaterial } from './core/material.js'
import { generate, materialHash, quote, MAX_CALLS } from './core/ai.js'

export const FILE_LOADERS = { claude: loadClaude, codex: loadCodex, cursor: loadCursor }
const CACHE_MS = 10 * 60 * 1000

export class Review {
  /**
   * @param {object} deps
   * @param {object} [deps.sessionQuery] ctx.sessionQuery；没有就只读勾选的外部来源
   * @param {import('./store.js').Store} deps.store
   * @param {Record<string, () => Promise<any>>} [deps.loaders] 外部来源读取器（测试换掉）
   * @param {object} [deps.config] 插件配置
   */
  constructor({ sessionQuery, store, loaders = FILE_LOADERS, config = {} }) {
    this.sessionQuery = sessionQuery
    this.store = store
    this.loaders = loaders
    this.config = config
    this._cache = null
  }

  sources() {
    const enabled = this.store.read().sources
    return [
      { id: 'dsh', name: 'DeepSeek Harness', path: 'dsh 会话日志（ctx.sessionQuery）', exists: Boolean(this.sessionQuery), enabled: true, fixed: true },
      ...describeSources().map(s => ({ ...s, name: { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' }[s.id], enabled: Boolean(enabled[s.id]) })),
    ]
  }

  setSource(id, on) {
    if (!(id in this.loaders)) throw new Error(`没有这个来源：${id}`)
    this.store.update(s => ({ ...s, sources: { ...s.sources, [id]: Boolean(on) } }))
    this._cache = null
  }

  /** 读全部勾选的来源。10 分钟内重复打开页面不重读。 */
  async load({ fresh = false } = {}) {
    const enabled = Object.entries(this.store.read().sources).filter(([, v]) => v).map(([k]) => k).filter(k => k in this.loaders).sort()
    const key = enabled.join(',')
    if (!fresh && this._cache && this._cache.key === key && Date.now() - this._cache.at < CACHE_MS) return this._cache.value
    const report = []
    let convs = []
    if (this.sessionQuery) {
      try {
        const r = await loadDsh(this.sessionQuery)
        convs = convs.concat(r.convs)
        report.push({ id: 'dsh', sessions: r.convs.length, skipped: r.skipped })
      } catch (err) {
        report.push({ id: 'dsh', sessions: 0, skipped: 0, error: err?.message || String(err) })
      }
    }
    for (const id of enabled) {
      try {
        const r = await this.loaders[id]()
        convs = convs.concat(r.convs)
        report.push({ id, sessions: r.convs.length, skipped: r.skipped })
      } catch (err) {
        report.push({ id, sessions: 0, skipped: 0, error: err?.message || String(err) })
      }
    }
    const value = { convs, report }
    this._cache = { key, at: Date.now(), value }
    return value
  }

  /** 统计 + 原话 + 材料。全部确定性，不调模型。 */
  async build({ range, fresh } = {}) {
    const r = range && range.start && range.end ? range : defaultRange()
    const { convs: all, report } = await this.load({ fresh })
    const convs = clip(all, r)
    const opts = { sensitiveExtra: this.config.sensitiveExtra || {} }
    const material = buildMaterial(convs, opts)
    return { range: r, report, convs, stats: computeStats(convs), quotes: pickQuotes(convs, opts), material, hash: materialHash(material) }
  }

  /** 页面要的那份：不带聊天全文。 */
  async view(range) {
    const b = await this.build({ range })
    const state = this.store.read()
    const ai = state.ai[b.hash] || null
    return {
      range: b.range,
      report: b.report,
      stats: b.stats,
      quotes: b.quotes,
      material: { titles: b.material.titles.length, samples: b.material.samples.length, droppedSensitive: b.material.droppedSensitive, external: b.material.external },
      ai: ai && { result: ai.result || null, calls: ai.calls, maxCalls: MAX_CALLS, route: ai.route, usage: ai.usage, at: ai.at },
      hidden: state.hidden[b.hash] || {},
      hash: b.hash,
    }
  }

  async quote({ range, kind, route }) {
    const b = await this.build({ range })
    const q = quote(b.material, route, this.config.prices || [], kind, this.config.expensiveOutputPrice || 0)
    const entry = this.store.read().ai[b.hash]
    return { ...q, hash: b.hash, calls: entry?.calls || 0, maxCalls: MAX_CALLS }
  }

  /** 用户在报价页点了「发送」才会走到这里。hash 必须和报价时一致：材料变了要重新报价。 */
  async generate({ range, kind, route, hash, adapter, signal }) {
    const b = await this.build({ range })
    if (hash !== b.hash) return { ok: false, error: '数据变了，请重新看一遍报价再发送' }
    const sources = [...b.material.samples.map(s => s.text), ...b.material.titles.map(t => t.text)]
    const entry = this.store.read().ai[b.hash]
    const r = await generate({ adapter, entry, material: b.material, route, kind, sources, signal })
    this.store.update(s => ({ ...s, ai: { ...s.ai, [b.hash]: r.entry } }))
    return { ok: r.ok, error: r.error, removed: r.removed || [], calls: r.entry.calls, maxCalls: MAX_CALLS }
  }

  setHidden(hash, card, hidden) {
    this.store.update(s => ({ ...s, hidden: { ...s.hidden, [hash]: { ...(s.hidden[hash] || {}), [card]: Boolean(hidden) } } }))
  }
}
