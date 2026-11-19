/**
 * 台词自动补货：让她永远有没说过的话。主人在第一次询问里亲手选了「自动更新」才开，设置里随时能关。
 *
 * 为什么不用 dsh 自带的定时：dsh 的 Schedule（@deepseek-ai/dsh-schedule）默认不启用（要在插件页手动打开的实验包），
 * 而且它做的是「到点往某个 Agent 会话里发一条消息」，不是到点调用插件里的函数。所以这里自己放一个很轻的定时器：
 * dsh web 开着的时候每 5 分钟看一眼库存，该补、主人又闲着，才补。
 *
 *   - 库存 = 模型写好、还没对主人说过的台词有几条（说没说过看 feedback.json 的 shown；旧事换了说法以后又算没说过）。
 *   - 库存低于 20 条，或者今天有新的事还没写：在下一个空闲时段补一批。新的事优先，不够再给说过的旧事换个说法。
 *   - 空闲时段：没有活在跑、主人最后一次派活在 10 分钟以前；尽量避开模型的高峰时段（库存见底了就不等）。
 *   - 上限只用来防 bug：每次补货最多 6 万 token（估算和实际用量各卡一道），每月最多约 5 元；触顶就停，原因写在状态里。
 *   - 连续 2 次没写成就暂停；同一件事连着两次没写成，7 天内不再试（不然会一直重试烧 token）。
 *   - 补完不弹窗：记下新写了几件，主人下次点她时说一句。
 */
import fs from 'node:fs'
import path from 'node:path'
import { styleQuote, styleRun, validLines } from './core/style.js'
import { estimateTokens } from './core/ai.js'
import { normFeedback } from './shared/feedback.js'

export const TARGET = 20                 // 库存低于这个数就补
export const FILL_TO = 30                // 一次补到大约这么多
export const IDLE = 10 * 60e3            // 主人最后一次派活在这么久以前才算闲
export const GAP = 30 * 60e3             // 两次补货至少隔这么久（防止一直补不上去时空转）
export const RETRY_AFTER = 7 * 864e5     // 同一件事连着两次没写成，这么久以后再试
export const DEFAULT_CAPS = { run: 60_000, monthYuan: 5 }
/** 没配价格表时按这个估钱：每百万 token，人民币。只是个估数，配置里的 prices 有这个模型的价格就用配置的 */
export const FALLBACK_PRICE = { input: 2, output: 8, currency: 'CNY', assumed: true }
/** 高峰时段（北京时间，工作日的白天）：这是插件自己的假设，不是官方数据；设置里能关掉「避开高峰」 */
export const PEAK = { from: 9, to: 18 }

const monthKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const dayKey = ts => new Date(ts).toDateString()
/** 一次调用实际用了多少 token：各家的字段名不一样，都认；没报用量就按字数估 */
function spent(usage, system, prompt, text) {
  const u = usage || {}
  const i = u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? u.input, o = u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? u.output
  return { in: Number.isFinite(i) ? i : estimateTokens(system) + estimateTokens(prompt), out: Number.isFinite(o) ? o : estimateTokens(text || '') }
}
/** 北京时间现在是不是高峰（周一到周五 9～18 点） */
export function isPeak(ts) {
  const bj = new Date(ts + 8 * 3600e3)             // 用 UTC 的读法读北京时间
  const day = bj.getUTCDay(), h = bj.getUTCHours()
  return day >= 1 && day <= 5 && h >= PEAK.from && h < PEAK.to
}

export class Auto {
  /**
   * @param {{ pet: any, store: import('./store.js').Store, adapter: any, route: () => { provider: string, model: string },
   *   activity: () => Promise<{ busy: boolean, lastAt: number }>, isRunning?: () => boolean, prices?: any[],
   *   caps?: { run?: number, monthYuan?: number }, shown?: () => Record<string, [number, number]>, now?: () => number }} deps
   *   activity：现在有没有活在跑、主人最后一次派活是什么时候；isRunning：手动那一路（Styler）是不是正在跑；
   *   shown：每件事对主人说过几次、上次什么时候说的（默认读插件目录里的 feedback.json）
   */
  constructor({ pet, store, adapter, route, activity, isRunning = () => false, prices = [], caps = {}, shown, now = Date.now }) {
    Object.assign(this, { pet, store, adapter, route, activity, isRunning, prices, now })
    this.caps = { run: caps.run > 0 ? caps.run : DEFAULT_CAPS.run, monthYuan: caps.monthYuan > 0 ? caps.monthYuan : DEFAULT_CAPS.monthYuan }
    this.shown = shown || (() => { try { return normFeedback(JSON.parse(fs.readFileSync(path.join(path.dirname(store.file), 'feedback.json'), 'utf8'))).shown } catch { return {} } })
    this.job = null
  }

  #state() { return { on: false, avoidPeak: true, fails: 0, paused: null, runs: [], tried: {}, ...(this.store.read().auto || {}) } }
  #save(patch) { this.store.update(s => ({ ...s, auto: { ...this.#state(), ...patch } })) }

  /** 这个模型的价格（每百万 token）：配置里有就用配置的，没有就用估的那个 */
  price() {
    const r = this.route(), p = this.prices.find(p => p.provider === r.provider && p.model === r.model)
    return p ? { input: p.input, output: p.output, currency: p.currency || 'USD', assumed: false } : FALLBACK_PRICE
  }
  cost(tin, tout) { const p = this.price(); return (tin * p.input + tout * p.output) / 1e6 }
  /** 这个月已经花了多少（只算自动补货的） */
  monthCost(at = this.now()) { return this.#state().runs.filter(r => monthKey(r.at) === monthKey(at)).reduce((a, r) => a + (r.cost || 0), 0) }

  /** 开 / 关、要不要避开高峰。开的时候清掉暂停 */
  set({ on, avoidPeak } = {}) {
    const patch = {}
    if (typeof on === 'boolean') Object.assign(patch, on ? { on: true, since: this.#state().since || this.now(), paused: null, fails: 0 } : { on: false })
    if (typeof avoidPeak === 'boolean') patch.avoidPeak = avoidPeak
    this.#save(patch)
    if (on === false) this.job?.ctrl.abort()
    return this.status()
  }
  /** 暂停以后主人点「继续」 */
  resume() { this.#save({ paused: null, fails: 0 }); return this.status() }
  /** 主人下次点她时说一句「新记了 N 件事」，说完清零 */
  takeNews() { const n = this.#state().news || 0; if (n) this.#save({ news: 0 }); return n }

  /** 看一眼库存：哪些事有模型写好的台词、其中哪些还没说过；哪些事还没写 */
  async stock() {
    const at = this.now()
    const { moments } = await this.pet.moments({ raw: true })
    const s = this.store.read(), styled = s.styled || {}, when = s.styledAt || {}, shown = this.shown(), tried = this.#state().tried
    const usable = moments.filter(m => m.card?.id && m.card.fact && !m.sensitive.length)
    const written = usable.filter(m => validLines(m.card, styled[m.card.id]).length > 0)
    const fresh = written.filter(m => !(shown[m.card.id] && shown[m.card.id][1] >= (when[m.card.id] || 0)))      // 写好以后还没说过
    const stale = written.filter(m => !fresh.includes(m)).sort((a, b) => (when[a.card.id] || 0) - (when[b.card.id] || 0))   // 说过了的：可以换个说法
    const giveUp = id => tried[id] && tried[id][0] >= 2 && at - tried[id][1] < RETRY_AFTER
    const missing = usable.filter(m => !written.includes(m) && !giveUp(m.card.id)).sort((a, b) => b.ts - a.ts)
    return { at, count: fresh.length, missing, stale, newToday: missing.filter(m => dayKey(m.ts) === dayKey(at)).length, styled }
  }

  async status() {
    const s = this.#state(), last = s.runs.at(-1) || null, p = this.price()
    let stock = null
    try { stock = (await this.stock()).count } catch (err) { console.warn('[dsh-xiaobenben] 数库存失败', err?.message) }
    const month = this.monthCost()
    return {
      on: !!s.on, avoidPeak: s.avoidPeak !== false, paused: s.paused || null, running: !!this.job,
      stock, target: TARGET,
      last: last && { at: last.at, tokens: (last.in || 0) + (last.out || 0), cost: last.cost || 0, ok: last.ok, added: last.added, rotated: last.rotated, withButtons: last.withButtons || 0, error: last.error || null, note: last.note || null },
      monthCost: month, capped: month >= this.caps.monthYuan ? `这个月已经花了约 ${month.toFixed(2)} 元，到了每月 ${this.caps.monthYuan} 元的上限，下个月再补` : null,
      caps: this.caps, price: p, peakNow: isPeak(this.now()), news: s.news || 0,
    }
  }

  /**
   * 这一次写哪些事：还没写过的（新的在前）→ 说过了的旧事换个说法。补到库存大约 FILL_TO 条、或者估算的 token 到上限为止。
   * @returns {Promise<{ cards: any[], missing: Set<string>, rotated: Set<string>, avoid: Record<string, string>, estimate: number, budget: number, stock: number, need: boolean }>}
   */
  async plan() {
    const st = await this.stock()
    const need = st.count < TARGET || st.newToday > 0
    const p = this.price(), left = Math.max(0, this.caps.monthYuan - this.monthCost(st.at))
    // 这个月剩下的钱最多还能买多少 token（按输出价算，保守）
    const budget = Math.max(0, Math.min(this.caps.run, Math.floor(left / Math.max(p.input, p.output) * 1e6)))
    const route = this.route(), cards = []
    const tokens = list => { const q = styleQuote(list, route); return q.inputTokens + q.outputTokens }
    const want = Math.max(st.newToday, FILL_TO - st.count)
    const avoid = {}
    for (const m of [...st.missing, ...st.stale]) {
      if (cards.length >= want || tokens([...cards, m.card]) > budget) break
      cards.push(m.card)
      const old = validLines(m.card, st.styled[m.card.id])[0]
      if (old) avoid[m.card.id] = old.text.replace(/\n/g, ' / ')            // 换说法：把上次那句给模型看，别写成一样的
    }
    return { cards, missing: new Set(st.missing.map(m => m.card.id)), rotated: new Set(st.stale.map(m => m.card.id)), avoid, estimate: cards.length ? tokens(cards) : 0, budget, stock: st.count, need }
  }

  /** 定时器每次看一眼：该补就补。返回这次为什么没补 / 补了 */
  async tick() {
    const s = this.#state(), at = this.now()
    if (!s.on) return 'off'
    if (s.paused) return 'paused'
    if (this.job || this.isRunning()) return 'running'
    if (this.monthCost(at) >= this.caps.monthYuan) return 'capped'
    const last = s.runs.at(-1)
    if (last && at - last.at < GAP) return 'just-ran'
    const st = await this.plan()
    if (!st.need) return 'stocked'
    if (!st.cards.length) return 'nothing'          // 库存不够，但没有能写的事了（都写过也都没说过，或者额度不够）：不空转
    const a = await this.activity()
    if (a.busy) return 'busy'                       // 主人正在派活，不抢
    if (at - (a.lastAt || 0) < IDLE) return 'active' // 刚派过活，等闲下来 10 分钟
    if (s.avoidPeak !== false && isPeak(at) && st.stock > 0) return 'peak'   // 高峰时段尽量不补；库存见底了就不等
    await this.run()
    return 'ran'
  }

  /** 补一次（不看时机；tick 和「开启自动更新」那一下调它） */
  async run() {
    if (this.job) return this.job.promise
    const ctrl = new AbortController()
    const job = this.job = { ctrl, promise: null }
    job.promise = this.#run(ctrl).finally(() => { this.job = null })
    return job.promise
  }

  async #run(ctrl) {
    const at = this.now()
    let tin = 0, tout = 0
    const finish = run => {
      const s = this.#state()
      const full = { at, in: tin, out: tout, cost: this.cost(tin, tout), added: 0, rotated: 0, withButtons: 0, error: null, ...run }
      const fails = full.ok ? 0 : s.fails + 1
      this.#save({ runs: [...s.runs, full].slice(-40), fails, news: (s.news || 0) + full.added + full.rotated,
        paused: fails >= 2 ? `连续 ${fails} 次没写成：${full.error}` : s.paused })
      return full
    }
    try {
      const { cards, missing, rotated, avoid, budget } = await this.plan()
      if (budget <= 0) return finish({ ok: true, note: `这个月到了 ${this.caps.monthYuan} 元的上限，下个月再补` })
      if (!cards.length) return finish({ ok: true, note: '没有能写的事了' })
      // 实际用量再卡一道：超过这一次的上限就停（估算偏小的时候不至于多花）
      const metered = async req => {
        if (tin + tout >= budget) { ctrl.abort(); throw new Error(`这一次的 token 上限（${budget}）用完了`) }
        const res = await this.adapter(req)
        const u = spent(res.usage, req.system, req.prompt, res.text)
        tin += u.in; tout += u.out
        return res
      }
      const r = await styleRun({ adapter: metered, cards, route: this.route(), signal: ctrl.signal, avoid })
      const ids = Object.keys(r.lines)
      const tried = { ...this.#state().tried }
      for (const c of cards) { if (r.lines[c.id]) delete tried[c.id]; else tried[c.id] = [(tried[c.id]?.[0] || 0) + 1, at] }
      this.store.update(s => ({ ...s, styled: { ...(s.styled || {}), ...r.lines }, styledAt: { ...(s.styledAt || {}), ...Object.fromEntries(ids.map(id => [id, at])) }, styledMeta: { route: this.route(), at } }))
      this.#save({ tried })
      const ok = ids.length > 0
      return finish({ ok, tried: cards.length, added: ids.filter(id => missing.has(id)).length, rotated: ids.filter(id => rotated.has(id)).length,
        withButtons: ids.filter(id => r.lines[id][0].options.length >= 2).length, error: ok ? null : r.errors[0] || r.failed[0]?.why || '模型没写出能用的台词' })
    } catch (err) {
      return finish({ ok: false, error: err?.message || String(err) })
    }
  }
}
