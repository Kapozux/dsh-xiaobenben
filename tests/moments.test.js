// 大肥鱼的台词：dsh 事件和 Claude Code JSONL 切出来的轮一样算；挑时刻的规则；私事只看原话。
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMoments, claudeTurns, dshTurns, fill, fillFit, say, ago, topic, width } from '../src/core/moments.js'
import { rounds } from '../src/shared/pet-engine.js'
import { check } from '../scripts/check-lines.mjs'
import { TPL } from '../src/core/lines.js'

const T0 = new Date(2026, 10, 3, 14, 0).getTime()
const min = m => T0 + m * 60e3

function dshSession() {
  let seq = 0
  const ev = (type, data, t) => ({ type, data, seq: seq++, time: t })
  const user = (text, t) => ev('user/message', { id: 'u' + seq, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, t)
  const say = (text, t, usage) => ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } }, usage }, t)
  const call = (name, args, t) => ev('tool/call', { turn: 1, step: 1, callId: 'c' + seq, name, arguments: JSON.stringify(args) }, t)
  const events = [
    ev('session/title', { title: '修登录页', messageSeqs: [], source: { kind: 'user' } }, min(0)),
    user('帮我修一下登录页的报错', min(0)),
    ev('user/message', { content: [{ type: 'text', text: '<ctx>注入的</ctx>' }], source: { kind: 'agent-instructions' } }, min(0)),
  ]
  // 干 8 分钟：每分钟一次工具调用
  for (let i = 1; i <= 8; i++) events.push(call(i % 2 ? 'edit' : 'bash', i % 2 ? { path: `/p/src/f${i}.js` } : { command: 'npm test' }, min(i)))
  events.push(say('改好了，测试全过了。', min(8.5), { inputTokens: 60000, outputTokens: 2000 }))
  events.push(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, min(8.6)))
  events.push(user('还是报错？？', min(20)))
  events.push(say('你说得对，是我漏了一个分支。', min(21)))
  events.push(ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, min(21)))
  return { header: { id: 's1', cwd: '/Users/sam/proj', createdAt: min(0) }, events }
}

test('dsh 事件切轮：时长按事件间隔算、改的文件按路径去重、注入的上下文不算主人说话', () => {
  const { header, events } = dshSession()
  const turns = dshTurns('s1', header, events)
  assert.equal(turns.length, 2)
  const [a, b] = turns
  assert.equal(a.text, '帮我修一下登录页的报错')
  assert.equal(a.title, '修登录页')
  assert.equal(a.project, 'proj')
  assert.equal(a.edited.size, 4)
  assert.equal(a.commands, 4)
  assert.equal(a.tokens, 62000)
  assert.ok(Math.abs(a.active - 8.6 * 60e3) < 1000)
  assert.equal(a.next, '还是报错？？')
  assert.equal(b.text, '还是报错？？')
})

test('子代理开的会话不算', () => {
  const { events } = dshSession()
  assert.deepEqual(dshTurns('s1', { origin: 'subagent' }, events), [])
})

test('挑时刻：干活、说好了却挨骂、认错，都带真数字和原话', () => {
  const { header, events } = dshSession()
  const ms = buildMoments(dshTurns('s1', header, events), { now: min(60) })
  const kinds = ms.map(m => m.kind)
  const work = ms.find(m => m.kind === 'work')
  assert.ok(work, kinds.join(','))
  assert.match(work.text, /修登录页/)
  assert.doesNotMatch(work.text, /「修登录页/)                 // 任务名不套引号
  assert.match(work.text, /9 分钟|碗/)
  const caught = ms.find(m => m.kind === 'caught')
  assert.ok(caught, kinds.join(','))
  assert.match(caught.text, /改好了，测试全过了/)
  assert.match(caught.text, /还是报错？？/)
  const sorry = ms.find(m => m.kind === 'sorry')
  assert.match(sorry.text, /你说得对，是我漏了一个分支/)
})

test('私事只看原话：模板里的「有感情了」不算感情，原话里的考试算成绩', () => {
  const turns = dshTurns('s', { cwd: '/x/proj' }, [
    { type: 'user/message', time: min(0), data: { content: [{ type: 'text', text: '帮我整理考试成绩表' }], source: { kind: 'user' } } },
    ...Array.from({ length: 70 }, (_, i) => ({ type: 'tool/call', time: min(i + 1), data: { name: 'bash', arguments: '{}' } })),
  ])
  const ms = buildMoments(turns, { now: min(100) })
  const work = ms.find(m => m.kind === 'work')
  assert.deepEqual(work.sensitive, ['成绩'])
  const stat = ms.find(m => m.kind === 'stat' && /proj/.test(m.text))
  assert.deepEqual(stat.sensitive, [])
})

test('Claude Code：被打断后主人的下一句是「继续」不算喊停；喊停的原话要打码', () => {
  const at = m => new Date(min(m)).toISOString()
  const line = o => JSON.stringify(o)
  const lines = [
    line({ type: 'user', timestamp: at(0), cwd: '/Users/sam/app', message: { content: '帮我把导入脚本重构一下' } }),
    ...Array.from({ length: 4 }, (_, i) => line({ type: 'assistant', timestamp: at(i + 1), message: { id: 'm' + i, content: [{ type: 'tool_use', name: 'Bash', input: {} }], usage: { input_tokens: 10, output_tokens: 10 } } })),
    line({ type: 'user', timestamp: at(5), message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
    line({ type: 'user', timestamp: at(6), message: { content: '继续' } }),
    ...Array.from({ length: 3 }, (_, i) => line({ type: 'assistant', timestamp: at(7 + i), message: { id: 'n' + i, content: [{ type: 'tool_use', name: 'Bash', input: {} }] } })),
    line({ type: 'user', timestamp: at(10), message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
    line({ type: 'user', timestamp: at(11), message: { content: '别动 /Users/sam/app/.env 那个文件' } }),
  ]
  const turns = claudeTurns(lines, { key: 'f' })
  assert.equal(turns.length, 3)
  assert.equal(turns[0].interrupted, true)
  assert.equal(turns[0].commands, 4)
  const stopped = buildMoments(turns, { now: min(60) }).filter(m => m.kind === 'stopped')
  assert.equal(stopped.length, 1)
  assert.match(stopped[0].text, /别动 〔路径〕 那个文件/)
})

test('800 条对话版模板全部过检查：必须的占位符各一次、填完没残留、引号不套娃、不超长', () => {
  for (const [k, r] of Object.entries(check())) {
    assert.deepEqual(r.bad, [], k)
    assert.equal(r.dup, 0, k)
    assert.ok(r.count >= 25, k)
  }
})

test('按类型挑模板：缺值的跳过，太长换下一条，都不行就不说', () => {
  const out = say('complain', 'x', { w: '10 月 3 日中午' }, { said: '你到底行不行' })
  assert.match(out, /「你到底行不行」/)
  assert.match(out, /10 月 3 日中午/)            // 模板没写时间的，前面补上
  assert.equal(say('complain', 'x', { w: '10 月 3 日中午', about: '合并页' }, { said: '你到底行不行' }).includes('合并页那会儿'), true)
  assert.equal(say('complain', 'x', {}, { said: '长'.repeat(130) }), null)
})

test('气泡：一轮一行，去掉「本肥鱼：」「主人：」，主人的话单独标出来', () => {
  assert.deepEqual(rounds('主人：「{task}要多久？」\n本肥鱼：「12 分钟。」\n主人：「……饭是重点吧？」'.replace('{task}', '导入')), [
    { who: 'master', text: '「导入要多久？」' }, { who: 'me', text: '「12 分钟。」' }, { who: 'master', text: '「……饭是重点吧？」' },
  ])
  assert.deepEqual(rounds('嘿咻！搞定啦。'), [{ who: 'me', text: '嘿咻！搞定啦。' }])
  assert.deepEqual(rounds('主人：下次呢？本肥鱼：下次早点说。'), [{ who: 'master', text: '下次呢？' }, { who: 'me', text: '下次早点说。' }])
  assert.equal(rounds('今天的本肥鱼：搞完了。').length, 1)     // 不是说话人标签，不拆
})

test('任务名压成 ≤10 字、不带引号：去客套、去长英文词、去括号补充；带路径或压不下就不要', () => {
  assert.equal(topic('帮我把导入脚本重构一下'), '导入脚本重构')
  assert.equal(topic('合并 Pipeline 和 Creators 页'), '合并页')
  assert.equal(topic('继续做（以及对分析资料里面屏蔽关于任何USA的内容）'), '继续做')
  assert.equal(topic('你能不能帮我把 README 写清楚一点'), 'README写清楚')
  assert.equal(topic('把首页的按钮颜色改成蓝色然后加个动画'), '首页按钮颜色改成蓝色')
  assert.equal(topic('看下 /Users/sam/proj/.env 里的 key'), null)
  assert.equal(topic('fix the login bug'), null)
  assert.equal(topic('做一个可以同时看三个博主观点对比的页面'), null)
})

test('原话：脏话打成 ××；在空格处截时前面至少两个汉字', () => {
  const mk = (next) => dshTurns('k', { cwd: '/x/p' }, [
    { type: 'user/message', time: min(0), data: { content: [{ type: 'text', text: '帮我把按钮改成蓝色' }], source: { kind: 'user' } } },
    { type: 'assistant/message', time: min(2), data: { message: { content: [{ type: 'text', text: '已经改好了，刷新就能看到。' }] } } },
    { type: 'turn/end', time: min(2), data: { reason: { kind: 'completed' } } },
    { type: 'user/message', time: min(3), data: { content: [{ type: 'text', text: next }], source: { kind: 'user' } } },
  ])
  const caught = buildMoments(mk('还是不行你他妈搞干净'), { now: min(60) }).find(m => m.kind === 'caught')
  assert.ok(caught)
  assert.doesNotMatch(caught.text, /他妈/)
  assert.match(caught.text, /××/)
})

test('超过上限自动换短模板；全都塞不下就不说', () => {
  const list = ['这一条特别特别长：{said}，本鱼要把它说完' + '说完'.repeat(60) + '。', '短的：「{said}」']
  for (let i = 0; i < 20; i++) assert.equal(fillFit(list, i, { said: '你说得对是我漏了一个分支呀' }), '短的：「你说得对是我漏了一个分支呀」')
  assert.equal(fillFit([list[0]], 0, { said: '你说得对是我漏了一个分支呀' }), null)
})

test('被抓包放宽：「已经改了，刷新就能看到」+「刷新了还是没变啊」算；「你能不能用OR帮我」「没用中国模型？」不算；同一件事抄了两份只说一次', () => {
  const mk = (next, key) => dshTurns(key, { cwd: '/x/p' }, [
    { type: 'user/message', time: min(0), data: { content: [{ type: 'text', text: '帮我把按钮改成蓝色' }], source: { kind: 'user' } } },
    { type: 'assistant/message', time: min(2), data: { message: { content: [{ type: 'text', text: '我已经改成蓝色了，刷新就能看到。' }] } } },
    { type: 'turn/end', time: min(2), data: { reason: { kind: 'completed' } } },
    { type: 'user/message', time: min(5), data: { content: [{ type: 'text', text: next }], source: { kind: 'user' } } },
  ])
  const caught = turns => buildMoments(turns, { now: min(60) }).filter(m => m.kind === 'caught')
  assert.equal(caught(mk('刷新了还是没变啊', 'a')).length, 1)
  assert.equal(caught(mk('你能不能用OR帮我弄转写？', 'b')).length, 0)
  assert.equal(caught(mk('抽证据卡这么贵没用中国模型？', 'c')).length, 0)
  assert.equal(caught([...mk('刷新了还是没变啊', 'd'), ...mk('刷新了还是没变啊', 'e')]).length, 1)
})

test('台词缓存：过期了先给旧的、后台重算，不让点的人等', async () => {
  const { Pet } = await import('../src/pet.js')
  let n = 0
  const slow = () => new Promise(r => setTimeout(() => r({ sessions: 0, skipped: 0, turns: [] }), 50))
  const pet = new Pet({ sessionQuery: { listSessions: async () => { n++; return [] } }, store: { read: () => ({ sources: { claude: true } }) }, loadClaude: slow })
  const a = await pet.moments({ raw: true })
  pet.cache.at -= 11 * 60e3                      // 假装过期
  const t0 = Date.now()
  const b = await pet.moments({ raw: true })
  assert.ok(Date.now() - t0 < 20, '过期也立刻回')
  assert.equal(b, a)
  await new Promise(r => setTimeout(r, 100))
  assert.equal(n, 2, '后台重算了一次')
  assert.notEqual(pet.cache.value, a)
})

test('无限轮闲聊：每个心情至少 6 个按钮、每个 3 句回话；按钮 ≤6 字、回话 ≤40 字；接到的心情都存在，动作都有表情', async () => {
  const { CHAT, MOOD_ANIM, ANIM_MOOD } = await import('../src/shared/chat.js')
  const { EXPR } = await import('../src/shared/pet-engine.js')
  const { LINES } = await import('../src/shared/lines.js')
  for (const [mood, list] of Object.entries(CHAT)) {
    assert.ok(list.length >= 6, mood)
    assert.ok(MOOD_ANIM[mood] && EXPR[MOOD_ANIM[mood]], mood)
    for (const [label, replies, to] of list) {
      assert.ok([...label].length <= 6, label)
      assert.equal(replies.length, 3, label)
      for (const r of replies) assert.ok([...r].length <= 40, r)
      assert.ok(CHAT[to], `${label} → ${to}`)
    }
  }
  for (const list of Object.values(LINES.react)) for (const r of list) if (r.replies.length) assert.ok(ANIM_MOOD[r.anim], r.anim)
})

test('碎碎念：500 句、不重复、≤40 字、心情都认识、任何钟点都有 400 句以上能说', async () => {
  const { IDLE } = await import('../src/shared/idle.js')
  const { CHAT } = await import('../src/shared/chat.js')
  assert.equal(IDLE.length, 500)
  assert.equal(new Set(IDLE.map(l => l.text)).size, 500)
  for (const l of IDLE) { assert.ok([...l.text.replace(/\s/g, '')].length <= 40, l.text); assert.ok(CHAT[l.mood], l.mood) }
  for (let h = 0; h < 24; h++) {
    const n = IDLE.filter(l => !l.hours || (l.hours[0] <= l.hours[1] ? h >= l.hours[0] && h < l.hours[1] : h >= l.hours[0] || h < l.hours[1])).length
    assert.ok(n >= 400, `${h} 点只有 ${n} 句`)
  }
})

test('反馈：👎 的不再挑、👍 的多挑；外面读进来的只收认得的字段', async () => {
  const { pickRated, normFeedback, feedbackJson } = await import('../src/shared/feedback.js')
  const fb = normFeedback({ lines: { a: -1, b: 1, x: 'oops' }, kinds: { work: [2, 1], bad: [1] }, clicks: { 摸摸头: 3, 零: 0 }, log: [{ t: 1, what: '落地', text: 'a', d: -1 }, { bad: 1 }], junk: 1 })
  assert.deepEqual(fb.lines, { a: -1, b: 1 }); assert.deepEqual(fb.kinds, { work: [2, 1] }); assert.deepEqual(fb.clicks, { 摸摸头: 3 }); assert.equal(fb.log.length, 1)
  const n = { a: 0, b: 0, c: 0 }
  for (let i = 0; i < 4000; i++) n[pickRated(['a', 'b', 'c'], fb)]++
  assert.equal(n.a, 0); assert.ok(n.b > n.c * 2, JSON.stringify(n))
  assert.equal(pickRated(['a'], fb), 'a')                 // 全被 👎 了：当没投过
  assert.ok(feedbackJson(fb).length < 1000)
})
