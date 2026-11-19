// 大肥鱼的台词：dsh 事件和 Claude Code JSONL 切出来的轮一样算；挑时刻的规则；私事只看原话。
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMoments, claudeTurns, dshTurns, fill, fillFit, say, ago, topic, width, timeWord } from '../src/core/moments.js'
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

test('挑时刻：说好了却挨骂、认错，都带原话；光干了几分钟的流水账不说', () => {
  const { header, events } = dshSession()
  const ms = buildMoments(dshTurns('s1', header, events), { now: min(60) })
  const kinds = ms.map(m => m.kind)
  assert.equal(ms.some(m => m.kind === 'work'), false, '8 分钟的活不值得翻')
  const caught = ms.find(m => m.kind === 'caught')
  assert.ok(caught, kinds.join(','))
  assert.match(caught.text, /「还是报错？？」/)
  assert.match(caught.text, /今天下午/)                       // 近的事说「今天下午」，不报几月几日几点几分
  const sorry = ms.find(m => m.kind === 'sorry')
  assert.match(sorry.text, /「你说得对，是我漏了一个分支」/)
  for (const m of ms) assert.ok(width(m.text) <= 60, m.text)
})

test('私事只看原话：模板里的字不算，原话里的考试算成绩', () => {
  const turns = dshTurns('s', { cwd: '/x/proj' }, [
    { type: 'user/message', time: min(0), data: { content: [{ type: 'text', text: '帮我整理考试成绩表' }], source: { kind: 'user' } } },
    ...Array.from({ length: 70 }, (_, i) => ({ type: 'tool/call', time: min(i + 1), data: { name: 'bash', arguments: '{}' } })),
  ])
  const ms = buildMoments(turns, { now: min(100) })
  const work = ms.find(m => m.kind === 'work')
  assert.equal(work.event, 'long')
  assert.deepEqual(work.sensitive, ['成绩'])
  for (const m of ms.filter(m => m.kind === 'stat')) assert.deepEqual(m.sensitive, [])
})

test('Claude Code：被打断后主人的下一句是「继续」不算喊停；喊停的原话带路径的不说', () => {
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
  // 喊停的那句带路径：打码以后是〔路径〕，算行话，这件事不说
  assert.equal(buildMoments(turns, { now: min(60) }).filter(m => m.kind === 'stopped').length, 0)
  const clean = claudeTurns([...lines.slice(0, -1), line({ type: 'user', timestamp: at(11), message: { content: '先别动那个文件' } })], { key: 'g' })
  const stopped = buildMoments(clean, { now: min(60) }).filter(m => m.kind === 'stopped')
  assert.equal(stopped.length, 1)
  assert.match(stopped[0].text, /「先别动那个文件」/)
})

test('模板全部过检查：标了情绪和态度、占位符都认得、「」里只有原话、填出来过标准', () => {
  for (const [k, r] of Object.entries(check())) {
    assert.deepEqual(r.bad, [], k)
    assert.equal(r.dup, 0, k)
    assert.ok(r.count >= 2, k)
  }
  assert.ok(Object.values(TPL).flat().length >= 100)
})

test('按事件挑模板：缺值的跳过，填出来超 60 字或有行话的换下一条，都不行就不说', () => {
  const out = say('complain', 'x', { t: '昨天下午', said: '你到底行不行' })
  assert.match(out, /「你到底行不行」/)
  assert.match(out, /昨天下午/)
  assert.ok(width(out) <= 60)
  assert.equal(say('complain', 'x', { t: '昨天下午' }), null)                                   // 没有原话
  assert.equal(say('complain', 'x', { t: '昨天下午', said: '长'.repeat(60) }), null)            // 塞不下
  assert.equal(say('complain', 'x', { t: '昨天下午', said: '先 commit 再说' }), null)           // 原话里有行话，不能改，只能不说
  assert.match(say('complain', 'x', { t: '上个月弄 my-app 那阵', place: 'my-app', said: '还是不行' }, { t: '上个月', said: '还是不行' }), /my-app/)   // 几版说法依次试
  assert.equal(say('complain', 'x', { t: '10 月 3 日', said: '还是不行' }), null)                // 时间只说相对的：几月几日的不说
})

test('什么时候：近的口语，远的说几月几日；凌晨带钟点', () => {
  const now = new Date(2026, 10, 19, 15, 0).getTime()                 // 周四
  const at = (mo, d, h, mi = 0) => new Date(2026, mo - 1, d, h, mi).getTime()
  assert.equal(timeWord(at(11, 19, 10), now), '今天上午')
  assert.equal(timeWord(at(11, 18, 20), now), '昨天晚上')
  assert.equal(timeWord(at(11, 16, 14), now), '这周一下午')
  assert.equal(timeWord(at(11, 11, 21), now), '上周三晚上')
  assert.equal(timeWord(at(10, 30, 7), now), '10 月 30 日早上')
  assert.equal(timeWord(at(10, 30, 7), now, { part: false }), '10 月 30 日')
  assert.equal(timeWord(at(9, 20, 1, 20), now, { clock: true }), '9 月 20 日凌晨 1:20')
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

test('无限轮闲聊：每个心情 10 个按钮、每个 5 句回话；按钮 ≤6 字、回话 ≤40 字；接到的心情都存在，动作都有表情', async () => {
  const { CHAT, MOOD_ANIM, ANIM_MOOD } = await import('../src/shared/chat.js')
  const { EXPR } = await import('../src/shared/pet-engine.js')
  const { LINES } = await import('../src/shared/lines.js')
  for (const [mood, list] of Object.entries(CHAT)) {
    assert.equal(list.length, 10, mood)
    assert.ok(MOOD_ANIM[mood] && EXPR[MOOD_ANIM[mood]], mood)
    for (const [label, replies, to] of list) {
      assert.ok([...label].length <= 6, label)
      assert.equal(replies.length, 5, label)
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

test('拖她的话：拎起 30、拎久 20、甩 20、落地 30；扣着刚才的事那些占位符只在该在的地方；打分回话每种 👍👎 各 15', async () => {
  const { LINES } = await import('../src/shared/lines.js')
  assert.deepEqual([LINES.drag, LINES.dragLong, LINES.fling, LINES.land].map(a => new Set(a).size), [30, 20, 20, 30])
  for (const [k, list] of Object.entries(LINES.ctx)) {
    assert.ok(list.length >= (/^pick_|_many|_night|_hard/.test(k) ? 8 : /^land_(down|up|rate|chat|sulk)/.test(k) ? 10 : 6), k)
    for (const t of list) {
      assert.ok([...t.replace(/\{\w+\}/g, 'xxx').replace(/\s/g, '')].length <= 40, t)
      if (k === 'land_chat') assert.match(t, /\{label\}/)
      if (k === 'land_many') assert.match(t, /\{n\}/)
      assert.ok(!(t.match(/\{(\w+)\}/g) || []).some(p => p !== { land_down: '{kind}', land_chat: '{label}', land_many: '{n}' }[k]), t)
    }
  }
  for (const g of Object.values(LINES.rateReply)) { assert.equal(g.up.length, 15); assert.equal(g.down.length, 15) }
})

test('原话过滤在进事件卡之前：半截指令只留看得懂的前半句，留不下就不引；事件卡只带过了滤的那句', () => {
  const mk = (next, key) => dshTurns(key, { cwd: '/x/p' }, [
    { type: 'user/message', time: min(0), data: { content: [{ type: 'text', text: '帮我把按钮改成蓝色' }], source: { kind: 'user' } } },
    { type: 'assistant/message', time: min(2), data: { message: { content: [{ type: 'text', text: '我已经改成蓝色了，刷新就能看到。' }] } } },
    { type: 'turn/end', time: min(2), data: { reason: { kind: 'completed' } } },
    { type: 'user/message', time: min(5), data: { content: [{ type: 'text', text: next }], source: { kind: 'user' } } },
  ])
  const caught = (next, key) => buildMoments(mk(next, key), { now: min(60) }).find(m => m.kind === 'caught')
  assert.equal(caught('不行 你现在不能纯卡', 'a').card.next, '不行')                    // 后半句是冲着当时那件活说的，只留前半句
  assert.match(caught('不行 你现在不能纯卡', 'a').card.fact, /主人回了一句「不行」$/)
  assert.doesNotMatch(caught('不行 你现在不能纯卡', 'a').text, /纯卡/)
  assert.equal(caught('？？？我看不是网络又断了下', 'b'), undefined)                    // 前半句自己站不住：这件事不说
  assert.equal(caught('还是不行，跑 3 次都 timeout', 'c').card.next, '还是不行')        // 数字、英文的那半句不引
  assert.equal(caught('额？？？？ 太慢了吧 我要你2分钟搞定', 'd').card.next, '额？？？？ 太慢了吧')   // 留下的那段一个字符都不动（空格也在）
  assert.equal(caught('大哥 我目前刷新我也看不到啊', 'e').card.next, '大哥 我目前刷新我也看不到啊')
})

test('动作：每张要用的立绘和特效图都在包里；事件默认动作、模型能挑的动作，桌宠都演得出来', async () => {
  const fs = await import('node:fs')
  const { FIGURES, EXPR, POSE_FALLBACK, FX_OF, SEQ } = await import('../src/shared/pet-engine.js')
  const { EVENT_ANIM, ANIM_OF, TPL } = await import('../src/core/lines.js')
  const { ACTIONS } = await import('../src/core/style.js')
  for (const n of FIGURES) assert.ok(fs.existsSync(new URL(`../assets/xiaobenben/${n}.png`, import.meta.url)), n)
  for (const [k, anim] of [...Object.entries(EVENT_ANIM), ...Object.entries(ANIM_OF), ...Object.entries(ACTIONS)]) assert.ok(EXPR[anim], `${k} → ${anim}`)
  for (const ev of Object.keys(EVENT_ANIM)) assert.ok(TPL[ev], ev)
  for (const frame of [...Object.keys(FX_OF), ...Object.values(SEQ).flat()]) assert.ok(FIGURES.includes(frame), frame)
  for (const [pose, fallback] of Object.entries(POSE_FALLBACK)) assert.ok(FIGURES.includes(pose) && FIGURES.includes(fallback), pose)
  assert.equal(Object.keys(ACTIONS).length, 20)
})

test('情绪：每种事件有情绪；情绪定了能做的动作和回话按钮；动作对不上就换默认的；碎碎念的鼓脸不演成生气', async () => {
  const { EMOTIONS, fitAnim } = await import('../src/shared/emotion.js')
  const { EMOTION_OF, EVENT_ANIM, ANIM_OF, KIND_OF, TPL } = await import('../src/core/lines.js')
  const { EXPR, FX_OF, FX_SVG } = await import('../src/shared/pet-engine.js')
  const { MOOD_ANIM, CHAT } = await import('../src/shared/chat.js')
  for (const ev of Object.keys(TPL)) assert.ok(EMOTIONS[EMOTION_OF[ev]], `${ev} 没有情绪`)
  for (const [name, e] of Object.entries(EMOTIONS)) {
    assert.ok(e.anims.includes(e.def), name)
    for (const a of e.anims) assert.ok(EXPR[a], `${name} → ${a}`)
    assert.ok(e.buttons.length >= 2 && e.buttons.length <= 3, name)
    for (const [label, replies, anim, mood] of e.buttons) {
      assert.ok([...label].length <= 8, label); assert.ok(replies.length >= 3 && replies.every(r => [...r].length <= 40), label)
      assert.ok(EXPR[anim] && CHAT[mood], label)
    }
  }
  // 事件的默认动作都在它那种情绪允许的范围里
  for (const ev of Object.keys(TPL)) { const a = EVENT_ANIM[ev] || ANIM_OF[KIND_OF[ev] || 'stat']; assert.ok(EXPR[fitAnim(EMOTION_OF[ev], a)], ev) }
  assert.equal(fitAnim('sorry', 'proud'), 'bow')                  // 认错不能配得意
  assert.equal(fitAnim('sorry', 'bury'), 'bury')
  assert.equal(fitAnim('coax', 'angry'), 'coax')                  // 撒娇不能配生气
  assert.equal(fitAnim('brag', null), 'proud')
  for (const e of ['coax', 'sorry', 'brag', 'caught', 'scold', 'night', 'miss', 'tally', 'eat', 'halt']) assert.ok(!EMOTIONS[e].anims.includes('angry'), e)
  assert.notEqual(MOOD_ANIM.pout, 'angry')
  assert.ok(![].concat(EXPR.pouty, EXPR.coax).some(f => FX_OF[f] === 'anger'))     // 鼓脸、撒娇的图不挂怒气
  for (const f of Object.values(FX_OF)) assert.ok(FX_SVG[f]?.startsWith('<svg'), f)
  assert.deepEqual(EMOTIONS.sorry.buttons.map(b => b[0]).slice(0, 2), ['原谅你了', '还敢？'])
  assert.deepEqual(EMOTIONS.coax.buttons.map(b => b[0]), ['陪你玩', '给你买零食', '等会儿嘛'])
  assert.deepEqual(EMOTIONS.scold.buttons.map(b => b[0]), ['吓到你了？', '下次多打几个字', '没事啦'])       // 挨骂有自己的一组，不借抓包的
  assert.notDeepEqual(EMOTIONS.scold.buttons, EMOTIONS.caught.buttons)
})

test('情绪有转折的台词动作跟着转；夸主人的台词换一组按钮；被喊停的说法跟着时长变', async () => {
  const { TURN, turnAt, praisesOwner, replyEmotion, EMOTIONS } = await import('../src/shared/emotion.js')
  const { EXPR } = await import('../src/shared/pet-engine.js')
  for (const a of Object.values(TURN)) assert.ok(EXPR[a], a)
  const t = '那天本肥鱼一天认错 3 回……活最后也干完了嘛，嘿嘿。'
  assert.equal(t.slice(turnAt(t)), '活最后也干完了嘛，嘿嘿。')             // 说到落点才转
  assert.equal(turnAt('主人，本肥鱼错了。'), -1)                            // 只有一小句：不转
  const { realTurn } = await import('../src/shared/emotion.js')
  assert.equal(realTurn('主人说了 90 回不对。本肥鱼认了 59 回'), false)      // 有落点，但情绪没转：姿势不换
  assert.equal(realTurn('主人，本肥鱼说过「我理解错了」。\n呜，不是故意的，下次先想清楚再动手。'), true)
  assert.equal(TURN.sorry, 'headpat')
  assert.ok(praisesOwner('56 天，主人全给了 getAudio。都是你一点点磨出来的呀，本肥鱼作证。'))
  assert.ok(!praisesOwner('主人一句话，本肥鱼闷头干了 42 分钟。夸一句不过分吧？'))
  assert.equal(replyEmotion({ emotion: 'brag', text: '它能有今天，主人功劳最大啦～' }), 'thanks')
  assert.deepEqual(EMOTIONS.thanks.buttons.map(b => b[0]), ['你也辛苦了', '还好有你'])
  // 被喊停：十分钟以内「才干了…」，半小时以上「干了好久 / 干了…就停了」
  const mk = (mins, key) => dshTurns(key, { cwd: '/x/p' }, [
    { type: 'user/message', time: min(0), data: { content: [{ type: 'text', text: '把注册页也照这个改一下' }], source: { kind: 'user' } } },
    ...Array.from({ length: mins }, (_, i) => ({ type: 'tool/call', time: min(i + 1), data: { name: 'bash', arguments: '{}' } })),
    { type: 'turn/end', time: min(mins + 0.2), data: { reason: { kind: 'interrupted' } } },
    { type: 'user/message', time: min(mins + 1), data: { content: [{ type: 'text', text: '算了先停一下' }], source: { kind: 'user' } } },
  ])
  const stop = (mins, key) => buildMoments(mk(mins, key), { now: min(600) }).find(m => m.kind === 'stopped')
  assert.match(stop(4, 'a').text, /才干了 4 分钟/)
  assert.equal(stop(4, 'a').card.len, 'short')
  assert.doesNotMatch(stop(45, 'b').text, /才干了/)
  assert.match(stop(45, 'b').text, /干了 45 分钟/)
  assert.equal(stop(45, 'b').card.len, 'long')
  assert.match(stop(45, 'b').card.fact, /已经干了很久（45 分钟）/)
})
