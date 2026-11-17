// 用本机真的 ~/.claude 和 ~/.codex 跑一遍整条链路（不经过 dsh，不调任何模型，不存任何东西到仓库）：
//   不跑 AI → 统计和原话完整；AI 调用失败（假模型连续报错）→ 重试 1 次后停、说清原因、退回不带 AI 的版本。
// 跑：npm run check:local
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Review } from '../src/review.js'
import { Store } from '../src/store.js'
import { loadClaude, loadCodex } from '../src/sources/files.js'

const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xiaobenben-local-')), 'state.json'))
const review = new Review({ store, loaders: { claude: loadClaude, codex: loadCodex } })
review.setSource('claude', true)
review.setSource('codex', true)

const t0 = Date.now()
const v = await review.view()
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) process.exitCode = 1 }
console.log(`读取 + 统计 ${Date.now() - t0} ms；来源：${v.report.map(r => `${r.id} ${r.sessions} 个会话，跳过 ${r.skipped} 行${r.error ? `，出错：${r.error}` : ''}`).join('；')}`)

ok(v.stats.totals.userMsgs > 0, `不跑 AI：${v.stats.totals.sessions} 个会话、${v.stats.totals.userMsgs} 句、${v.stats.activeDays} 天、最长连续 ${v.stats.longestStreak?.days} 天`)
ok(v.quotes.first && v.quotes.repeated.length > 0, `原话：第一句 ${v.quotes.first?.day}，口头禅 ${v.quotes.repeated.length} 条，凌晨最晚 ${v.quotes.late?.time ?? '（没有）'}`)
ok(v.ai === null, '没跑过 AI 时 ai 为空，图照样完整')

const route = { provider: 'fake', model: 'fake' }
const q = await review.quote({ kind: 'all', route })
ok(q.inputTokens > 0 && q.cost === null, `报价：≈${q.inputTokens} 输入 token，没价格表不给钱；外部来源 ${q.external.map(x => `${x.name} ${x.count} 条`).join('、')}`)

let calls = 0
const failing = async () => { calls++; throw new Error('假模型：503 服务不可用') }
const g = await review.generate({ kind: 'all', route, hash: q.hash, adapter: failing })
ok(!g.ok && calls === 2 && /503/.test(g.error), `AI 失败：调用 ${calls} 次（含重试 1 次）后停下，原因「${g.error}」`)
const after = await review.view()
ok(after.ai.result === null && after.stats.totals.userMsgs === v.stats.totals.userMsgs, '失败后退回不带 AI 的版本，统计不变')
