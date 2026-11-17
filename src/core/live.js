/**
 * 「现在」：她陪你等活、提醒你上次停在哪、半夜说这个点、你骂它时站你这边——要的事实都从这里算。
 * 纯函数，不读文件（读文件在 src/live.js）。只放程序算出来的事实，台词在 src/shared/lines.js 的 LINES.live。
 *
 * 「在跑」：一份记录的最后一轮还没结束（Claude Code 没记 system/turn_duration、dsh 没有 turn/end），
 * 而且最近 RUNNING_STALE 内还写过东西（会话被直接关掉时最后一轮永远不会结束，不能一直算在跑）。
 */
import { task, short, isHuman, FILLER, COMPLAIN, dur, when, clock } from './moments.js'

export const RUNNING_STALE = 20 * 60e3

const firstLine = s => String(s || '').split('\n')[0].trim()
const pad = n => String(n).padStart(2, '0')
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/** 哪件事：话题 → 派活原话 → 同一份记录前面派的活 */
function taskOf(turns, i) {
  const tr = turns[i]
  const t = task(tr)
  if (t) return t
  const ask = firstLine(tr.text)
  if (!FILLER.test(ask) && !COMPLAIN.test(ask) && [...ask].length >= 4 && isHuman(ask)) return `「${short(ask, 14)}」`
  for (let k = i - 1; k >= 0 && k >= i - 6; k--) { const p = task(turns[k]); if (p) return p }
  return null
}

/** 什么时候：今天 / 昨天就说「今天下午 3:06」，再早的说日期 */
export function whenNear(ts, now = Date.now()) {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 864e5)
  const w = when(ts)
  return days === 0 ? '今天' + w.replace(/^\d+ 月 \d+ 日/, '') : days === 1 ? '昨天' + w.replace(/^\d+ 月 \d+ 日/, '') : w
}

/** 它最后交代的一句：最后一段话的最后一行，去掉 Markdown，太长截短 */
function lastSaid(tr) {
  const tx = tr.texts?.at(-1) || ''
  const lines = tx.split('\n').map(l => l.replace(/^[-*#>\d.\s|]+/, '').replace(/[*`_]/g, '').trim()).filter(l => /[一-鿿A-Za-z]/.test(l))
  const l = lines.at(-1) || lines[0]
  return l ? short(l, 18) : null
}

/**
 * @param {{ recent: { key: string, agent: string, turns: any[] }[], history: any[], now?: number }} input
 *   recent：最近写过的几份记录（每份按时间排好的轮，判断在不在跑）；history：最近一周多的轮（算今天几件、这周骂了几回、上回这个点、上次停在哪）
 */
export function liveState({ recent = [], history = [], now = Date.now() }) {
  // 合并：同一轮（同一份记录 + 同一开始时间）以刚读的为准
  const all = new Map()
  for (const t of history) all.set(t.key + '|' + t.start, t)
  for (const r of recent) for (const t of r.turns) all.set(t.key + '|' + t.start, t)
  const turns = [...all.values()].filter(t => isHuman(firstLine(t.text))).sort((a, b) => a.start - b.start)
  const byKey = new Map()
  for (const t of turns) { if (!byKey.has(t.key)) byKey.set(t.key, []); byKey.get(t.key).push(t) }
  const nameOf = t => { const list = byKey.get(t.key) || [t]; return taskOf(list, list.indexOf(t)) }

  const busy = []
  for (const r of recent) {
    const list = byKey.get(r.key) || []
    const tr = list.at(-1)
    if (!tr || tr.ended || tr.interrupted || now - tr.last > RUNNING_STALE) continue
    const ask = firstLine(tr.text)
    busy.push({ key: r.key, agent: r.agent, start: tr.start, ms: Math.max(0, now - tr.start), dur: dur(Math.max(60e3, now - tr.start)),
      task: nameOf(tr) || '这件活', angry: COMPLAIN.test(ask) && [...ask].length <= 40, project: tr.project || null })
  }
  const busyKeys = new Set(busy.map(b => b.key + '|' + b.start))

  // 上次停在哪：最新的一轮做完了的（正在跑的不算）
  const done = turns.filter(t => !busyKeys.has(t.key + '|' + t.start) && (t.ended || t.interrupted || now - t.last > RUNNING_STALE))
  const lt = done.at(-1)
  const last = lt ? { key: lt.key, ts: lt.end, w: whenNear(lt.end, now), task: nameOf(lt), said: lt.interrupted ? null : lastSaid(lt), interrupted: !!lt.interrupted, dur: dur(Math.max(60e3, lt.active)) } : null

  const today = turns.filter(t => dayKey(t.start) === dayKey(now))
  const todayMs = today.reduce((a, t) => a + t.active, 0)
  const complain = turns.filter(t => now - t.start < 7 * 864e5 && COMPLAIN.test(firstLine(t.text)) && [...firstLine(t.text)].length <= 40).length

  // 上回这个点：前几天同一个钟点（前后一小时）在干的活
  const h = new Date(now).getHours()
  const near = t => { const d = Math.abs(new Date(t.start).getHours() - h); return Math.min(d, 24 - d) <= 1 }
  const nt = [...turns].reverse().find(t => dayKey(t.start) !== dayKey(now) && near(t) && nameOf(t))
  const night = nt ? { w: whenNear(nt.start, now), task: nameOf(nt) } : null

  // 这个项目最久的一轮（陪你等时拿来比）
  const longest = {}
  for (const b of busy) {
    const same = turns.filter(t => t.project && t.project === b.project && !busyKeys.has(t.key + '|' + t.start))
    const top = same.sort((x, y) => y.active - x.active)[0]
    if (top && top.active >= 5 * 60e3) longest[b.key] = dur(top.active)
  }

  return { at: now, clock: clock(now), busy, last, today: { n: today.length, dur: todayMs >= 60e3 ? dur(todayMs) : null }, complain, night, longest }
}
