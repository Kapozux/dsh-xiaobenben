/**
 * 要发给模型的材料：只有会话标题 + 每月抽样最多 30 条用户短句。
 * 都已打码、已去掉超长消息、默认去掉敏感内容。报价页把这份东西原样给用户看，发出去的就是它，一个字不多。
 */
import { mask } from './redact.js'
import { sensitiveCats } from './sensitive.js'
import { dayKey, monthKey } from './stats.js'
import { userLines, normKey } from './quotes.js'
import { AGENT_NAMES, EXTERNAL_AGENTS } from './types.js'

export const PER_MONTH = 30
export const SAMPLE_MAX_CHARS = 200      // 抽样只要短句
export const MAX_TITLES = 200

/**
 * @param {import('./types.js').Conv[]} convs 已经 clip 过的
 * @param {{ includeSensitive?: boolean, sensitiveExtra?: Record<string, string[]> }} [opts]
 */
export function buildMaterial(convs, opts = {}) {
  const keep = text => opts.includeSensitive || sensitiveCats(text, opts.sensitiveExtra).length === 0
  let droppedSensitive = 0

  const byMonth = new Map()
  const seen = new Set()
  for (const l of userLines(convs)) {
    const text = l.text.trim()
    if (!text || [...text].length > SAMPLE_MAX_CHARS) continue
    const masked = mask(text)
    const k = normKey(masked)
    if (seen.has(k)) continue
    seen.add(k)
    if (!keep(masked)) { droppedSensitive++; continue }
    const m = monthKey(l.t)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m).push({ day: dayKey(l.t), agent: l.agent, text: masked })
  }
  // 每月等间隔取 30 条：确定性，同样的数据每次抽到同样的句子
  const samples = []
  for (const [month, list] of [...byMonth.entries()].sort()) {
    const step = list.length / Math.min(PER_MONTH, list.length)
    for (let i = 0; i < Math.min(PER_MONTH, list.length); i++) samples.push({ month, ...list[Math.floor(i * step)] })
  }

  const titles = []
  const seenT = new Set()
  for (const c of [...convs].sort((a, b) => a.msgs[0].t - b.msgs[0].t)) {
    if (!c.title) continue
    const t = mask(c.title.trim())
    if (!t || seenT.has(t)) continue
    seenT.add(t)
    if (!keep(t)) { droppedSensitive++; continue }
    titles.push({ agent: c.agent, text: t })
    if (titles.length >= MAX_TITLES) break
  }

  const agents = [...new Set([...samples.map(s => s.agent), ...titles.map(t => t.agent)])]
  return {
    titles,
    samples,
    droppedSensitive,
    agents,
    /** 来自 Claude Code / Codex / Cursor 的条数：报价页要单独标出来 */
    external: EXTERNAL_AGENTS
      .map(a => ({ agent: a, name: AGENT_NAMES[a], count: samples.filter(s => s.agent === a).length + titles.filter(t => t.agent === a).length }))
      .filter(x => x.count),
  }
}

/** 材料 → 发给模型的正文（报价页「查看全部」显示的就是这段）。 */
export function materialText(material) {
  const parts = ['## 会话标题', ...material.titles.map(t => `- [${AGENT_NAMES[t.agent]}] ${t.text}`), '', '## 用户原话（每月抽样）']
  let month = ''
  for (const s of material.samples) {
    if (s.month !== month) { month = s.month; parts.push(`### ${month}`) }
    parts.push(`- ${s.day} [${AGENT_NAMES[s.agent]}] ${s.text}`)
  }
  return parts.join('\n')
}
