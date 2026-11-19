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
const all = moments.filter(m => !m.sensitive.length && m.card.fact)
// --events caught,sorryday,stat_owe：每种事件只跑第一件（试跑几件事用）
const only = arg('--events')
const said = only ? only.split(',').map(ev => all.find(m => m.event === ev)).filter(Boolean) : all
const cards = said.map(m => m.card)
const route = { provider: 'deepseek', model }
const q = styleQuote(cards, route)
console.log(`${cards.length} 件事（其中 ${q.withContext} 件带对话原文；私事 ${moments.length - said.length} 件不发）→ ${model}`)
console.log('预计：' + Object.entries({ 写: q.stages.write, 挑: q.stages.pick, 写回话: q.stages.options, 查回话: q.stages.check }).map(([k, v]) => `${k} ${v.calls} 次，约 ${v.input} + ${v.output}`).join('；') + `；合计约 ${q.inputTokens} 输入 + ${q.outputTokens} 输出 = ${q.inputTokens + q.outputTokens} token`)
console.log('样例：\n' + q.sample.join('\n\n'))
if (process.argv.includes('--dry')) process.exit(0)
if (!key()) { console.error('没找到 DEEPSEEK_API_KEY'); process.exit(1) }

const r = await styleRun({ adapter, cards, route, onProgress: p => console.log(`  ${p.stage} ${p.done}/${p.total}`) })
const why = {}
for (const f of r.failed) { const k = f.why.replace(/（.*$/, ''); why[k] = (why[k] || 0) + 1 }
const usage = r.usage.reduce((a, u) => ({ in: a.in + (u.prompt_tokens || 0), out: a.out + (u.completion_tokens || 0) }), { in: 0, out: 0 })
const withTree = Object.values(r.lines).filter(l => l[0].options.length).length
console.log(`写成 ${Object.keys(r.lines).length} / ${cards.length} 件，其中 ${withTree} 件带回话按钮；程序核对扔掉 ${r.dropped} 个版本；${r.failed.length} 件没写成（照模板念）`, why, r.errors.length ? r.errors : '', `实际用了 ${usage.in} 输入 + ${usage.out} 输出 token`)
fs.mkdirSync(OUT, { recursive: true })
const items = said.map(m => ({ id: m.card.id, event: m.event, ageDays: m.ageDays, age: m.age, card: cardLine(m.card), template: m.text, tree: r.lines[m.card.id]?.[0] || null, pick: r.picks[m.card.id] || null, branch: r.branches[m.card.id] || null, failed: r.failed.find(f => f.id === m.card.id)?.why || null }))
fs.writeFileSync(`${OUT}/model-lines.json`, JSON.stringify({ at: new Date().toISOString(), model, usage, items }, null, 1))
const md = items.map(it => `### [${it.event}] ${it.card.split('\n')[0].split(' | ').slice(2).join(' | ')}\n` + (it.tree
  ? it.tree.beats.map(b => `**${b.t}**　〔${b.a || '—'}〕`).join('\n\n') + '\n' + (it.tree.options.length ? it.tree.options.map(o => `- 主人：${o.label} → ${o.reply.beats[0].t}　〔${o.reply.beats[0].a || '—'}〕`).join('\n') : `- （没有模型写的按钮，用默认的：${(it.branch?.why || []).join('；')}）`)
  : `（没写成：${it.failed}）`) + `\n- 模板兜底：${it.template.replace(/\n/g, ' / ')}`).join('\n\n')
fs.writeFileSync(`${OUT}/model-lines.md`, `# 模型写的台词和回话（${model}，${new Date().toLocaleString('zh-CN')}）\n\n${md}\n`)
// --install：写进本机 dsh 的库里（和在确认框里点「发送」存的是同一个地方），重开页面就能点到
if (process.argv.includes('--install')) {
  const { Store } = await import('../../src/store.js')
  const store = new Store(path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages/dsh-xiaobenben/state.json'))
  store.update(s => ({ ...s, styled: { ...(s.styled || {}), ...r.lines }, styledMeta: { route, at: Date.now() } }))
  console.log('已写进', store.file, '：', Object.keys(r.lines).join(' '))
}
console.log('→', `${OUT}/model-lines.md`)
