// 台词模板检查：node scripts/check-lines.mjs [某个.json]（不给就查 src/core/lines.js）。规则见 docs/lines-spec.md。
import fs from 'node:fs'
import { fill, width, MAX_WIDTH } from '../src/core/moments.js'

export const TYPICAL = { w: '11 月 4 日凌晨', clock: '1:02', task: '导入脚本重构', dur: '12 分钟', doing: '，改了 4 个文件', rice: '3 碗', said: '你说得对，是我漏了', next: '还是不对啊', claim: '改好了，测试全过了', project: 'my-app', days: '23', files: '41', n: '37', span: '这 120 天', date: '10 月 3 日' }
export const RULES = {
  work: { must: ['task'], any: ['dur', 'rice'], opt: ['w', 'doing'] },
  late: { must: ['task'], any: ['dur', 'rice'], opt: ['w', 'clock', 'doing'] },
  stopped: { must: ['next'], opt: ['dur', 'w'] },
  caught: { must: ['claim', 'next'], opt: ['w'], quotes: 2 },
  complain: { must: ['said'], opt: ['w'] },
  sorry: { must: ['said'], opt: ['w'] },
  report: { must: ['said'], opt: ['dur', 'w'] },
  stat_continue: { must: ['n'], opt: ['span', 'dur'] },
  stat_project: { must: ['project', 'dur'], opt: ['days', 'files', 'rice'] },
  stat_longest: { must: ['task', 'dur'], opt: ['w', 'rice'] },
  stat_busiest: { must: ['date', 'dur'], opt: [] },
}

export function problems(kind, t) {
  const r = RULES[kind]
  if (!r) return [`未知类型 ${kind}`]
  const out = []
  const used = [...t.matchAll(/\{(\w+)\}/g)].map(m => m[1])
  const allowed = new Set([...r.must, ...(r.any || []), ...r.opt])
  for (const v of used) if (!allowed.has(v)) out.push(`多余占位符 {${v}}`)
  for (const v of new Set(used)) if (used.filter(x => x === v).length > 1) out.push(`{${v}} 用了不止一次`)
  for (const v of r.must) if (!used.includes(v)) out.push(`缺 {${v}}`)
  if (r.any && !r.any.some(v => used.includes(v))) out.push(`${r.any.map(v => `{${v}}`).join(' / ')} 至少用一个`)
  if (/\n/.test(t)) out.push('有换行')
  if (/(本肥鱼|本鱼|主人|大肥鱼)\s*[：:]/.test(t)) out.push('有说话人标签')
  if (/「\{task\}」/.test(t)) out.push('{task} 不要加引号')
  const filled = fill(t, TYPICAL)
  if (/「[^」]*「/.test(filled)) out.push('引号套引号')
  const q = (filled.match(/「/g) || []).length
  if (q > (r.quotes || 1)) out.push(`${q} 处引号（最多 ${r.quotes || 1}）`)
  if (width(filled) > MAX_WIDTH) out.push(`${width(filled)} 字（>${MAX_WIDTH}）`)
  return out
}

export function check(tpl) {
  const report = {}
  for (const [kind, list] of Object.entries(tpl)) {
    const bad = []
    list.forEach((t, i) => { const p = problems(kind, t); if (p.length) bad.push({ i, t, p }) })
    const dup = list.length - new Set(list).size
    report[kind] = { n: list.length, bad, dup, avg: Math.round(list.reduce((a, t) => a + width(fill(t, TYPICAL)), 0) / Math.max(1, list.length)) }
  }
  return report
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]
  const tpl = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : (await import('../src/core/lines.js')).TPL
  let fail = 0
  for (const [kind, r] of Object.entries(check(tpl))) {
    console.log(`${kind.padEnd(14)} ${r.n} 条  不合格 ${r.bad.length}  重复 ${r.dup}  平均 ${r.avg} 字`)
    for (const b of r.bad.slice(0, 8)) console.log(`   #${b.i} ${b.p.join('；')}  ←  ${b.t}`)
    if (r.bad.length > 8) console.log(`   …还有 ${r.bad.length - 8} 条`)
    fail += r.bad.length + r.dup
  }
  process.exit(fail ? 1 : 0)
}
