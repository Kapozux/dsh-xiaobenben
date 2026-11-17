/**
 * 大肥鱼（悬浮桌宠）的 Host 这一半：攒台词、给动画文件。
 * - 台词：dsh 自己的会话（ctx.sessionQuery）一定读；Claude Code 只在「设置 → 年度回顾」里勾了才读（和回顾页用同一个开关）。
 *   确定性模板，不调模型；10 分钟缓存，点一下不重算。
 * - 动画：本插件不带画。先借本机已经装了的 dsh-pet（MIT）的透明 webm，找不到就让页面用备用形象。
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildMoments, dshTurns } from './core/moments.js'
import { loadClaudeTurns } from './sources/claude-turns.js'
import { dshHome } from './store.js'

/** 时刻里的 anim → dsh-pet 的动画文件名 */
export const ANIM = {
  idle: '待机呼吸休闲', work: '写代码', yawn: '哈欠连天', startle: '被吓一跳', caught: '偷吃零食被抓住',
  sigh: '工作状态-垂头叹气冒汗', bow: '女仆屈膝礼仪', cheer: '工作状态-雀跃庆祝', eat: '吃白饭', file: '工作状态-清点归档',
  poke: '点击回应-开心跃动', drag: '被鼠标拖拽悬空反馈',
}

/** 找本机装着的 dsh-pet 动画目录：配置优先，否则在 $DSH_HOME/profiles/* 里找。 */
export function findPetAssets(configured) {
  const cands = []
  if (configured) cands.push(configured)
  try {
    const profiles = path.join(dshHome(), 'profiles')
    for (const p of fs.readdirSync(profiles)) cands.push(path.join(profiles, p, 'node_modules', 'dsh-pet', 'assets', 'webm'))
  } catch {}
  return cands.find(d => { try { return fs.statSync(path.join(d, ANIM.idle + '.webm')).isFile() } catch { return false } }) || null
}

export class Pet {
  /**
   * @param {{ sessionQuery: any, store: import('./store.js').Store, assets?: string, days?: number, loadClaude?: typeof loadClaudeTurns }} deps
   */
  constructor({ sessionQuery, store, assets = null, days = 120, loadClaude = loadClaudeTurns }) {
    this.sessionQuery = sessionQuery
    this.store = store
    this.assetsDir = findPetAssets(assets)
    this.days = days
    this.loadClaude = loadClaude
    this.cache = null
  }

  /** 同一时间只翻一次记录：并发的请求等同一个结果 */
  moments({ fresh = false } = {}) {
    const claudeOn = !!this.store.read().sources?.claude
    const key = claudeOn ? 'c' : 'd'
    if (!fresh && this.cache && this.cache.key === key && Date.now() - this.cache.at < 10 * 60e3) return Promise.resolve(this.cache.value)
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
        } catch (err) { failed++; console.warn('[dsh-agent-year] 读会话失败', h.id, err?.message) }
      }
      report.push({ id: 'dsh', sessions: n, failed })
    } catch (err) {
      report.push({ id: 'dsh', error: err?.message || String(err) })
    }
    if (claudeOn) {
      const r = await this.loadClaude({ since })
      turns.push(...r.turns)
      report.push({ id: 'claude', sessions: r.sessions, skipped: r.skipped })
    }
    const moments = buildMoments(turns, { since, days: this.days })
    const value = { moments, report, turns: turns.filter(t => t.start >= since).length, days: this.days, anims: this.assetsDir ? Object.keys(ANIM) : [] }
    this.cache = { key, at: Date.now(), value }
    return value
  }

  /** @returns {Buffer|null} */
  anim(name) {
    if (!this.assetsDir || !Object.hasOwn(ANIM, name)) return null
    try { return fs.readFileSync(path.join(this.assetsDir, ANIM[name] + '.webm')) } catch { return null }
  }
}
