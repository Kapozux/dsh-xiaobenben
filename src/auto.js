/**
 * 台词自动更新：主人在第一次询问里选了「自动更新」才开，设置里随时能关。
 *
 * 为什么不用 dsh 自带的定时：dsh 的 Schedule（@deepseek-ai/dsh-schedule）默认不启用（是个要在插件页手动打开的实验包），
 * 而且它做的是「到点往某个 Agent 会话里发一条消息」，不是到点调用插件里的函数——用它就得每周唤醒一次 agent、往主人的会话里塞消息。
 * 所以这里自己放一个很轻的定时器：dsh web 开着的时候每 5 分钟看一眼，够一周了、主人又闲着，才跑。
 *
 *   - 每周最多一次；只做增量：这周新的事 + 库里没写过的旧事（省着补）+ 轮换 5 件已经写过的事换个说法。
 *   - 每次、每月都有 token 上限：先按估算挑事件，挑到上限为止；跑的时候再按实际用量卡一道，超了就停。
 *   - 时机：没有活在跑，而且最近 10 分钟主人没派过活。
 *   - 连续失败 2 次就暂停，原因写在状态里（设置页显示），主人点「继续」才再跑。
 *   - 跑完不弹窗：记下新写了几件，主人下次点她时说一句。
 */
import { styleQuote, styleRun, validLines } from './core/style.js'
import { estimateTokens } from './core/ai.js'

export const WEEK = 7 * 864e5
export const IDLE = 10 * 60e3
export const ROTATE = 5
export const DEFAULT_CAPS = { run: 60_000, month: 250_000 }

const monthKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
/** 一次调用实际用了多少 token：各家的字段名不一样，都认；没报用量就按字数估 */
function spent(usage, system, prompt, text) {
  const u = usage || {}
  const i = u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? u.input, o = u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? u.output
  return (Number.isFinite(i) ? i : estimateTokens(system) + estimateTokens(prompt)) + (Number.isFinite(o) ? o : estimateTokens(text || ''))
}

export class Auto {
  /**
   * @param {{ pet: any, store: import('./store.js').Store, adapter: any, route: () => { provider: string, model: string },
   *   activity: () => Promise<{ busy: boolean, lastAt: number }>, isRunning?: () => boolean, caps?: { run?: number, month?: number }, now?: () => number }} deps
   *   activity：现在有没有活在跑、主人最后一次派活是什么时候；isRunning：手动那一路（Styler）是不是正在跑
   */
  constructor({ pet, store, adapter, route, activity, isRunning = () => false, caps = {}, now = Date.now }) {
    Object.assign(this, { pet, store, adapter, route, activity, isRunning, now })
    this.caps = { run: caps.run > 0 ? caps.run : DEFAULT_CAPS.run, month: caps.month > 0 ? caps.month : DEFAULT_CAPS.month }
    this.job = null
  }

  #state() { return { on: false, fails: 0, paused: null, runs: [], ...(this.store.read().auto || {}) } }
  #save(patch) { this.store.update(s => ({ ...s, auto: { ...this.#state(), ...patch } })) }
  /** 这个月已经用了多少 token（只算自动跑的） */
  monthUsed(at = this.now()) { return this.#state().runs.filter(r => monthKey(r.at) === monthKey(at)).reduce((a, r) => a + (r.tokens || 0), 0) }

  /** 开 / 关。开的时候清掉暂停；不改上次运行时间（关了再开不会立刻多跑一次） */
  set(on) {
    this.#save(on ? { on: true, since: this.#state().since || this.now(), paused: null, fails: 0 } : { on: false })
    if (!on) this.job?.ctrl.abort()
    return this.status()
  }
  /** 暂停以后主人点「继续」 */
  resume() { this.#save({ paused: null, fails: 0 }); return this.status() }
  /** 主人下次点她时说一句「新记了 N 件事」，说完清零 */
  takeNews() { const n = this.#state().news || 0; if (n) this.#save({ news: 0 }); return n }

  status() {
    const s = this.#state(), last = s.runs.at(-1) || null
    return {
      on: !!s.on, paused: s.paused || null, running: !!this.job,
      last: last && { at: last.at, tokens: last.tokens, ok: last.ok, added: last.added, rotated: last.rotated, error: last.error || null },
      monthTokens: this.monthUsed(), caps: this.caps,
      // 下次：上次跑完一周以后（还得等主人闲下来）；没跑过就是现在
      nextAt: s.on && !s.paused ? (last ? last.at + WEEK : this.now()) : null,
      news: s.news || 0,
    }
  }

  /**
   * 这一次写哪些事：先是这周新的，再轮换 5 件写过的旧事，最后拿剩下的额度补还没写过的旧事。按估算的 token 挑到上限为止。
   * @returns {Promise<{ cards: any[], fresh: Set<string>, rotated: Set<string>, estimate: number, budget: number }>}
   */
  async plan() {
    const at = this.now()
    const { moments } = await this.pet.moments({ raw: true })
    const styled = this.store.read().styled || {}, when = this.store.read().styledAt || {}
    const usable = moments.filter(m => m.card?.id && m.card.fact && !m.sensitive.length)
    const has = m => validLines(m.card, styled[m.card.id]).length > 0
    const missing = usable.filter(m => !has(m)).sort((a, b) => b.ts - a.ts)
    const thisWeek = missing.filter(m => at - m.ts <= WEEK), backlog = missing.filter(m => at - m.ts > WEEK)
    const rotate = usable.filter(has).sort((a, b) => (when[a.card.id] || 0) - (when[b.card.id] || 0)).slice(0, ROTATE)
    const budget = Math.max(0, Math.min(this.caps.run, this.caps.month - this.monthUsed(at)))
    const route = this.route(), cards = []
    const cost = list => { const q = styleQuote(list, route); return q.inputTokens + q.outputTokens }
    for (const m of [...thisWeek, ...rotate, ...backlog]) { if (cost([...cards, m.card]) > budget) break; cards.push(m.card) }
    return { cards, fresh: new Set(missing.map(m => m.card.id)), rotated: new Set(rotate.map(m => m.card.id)), estimate: cards.length ? cost(cards) : 0, budget }
  }

  /** 定时器每次看一眼：该跑就跑。返回这次为什么没跑 / 跑了 */
  async tick() {
    const s = this.#state(), at = this.now()
    if (!s.on) return 'off'
    if (s.paused) return 'paused'
    if (this.job || this.isRunning()) return 'running'
    const last = s.runs.at(-1)
    if (last && at - last.at < WEEK) return 'not-due'
    const a = await this.activity()
    if (a.busy) return 'busy'                       // 主人正在派活，不抢
    if (at - (a.lastAt || 0) < IDLE) return 'active' // 刚派过活，等闲下来 10 分钟
    await this.run()
    return 'ran'
  }

  /** 跑一次（不看时机；tick 和「开启自动更新」那一下调它） */
  async run() {
    if (this.job) return this.job.promise
    const ctrl = new AbortController()
    const job = this.job = { ctrl, promise: null }
    job.promise = this.#run(ctrl).finally(() => { this.job = null })
    return job.promise
  }

  async #run(ctrl) {
    const at = this.now()
    let tokens = 0
    const finish = run => {
      const s = this.#state()
      const fails = run.ok ? 0 : s.fails + 1
      this.#save({ runs: [...s.runs, run].slice(-30), fails, news: (s.news || 0) + (run.added || 0),
        paused: fails >= 2 ? `连续 ${fails} 次没写成：${run.error}` : s.paused })
      return run
    }
    try {
      const { cards, fresh, rotated, budget } = await this.plan()
      if (budget <= 0) return finish({ at, ok: true, tokens: 0, added: 0, rotated: 0, error: null, note: '这个月的额度用完了，下个月再写' })
      if (!cards.length) return finish({ at, ok: true, tokens: 0, added: 0, rotated: 0, error: null, note: '没有新的事要写' })
      // 实际用量再卡一道：超过这一次的上限就停（估算偏小的时候不至于多花）
      const metered = async req => {
        if (tokens >= budget) { ctrl.abort(); throw new Error(`这一次的 token 上限（${budget}）用完了`) }
        const res = await this.adapter(req)
        tokens += spent(res.usage, req.system, req.prompt, res.text)
        return res
      }
      const r = await styleRun({ adapter: metered, cards, route: this.route(), signal: ctrl.signal })
      const ids = Object.keys(r.lines)
      this.store.update(s => ({ ...s, styled: { ...(s.styled || {}), ...r.lines }, styledAt: { ...(s.styledAt || {}), ...Object.fromEntries(ids.map(id => [id, at])) }, styledMeta: { route: this.route(), at } }))
      const ok = ids.length > 0
      const why = r.errors[0] || r.failed[0]?.why || '模型没写出能用的台词'
      return finish({ at, ok, tokens, added: ids.filter(id => fresh.has(id)).length, rotated: ids.filter(id => rotated.has(id)).length, tried: cards.length, error: ok ? null : why })
    } catch (err) {
      return finish({ at, ok: false, tokens, added: 0, rotated: 0, error: err?.message || String(err) })
    }
  }
}
