/**
 * 「翻旧账」的台词来源：从会话记录里挑出能说的事（moments）。
 * - dsh 自己的会话（ctx.sessionQuery）一定读；Claude Code 只在「设置 → 年度回顾」里勾了才读（和回顾页同一个开关）。
 * - 确定性模板，不调模型；10 分钟缓存，同一时间只算一次。
 * 每件事带一个动作名（anim：work / sigh / cheer……），挂件按它换表情（src/shared/pet-engine.js 的 EXPR）。
 */
import { buildMoments, dshTurns } from './core/moments.js'
import { loadClaudeTurns } from './sources/claude-turns.js'

export class Pet {
  /**
   * @param {{ sessionQuery: any, store: import('./store.js').Store, days?: number, loadClaude?: typeof loadClaudeTurns }} deps
   */
  constructor({ sessionQuery, store, days = 120, loadClaude = loadClaudeTurns }) {
    this.sessionQuery = sessionQuery
    this.store = store
    this.days = days
    this.loadClaude = loadClaude
    this.cache = null
    this.pending = null
  }

  /**
   * 同一时间只翻一次记录：并发的请求等同一个结果。
   * 过了 10 分钟先给旧的、后台重算（右键「翻旧账」要点了就说，不能等几秒读记录）；只有第一次和 fresh 才真等。
   */
  moments({ fresh = false, raw = false } = {}) {
    const p = this.#moments(fresh)
    return raw ? p : p.then(v => this.#styled(v))
  }

  /** 有 AI 改写过的就换成改写的说法（m.styled = true），没有的照旧说模板的 */
  #styled(v) {
    const styled = this.store.read().styled || {}
    return { ...v, moments: v.moments.map(m => styled[m.card?.id] ? { ...m, text: styled[m.card.id], template: m.text, styled: true } : m) }
  }

  #moments(fresh) {
    const claudeOn = !!this.store.read().sources?.claude
    const key = claudeOn ? 'c' : 'd'
    const have = this.cache && this.cache.key === key
    if (!fresh && have && Date.now() - this.cache.at < 10 * 60e3) return Promise.resolve(this.cache.value)
    if (!fresh && have) {
      if (this.pending?.key !== key) this.#start(key, claudeOn).catch(err => console.warn('[dsh-xiaobenben] 后台重翻记录失败', err))
      return Promise.resolve(this.cache.value)
    }
    return this.#start(key, claudeOn)
  }

  #start(key, claudeOn) {
    if (this.pending?.key === key) return this.pending.promise
    const promise = this.#compute(key, claudeOn).finally(() => { if (this.pending?.promise === promise) this.pending = null })
    this.pending = { key, promise }
    return promise
  }

  async #compute(key, claudeOn) {
    const since = Date.now() - this.days * 864e5
    const turns = []
    const report = []
    try {
      const records = await this.sessionQuery.listSessions()
      let n = 0, failed = 0
      for (const r of records) {
        const h = r.header
        if (!h || h.origin === 'subagent') continue
        if ((h.createdAt || 0) < since - 30 * 864e5) continue     // 很早建的会话后来也可能续上，多看一个月
        try {
          const log = await this.sessionQuery.readSession(h.id)
          const t = dshTurns(h.id, h, log.events)
          if (t.length) { n++; turns.push(...t) }
        } catch (err) { failed++; console.warn('[dsh-xiaobenben] 读会话失败', h.id, err?.message) }
      }
      report.push({ id: 'dsh', sessions: n, failed })
    } catch (err) {
      console.warn('[dsh-xiaobenben] 列会话失败', err)
      report.push({ id: 'dsh', error: err?.message || String(err) })
    }
    if (claudeOn) {
      const r = await this.loadClaude({ since })
      turns.push(...r.turns)
      report.push({ id: 'claude', sessions: r.sessions, skipped: r.skipped })
    }
    const moments = buildMoments(turns, { since, days: this.days })
    const value = { moments, report, turns: turns.filter(t => t.start >= since).length, days: this.days }
    this.cache = { key, at: Date.now(), value }
    return value
  }

}
