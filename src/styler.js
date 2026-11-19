/**
 * 翻旧账的台词「模型写为主，模板兜底」：
 *   第一次打开问一次（state.json 的 styleAsked）→ 给主人看要发什么、多少 token → 主人点「发送」→ 后台跑：每件事写 5 版、程序核对、再让模型挑一版 → 结果存本机（state.json 的 styled：事件 id → [选中的那一版]）。
 *   之后点小本本只从这个库里抽，不调模型；有新事件时主人点「更新台词」才再发一次（只发新的）。
 *   没同意、没配模型、调用失败、某件事一个版本都没过核对：照旧说模板的（Pet.moments 里换）。
 * 同一时间只跑一个，不排队；页面关了照跑，页面轮询 status。
 */
import { styleQuote, styleRun, cardsHash, validLines } from './core/style.js'

export class Styler {
  /** @param {{ pet: import('./pet.js').Pet, store: import('./store.js').Store, adapter: any, prices?: any[] }} deps */
  constructor({ pet, store, adapter, prices = [] }) {
    this.pet = pet
    this.store = store
    this.adapter = adapter
    this.prices = prices
    this.job = null
    this.last = null
  }

  /** 要发的卡片：私事不发；redo=false 时只发库里还没有的（新事件） */
  async pending(redo = false) {
    const { moments } = await this.pet.moments({ raw: true })
    const have = this.store.read().styled || {}
    // 库里有、但照现在的事件卡已经对不上的（时间过期了、数变了），也算还没写
    return moments.filter(m => m.card?.id && m.card.fact && !m.sensitive.length && (redo || !validLines(m.card, have[m.card.id]).length)).map(m => m.card)
  }

  /** 第一次问过了没有、主人怎么答的：'yes' | 'no' | null（还没问） */
  asked() { return this.store.read().styleAsked || null }
  answer(a) { this.store.update(s => ({ ...s, styleAsked: a === 'yes' ? 'yes' : 'no' })); return { ok: true } }

  async quote({ route, redo = false }) {
    const cards = await this.pending(redo)
    const all = (await this.pet.moments({ raw: true })).moments
    return { ...styleQuote(cards, route, this.prices), styled: Object.keys(this.store.read().styled || {}).length, total: all.length, privateSkipped: all.filter(m => m.sensitive.length).length }
  }

  async start({ route, hash, redo = false }) {
    if (this.job) return { ok: false, error: '上一次还在跑，等它结束' }
    const cards = await this.pending(redo)
    if (!cards.length) return { ok: false, error: '没有新的事要写了' }
    if (cardsHash(cards) !== hash) return { ok: false, error: '记录变了，请重新看一遍要发什么再发送' }
    const ctrl = new AbortController()
    const job = { route, total: cards.length, done: 0, ok: 0, failed: 0, startedAt: Date.now(), ctrl }
    this.job = job
    styleRun({
      adapter: this.adapter, cards, route, signal: ctrl.signal,
      onProgress: p => {
        Object.assign(job, p)
      },
    }).then(r => {
      // 每批的结果最后一起存：中途停了也把已经写好的存下
      this.store.update(s => ({ ...s, styleAsked: 'yes', styled: { ...(s.styled || {}), ...r.lines }, styledMeta: { route, at: Date.now() } }))
      const why = {}
      for (const f of r.failed) why[f.why] = (why[f.why] || 0) + 1
      this.last = { ok: Object.keys(r.lines).length, dropped: r.dropped, failed: r.failed.length, why, errors: [...new Set(r.errors)].slice(0, 3), total: cards.length, at: Date.now(), route }
      if (r.failed.length) console.warn('[dsh-xiaobenben] 没过核对、用模板兜底的：', why)
    }).catch(err => {
      console.warn('[dsh-xiaobenben] 模型写台词出错', err)
      this.last = { ok: 0, failed: cards.length, why: {}, errors: [err?.message || String(err)], total: cards.length, at: Date.now(), route }
    }).finally(() => { this.job = null })
    return { ok: true, total: cards.length }
  }

  stop() { this.job?.ctrl.abort(); return { ok: true } }

  clear() { this.store.update(s => ({ ...s, styled: {}, styledMeta: null })); return { ok: true } }

  async status() {
    const j = this.job
    let pending = null
    try { pending = (await this.pending(false)).length } catch (err) { console.warn('[dsh-xiaobenben] 数新事件失败', err?.message) }
    return {
      asked: this.asked(),
      pending,                              // 库里还没有的事（「更新台词」会发的件数）
      running: j ? { total: j.total, done: j.done, ok: j.ok, failed: j.failed, stage: j.stage, route: j.route } : null,
      last: this.last,
      styled: Object.keys(this.store.read().styled || {}).length,
      meta: this.store.read().styledMeta || null,
    }
  }
}
