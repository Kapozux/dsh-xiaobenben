// 整条链路：假的 sessionQuery + 假的模型适配器。不调真模型。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Review } from '../src/review.js'
import { Store } from '../src/store.js'
import { MAX_CALLS, clampYear, estimateTokens } from '../src/core/ai.js'
import { loadClaude, loadCodex } from '../src/sources/files.js'
import { fakeSessionQuery } from './fixtures/light.js'

const RANGE = { start: new Date(2026, 0, 1).getTime(), end: new Date(2026, 11, 31).getTime() }
const ROUTE = { provider: 'deepseek-official', model: 'deepseek-flash' }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-year-test-'))
const newReview = (extra = {}) => new Review({ sessionQuery: fakeSessionQuery(), store: new Store(path.join(tmp(), 'state.json')), loaders: {}, ...extra })

const GOOD = JSON.stringify({
  keywords: ['跑测试', '你搜搜', '凌晨'],
  awards: [
    { name: '测试复读机', reason: '一个夏天说了好多次「跑一下测试」。', quote: '跑一下测试' },
    { name: '搜索委托人', reason: '遇事先「你搜搜」。', quote: '你搜搜' },
    { name: '编出来的奖', reason: '你说过「我从不写 bug」。', quote: '我从不写 bug' },
  ],
  year: '这三个月你最常说「不对」，也最常说「继续」。',
})

/** 假适配器：按顺序吐出给定的结果；Error 就抛。记下每次收到的请求。 */
function fakeAdapter(...outputs) {
  const calls = []
  const fn = async (req) => {
    calls.push(req)
    const o = outputs[Math.min(calls.length - 1, outputs.length - 1)]
    if (o instanceof Error) throw o
    return { text: o, usage: { inputTokens: 100, outputTokens: 50 } }
  }
  fn.calls = calls
  return fn
}

test('不跑 AI：统计和原话照样完整，ai 为空', async () => {
  const v = await newReview().view(RANGE)
  assert.equal(v.stats.totals.userMsgs, 150)
  assert.equal(v.stats.light, true)
  assert.ok(v.quotes.first && v.quotes.late && v.quotes.repeated.length)
  assert.equal(v.ai, null)
})

test('报价：给出要发的全文、token、路线；没价格表就不给钱', async () => {
  const q = await newReview().quote({ range: RANGE, kind: 'all', route: ROUTE })
  assert.ok(q.prompt.includes('## 会话标题'))
  assert.ok(q.prompt.includes('跑一下测试'))
  assert.ok(!q.prompt.includes('sk-aaaa'))            // 打过码
  assert.ok(!q.prompt.includes('焦虑'))               // 敏感的没进
  assert.ok(!q.prompt.includes('好的。'))             // agent 回复没进
  assert.ok(q.inputTokens > 0 && q.outputTokens > 0)
  assert.equal(q.cost, null)
  assert.deepEqual(q.route, ROUTE)
  assert.deepEqual(q.external, [])
})

test('报价：有价格表就算钱，贵的提示', async () => {
  const r = newReview({ config: { prices: [{ ...ROUTE, input: 1, output: 20, currency: 'CNY' }], expensiveOutputPrice: 10 } })
  const q = await r.quote({ range: RANGE, kind: 'all', route: ROUTE })
  assert.equal(q.cost.currency, 'CNY')
  assert.ok(Math.abs(q.cost.amount - (q.inputTokens * 1 + q.outputTokens * 20) / 1e6) < 1e-12)
  assert.equal(q.expensive, true)
})

test('生成：一次成功，结果缓存；编出来的引用被删掉', async () => {
  const r = newReview()
  const { hash } = await r.quote({ range: RANGE, route: ROUTE })
  const adapter = fakeAdapter(GOOD)
  const out = await r.generate({ range: RANGE, kind: 'all', route: ROUTE, hash, adapter })
  assert.equal(out.ok, true)
  assert.equal(adapter.calls.length, 1)
  assert.deepEqual(out.removed, ['我从不写 bug', '我从不写 bug'])
  const v = await r.view(RANGE)
  assert.deepEqual(v.ai.result.keywords, ['跑测试', '你搜搜', '凌晨'])
  assert.equal(v.ai.result.awards[2].quote, null)
  assert.equal(v.ai.result.year, '这三个月你最常说「不对」，也最常说「继续」。')
  assert.equal(v.ai.calls, 1)
  // 发出去的就是报价页给看的那份
  const q = await r.quote({ range: RANGE, route: ROUTE })
  assert.equal(adapter.calls[0].prompt, q.prompt)
})

test('生成：失败重试 1 次就停，说清原因；页面退回不带 AI 的版本', async () => {
  const r = newReview()
  const { hash } = await r.quote({ range: RANGE, route: ROUTE })
  const adapter = fakeAdapter(new Error('402 余额不足'), new Error('402 余额不足'), GOOD)
  const out = await r.generate({ range: RANGE, kind: 'all', route: ROUTE, hash, adapter })
  assert.equal(out.ok, false)
  assert.equal(adapter.calls.length, 2)
  assert.match(out.error, /余额不足/)
  const v = await r.view(RANGE)
  assert.equal(v.ai.result, null)                    // 有调用记录（2 次），没有结果
  assert.equal(v.stats.totals.userMsgs, 150)
})

test('生成：第一次返回坏 JSON，重试成功', async () => {
  const r = newReview()
  const { hash } = await r.quote({ range: RANGE, route: ROUTE })
  const adapter = fakeAdapter('不好意思我不会 JSON', '```json\n' + GOOD + '\n```')
  const out = await r.generate({ range: RANGE, kind: 'all', route: ROUTE, hash, adapter })
  assert.equal(out.ok, true)
  assert.equal(out.calls, 2)
})

test('生成：整份回顾最多 5 次调用（重新生成也算）', async () => {
  const r = newReview()
  const { hash } = await r.quote({ range: RANGE, route: ROUTE })
  const adapter = fakeAdapter(GOOD)
  for (let i = 0; i < MAX_CALLS; i++) assert.equal((await r.generate({ range: RANGE, kind: i ? 'year' : 'all', route: ROUTE, hash, adapter: i ? fakeAdapter('{"year":"又一版。"}') : adapter })).ok, true)
  const sixth = fakeAdapter(GOOD)
  const out = await r.generate({ range: RANGE, kind: 'year', route: ROUTE, hash, adapter: sixth })
  assert.equal(out.ok, false)
  assert.equal(sixth.calls.length, 0)
  assert.match(out.error, /上限/)
})

test('生成：只重新生成一块时，别的块保留', async () => {
  const r = newReview()
  const { hash } = await r.quote({ range: RANGE, route: ROUTE })
  await r.generate({ range: RANGE, kind: 'all', route: ROUTE, hash, adapter: fakeAdapter(GOOD) })
  await r.generate({ range: RANGE, kind: 'keywords', route: ROUTE, hash, adapter: fakeAdapter('{"keywords":["新一","新二","新三"]}') })
  const v = await r.view(RANGE)
  assert.deepEqual(v.ai.result.keywords, ['新一', '新二', '新三'])
  assert.equal(v.ai.result.awards.length, 3)
})

test('生成：数据变了（hash 对不上）不发', async () => {
  const adapter = fakeAdapter(GOOD)
  const out = await newReview().generate({ range: RANGE, kind: 'all', route: ROUTE, hash: 'stale', adapter })
  assert.equal(out.ok, false)
  assert.equal(adapter.calls.length, 0)
})

test('「这一年」超过 150 字在句号处截短', () => {
  const s = '这是一句话。'.repeat(40)
  const out = clampYear(s)
  assert.ok([...out].length <= 150)
  assert.ok(out.endsWith('。'))
})

test('估 token：中文一个字一个，英文约 4 个字符一个', () => {
  assert.equal(estimateTokens('你好世界'), 4)
  assert.equal(estimateTokens('abcdefgh'), 2)
})

test('隐藏卡片记在本地', async () => {
  const r = newReview()
  const v = await r.view(RANGE)
  r.setHidden(v.hash, 'late', true)
  assert.deepEqual((await r.view(RANGE)).hidden, { late: true })
})

// ── 外部来源（用临时目录造假文件，不读真的 ~/.claude） ──
test('Claude Code：只算交互会话，跳过 sdk 调用、子代理、工具结果和注入块', async () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'p'))
  const line = o => JSON.stringify(o)
  fs.writeFileSync(path.join(root, 'p', 'a.jsonl'), [
    line({ type: 'ai-title', aiTitle: '修 bug' }),
    line({ type: 'user', entrypoint: 'cli', timestamp: '2026-03-01T01:00:00Z', message: { role: 'user', content: '帮我看看' } }),
    line({ type: 'user', entrypoint: 'cli', timestamp: '2026-03-01T01:00:01Z', message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
    line({ type: 'user', entrypoint: 'cli', timestamp: '2026-03-01T01:00:02Z', isMeta: true, message: { role: 'user', content: 'meta' } }),
    line({ type: 'user', entrypoint: 'cli', timestamp: '2026-03-01T01:00:03Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
    line({ type: 'assistant', entrypoint: 'cli', timestamp: '2026-03-01T01:00:04Z', message: { content: [{ type: 'text', text: '好' }] } }),
    line({ type: 'user', entrypoint: 'cli', isSidechain: true, timestamp: '2026-03-01T01:00:05Z', message: { role: 'user', content: '子任务' } }),
    '{坏行',
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'p', 'b.jsonl'), line({ type: 'user', entrypoint: 'sdk-cli', timestamp: '2026-03-01T01:00:00Z', message: { role: 'user', content: '程序调用' } }))
  const r = await loadClaude(root)
  assert.equal(r.convs.length, 1)
  assert.equal(r.convs[0].title, '修 bug')
  assert.deepEqual(r.convs[0].msgs.map(m => [m.role, m.text]), [['user', '帮我看看'], ['assistant', '']])
  assert.equal(r.skipped, 1)
})

test('Codex：用户的话只认 event_msg/user_message', async () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, '2026', '03'), { recursive: true })
  const line = o => JSON.stringify(o)
  fs.writeFileSync(path.join(root, '2026', '03', 'r.jsonl'), [
    line({ type: 'session_meta', timestamp: '2026-03-01T01:00:00Z', payload: { id: 'cx1' } }),
    line({ type: 'response_item', timestamp: '2026-03-01T01:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>' }] } }),
    line({ type: 'event_msg', timestamp: '2026-03-01T01:00:01Z', payload: { type: 'user_message', message: '跑一下测试' } }),
    line({ type: 'event_msg', timestamp: '2026-03-01T01:00:02Z', payload: { type: 'agent_message', message: '好' } }),
  ].join('\n'))
  const r = await loadCodex(root)
  assert.equal(r.convs[0].id, 'cx1')
  assert.deepEqual(r.convs[0].msgs.map(m => [m.role, m.text]), [['user', '跑一下测试'], ['assistant', '']])
})

test('外部来源要勾选才读', async () => {
  let read = 0
  const r = newReview({ loaders: { claude: async () => { read++; return { convs: [], skipped: 0 } } } })
  await r.view(RANGE)
  assert.equal(read, 0)
  r.setSource('claude', true)
  await r.view(RANGE)
  assert.equal(read, 1)
})
