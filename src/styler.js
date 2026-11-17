/**
 * 翻旧账的 AI 改写：报价 → 用户点「发送」→ 后台一批批跑 → 结果存本机（state.json 的 styled）。
 * 点 dsh-pet 或翻旧账那页时，有改写过的就说改写的，没有就说模板的（Pet.moments 里换）。
 * 同一时间只跑一个，不排队；页面关了照跑，页面轮询 status。
 */
import { styleQuote, styleRun, cardsHash } from './core/style.js'

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

  /** 要发的卡片：私事不发；redo=false 时只发还没改写过的 */
  async pending(redo = false) {
    const { moments } = await this.pet.moments({ raw: true })
    const have = this.store.read().styled || {}
    return moments.filter(m => m.card?.id && !m.sensitive.length && (redo || !have[m.card.id])).map(m => m.card)
  }

  async quote({ route, redo = false }) {
    const cards = await this.pending(redo)
    const all = (await this.pet.moments({ raw: true })).moments
    return { ...styleQuote(cards, route, this.prices), styled: Object.keys(this.store.read().styled || {}).length, total: all.length, privateSkipped: all.filter(m => m.sensitive.length).length }
  }

  async start({ route, hash, redo = false }) {
    if (this.job) return { ok: false, error: '上一次还在跑，等它结束' }
    const cards = await this.pending(redo)
    if (!cards.length) return { ok: false, error: '没有要改写的了' }
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
      this.store.update(s => ({ ...s, styled: { ...(s.styled || {}), ...r.lines }, styledMeta: { route, at: Date.now() } }))
      const why = {}
      for (const f of r.failed) why[f.why] = (why[f.why] || 0) + 1
      this.last = { ok: Object.keys(r.lines).length, failed: r.failed.length, why, errors: [...new Set(r.errors)].slice(0, 3), total: cards.length, at: Date.now(), route }
      if (r.failed.length) console.warn('[dsh-xiaobenben] 改写没过核对、用模板兜底的：', why)
    }).catch(err => {
      console.warn('[dsh-xiaobenben] 改写台词出错', err)
      this.last = { ok: 0, failed: cards.length, why: {}, errors: [err?.message || String(err)], total: cards.length, at: Date.now(), route }
    }).finally(() => { this.job = null })
    return { ok: true, total: cards.length }
  }

  stop() { this.job?.ctrl.abort(); return { ok: true } }

  clear() { this.store.update(s => ({ ...s, styled: {}, styledMeta: null })); return { ok: true } }

  status() {
    const j = this.job
    return {
      running: j ? { total: j.total, done: j.done, ok: j.ok, failed: j.failed, route: j.route } : null,
      last: this.last,
      styled: Object.keys(this.store.read().styled || {}).length,
      meta: this.store.read().styledMeta || null,
    }
  }
}
