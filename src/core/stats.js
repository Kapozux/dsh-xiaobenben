/**
 * 统计：全部是确定性代码，不调模型。时间一律按本机时区切日（凌晨统计必须用本地时间）。
 * token 和费用不算：dsh-usage 已经做了。
 */
import { AGENT_NAMES } from './types.js'

const pad = n => String(n).padStart(2, '0')
/** 本地日期 YYYY-MM-DD */
export const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
/** 本地月份 YYYY-MM */
export const monthKey = t => dayKey(t).slice(0, 7)
const hourOf = t => new Date(t).getHours()

/** 下一天的 YYYY-MM-DD（按日历走，不受夏令时影响）。 */
function nextDay(key) {
  const [y, m, d] = key.split('-').map(Number)
  const n = new Date(y, m - 1, d + 1)
  return dayKey(n.getTime())
}

/** 默认范围：截至今天的过去一年。 */
export function defaultRange(now = Date.now()) {
  const end = new Date(now)
  const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate() + 1)
  return { start: start.getTime(), end: now }
}

/**
 * 只留范围内的消息；没剩下用户消息的会话整个去掉。
 * @param {import('./types.js').Conv[]} convs
 * @param {{ start: number, end: number }} range
 */
export function clip(convs, range) {
  return convs
    .map(c => ({ ...c, msgs: c.msgs.filter(m => m.t >= range.start && m.t <= range.end).sort((a, b) => a.t - b.t) }))
    .filter(c => c.msgs.some(m => m.role === 'user'))
}

/** 一个会话里有几轮：一句用户的话之后、下一句之前，agent 回过至少一次，算一轮。 */
export function roundsOf(msgs) {
  let rounds = 0
  let open = false
  for (const m of msgs) {
    if (m.role === 'user') open = true
    else if (open) { rounds++; open = false }
  }
  return rounds
}

/** 会话的显示名：有标题用标题，没有就用第一句话的前 20 个字。 */
export function convLabel(conv) {
  if (conv.title && conv.title.trim()) return { text: conv.title.trim(), fromTitle: true }
  const first = conv.msgs.find(m => m.role === 'user')?.text.replace(/\s+/g, ' ').trim() || ''
  return { text: [...first].slice(0, 20).join(''), fromTitle: false }
}

/**
 * @param {import('./types.js').Conv[]} convs 已经 clip 过的
 * @returns 统计结果（全是可 JSON 化的值）
 */
export function computeStats(convs) {
  const userMsgs = []
  for (const c of convs) for (const m of c.msgs) if (m.role === 'user') userMsgs.push({ t: m.t, agent: c.agent })
  userMsgs.sort((a, b) => a.t - b.t)

  const days = new Map()
  const months = new Map()
  const lateByDay = new Map()
  const hours = Array(24).fill(0)
  for (const m of userMsgs) {
    const d = dayKey(m.t)
    days.set(d, (days.get(d) || 0) + 1)
    months.set(monthKey(m.t), (months.get(monthKey(m.t)) || 0) + 1)
    const h = hourOf(m.t)
    hours[h]++
    if (h < 5) lateByDay.set(d, (lateByDay.get(d) || 0) + 1)
  }

  // 最长连续天数
  const sortedDays = [...days.keys()].sort()
  let best = sortedDays.length ? { days: 1, from: sortedDays[0], to: sortedDays[0] } : null
  let run = best && { ...best }
  for (let i = 1; i < sortedDays.length; i++) {
    if (nextDay(sortedDays[i - 1]) === sortedDays[i]) { run.days++; run.to = sortedDays[i] } else run = { days: 1, from: sortedDays[i], to: sortedDays[i] }
    if (run.days > best.days) best = { ...run }
  }

  const maxEntry = map => [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
  const bm = maxEntry(months)
  const late = maxEntry(lateByDay)                                   // 0–5 点之间消息最多的那天

  // 各 agent
  const per = {}
  for (const c of convs) {
    const p = per[c.agent] ??= { agent: c.agent, name: AGENT_NAMES[c.agent] || c.agent, sessions: 0, userMsgs: 0, rounds: 0, days: new Set() }
    p.sessions++
    p.rounds += roundsOf(c.msgs)
    for (const m of c.msgs) if (m.role === 'user') { p.userMsgs++; p.days.add(dayKey(m.t)) }
  }
  const perAgent = Object.values(per)
    .map(p => ({ agent: p.agent, name: p.name, sessions: p.sessions, userMsgs: p.userMsgs, rounds: p.rounds, activeDays: p.days.size }))
    .sort((a, b) => b.userMsgs - a.userMsgs)

  const total = userMsgs.length
  const shares = []
  let other = 0
  for (const p of perAgent) {
    const share = total ? p.userMsgs / total : 0
    if (share < 0.01) other += p.userMsgs
    else shares.push({ agent: p.agent, name: p.name, count: p.userMsgs, share })
  }
  if (other) shares.push({ agent: 'other', name: '其他', count: other, share: other / total })

  // 最长的会话：按轮数，同轮数比用户消息数
  let longest = null
  for (const c of convs) {
    const r = roundsOf(c.msgs)
    const u = c.msgs.filter(m => m.role === 'user').length
    if (!longest || r > longest.rounds || (r === longest.rounds && u > longest.userMsgs)) {
      longest = { agent: c.agent, id: c.id, rounds: r, userMsgs: u, label: convLabel(c), day: dayKey(c.msgs[0].t) }
    }
  }

  return {
    totals: { sessions: convs.length, userMsgs: total, rounds: perAgent.reduce((s, p) => s + p.rounds, 0) },
    firstDay: sortedDays[0] || null,
    lastDay: sortedDays.at(-1) || null,
    activeDays: days.size,
    longestStreak: best,
    busiestMonth: bm ? { month: bm[0], count: bm[1] } : null,
    lateNight: late ? { day: late[0], count: late[1] } : null,
    months: Object.fromEntries([...months.entries()].sort()),
    hours,
    shares,
    perAgent,
    longest,
    light: total < 200,                                                // 不到 200 条换一套版式
  }
}
