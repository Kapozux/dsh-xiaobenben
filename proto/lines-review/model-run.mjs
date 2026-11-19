// 用本机真实记录走一遍「模型写台词」：和插件同一套事件卡、同一个提示词、同一套核对（src/core/style.js），只是不经过 dsh，直接调 DeepSeek。
// 发出去的只有事件卡（私事不发）。key 从环境变量 DEEPSEEK_API_KEY 或 dsh 的凭据文件里读，不打印、不落盘。
// 跑：node proto/lines-review/model-run.mjs [--model deepseek-chat] [--dry]   --dry 只看要发什么、多少 token，不发
// 产物（有原话，不进仓库）：proto/lines-review/out/model-lines.md / model-lines.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { realMoments, OUT } from './real.mjs'
import { styleRun, styleQuote, cardLine } from '../../src/core/style.js'

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const model = arg('--model') || 'deepseek-chat'
function key() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  for (const home of [process.env.DSH_HOME, path.join(os.homedir(), '.dsh')].filter(Boolean)) {
    try { const m = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8').match(/^\s*DEEPSEEK_API_KEY:\s*["']?([^\s"']+)/m); if (m) return m[1] } catch {}
  }
  return null
}
const adapter = async ({ system, prompt, maxTokens, signal }) => {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key()}` },
    body: JSON.stringify({ model, max_tokens: Math.min(maxTokens, 8000), temperature: 1.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}：${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  return { text: j.choices?.[0]?.message?.content || '', usage: j.usage }
}

const { moments } = await realMoments()
const said = moments.filter(m => !m.sensitive.length && m.card.fact)
const cards = said.map(m => m.card)
const route = { provider: 'deepseek', model }
const q = styleQuote(cards, route)
console.log(`${cards.length} 件事（其中 ${q.withContext} 件带对话原文；私事 ${moments.length - said.length} 件不发）→ ${model}`)
console.log(`预计：写 ${q.stages.write.calls} 次调用，约 ${q.stages.write.input} 输入 + ${q.stages.write.output} 输出；挑 ${q.stages.pick.calls} 次调用，约 ${q.stages.pick.input} 输入 + ${q.stages.pick.output} 输出；合计约 ${q.inputTokens} 输入 + ${q.outputTokens} 输出 = ${q.inputTokens + q.outputTokens} token`)
console.log('样例：\n' + q.sample.join('\n\n'))
if (process.argv.includes('--dry')) process.exit(0)
if (!key()) { console.error('没找到 DEEPSEEK_API_KEY'); process.exit(1) }

const r = await styleRun({ adapter, cards, route, onProgress: p => console.log(`  ${p.stage} ${p.done}/${p.total}`) })
const why = {}
for (const f of r.failed) { const k = f.why.replace(/（.*$/, ''); why[k] = (why[k] || 0) + 1 }
const usage = r.usage.reduce((a, u) => ({ in: a.in + (u.prompt_tokens || 0), out: a.out + (u.completion_tokens || 0) }), { in: 0, out: 0 })
console.log(`写成 ${Object.keys(r.lines).length} / ${cards.length} 件；程序核对扔掉 ${r.dropped} 个版本；${r.failed.length} 件没写成（照模板念）`, why, r.errors.length ? r.errors : '', `实际用了 ${usage.in} 输入 + ${usage.out} 输出 token`)
fs.mkdirSync(OUT, { recursive: true })
const items = said.map(m => ({ id: m.card.id, event: m.event, ageDays: m.ageDays, age: m.age, card: cardLine(m.card), template: m.text, line: (x => x ? (x.text || x) : null)(r.lines[m.card.id]?.[0]), anim: r.lines[m.card.id]?.[0]?.anim || null, pick: r.picks[m.card.id] || null, failed: r.failed.find(f => f.id === m.card.id)?.why || null }))
fs.writeFileSync(`${OUT}/model-lines.json`, JSON.stringify({ at: new Date().toISOString(), model, usage, items }, null, 1))
const md = items.map(it => `### [${it.event}] ${it.card.split('\n')[0].split(' | ').slice(2).join(' | ')}\n` + (it.line ? `**${it.line.replace(/\n/g, ' / ')}**` : `（没写成：${it.failed}）`) + (it.pick ? `\n- 挑的理由：${it.pick.why}\n` + it.pick.candidates.map((t, i) => `- ${it.pick.bad.includes(i + 1) ? '✗' : i + 1 === it.pick.best ? '✓' : '·'} ${t.replace(/\n/g, ' / ')}`).join('\n') : '') + `\n- 模板兜底：${it.template.replace(/\n/g, ' / ')}`).join('\n\n')
fs.writeFileSync(`${OUT}/model-lines.md`, `# 模型写的台词（${model}，${new Date().toLocaleString('zh-CN')}）\n\n写成 ${Object.keys(r.lines).length} / ${cards.length} 件。✓ 选中 · 没选 ✗ 挑的时候判为有问题\n\n${md}\n`)
console.log('→', `${OUT}/model-lines.md`)
