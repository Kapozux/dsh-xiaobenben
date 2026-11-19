// 用本机真实记录生成全部旧账（和插件同一套逻辑），每条带上：用了哪条模板、那一轮的原始记录、多少天以前、机器检查结果。
// 只读 ~/.claude，不调模型、不联网。产物只放 proto/lines-review/out/（git 不收，里面有原话）。
import path from 'node:path'
import { buildMoments } from '../../src/core/moments.js'
import { loadClaudeTurns } from '../../src/sources/claude-turns.js'
import { checkLine } from '../../scripts/lines-standard.mjs'

export const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out')
export const AGES = [[7, '一周内'], [30, '一个月内'], [60, '一到两个月'], [Infinity, '两个月以上']]
export const ageOf = days => AGES.find(([max]) => days <= max)[1]

export async function realMoments({ days = 120, now = Date.now() } = {}) {
  const since = now - days * 864e5
  const { turns, sessions } = await loadClaudeTurns({ since })
  const moments = buildMoments(turns, { since, now, days, withSource: true }).map(m => {
    const ageDays = Math.max(0, Math.floor((now - m.ts) / 864e5))
    const type = m.event                                    // 模板类型 = 事件（caught / streak / stat_first …）
    const bad = checkLine(m.text, { sources: m.source, card: m.card, project: [m.card.project, m.card.task].filter(Boolean).join(' '), sensitive: m.sensitive })
    const dated = m.kind !== 'stat' || ['stat_first', 'stat_streak', 'stat_busiest', 'stat_latest', 'stat_today'].includes(m.event)
    return { ...m, type, ageDays, age: dated ? ageOf(ageDays) : '总账', bad }
  })
  return { moments, sessions, turns: turns.filter(t => t.start >= since).length, days }
}
