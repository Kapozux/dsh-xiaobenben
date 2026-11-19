// 台词自动更新：选了才开、每周一次、只做增量、每次和每月有上限、忙的时候不跑、连续失败两次暂停、跑完只记一笔等主人来点。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Auto, WEEK, IDLE, ROTATE } from '../src/auto.js'
import { Store } from '../src/store.js'
import { normFeedback, REST } from '../src/shared/feedback.js'

const DAY = 864e5
const T0 = new Date(2026, 10, 19, 15, 0).getTime()
const card = (i, daysAgo) => ({ kind: 'complain', event: 'complain', ts: T0 - daysAgo * DAY, sensitive: [],
  card: { id: 'c' + i, kind: 'complain', event: 'complain', rel: '上个月', said: '还是不行', fact: `上个月，主人对本肥鱼干的活不满意，说了「还是不行」（第 ${i} 件）` } })
// 每件事的台词各不相同（同一批里短句不许重样），数字只用卡片里有的那个编号
const lineFor = id => `第 ${id.slice(1)} 件嘛，主人，本肥鱼记好第 ${id.slice(1)} 件啦～`
/** 假模型：每张卡写一版、挑第一版、不写回话。calls 记下每次发了哪些卡 */
function fakeAdapter({ fail = false, usage = { inputTokens: 500, outputTokens: 300 } } = {}) {
  const calls = []
  const adapter = async ({ system, prompt }) => {
    const ids = [...new Set([...prompt.matchAll(/id=(\w+)/g)].map(m => m[1]))]
    const stage = system.includes('挑出最好的一版') ? 'pick' : system.includes('写 3 个按钮') ? 'options' : system.includes('检查每一组') ? 'check' : 'write'
    calls.push({ stage, ids })
    if (fail) throw new Error('503 服务不可用')
    const text = stage === 'write' ? { lines: ids.map(id => ({ id, texts: [{ beats: [{ t: lineFor(id), a: '委屈' }] }] })) }
      : stage === 'pick' ? { picks: ids.map(id => ({ id, best: 1, bad: [] })) } : stage === 'options' ? { branches: [] } : { checks: [] }
    return { text: JSON.stringify(text), usage }
  }
  return { adapter, calls }
}
function setup({ moments, caps, fail, usage, activity = { busy: false, lastAt: 0 } } = {}) {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xbb-auto-')), 'state.json'))
  const clock = { now: T0 }
  const fake = fakeAdapter({ fail, usage })
  const state = { activity, moments }
  const auto = new Auto({ pet: { moments: async () => ({ moments: state.moments }) }, store, adapter: fake.adapter, route: () => ({ provider: 'p', model: 'm' }),
    activity: async () => state.activity, caps, now: () => clock.now })
  return { auto, store, clock, state, calls: fake.calls }
}

test('没选就不开；开了也得等：正在派活不跑，刚派过活等闲下来 10 分钟，一周只跑一次', async () => {
  const { auto, store, clock, state, calls } = setup({ moments: [card(1, 1), card(2, 2)] })
  assert.equal(await auto.tick(), 'off')
  assert.equal(calls.length, 0)
  assert.equal(auto.status().on, false)
  auto.set(true)
  state.activity = { busy: true, lastAt: T0 }
  assert.equal(await auto.tick(), 'busy')
  state.activity = { busy: false, lastAt: T0 - IDLE + 60e3 }
  assert.equal(await auto.tick(), 'active')
  assert.equal(calls.length, 0)
  state.activity = { busy: false, lastAt: T0 - IDLE - 1 }
  assert.equal(await auto.tick(), 'ran')
  assert.deepEqual(Object.keys(store.read().styled).sort(), ['c1', 'c2'])
  const st = auto.status()
  assert.equal(st.last.ok, true)
  assert.equal(st.last.added, 2)
  assert.ok(st.last.tokens > 0 && st.monthTokens === st.last.tokens)
  assert.equal(st.nextAt, T0 + WEEK)
  assert.equal(st.news, 2)                                   // 不弹窗，记一笔等主人来点
  assert.equal(auto.takeNews(), 2)
  assert.equal(auto.takeNews(), 0)                           // 只说一次
  clock.now = T0 + WEEK - 60e3
  assert.equal(await auto.tick(), 'not-due')
  auto.set(false)                                            // 设置里随时能关
  clock.now = T0 + 2 * WEEK
  assert.equal(await auto.tick(), 'off')
})

test('只做增量：这周新的事 + 轮换 5 件写过的旧事；已经写过的不重写；私事不发', async () => {
  const old = Array.from({ length: 8 }, (_, i) => card(i + 1, 20 + i))
  const { auto, store, clock, state, calls } = setup({ moments: old })
  auto.set(true)
  await auto.run()
  assert.equal(Object.keys(store.read().styled).length, 8)
  // 一周以后：多了两件新的（一件是私事）
  clock.now = T0 + WEEK + 1
  state.moments = [...old.map(m => ({ ...m })), { ...card(9, -6), sensitive: [] }, { ...card(10, -6), sensitive: ['家庭'] }]
  calls.length = 0
  assert.equal(await auto.tick(), 'ran')
  const sent = new Set(calls.filter(c => c.stage === 'write').flatMap(c => c.ids))
  assert.ok(sent.has('c9'))
  assert.ok(!sent.has('c10'))                                // 私事不发
  assert.equal(sent.size, 1 + ROTATE)                        // 新的 1 件 + 轮换 5 件
  const last = auto.status().last
  assert.equal(last.added, 1)
  assert.equal(last.rotated, ROTATE)
  assert.equal(auto.status().news, 8 + 1)                    // 只把新写的算进「新记了几件」：第一次 8 件，这次 1 件，轮换的不算
})

test('每次有上限：按估算挑到上限为止；每月有上限：这个月用完了就不再调模型', async () => {
  const many = Array.from({ length: 30 }, (_, i) => card(i + 1, 1 + i % 5))
  const small = setup({ moments: many, caps: { run: 25000, month: 250000 } })
  small.auto.set(true)
  const plan = await small.auto.plan()
  assert.ok(plan.cards.length >= 1 && plan.cards.length < 30)
  assert.ok(plan.estimate <= 25000)
  await small.auto.run()
  assert.ok(Object.keys(small.store.read().styled).length < 30)          // 剩下的以后每周补

  const month = setup({ moments: many, caps: { run: 60000, month: 12000 }, usage: { inputTokens: 900, outputTokens: 300 } })
  month.auto.set(true)
  await month.auto.run()                                                   // 月额度只够写一两件
  const used = month.auto.status().monthTokens
  assert.ok(used > 0 && used <= 12000)
  assert.ok(Object.keys(month.store.read().styled).length <= 3)
  for (let d = 1; d <= 9; d++) { month.clock.now = T0 + d * DAY; await month.auto.run() }       // 这个月里接着硬跑九次
  assert.ok(month.auto.status().monthTokens <= 12000 + 1200)             // 这个月怎么跑都不超过月上限（最多多出正在路上的那一次调用）
  const left = 12000 - month.auto.status().monthTokens
  assert.ok((await month.auto.plan()).estimate <= Math.max(0, left))
  month.clock.now = new Date(2026, 11, 2, 10, 0).getTime()                 // 下个月重新算
  assert.equal(month.auto.status().monthTokens, 0)
})

test('实际用量再卡一道：模型报的用量比估的大很多时，超过这一次的上限就停', async () => {
  const many = Array.from({ length: 30 }, (_, i) => card(i + 1, 1))
  const { auto, calls } = setup({ moments: many, caps: { run: 60000, month: 250000 }, usage: { inputTokens: 50000, outputTokens: 20000 } })
  auto.set(true)
  await auto.run()
  assert.equal(calls.length, 1)                                            // 第一次调用就超了，后面的都不发
  assert.ok(auto.status().last.tokens >= 60000)
})

test('连续失败 2 次就暂停，原因写在状态里；点「继续」才再跑', async () => {
  const { auto, clock, calls } = setup({ moments: [card(1, 1)], fail: true })
  auto.set(true)
  assert.equal(await auto.tick(), 'ran')
  assert.equal(auto.status().paused, null)
  assert.equal(auto.status().last.ok, false)
  clock.now = T0 + WEEK + 1
  assert.equal(await auto.tick(), 'ran')
  assert.match(auto.status().paused, /连续 2 次没写成：.*503/)
  assert.equal(auto.status().nextAt, null)
  clock.now = T0 + 3 * WEEK
  const before = calls.length
  assert.equal(await auto.tick(), 'paused')
  assert.equal(calls.length, before)
  auto.resume()
  assert.equal(auto.status().paused, null)
  assert.equal(await auto.tick(), 'ran')
})

test('防重复：每件事翻过几次、上次什么时候翻的都记着（网页和桌面共用），至少隔 3 天再翻', () => {
  assert.equal(REST, 3 * DAY)
  const fb = normFeedback({ shown: { c1: [2, T0], bad: 'x', c2: [1, -5], c3: [1.6, T0 - DAY] } })
  assert.deepEqual(fb.shown, { c1: [2, T0], c3: [2, T0 - DAY] })
  assert.deepEqual(normFeedback({}).shown, {})
})
