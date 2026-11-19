// 台词模板检查：node scripts/check-lines.mjs [--list]
//   每条模板：标了情绪（笑 / 被懂 / 骄傲 / 怀念）和态度（心虚 / 撒娇 / 邀功 / 自嘲）；占位符都认得；「」里只有占位符（不许编带引号的话）；
//   用典型值填出来过台词标准（docs/lines-standard.md：≤40 字、最多两轮、不套娃、没行话）。
// 加 --real：用本机真实记录生成的全部台词逐条过标准（含原话逐字、数字真实、私事），明细写到 proto/lines-review/out/（有原话，不进仓库）。
import { TPL, KIND_OF } from '../src/core/lines.js'
import { render } from '../src/core/moments.js'
import { checkLine, tally } from '../src/core/standard.js'

export const MOODS = ['笑', '被懂', '骄傲', '怀念']
export const TONES = ['心虚', '撒娇', '邀功', '自嘲']
/** 典型值：时间说法取最常见的长度，原话取 6 个字 */
export const TYPICAL = { t: '上周三晚上', said: '怎么还没好啊', next: '还是不行啊', claim: '改好了', n: 4, m: 12, k: 3, w: 7, dur: '26 分钟', few: '3 分钟', long: '48 分钟', rice: '11 大碗', clock: '1:02', project: 'my-app', days: 23, files: 41, rel: '上个月', relday: '上个月有一天', span: 120 }
/** 模板里允许直接写的带引号的话（确实是主人说过的，生成时有记录可对） */
const FIXED_QUOTES = ['继续']

export function check() {
  const report = {}
  for (const [event, list] of Object.entries(TPL)) {
    const bad = []
    list.forEach((l, i) => {
      const why = []
      if (!MOODS.includes(l.mood)) why.push(`情绪没标或不认识：${l.mood}`)
      if (!TONES.includes(l.tone)) why.push(`态度没标或不认识：${l.tone}`)
      for (const k of [...l.t.matchAll(/\{(\w+)\}/g)].map(m => m[1])) if (!(k in TYPICAL)) why.push(`不认识的占位符 {${k}}`)
      for (const q of [...l.t.matchAll(/「([^」]*)」/g)].map(m => m[1])) if (!/^\{\w+\}$/.test(q) && !FIXED_QUOTES.includes(q)) why.push(`引号里不是原话：「${q}」`)
      const out = render(l.t, TYPICAL)
      if (/[{}]|，，|。，|「，/.test(out)) why.push(`填完有残留：${out}`)
      for (const b of checkLine(out, { project: TYPICAL.project })) why.push(`${b.rule}（${b.why}）：${out.replace(/\n/g, ' ⏎ ')}`)
      if (why.length) bad.push({ id: `${event}#${i}`, tpl: l.t, why })
    })
    report[event] = { count: list.length, bad, dup: list.length - new Set(list.map(l => l.t)).size, kind: KIND_OF[event] || 'stat' }
  }
  return report
}
/** 每种情绪、每种态度各有几条模板 */
export function coverage() {
  const all = Object.values(TPL).flat()
  return { mood: Object.fromEntries(MOODS.map(m => [m, all.filter(l => l.mood === m).length])), tone: Object.fromEntries(TONES.map(t => [t, all.filter(l => l.tone === t).length])), total: all.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--real')) {
    const { realMoments, OUT } = await import('../proto/lines-review/real.mjs')
    const fs = await import('node:fs')
    const { moments, sessions, turns, days } = await realMoments()
    const said = moments.filter(m => !m.sensitive.length)             // 私事默认不说
    const failed = said.filter(m => m.bad.length)
    console.log(`近 ${days} 天：${sessions} 个会话、${turns} 轮 → ${moments.length} 条台词（私事 ${moments.length - said.length} 条默认不说），会说的 ${said.length} 条里不过标准 ${failed.length} 条`)
    if (failed.length) console.log('按规则：', tally(failed.map(m => m.bad)))
    const byType = {}
    for (const m of said) { const r = (byType[m.type] ||= { 条数: 0, 不过: 0 }); r.条数++; if (m.bad.length) r.不过++ }
    console.table(byType)
    fs.mkdirSync(OUT, { recursive: true })
    const file = OUT + '/real-failed.md'
    fs.writeFileSync(file, `# 真实记录生成的台词里不过标准的（${failed.length} / ${said.length}）\n\n` + failed.map(m => `- [${m.tpl}] ${m.text.replace(/\n/g, ' ⏎ ')}\n  - ${m.bad.map(b => `${b.rule}：${b.why}`).join('；')}`).join('\n') + '\n')
    console.log('明细 →', file)
    process.exit(failed.length ? 1 : 0)
  }
  let fail = 0
  for (const [event, r] of Object.entries(check())) {
    console.log(`${event.padEnd(14)} ${String(r.count).padStart(2)} 条  不合格 ${r.bad.length}  重复 ${r.dup}`)
    for (const b of r.bad) console.log(`   ${b.id}  ${b.tpl.replace(/\n/g, ' ⏎ ')}\n      ${b.why.join('\n      ')}`)
    fail += r.bad.length + r.dup
  }
  console.log(coverage())
  process.exit(fail ? 1 : 0)
}
