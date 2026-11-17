// 模板检查：node scripts/check-lines.mjs。对话版台词（src/core/lines.js 的 TPL），一轮一行，「本肥鱼：」「主人：」标签显示时会去掉、主人的话换颜色。
// 查：每类必须的占位符各出现一次；用典型值填完没有残留括号、没有「，，」、引号不套娃、不超过 MAX_WIDTH。
import { TPL } from '../src/core/lines.js'
import { fill, width, MAX_WIDTH } from '../src/core/moments.js'

export const REQ = { work: ['task', 'dur', 'rice'], late: ['task', 'dur', 'rice'], stopped: ['dur', 'next'], caught: ['claim', 'next'], complain: ['said'], sorry: ['said'], report: ['dur', 'said'],
  stat_continue: ['span', 'n', 'dur'], stat_project: ['project', 'dur', 'days'], stat_longest: ['task', 'dur'], stat_busiest: ['date', 'dur'] }
export const TYPICAL = { w: '10 月 3 日中午', clock: '1:02', task: '导入脚本重构', dur: '12 分钟', doing: '，改了 4 个文件', rice: '3 碗', next: '还是不对啊', claim: '改好了', said: '你说得对，是我漏了', project: 'my-app', days: 23, files: 41, n: 37, span: '这 120 天', date: '10 月 3 日' }

export function check() {
  const report = {}
  for (const [kind, list] of Object.entries(TPL)) {
    const bad = []
    for (const t of list) {
      for (const r of REQ[kind]) if (t.split(`{${r}}`).length - 1 !== 1) bad.push(`缺 {${r}} 或用了不止一次 ← ${t}`)
      for (const vars of [TYPICAL, { ...TYPICAL, doing: '', rice: '小半碗' }]) {
        const out = fill(t, vars)
        if (/[{}]|，，|。，|「，/.test(out)) bad.push(`填完有残留 ← ${out}`)
        if (/「[^」]*「/.test(out)) bad.push(`引号套娃 ← ${out}`)
        if (width(out) > MAX_WIDTH) bad.push(`${width(out)} 字，超过 ${MAX_WIDTH} ← ${out}`)
      }
    }
    report[kind] = { count: list.length, bad: [...new Set(bad)], dup: list.length - new Set(list).size }
  }
  return report
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let fail = 0
  for (const [kind, r] of Object.entries(check())) {
    console.log(`${kind.padEnd(14)} ${r.count} 条  不合格 ${r.bad.length}  重复 ${r.dup}`)
    for (const b of r.bad) console.log('   ' + b)
    fail += r.bad.length + r.dup
  }
  process.exit(fail ? 1 : 0)
}
