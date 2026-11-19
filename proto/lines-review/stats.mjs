// 打分结果 → 规律：哪种模板类型、哪类事件、多久以前的事最容易「干巴」「看不懂」。
// 跑：node proto/lines-review/stats.mjs [轮号]。报告（有原话）写到 out/round-N.report.md。
import fs from 'node:fs'
import { OUT } from './real.mjs'
import { TPL } from '../../src/core/lines.js'

export const RATINGS = ['哈哈', '有感觉', '干巴', '看不懂']
const NAMES = { caught: '说好了被抓包', complain: '挨骂', cuss: '挨骂（带脏话）', streak: '连着被说', marks: '只回问号', sorry: '认错', sorryday: '一天认错几回', stopped: '被喊停', late: '零点以后', night: '一晚上派了几个活',
  long: '一口气干很久', terse: '话短活长', eater: '吃得多', pass: '主人认可', passafter: '说了几回终于行了', stat_project: '项目总账', stat_first: '项目第一天', stat_streak: '连着几天', stat_busiest: '最累的一天',
  stat_continue: '喊继续', stat_latest: '最晚的一次', stat_caught: '报喜报早了几回', stat_owe: '还欠几回认错', stat_rice: '一共吃了几碗', stat_nights: '熬了几个夜', stat_days: '来了几天', stat_asks: '派了几个活', stat_today: '上个月的今天' }
/** 事件大类：这件事的料是什么 */
const groupOf = t => t.startsWith('stat_') ? (['stat_first', 'stat_streak', 'stat_busiest', 'stat_latest', 'stat_today'].includes(t) ? '总账·某一天的事' : '总账·一个总数')
  : ['complain', 'cuss', 'marks', 'pass', 'passafter', 'stopped'].includes(t) ? '主人的一句话' : t === 'caught' ? '有来有回' : t === 'sorry' ? '本肥鱼自己的一句话' : t === 'late' || t === 'night' ? '熬夜' : '数出来的（几回、多久、几碗）'
const tplOf = id => { const [ev, i] = String(id).split('#'); return TPL[ev]?.[+i] || {} }

export function load(round) {
  const sample = JSON.parse(fs.readFileSync(`${OUT}/round-${round}.sample.json`, 'utf8'))
  let ratings = {}
  try { ratings = JSON.parse(fs.readFileSync(`${OUT}/round-${round}.ratings.json`, 'utf8')) } catch {}
  return { sample, ratings, rows: sample.items.filter(i => ratings[i.id]).map(i => ({ ...i, rating: ratings[i.id] })) }
}

const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—'
function table(rows, keyOf, title) {
  const g = {}
  for (const r of rows) for (const k of [].concat(keyOf(r))) { const c = (g[k] ||= { n: 0, 哈哈: 0, 有感觉: 0, 干巴: 0, 看不懂: 0 }); c.n++; c[r.rating]++ }
  const lines = Object.entries(g).sort((a, b) => (b[1].干巴 + b[1].看不懂) / b[1].n - (a[1].干巴 + a[1].看不懂) / a[1].n)
    .map(([k, c]) => `| ${k} | ${c.n} | ${c.哈哈} | ${c.有感觉} | ${c.干巴} | ${c.看不懂} | ${pct(c.哈哈 + c.有感觉, c.n)} |`)
  return `### ${title}\n\n| | 条数 | 哈哈 | 有感觉 | 干巴 | 看不懂 | 好评率 |\n|---|---|---|---|---|---|---|\n${lines.join('\n')}\n`
}

export function report(round) {
  const { sample, rows } = load(round)
  const n = rows.length, good = rows.filter(r => r.rating === '哈哈' || r.rating === '有感觉').length
  const c = Object.fromEntries(RATINGS.map(k => [k, rows.filter(r => r.rating === k).length]))
  const width = r => [...r.text.replace(/\s/g, '')].length
  const out = [
    `# 第 ${round} 轮打分（${n} / ${sample.items.length} 条）`,
    `**哈哈 + 有感觉：${good} / ${n} = ${pct(good, n)}**（目标 > 70%）　哈哈 ${c.哈哈}　有感觉 ${c.有感觉}　干巴 ${c.干巴}　看不懂 ${c.看不懂}\n`,
    table(rows, r => NAMES[r.type] || r.type, '按模板类型（事件）'),
    table(rows, r => groupOf(r.type), '按事件大类'),
    table(rows, r => tplOf(r.tpl).mood || '（旧模板，没标）', '按想要的情绪'),
    table(rows, r => tplOf(r.tpl).tone || '（旧模板，没标）', '按态度'),
    table(rows, r => r.age, '按多久以前'),
    table(rows, r => width(r) <= 30 ? '≤30 字' : width(r) <= 40 ? '31～40 字' : '超过 40 字', '按长度'),
    table(rows, r => r.text.includes('\n') ? '两轮' : '一轮', '按轮数'),
    table(rows, r => /那阵/.test(r.text) ? '带了在弄什么' : '只有时间', '按有没有交代在弄什么'),
    table(rows, r => /「/.test(r.text) ? '带原话' : '不带原话', '按有没有原话'),
    ...['看不懂', '干巴', '哈哈', '有感觉'].map(k => `### 标成「${k}」的（${c[k]}）\n\n` + rows.filter(r => r.rating === k).map(r => `- [${r.tpl} · ${r.age}] ${r.text.replace(/\n/g, ' ⏎ ')}`).join('\n') + '\n'),
  ].join('\n')
  fs.writeFileSync(`${OUT}/round-${round}.report.md`, out)
  return { n, good, rate: n ? good / n : 0, counts: c, file: `${OUT}/round-${round}.report.md`, text: out }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = report(Number(process.argv[2] || 1))
  console.log(r.text.split('### 标成')[0])
  console.log('完整报告 →', r.file)
}
