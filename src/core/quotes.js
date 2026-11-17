/**
 * 原话候选：只从用户自己说的话里按规则挑。每条原样保留（只经过打码），带日期和来源 agent。
 */
import { mask } from './redact.js'
import { sensitiveCats } from './sensitive.js'
import { dayKey } from './stats.js'
import { AGENT_NAMES } from './types.js'

export const MAX_QUOTE_CHARS = 2000      // 单条超过就不进候选（贴代码、贴日志）
export const SHORT_CHARS = 20            // 「短句」：去掉首尾空白后不超过这么多字

/** 判断「同一句话」时用的键：只抹掉首尾空白、大小写和结尾标点，显示时用原文。 */
export const normKey = text => text.trim().toLowerCase().replace(/[\s。．.!！?？~～,，…]+$/u, '')

/** 用户消息平铺成一列，带上 agent，已按时间排好。 */
export function userLines(convs) {
  const out = []
  for (const c of convs) for (const m of c.msgs) if (m.role === 'user') out.push({ t: m.t, agent: c.agent, conv: c.id, text: m.text })
  return out.sort((a, b) => a.t - b.t)
}

const minuteOfDay = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 }

/**
 * @param {import('./types.js').Conv[]} convs 已经 clip 过的
 * @param {{ sensitiveExtra?: Record<string, string[]> }} [opts]
 */
export function pickQuotes(convs, opts = {}) {
  const lines = userLines(convs).filter(l => [...l.text].length <= MAX_QUOTE_CHARS)
  const card = (kind, l, extra = {}) => {
    const text = mask(l.text)
    return { kind, text, day: dayKey(l.t), t: l.t, agent: l.agent, agentName: AGENT_NAMES[l.agent] || l.agent, sensitive: sensitiveCats(text, opts.sensitiveExtra), ...extra }
  }

  // 重复最多的短句
  const groups = new Map()
  for (const l of lines) {
    if ([...l.text.trim()].length > SHORT_CHARS) continue
    const k = normKey(l.text)
    if (!k) continue
    const g = groups.get(k)
    if (g) g.count++
    else groups.set(k, { first: l, count: 1 })
  }
  const repeated = [...groups.values()]
    .filter(g => g.count >= 2)
    .sort((a, b) => b.count - a.count || a.first.t - b.first.t)
    .slice(0, 5)
    .map(g => card('repeated', g.first, { count: g.count }))

  const first = lines[0] ? card('first', lines[0]) : null

  // 凌晨最晚的一句：0–5 点之间，钟面时间最晚的那句；同一时刻取日期最近的
  let late = null
  for (const l of lines) {
    if (new Date(l.t).getHours() >= 5) continue
    if (!late || minuteOfDay(l.t) > minuteOfDay(late.t) || (minuteOfDay(l.t) === minuteOfDay(late.t) && l.t > late.t)) late = l
  }
  const lateCard = late ? card('late', late, { time: new Date(late.t).toTimeString().slice(0, 5) }) : null

  // 平时说的话：全年等间隔挑几句短句（轻量版式「少放数字，多放原话」用）。确定性，不随机。
  const used = new Set([first, lateCard, ...repeated].filter(Boolean).map(c => normKey(c.text)))
  const pool = lines.filter(l => { const n = [...l.text.trim()].length; return n >= 4 && n <= 60 && !used.has(normKey(l.text)) })
  const extras = []
  const seen = new Set()
  const want = 8
  for (let i = 0; i < pool.length && extras.length < want; i += Math.max(1, Math.floor(pool.length / want))) {
    const k = normKey(pool[i].text)
    if (seen.has(k)) continue
    seen.add(k)
    extras.push(card('extra', pool[i]))
  }

  return { repeated, first, late: lateCard, extras }
}
