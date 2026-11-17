// 「现在」：Claude Code 记录里哪一轮在跑、上次停在哪、这周骂了几回、上回这个点；台词模板的占位符。
import test from 'node:test'
import assert from 'node:assert/strict'
import { claudeTurns, dshTurns } from '../src/core/moments.js'
import { liveState } from '../src/core/live.js'
import { LIVE } from '../src/shared/live-lines.js'

const T0 = new Date(2026, 10, 3, 23, 30).getTime()
const at = m => new Date(T0 + m * 60e3).toISOString()
const user = (m, text) => JSON.stringify({ type: 'user', timestamp: at(m), cwd: '/x/shop', message: { content: text } })
const bot = (m, text) => JSON.stringify({ type: 'assistant', timestamp: at(m), message: { id: 'a' + m, content: [{ type: 'text', text }] } })
const end = m => JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: at(m) })
const title = t => JSON.stringify({ type: 'ai-title', aiTitle: t })

test('Claude Code：最后一轮没有 turn_duration 就是在跑；有就是做完了', () => {
  const lines = [title('购物车结算页'), user(0, '帮我修一下结算页的金额'), bot(1, '看一下'), bot(9, '改好了，你刷新看看'), end(9),
    user(12, '还是不对，你又改错了'), bot(13, '抱歉我再看看'), bot(20, '在查')]
  const turns = claudeTurns(lines, { key: 'f1' })
  assert.equal(turns.length, 2)
  assert.equal(turns[0].ended, true)
  assert.ok(!turns[1].ended)
  const s = liveState({ recent: [{ key: 'f1', agent: 'claude', turns }], history: [], now: T0 + 21 * 60e3 })
  assert.equal(s.busy.length, 1)
  assert.equal(s.busy[0].task, '购物车结算页')
  assert.equal(s.busy[0].angry, true)
  assert.equal(s.busy[0].dur, '9 分钟')
  assert.equal(s.last.said, '改好了，你刷新看看')
  assert.equal(s.complain, 1)
})

test('做完又被叫起来干活算在跑；按停的算停了；太久没动静的不算在跑', () => {
  const again = claudeTurns([user(0, '帮我写个导出功能'), bot(2, '好'), end(2), bot(5, '后台任务跑完了，接着改')], { key: 'f' })
  assert.ok(!again[0].ended)
  const stopped = claudeTurns([user(0, '帮我写个导出功能'), bot(2, '好'), JSON.stringify({ type: 'user', timestamp: at(3), message: { content: '[Request interrupted by user]' } })], { key: 'f' })
  assert.equal(stopped[0].interrupted, true)
  const s = liveState({ recent: [{ key: 'f', agent: 'claude', turns: stopped }], now: T0 + 30 * 60e3 })
  assert.equal(s.busy.length, 0)
  assert.equal(s.last.interrupted, true)
  const stale = liveState({ recent: [{ key: 'f', agent: 'claude', turns: claudeTurns([user(0, '帮我写个导出功能'), bot(2, '好')], { key: 'f' }) }], now: T0 + 60 * 60e3 })
  assert.equal(stale.busy.length, 0, '一小时没写过东西：会话多半被关了')
})

test('dsh：没有 turn/end 就是在跑', () => {
  const ev = (m, type, data) => ({ type, time: T0 + m * 60e3, data })
  const turns = dshTurns('s1', { cwd: '/x/shop' }, [ev(0, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我加个登录页' }] }), ev(1, 'assistant/message', { message: { content: [{ type: 'text', text: '好' }] } })])
  const s = liveState({ recent: [{ key: 's1', agent: 'dsh', turns }], now: T0 + 4 * 60e3 })
  assert.equal(s.busy.length, 1)
  turns[0].ended = true
  assert.equal(liveState({ recent: [{ key: 's1', agent: 'dsh', turns }], now: T0 + 4 * 60e3 }).busy.length, 0)
})

test('上回这个点：前几天同一钟点的活', () => {
  const y = new Date(2026, 10, 2, 23, 10).getTime()
  const old = claudeTurns([JSON.stringify({ type: 'user', timestamp: new Date(y).toISOString(), message: { content: '帮我重构支付模块' } }), JSON.stringify({ type: 'assistant', timestamp: new Date(y + 6e5).toISOString(), message: { id: 'z', content: [{ type: 'text', text: '好了' }] } }), JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: new Date(y + 6e5).toISOString() })], { key: 'old' })
  const s = liveState({ recent: [], history: old, now: T0 })
  assert.equal(s.night.task, '重构支付模块')
  assert.match(s.night.w, /^昨天晚上 11:10/)
})

test('现在的台词：只用认得的占位符，每类至少 3 条，不超过 60 字', () => {
  const known = new Set(['task', 'dur', 'n', 'today', 'longest', 'c', 'w', 'said', 'clock'])
  for (const [k, list] of Object.entries(LIVE)) {
    assert.ok(list.length >= 3, k)
    for (const t of list) {
      for (const m of t.matchAll(/\{(\w+)\}/g)) assert.ok(known.has(m[1]), `${k}: ${t}`)
      assert.ok([...t.replace(/\{\w+\}/g, '某某某某').replace(/\s/g, '')].length <= 60, `${k} 太长: ${t}`)
    }
  }
})
