// 跑：npm test（TZ=Asia/Taipei node --test）。不调任何真模型。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, mask } from '../src/core/redact.js'
import { sensitiveCats } from '../src/core/sensitive.js'
import { computeStats, clip, roundsOf, convLabel } from '../src/core/stats.js'
import { pickQuotes, MAX_QUOTE_CHARS } from '../src/core/quotes.js'
import { buildMaterial, PER_MONTH } from '../src/core/material.js'
import { verifyResult, isVerbatim, dropUnverifiedSentences } from '../src/core/verify.js'
import { convFromEvents } from '../src/sources/dsh.js'
import { lightSessions } from './fixtures/light.js'

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const conv = (agent, id, msgs, title = null) => ({ agent, id, title, msgs: msgs.map(([t, role, text = '']) => ({ t, role, text })) })
const ALL = { start: 0, end: Date.now() }

// ── 打码 ──
test('打码：路径、邮箱、key、token、内网地址', () => {
  const cases = [
    ['看下 /Users/sam/proj/.env', '看下 〔路径〕'],
    ['在 ~/Documents/x.md 里', '在 〔路径〕 里'],
    ['C:\\Users\\sam\\a.txt 打不开', '〔路径〕 打不开'],
    ['发给 sam.lee+x@example.com', '发给 〔邮箱〕'],
    ['key 是 sk-abcdefghijklmnopqrstuvwx', 'key 是 〔密钥〕'],
    ['ghp_abcdefghijklmnopqrstuvwxyz123456 过期了', '〔密钥〕 过期了'],
    ['Authorization: Bearer abc.def.ghi12345', 'Authorization: 〔密钥〕'],
    ['token=abcd1234efgh', 'token=〔密钥〕'],
    ['打开 http://localhost:3000/admin 看看', '打开 〔内网地址〕 看看'],
    ['连 192.168.1.20:8080', '连 〔内网地址〕'],
    ['10.0.0.5 挂了', '〔内网地址〕 挂了'],
    ['nas.local 进不去', '〔内网地址〕 进不去'],
  ]
  for (const [input, want] of cases) assert.equal(mask(input), want, input)
})

test('打码：正常的话一个字不动', () => {
  for (const s of ['跑一下测试', '不对，你再想想', 'see https://github.com/foo/bar', 'React 18 和 19 区别', 'src/index.ts 第 3 行']) {
    assert.deepEqual(redact(s), { text: s, hits: 0 })
  }
})

// ── 敏感 ──
test('敏感：四类都能认出，普通的话不算', () => {
  assert.deepEqual(sensitiveCats('最近失眠，去医院看了'), ['健康'])
  assert.deepEqual(sensitiveCats('和女朋友分手了'), ['感情'])
  assert.deepEqual(sensitiveCats('这次考试成绩不好'), ['成绩'])
  assert.deepEqual(sensitiveCats('我妈让我早点睡'), ['家庭'])
  assert.deepEqual(sensitiveCats('跑一下测试'), [])
  assert.deepEqual(sensitiveCats('部署脚本', { 工作: ['部署'] }), ['工作'])
})

// ── 统计 ──
test('统计：活跃天数、最长连续、最忙月份', () => {
  const c = conv('dsh', 'a', [
    [at(2026, 3, 1, 10), 'user', 'a'], [at(2026, 3, 1, 10, 1), 'assistant'],
    [at(2026, 3, 2, 10), 'user', 'b'], [at(2026, 3, 3, 10), 'user', 'c'],
    [at(2026, 3, 10, 10), 'user', 'd'],
    [at(2026, 5, 1, 10), 'user', 'e'],
  ])
  const s = computeStats([c])
  assert.equal(s.activeDays, 5)
  assert.deepEqual(s.longestStreak, { days: 3, from: '2026-03-01', to: '2026-03-03' })
  assert.deepEqual(s.busiestMonth, { month: '2026-03', count: 4 })
  assert.equal(s.totals.userMsgs, 5)
  assert.equal(s.light, true)
})

test('统计：连续天数跨月跨年', () => {
  const c = conv('dsh', 'a', [[at(2025, 12, 31, 9), 'user', 'x'], [at(2026, 1, 1, 9), 'user', 'y'], [at(2026, 1, 2, 9), 'user', 'z']])
  assert.equal(computeStats([c]).longestStreak.days, 3)
})

test('统计：凌晨最多的那天 = 0–5 点之间消息最多的那天，不看离分界点多近', () => {
  const c = conv('dsh', 'a', [
    // 3-01 凌晨 1 条，4:59
    [at(2026, 3, 1, 4, 59), 'user', 'late'],
    // 3-02 凌晨 3 条，都在 0 点多
    [at(2026, 3, 2, 0, 5), 'user', 'a'], [at(2026, 3, 2, 0, 6), 'user', 'b'], [at(2026, 3, 2, 0, 7), 'user', 'c'],
    // 3-03 白天 10 条，不算
    ...Array.from({ length: 10 }, (_, i) => [at(2026, 3, 3, 14, i), 'user', `d${i}`]),
    // 5:00 整不算凌晨
    [at(2026, 3, 4, 5, 0), 'user', 'five'],
  ])
  assert.deepEqual(computeStats([c]).lateNight, { day: '2026-03-02', count: 3 })
})

test('统计：没有凌晨消息时 lateNight 是 null', () => {
  assert.equal(computeStats([conv('dsh', 'a', [[at(2026, 3, 1, 12), 'user', 'x']])]).lateNight, null)
})

test('统计：各 agent 占比，不到 1% 合并成「其他」', () => {
  const many = Array.from({ length: 200 }, (_, i) => [at(2026, 3, 1, 12) + i * 60000, 'user', `m${i}`])
  const s = computeStats([
    conv('dsh', 'a', many),
    conv('claude', 'b', many.slice(0, 100)),
    conv('codex', 'c', [[at(2026, 3, 2, 12), 'user', 'x']]),
    conv('cursor', 'd', [[at(2026, 3, 2, 12), 'user', 'y']]),
  ])
  assert.deepEqual(s.shares.map(x => [x.agent, x.count]), [['dsh', 200], ['claude', 100], ['other', 2]])
  assert.ok(Math.abs(s.shares.reduce((a, x) => a + x.share, 0) - 1) < 1e-9)
  assert.equal(s.perAgent.length, 4)                 // 分 agent 统计里还是四个都在
})

test('统计：轮次 = 用户说话后 agent 回过', () => {
  assert.equal(roundsOf([{ role: 'user' }, { role: 'assistant' }, { role: 'assistant' }, { role: 'user' }, { role: 'user' }, { role: 'assistant' }, { role: 'user' }]), 2)
})

test('统计：最长会话有标题显示标题，没有显示第一句前 20 字', () => {
  const long = '这是一句非常非常长的开场白，用来测试截断到二十个字是不是对的'
  const a = conv('dsh', 'a', [[1, 'user', long], [2, 'assistant'], [3, 'user', 'x'], [4, 'assistant']])
  const b = conv('dsh', 'b', [[1, 'user', 'y'], [2, 'assistant']], '短的')
  const s = computeStats([a, b])
  assert.equal(s.longest.id, 'a')
  assert.deepEqual(s.longest.label, { text: [...long].slice(0, 20).join(''), fromTitle: false })
  assert.deepEqual(convLabel(b), { text: '短的', fromTitle: true })
})

test('clip：范围外的消息去掉，没剩用户消息的会话去掉', () => {
  const c1 = conv('dsh', 'a', [[100, 'user', 'x'], [300, 'user', 'y']])
  const c2 = conv('dsh', 'b', [[100, 'user', 'x']])
  const out = clip([c1, c2], { start: 200, end: 400 })
  assert.equal(out.length, 1)
  assert.equal(out[0].msgs.length, 1)
})

// ── 原话 ──
test('原话：重复最多的短句、全年第一句、凌晨最晚一句，原样带日期和来源', () => {
  const c = conv('dsh', 'a', [
    [at(2026, 1, 5, 9), 'user', '你好，开始吧'],
    [at(2026, 1, 6, 9), 'user', '不对'], [at(2026, 1, 7, 9), 'user', '不对。'], [at(2026, 1, 8, 9), 'user', '不对'],
    [at(2026, 1, 9, 9), 'user', '你搜搜'], [at(2026, 1, 10, 9), 'user', '你搜搜'],
    [at(2026, 2, 1, 4, 40), 'user', '再跑一次'],
    [at(2026, 2, 3, 1, 0), 'user', '睡了'],
    [at(2026, 2, 4, 23, 59), 'user', '这句不是凌晨'],
  ])
  const q = pickQuotes([c])
  assert.equal(q.repeated[0].text, '不对')           // 显示第一次出现的原文
  assert.equal(q.repeated[0].count, 3)
  assert.equal(q.repeated[1].text, '你搜搜')
  assert.equal(q.first.text, '你好，开始吧')
  assert.equal(q.first.day, '2026-01-05')
  assert.equal(q.first.agentName, 'DeepSeek Harness')
  assert.equal(q.late.text, '再跑一次')
  assert.equal(q.late.time, '04:40')
})

test('原话：超过 2000 字的不进候选；打码；敏感的标出来', () => {
  const huge = 'x'.repeat(MAX_QUOTE_CHARS + 1)
  const c = conv('dsh', 'a', [[at(2026, 1, 1, 9), 'user', huge], [at(2026, 1, 2, 9), 'user', '看 /Users/sam/a.txt'], [at(2026, 1, 3, 2), 'user', '我妈叫我睡觉']])
  const q = pickQuotes([c])
  assert.equal(q.first.text, '看 〔路径〕')
  assert.deepEqual(q.late.sensitive, ['家庭'])
})

test('原话：agent 的回复不进候选', () => {
  const c = { agent: 'dsh', id: 'a', title: null, msgs: [{ t: 1, role: 'assistant', text: '我是 agent 说的' }, { t: 2, role: 'user', text: '我说的' }] }
  assert.equal(pickQuotes([c]).first.text, '我说的')
})

// ── 材料 ──
test('材料：每月最多 30 条，去掉超长、敏感，打码', () => {
  const msgs = Array.from({ length: 50 }, (_, i) => [at(2026, 3, 1, 9) + i * 3600_000, 'user', `第 ${i} 句`])
  msgs.push([at(2026, 3, 10, 9), 'user', 'y'.repeat(300)], [at(2026, 3, 11, 9), 'user', '考试成绩出来了'], [at(2026, 4, 1, 9), 'user', '看 ~/x/y.md'])
  const m = buildMaterial([conv('dsh', 'a', msgs, '某个标题')])
  const march = m.samples.filter(s => s.month === '2026-03')
  assert.equal(march.length, PER_MONTH)
  assert.ok(m.samples.every(s => s.text.length <= 200))
  assert.ok(!m.samples.some(s => s.text.includes('成绩')))
  assert.equal(m.droppedSensitive, 1)
  assert.equal(m.samples.find(s => s.month === '2026-04').text, '看 〔路径〕')
  assert.deepEqual(m.titles, [{ agent: 'dsh', text: '某个标题' }])
  assert.deepEqual(m.external, [])
})

test('材料：来自 Claude Code / Codex / Cursor 的条数单独列出', () => {
  const m = buildMaterial([conv('claude', 'a', [[1, 'user', 'x']], 'T'), conv('dsh', 'b', [[2, 'user', 'y']])])
  assert.deepEqual(m.external, [{ agent: 'claude', name: 'Claude Code', count: 2 }])
})

// ── 逐字核对 ──
test('逐字核对：对得上的留下，对不上的删掉', () => {
  const sources = ['跑一下测试', '不对，你再想想']
  assert.ok(isVerbatim('跑一下测试', sources))
  assert.ok(isVerbatim('你再想想', sources))           // 子串也算原话
  assert.ok(!isVerbatim('跑一下测试吧', sources))
  assert.ok(!isVerbatim('跑一下 测试', sources))       // 多一个空格也不行

  const r = dropUnverifiedSentences('你最常说「跑一下测试」。你还说过「我爱加班」。这一年很忙。', sources)
  assert.equal(r.text, '你最常说「跑一下测试」。这一年很忙。')
  assert.deepEqual(r.removed, ['我爱加班'])
})

test('逐字核对：奖项 quote 对不上置空，理由里编的句子删掉', () => {
  const v = verifyResult({
    keywords: ['测试'],
    awards: [
      { name: '测试狂魔', reason: '一年说了 40 次「跑一下测试」。', quote: '跑一下测试' },
      { name: '编的', reason: '你说过「我是天才」。', quote: '我是天才' },
    ],
    year: '你说“不对”的次数比说谢谢多。',
  }, ['跑一下测试', '不对'])
  assert.equal(v.result.awards[0].quote, '跑一下测试')
  assert.equal(v.result.awards[1].quote, null)
  assert.equal(v.result.awards[1].reason, '')
  assert.equal(v.result.year, '你说“不对”的次数比说谢谢多。')
  assert.deepEqual(v.removed, ['我是天才', '我是天才'])
})

// ── dsh 来源 ──
test('dsh：只认 source.kind=user 的 user/message，标题取最后一个 session/title', () => {
  const s = lightSessions()[0]
  const c = convFromEvents(s.header.id, s.events)
  assert.equal(c.msgs.filter(m => m.role === 'user').length, 5)
  assert.ok(!c.msgs.some(m => m.text.includes('system-context')))
  assert.equal(c.title, '修登录页的 bug')
  assert.ok(c.msgs.filter(m => m.role === 'assistant').every(m => m.text === ''))
})

test('轻度数据：150 条、三个月、走轻量版式', () => {
  const convs = lightSessions().filter(s => !s.header.origin).map(s => convFromEvents(s.header.id, s.events))
  const s = computeStats(clip(convs, ALL))
  assert.equal(s.totals.userMsgs, 150)
  assert.deepEqual(Object.keys(s.months), ['2026-06', '2026-07', '2026-08'])
  assert.equal(s.light, true)
  assert.ok(s.lateNight)
})
