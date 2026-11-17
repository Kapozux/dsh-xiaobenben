// 模板检查：node scripts/check-lines.mjs。规则见 docs/lines-spec.md。
// 每句 = {多久之前}，{FACT}，{VIEW}。FACT 查占位符和引号，VIEW 查格式，组合起来用典型值算长度。
import { FACT, VIEW } from '../src/core/lines.js'
import { fill, width, MAX_WIDTH } from '../src/core/moments.js'

export const TYPICAL = { clock: '1:02', task: '导入脚本重构', dur: '12 分钟', doing: '，改了 4 个文件', rice: '3 碗', said: '你说得对，是我漏了', next: '还是不对啊', claim: '改好了，测试全过了', project: 'my-app', days: '23', files: '41', n: '37', date: '10 月 3 日' }
const AGO = '一个多月前'
export const RULES = {
  work: { must: ['task'], any: ['dur', 'rice'], opt: ['doing'] },
  late: { must: ['task'], any: ['dur', 'rice'], opt: ['clock', 'doing'] },
  stopped: { must: ['next'], opt: ['dur', 'task'] },
  caught: { must: ['claim', 'next'], opt: ['task'], quotes: 2 },
  complain: { must: ['said'], opt: ['task'] },
  sorry: { must: ['said'], opt: ['task'] },
  report: { must: ['said'], opt: ['dur', 'task'] },
  stat_continue: { must: ['n'], opt: ['dur'] },
  stat_project: { must: ['project', 'dur'], opt: ['days', 'files', 'rice'] },
  stat_longest: { must: ['task', 'dur'], opt: ['rice'] },
  stat_busiest: { must: ['date', 'dur'], opt: [] },
}

export function factProblems(kind, t) {
  const r = RULES[kind], out = []
  const used = [...t.matchAll(/\{(\w+)\}/g)].map(m => m[1])
  const allowed = new Set([...r.must, ...(r.any || []), ...r.opt])
  for (const v of used) if (!allowed.has(v)) out.push(`多余占位符 {${v}}`)
  for (const v of new Set(used)) if (used.filter(x => x === v).length > 1) out.push(`{${v}} 用了不止一次`)
  for (const v of r.must) if (!used.includes(v)) out.push(`缺 {${v}}`)
  if (r.any && !r.any.some(v => used.includes(v))) out.push(`${r.any.map(v => `{${v}}`).join(' / ')} 至少用一个`)
  if (/[。！？.!?]$/.test(t)) out.push('事实句不带句末标点（后面要接看法）')
  if (/\n/.test(t) || /(本肥鱼|本鱼|主人|大肥鱼)\s*[：:]/.test(t)) out.push('换行或说话人标签')
  if (/「\{task\}」/.test(t)) out.push('{task} 不要加引号')
  const q = (fill(t, TYPICAL).match(/「/g) || []).length
  if (q > (r.quotes || 1) + (kind === 'stat_continue' ? 1 : 0)) out.push(`${q} 处引号`)
  return out
}

export function viewProblems(t) {
  const out = []
  if (/[{}「」\n]/.test(t)) out.push('看法里不放占位符、引号、换行')
  if (!/[。！？]$/.test(t)) out.push('看法要带句末标点')
  if (!/^(我大肥鱼|大肥鱼)/.test(t)) out.push('看法以「我大肥鱼」开头')
  if (width(t) > 20) out.push(`${width(t)} 字（看法 ≤20）`)
  return out
}

export function check() {
  const report = {}
  for (const kind of Object.keys(RULES)) {
    const facts = FACT[kind] || [], views = VIEW[kind] || []
    const bad = []
    facts.forEach((t, i) => { const p = factProblems(kind, t); if (p.length) bad.push(`FACT#${i} ${p.join('；')} ← ${t}`) })
    views.forEach((t, i) => { const p = viewProblems(t); if (p.length) bad.push(`VIEW#${i} ${p.join('；')} ← ${t}`) })
    // 典型值下，每条事实句至少能配上一半的看法
    for (const f of facts) {
      const fact = fill(f, TYPICAL)
      const fit = views.filter(v => width(`${AGO}，${fact}，${v}`) <= MAX_WIDTH).length
      if (fit < views.length / 2) bad.push(`FACT 太长，只配得上 ${fit}/${views.length} 条看法 ← ${f}`)
    }
    const dup = facts.length - new Set(facts).size + views.length - new Set(views).size
    report[kind] = { facts: facts.length, views: views.length, combos: facts.length * views.length, bad, dup }
  }
  return report
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let fail = 0
  for (const [kind, r] of Object.entries(check())) {
    console.log(`${kind.padEnd(14)} 事实 ${r.facts} × 看法 ${r.views} = ${r.combos} 种  不合格 ${r.bad.length}  重复 ${r.dup}`)
    for (const b of r.bad) console.log('   ' + b)
    fail += r.bad.length + r.dup
  }
  process.exit(fail ? 1 : 0)
}
