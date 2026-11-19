// 翻旧账的 AI 改写：核对规则 + 一批跑下来（假模型），不合格的用模板兜底。
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLine, cardLine, outCard, styleRun, styleQuote, cardsHash } from '../src/core/style.js'

const complain = { id: 'c1', kind: 'complain', event: 'complain', when: '10 月 4 日弄 my-app 那阵', time: '10 月 4 日', rel: '上个月', task: 'my-app', said: '你到底行不行', fact: '上个月（当时在弄 my-app），主人对本肥鱼干的活不满意，说了「你到底行不行」', ctx: '主人：把登录页的按钮改圆一点\n本肥鱼：改好了，刷新就能看到。\n主人：你到底行不行' }
const caught = { id: 'k1', kind: 'caught', event: 'caught', when: '11 月 5 日下午', time: '11 月 5 日下午', rel: '上周三下午', claim: '改好了', next: '还是不行', fact: '上周三下午，本肥鱼跟主人说弄好了，结果没好，主人回了一句「还是不行」', ctx: '主人：帮我修一下登录页\n本肥鱼：改好了，测试全过了。\n主人：还是不行' }
const terse = { id: 'w1', kind: 'work', event: 'terse', when: '昨天上午', time: '昨天上午', rel: '昨天上午', said: '做吧', dur: '22 分钟', fact: '昨天上午，主人只说了「做吧」，本肥鱼就干了 22 分钟' }
const owe = { id: 's1', kind: 'stat', event: 'stat_owe', stat: 'owe', span: 120, n: 90, m: 59, k: 31, fact: '最近 120 天，主人说本肥鱼不对 90 回，本肥鱼认错 59 回，差 31 回没认' }
const streak = { id: 's2', kind: 'stat', event: 'stat_streak', stat: 'streak', span: 120, rel: '上个月', project: 'my-app', n: 9, date: '10 月 30 日', fact: '主人弄 my-app 这个项目，曾经连着 9 天一天没断（是上个月开始的那 9 天，现在已经过去了），本肥鱼也陪了 9 天' }

test('角色设定：docs/persona.md 和放进提示词的那份一字不差', async () => {
  const fs = await import('node:fs')
  const { PERSONA } = await import('../src/core/persona.js')
  const { STYLE_SYSTEM } = await import('../src/core/style.js')
  assert.ok(fs.readFileSync(new URL('../docs/persona.md', import.meta.url), 'utf8').includes(PERSONA))
  assert.ok(STYLE_SYSTEM.includes(PERSONA))
  for (const w of ['嘿咻', '白饭', '本鲸', '服务器繁忙', '耐心是你的，脸是我丢的']) assert.ok(PERSONA.includes(w), w)
})

test('语气示例：docs/persona-examples.md 里的句子都在提示词用的那份里；每件事只看自己那一类的例子和主人亲手写的那句', async () => {
  const fs = await import('node:fs')
  const { EXAMPLES, OWNER_EXAMPLE, exampleFor } = await import('../src/core/persona-examples.js')
  const { STYLE_SYSTEM, buildStylePrompt } = await import('../src/core/style.js')
  const doc = fs.readFileSync(new URL('../docs/persona-examples.md', import.meta.url), 'utf8')
  assert.ok(doc.includes(OWNER_EXAMPLE))
  for (const e of Object.values(EXAMPLES)) for (const l of e.lines) assert.ok(doc.includes(l), l)
  assert.equal(doc.split('\n').filter(l => l.trim() && !/^[#-]|^下面每个|^写台词时/.test(l)).length, 1 + Object.values(EXAMPLES).flatMap(e => e.lines).length)   // 文档里的例句一句不少
  assert.ok(STYLE_SYSTEM.includes(OWNER_EXAMPLE))
  for (const e of Object.values(EXAMPLES)) for (const l of e.lines) assert.ok(!STYLE_SYSTEM.includes(l))        // 分类的例子不进公共提示词
  const { prompt } = buildStylePrompt([caught, owe])
  assert.ok(prompt.includes(EXAMPLES.抓包.lines[0]) && prompt.includes(EXAMPLES.对账.lines[0]))
  assert.ok(!prompt.includes(EXAMPLES.深夜.lines[0]) && !prompt.includes(EXAMPLES.认错.lines[0]))
  assert.equal(exampleFor('late').name, '深夜')
})

test('发出去的卡片：一行事实（相对时间），底下是事发前后的几句对话；总账没有对话', () => {
  assert.equal(cardLine(complain), 'id=c1 | 挨骂 | 上个月（当时在弄 my-app），主人对本肥鱼干的活不满意，说了「你到底行不行」\n  当时的对话：\n    主人：把登录页的按钮改圆一点\n    本肥鱼：改好了，刷新就能看到。\n    主人：你到底行不行')
  assert.equal(cardLine(owe), 'id=s1 | 对账 | 最近 120 天，主人说本肥鱼不对 90 回，本肥鱼认错 59 回，差 31 回没认')
})

test('核对·不变的三条：原话一字不改、数字不改、不编时间段', () => {
  assert.equal(checkLine(complain, '主人还记得吗，上个月你问本肥鱼「你到底行不行」……\n呜，本肥鱼现在行一点了嘛～'), null)
  assert.match(checkLine(complain, '那天本肥鱼刚说完「改好了，刷新就能看到」，主人就问「你到底行不行」。呜，不许笑嘛～'), /「改好了，刷新就能看到」不是这件事的原话/)      // 当时的对话里别的话不许引：只能引事件卡第一行那句
  assert.match(checkLine(complain, '主人那天说「你到底行不行啊」。呜，本肥鱼懂的嘛～'), /不是这件事的原话/)
  assert.match(checkLine(complain, '主人那天说「到底行不行」。呜，本肥鱼懂的嘛～'), /不是这件事的原话/)          // 只引半句也不行
  assert.match(checkLine(complain, '主人那天说「你到底行不行」，本肥鱼可是干了 3 小时呀～'), /数字 3 卡片里没有/)
  assert.match(checkLine({ ...complain, ctx: complain.ctx + '\n本肥鱼：一共 7029 字' }, '主人那天说「你到底行不行」，本肥鱼写了 7029 字呢，呜。'), /数字 7029 卡片里没有/)   // 对话里的数字不算这件事的数
  assert.match(checkLine(terse, '主人昨天上午就两个字「做吧」，本肥鱼干了 22 分钟呢，亏呀～'), /汉字/)
  assert.match(checkLine(owe, '主人说了 90 回不对，本肥鱼认了 60 回嘛～'), /数字 60 卡片里没有/)
  assert.match(checkLine(complain, '主人那天夜里说「你到底行不行」，呜，本肥鱼记着呢～'), /没有「夜里」这个时间段/)
  assert.match(checkLine(complain, '主人上周说「你到底行不行」，呜，本肥鱼记着呢～'), /时间不是「上周」/)
  assert.match(checkLine(complain, '主人 10 月 4 日说「你到底行不行」，呜，本肥鱼记着呢～'), /写了几月几日/)
})

test('核对·语气：对主人说话、有语气词、不写旁白、不照抄示例、项目名最多一次', () => {
  assert.match(checkLine(complain, '上个月被问了一句「你到底行不行」，本肥鱼没敢回嘴呀。'), /不是在对主人说话/)
  assert.match(checkLine(complain, '主人上个月问「你到底行不行」，本肥鱼没敢回。'), /没有语气词/)
  assert.match(checkLine(complain, '主人那天问「你到底行不行」，本肥鱼尾巴都夹起来了呀～'), /旁白式描写/)
  assert.match(checkLine(complain, '主人那天问「你到底行不行」（缩成一团）呜，别问了嘛～'), /括号里写了动作/)
  assert.equal(checkLine(complain, '主人那天问「你到底行不行」……（小声）行的嘛，就是慢了点～'), null)
  assert.match(checkLine(complain, '主人那天在 my-app 里问「你到底行不行」，my-app 都听见了呀～'), /项目名出现了不止一次/)
  assert.match(checkLine(terse, '主人昨天上午只说了「做吧」，本肥鱼干了 22 分钟……这算加班吗？嘿嘿～'), /照抄了示例里的「这算加班吗」/)
  assert.match(checkLine(caught, '主人，上周三下午本肥鱼那个 PR，你回「还是不行」呀，呜。'), /行话/)
  assert.match(checkLine(caught, '诶，上周三下午本肥鱼说弄好了，主人回「还是不行」。'), /没有本肥鱼的反应/)
  assert.match(checkLine(complain, '主人：「你到底行不行」\n呜，本肥鱼记着呢～'), /对话体/)
  assert.match(checkLine(complain, '主人呀，「你到底行不行」，' + '本肥鱼嘿嘿'.repeat(12)), /超过 60/)
  assert.match(checkLine(streak, '主人曾经连着 9 天一天没断，本肥鱼也陪了 9 天，快夸夸我们嘛～'), /必须带项目名「my-app」/)
  assert.equal(checkLine(streak, '主人还记得吗，my-app 你连着弄过 9 天，一天没断。本肥鱼也陪了 9 天哦，嘿嘿～'), null)
  assert.equal(checkLine(owe, '主人说了本肥鱼 90 回不对，本肥鱼只认了 59 回……\n（小声）剩下 31 回先欠着嘛～'), null)
})

test('跑一批：先写后挑。程序核对扔掉改了原话的；挑的时候标成有问题的不选，全有问题就照模板念；调用失败重试一次；动作跟着选中的那版走', async () => {
  const good1 = '主人还记得吗，上个月你问本肥鱼「你到底行不行」……呜，现在行一点了嘛～', good2 = '诶，「你到底行不行」，这句是主人上个月问的。本肥鱼还欠主人一个行呢，嘿嘿～'
  const calls = []
  const adapter = async ({ system, prompt }) => {
    const pick = system.includes('台词编辑')
    calls.push(pick ? 'pick' : 'write')
    if (calls.length === 1) throw new Error('网络断了')
    if (!pick) return { text: JSON.stringify({ lines: /上一遍写的都没过检查/.test(prompt)
      ? [{ id: 'w1', texts: [{ t: '主人昨天上午只说了「做吧」，本肥鱼就干了 22 分钟呀，主人还笑着走开了，哼～', a: '得意' }] }]             // 第二遍 w1 过了程序核对，但编了细节
      : [{ id: 'c1', texts: [{ t: good1, a: '委屈' }, { t: '主人那句「你到底行不行啊」，本肥鱼记着呢～', a: '委屈' }, { t: good2, a: '本子挡脸' }] }, { id: 'k1', texts: ['主人，上周三下午你回「根本不行」，呜。'] }] }) }
    assert.match(prompt, /候选：\n    1\. /)
    return { text: JSON.stringify({ picks: [{ id: 'c1', best: 2, bad: [], why: '落点在最后' }, { id: 'w1', best: 0, bad: [1], why: '编了主人笑着走开' }] }) }
  }
  const r = await styleRun({ adapter, cards: [complain, caught, terse], route: { provider: 'p', model: 'm' } })
  assert.deepEqual(calls, ['write', 'write', 'write', 'pick'])           // 第一批失败重试 1 次；没过核对的再写 1 次；挑 1 次
  assert.deepEqual(r.lines, { c1: [{ text: good2, anim: 'caught' }] })
  assert.equal(r.dropped, 2)                                             // 程序核对扔掉的：c1 改了原话的 1 版、k1 改了原话的 1 版
  assert.deepEqual(r.failed.map(f => f.id).sort(), ['k1', 'w1'])
  assert.match(r.failed.find(f => f.id === 'w1').why, /几个版本都有问题（编了主人笑着走开/)
})

test('预计 token：写和挑两步都算；样例里有带对话的卡片；指纹跟着卡片变', () => {
  const q = styleQuote([complain, caught, owe], { provider: 'p', model: 'm' }, [{ provider: 'p', model: 'm', input: 1, output: 2, currency: 'CNY' }])
  assert.equal(q.count, 3)
  assert.equal(q.calls, 2)
  assert.equal(q.withContext, 2)
  assert.equal(q.inputTokens, q.stages.write.input + q.stages.pick.input)
  assert.ok(q.stages.pick.input > 0 && q.outputTokens > 3 * 400)
  assert.equal(q.cost.currency, 'CNY')
  assert.match(q.prompt, /当时的对话/)
  assert.match(q.sample[0], /当时的对话/)
  assert.notEqual(cardsHash([complain]), cardsHash([complain, caught]))
})

test('问一次、存本机、之后只发新的：私事不发；主人答「不用」就记住；写好的按事件存下选中的那一版', async () => {
  const { Styler } = await import('../src/styler.js')
  const { Store } = await import('../src/store.js')
  const os = await import('node:os'), fs = await import('node:fs'), path = await import('node:path')
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xbb-style-')), 'state.json'))
  const moments = [{ kind: 'complain', card: complain, sensitive: [] }, { kind: 'caught', card: caught, sensitive: ['家庭'] }]
  const sent = []
  const adapter = async ({ system, prompt }) => {
    sent.push(prompt)
    const ids = [...new Set([...prompt.matchAll(/id=(\w+)/g)].map(m => m[1]))]
    if (system.includes('台词编辑')) return { text: JSON.stringify({ picks: ids.map(id => ({ id, best: 1, bad: [], why: '好' })) }) }
    return { text: JSON.stringify({ lines: ids.map(id => ({ id, texts: ['主人上个月问本肥鱼「你到底行不行」……呜，现在行一点了嘛～', '主人昨天上午只说了「做吧」，本肥鱼就干了 22 分钟呢，哼～'] })) }) }
  }
  const styler = new Styler({ pet: { moments: async () => ({ moments }) }, store, adapter })
  let st = await styler.status()
  assert.equal(st.asked, null)
  assert.equal(st.pending, 1)                                   // 私事那件不算
  styler.answer('no')
  assert.equal((await styler.status()).asked, 'no')
  const route = { provider: 'p', model: 'm' }
  const q = await styler.quote({ route })
  assert.equal(q.count, 1)
  assert.doesNotMatch(q.prompt, /k1/)
  assert.equal((await styler.start({ route, hash: 'x' })).ok, false)           // 给主人看的和要发的对不上：不发
  assert.equal((await styler.start({ route, hash: q.hash })).ok, true)
  while ((await styler.status()).running) await new Promise(r => setTimeout(r, 5))
  st = await styler.status()
  assert.equal(st.asked, 'yes')
  assert.equal(st.pending, 0)
  assert.deepEqual(store.read().styled.c1, ['主人上个月问本肥鱼「你到底行不行」……呜，现在行一点了嘛～'])      // 第二个版本说的不是这件事（引的话、数字都不是这张卡的），扔掉
  moments.push({ kind: 'work', card: terse, sensitive: [] })                 // 有了新的事：只发新的
  assert.equal((await styler.status()).pending, 1)
  const q2 = await styler.quote({ route })
  assert.match(q2.prompt, /id=w1/)
  assert.doesNotMatch(q2.prompt, /id=c1/)
})
