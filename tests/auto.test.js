// 台词自动补货：选了才开；库存不到 20 条或当天有新事就补；忙的时候、高峰时段不补；每次 6 万 token、每月约 5 元封顶；连续失败两次暂停。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Auto, TARGET, FILL_TO, IDLE, GAP, RETRY_AFTER, isPeak } from '../src/auto.js'
import { priceAt, costOf, DEFAULT_PRICES, PRICE_SOURCE } from '../src/core/prices.js'
import { Store } from '../src/store.js'
import { normFeedback, REST } from '../src/shared/feedback.js'

const DAY = 864e5
const T0 = new Date(2026, 10, 21, 22, 0).getTime()           // 周六晚上：不是高峰
const card = (i, daysAgo) => ({ kind: 'complain', event: 'complain', ts: T0 - daysAgo * DAY, sensitive: [],
  card: { id: 'c' + i, kind: 'complain', event: 'complain', rel: '上个月', said: '还是不行', fact: `上个月，主人对本肥鱼干的活不满意，说了「还是不行」（第 ${i} 件）` } })
// 每件事的台词各不相同（同一批里短句不许重样），数字只用卡片里有的那个编号；v 区分第几次写
const lineFor = (id, v) => `第 ${id.slice(1)} 件嘛，主人，本肥鱼${v ? '重新' : ''}记好第 ${id.slice(1)} 件啦～`
function setup({ moments, caps, prices, fail = false, usage = { inputTokens: 500, outputTokens: 300 }, activity = { busy: false, lastAt: 0 } } = {}) {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xbb-auto-')), 'state.json'))
  const clock = { now: T0 }, calls = [], state = { activity, moments, shown: {}, fail }
  const adapter = async ({ system, prompt }) => {
    const ids = [...new Set([...prompt.matchAll(/id=(\w+)/g)].map(m => m[1]))]
    const stage = system.includes('挑出最好的一版') ? 'pick' : system.includes('写 3 个按钮') ? 'options' : system.includes('检查每一组') ? 'check' : 'write'
    calls.push({ stage, ids, prompt })
    if (state.fail) throw new Error('503 服务不可用')
    const text = stage === 'write' ? { lines: ids.map(id => ({ id, texts: [{ beats: [{ t: lineFor(id, /旧说法/.test(prompt)), a: '委屈' }] }] })) }
      : stage === 'pick' ? { picks: ids.map(id => ({ id, best: 1, bad: [] })) } : stage === 'options' ? { branches: [] } : { checks: [] }
    return { text: JSON.stringify(text), usage }
  }
  const auto = new Auto({ pet: { moments: async () => ({ moments: state.moments }) }, store, adapter, route: () => ({ provider: 'p', model: 'm' }),
    activity: async () => state.activity, shown: () => state.shown, caps, prices, now: () => clock.now })
  return { auto, store, clock, state, calls }
}
const many = (n, daysAgo = 3) => Array.from({ length: n }, (_, i) => card(i + 1, daysAgo + (i % 4)))

test('没选就不开；开了也得等：正在派活不补，刚派过活等闲下来 10 分钟，高峰时段尽量不补', async () => {
  const { auto, clock, state, calls } = setup({ moments: many(8) })
  assert.equal(await auto.tick(), 'off')
  assert.equal(calls.length, 0)
  assert.equal((await auto.status()).on, false)
  auto.set({ on: true })
  state.activity = { busy: true, lastAt: T0 }
  assert.equal(await auto.tick(), 'busy')
  state.activity = { busy: false, lastAt: T0 - IDLE + 60e3 }
  assert.equal(await auto.tick(), 'active')
  assert.equal(calls.length, 0)
  state.activity = { busy: false, lastAt: T0 - IDLE - 1 }
  assert.equal(await auto.tick(), 'ran')
  const st = await auto.status()
  assert.equal(st.stock, 8)                                  // 写好了、还没说过的有 8 条
  assert.equal(st.last.added, 8)
  assert.equal(st.news, 8)                                   // 不弹窗，记一笔等主人来点
  assert.equal(auto.takeNews(), 8)
  assert.equal(auto.takeNews(), 0)
  assert.equal(await auto.tick(), 'just-ran')                // 刚补过，隔一阵再看
  auto.set({ on: false })                                    // 设置里随时能关
  clock.now = T0 + DAY
  assert.equal(await auto.tick(), 'off')

  // 高峰（北京时间工作日白天）：库存还有就等；设置里关掉「避开高峰」就不等；库存见底了也不等
  assert.equal(isPeak(new Date('2026-11-23T03:00:00Z').getTime()), true)       // 周一 11:00 北京时间
  assert.equal(isPeak(new Date('2026-11-23T14:00:00Z').getTime()), false)      // 周一 22:00
  assert.equal(isPeak(new Date('2026-11-21T03:00:00Z').getTime()), false)      // 周六
  const peak = setup({ moments: many(8) })
  peak.auto.set({ on: true })
  await peak.auto.run()
  peak.clock.now = new Date('2026-11-23T03:00:00Z').getTime()
  assert.equal(await peak.auto.tick(), 'nothing')                                // 库存 8 条不到 20，但没有能写的事了：不空转
  for (const id of ['c1', 'c2', 'c3']) peak.state.shown[id] = [1, peak.clock.now]  // 翻掉 3 条：有旧事可以换说法了
  assert.equal(await peak.auto.tick(), 'peak')                                   // 高峰，库存还有 5 条：等
  peak.auto.set({ avoidPeak: false })
  assert.equal(await peak.auto.tick(), 'ran')                                    // 设置里关掉「避开高峰」就不等
  const dry = setup({ moments: many(4) })
  dry.auto.set({ on: true })
  dry.clock.now = new Date('2026-11-23T03:00:00Z').getTime()
  assert.equal(await dry.auto.tick(), 'ran')                                     // 库存见底了，高峰也补
})

test('库存不到 20 条就补：没写过的优先，不够再给说过的旧事换个说法；说过的不算库存', async () => {
  const { auto, store, clock, state, calls } = setup({ moments: many(20) })
  auto.set({ on: true })
  assert.equal(await auto.tick(), 'ran')
  assert.equal((await auto.status()).stock, 20)              // 一次把 20 件都写了（没到每次的上限）
  clock.now += GAP + 1
  assert.equal(await auto.tick(), 'stocked')                 // 库存够，不补
  // 主人这几天翻掉了 10 条：库存剩 10，低于 20
  for (let i = 1; i <= 10; i++) state.shown['c' + i] = [1, clock.now]
  clock.now += 60e3
  assert.equal((await auto.status()).stock, 10)
  calls.length = 0
  assert.equal(await auto.tick(), 'ran')
  const write = calls.filter(c => c.stage === 'write')
  const sent = new Set(write.flatMap(c => c.ids))
  assert.equal(sent.size, 10)                                // 没有没写过的了：给说过的那 10 件换说法
  assert.ok([...sent].every(id => +id.slice(1) <= 10))
  assert.match(write[0].prompt, /以前写过、主人已经听过了/)
  assert.match(write[0].prompt, /id=c1 旧说法：第 1 件嘛，主人，本肥鱼记好第 1 件啦～/)
  const st = await auto.status()
  assert.equal(st.last.rotated, 10)
  assert.equal(st.stock, 20)                                 // 换了说法的又算没说过
  assert.match(store.read().styled.c1[0].text, /重新记好/)
  // 当天有新的事：库存够也补
  clock.now += GAP + 1
  state.moments = [...state.moments, { ...card(99, 0), ts: clock.now - 3600e3 }]
  calls.length = 0
  assert.equal(await auto.tick(), 'ran')
  assert.deepEqual([...new Set(calls.filter(c => c.stage === 'write').flatMap(c => c.ids))], ['c99'])
  // 私事不发
  clock.now += GAP + 1
  state.moments = [...state.moments, { ...card(100, 0), ts: clock.now - 60e3, sensitive: ['家庭'] }]
  assert.equal(await auto.tick(), 'stocked')
})

test('上限只用来防 bug：每次最多 6 万 token（估算和实际各卡一道），每月最多约 5 元；触顶就停并写明原因', async () => {
  const small = setup({ moments: many(40), caps: { run: 25000 } })
  small.auto.set({ on: true })
  const plan = await small.auto.plan()
  assert.ok(plan.cards.length >= 1 && plan.cards.length < 40 && plan.estimate <= 25000)

  // 模型报的用量比估的大很多：第一次调用就超了这一次的上限，后面的不发
  const big = setup({ moments: many(30), usage: { inputTokens: 50000, outputTokens: 20000 } })
  big.auto.set({ on: true })
  await big.auto.run()
  assert.equal(big.calls.length, 1)

  // 每月 5 元。这个假模型不在价格表里：按 deepseek-flash 的高峰价（输入 2、输出 8）估
  const m = setup({ moments: many(30), usage: { inputTokens: 300000, outputTokens: 600000 }, caps: { run: 60000, monthYuan: 5 } })
  m.auto.set({ on: true })
  await m.auto.run()                                         // 一次调用就是 0.6 + 4.8 = 5.4 元
  let st = await m.auto.status()
  assert.ok(st.monthCost >= 5)
  assert.equal(st.price.source, 'assumed')
  assert.match(st.capped, /到了每月 5 元的上限/)
  m.clock.now += GAP + 1
  m.calls.length = 0
  assert.equal(await m.auto.tick(), 'capped')
  assert.equal(m.calls.length, 0)
  m.clock.now = new Date(2026, 11, 2, 22, 0).getTime()       // 下个月重新算
  st = await m.auto.status()
  assert.equal(st.monthCost, 0)
  assert.equal(st.capped, null)
  // 配了价格就按配置的算
  const p = setup({ moments: many(3), prices: [{ provider: 'p', model: 'm', input: 1, output: 2, currency: 'CNY' }], usage: { inputTokens: 1000000, outputTokens: 0 } })
  p.auto.set({ on: true })
  await p.auto.run()
  assert.equal((await p.auto.status()).price.source, 'config')
  assert.ok(Math.abs((await p.auto.status()).last.cost - p.calls.length * 1) < 1e-9)
})

test('默认价格表：DeepSeek 官方价（注明哪天查的、来源），分空闲 / 高峰、缓存命中 / 没命中；配置里的 prices 可以覆盖', () => {
  assert.equal(PRICE_SOURCE.checked, '2026-11-19')
  assert.equal(PRICE_SOURCE.url, 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing')
  assert.deepEqual(DEFAULT_PRICES['deepseek-flash'], { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] })
  assert.deepEqual(DEFAULT_PRICES['deepseek-v4-pro'], { hit: [0.15, 0.30], miss: [4.5, 9], out: [13.5, 27] })
  const at = iso => new Date(iso).getTime()                  // 下面都写成 UTC：北京时间 = UTC + 8
  // 高峰：北京时间工作日 9:00–12:00、14:00–18:00；午休、晚上、周末都是空闲
  assert.equal(isPeak(at('2026-11-23T01:00:00Z')), true)     // 周一 9:00
  assert.equal(isPeak(at('2026-11-23T03:59:00Z')), true)     // 周一 11:59
  assert.equal(isPeak(at('2026-11-23T04:00:00Z')), false)    // 周一 12:00 午休
  assert.equal(isPeak(at('2026-11-23T05:59:00Z')), false)    // 周一 13:59
  assert.equal(isPeak(at('2026-11-23T06:00:00Z')), true)     // 周一 14:00
  assert.equal(isPeak(at('2026-11-23T10:00:00Z')), false)    // 周一 18:00
  assert.equal(isPeak(at('2026-11-23T00:59:00Z')), false)    // 周一 8:59
  assert.equal(isPeak(at('2026-11-21T03:00:00Z')), false)    // 周六 11:00
  assert.equal(isPeak(at('2026-11-23T03:00:00Z'), { holidays: ['2026-11-23'] }), false)   // 配置里填的节假日：全天空闲
  assert.equal(isPeak(at('2026-11-21T03:00:00Z'), { workdays: ['2026-11-21'] }), true)    // 调休上班的周末：按工作日
  const flash = { provider: 'deepseek-official', model: 'deepseek-flash' }
  const idle = priceAt(flash, [], at('2026-11-23T14:00:00Z')), peak = priceAt(flash, [], at('2026-11-23T03:00:00Z'))
  assert.deepEqual([idle.hit, idle.miss, idle.out, idle.source, idle.peak], [0.02, 1, 4, 'official', false])
  assert.deepEqual([peak.hit, peak.miss, peak.out, peak.currency, peak.peak], [0.04, 2, 8, 'CNY', true])
  assert.equal(costOf({ in: 1e6, cache: 1e6, out: 1e6 }, idle), 1 + 0.02 + 4)
  assert.equal(priceAt({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }, [], at('2026-11-23T03:00:00Z')).out, 27)
  const mine = priceAt(flash, [{ provider: 'deepseek-official', model: 'deepseek-flash', input: 9, output: 9, currency: 'CNY' }], at('2026-11-23T03:00:00Z'))
  assert.deepEqual([mine.miss, mine.out, mine.source], [9, 9, 'config'])                    // 配置覆盖默认表
})

test('连续失败 2 次就暂停，原因写在状态里，点「继续」才再补；同一件事连着两次没写成，7 天内不再试', async () => {
  const { auto, clock, state, calls } = setup({ moments: many(3), fail: true })
  auto.set({ on: true })
  assert.equal(await auto.tick(), 'ran')
  assert.equal((await auto.status()).paused, null)
  clock.now += GAP + 1
  assert.equal(await auto.tick(), 'ran')
  assert.match((await auto.status()).paused, /连续 2 次没写成：.*503/)
  clock.now += DAY
  const before = calls.length
  assert.equal(await auto.tick(), 'paused')
  assert.equal(calls.length, before)
  auto.resume()
  state.fail = false
  // 那 3 件事已经连着两次没写成：7 天内不再试，所以没有能写的
  assert.equal((await auto.plan()).cards.length, 0)
  clock.now += RETRY_AFTER + 1
  assert.equal((await auto.plan()).cards.length, 3)
  assert.equal(await auto.tick(), 'ran')
  assert.equal((await auto.status()).stock, 3)
})

test('防重复：每件事翻过几次、上次什么时候翻的都记着（网页和桌面共用），至少隔 3 天再翻', () => {
  assert.equal(REST, 3 * DAY)
  const fb = normFeedback({ shown: { c1: [2, T0], bad: 'x', c2: [1, -5], c3: [1.6, T0 - DAY] } })
  assert.deepEqual(fb.shown, { c1: [2, T0], c3: [2, T0 - DAY] })
  assert.deepEqual(normFeedback({}).shown, {})
  assert.ok(TARGET === 20 && FILL_TO > TARGET)
})
