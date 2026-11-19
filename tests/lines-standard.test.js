// 台词标准（docs/lines-standard.md）里机器能查的：字数、轮数、引号套娃、行话黑名单、原话逐字、数字真实、私事不说。
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLine, spaced, bubbleLines, MAX } from '../scripts/lines-standard.mjs'
import { check, coverage } from '../scripts/check-lines.mjs'
import { buildMoments, dshTurns } from '../src/core/moments.js'

// 口气另有一条测试；这几条只看各自那一项
const rules = (text, ctx) => [...new Set(checkLine(text, { voice: false, ...ctx }).map(b => b.rule))]

test('检查器：合格的台词不报', () => {
  const text = '昨天下午我说「改好了」，你回「打不开啊」。本肥鱼当场装死。'
  assert.deepEqual(rules(text, { sources: ['已经停掉旧的、重新启动，改好了。', '打不开啊'], card: {} }), [])
})

test('检查器：字数（不算空格和换行）、轮数、气泡里最多两行', () => {
  assert.deepEqual(rules('字'.repeat(54)), [])                          // 一行 27 个字，两行 54
  assert.deepEqual(rules('字'.repeat(55)), ['行数'])
  assert.deepEqual(rules('字'.repeat(MAX + 1)), ['字数', '行数'])
  assert.deepEqual(rules('第一轮\n第二轮'), [])
  assert.deepEqual(rules('第一轮\n第二轮\n第三轮'), ['轮数'])
  assert.deepEqual(rules('字'.repeat(28) + '\n第二行'), ['行数'])       // 自己换了行，第一行又折了一行：三行
  assert.equal(bubbleLines('主人在 getAudio 里干了 22 分钟，本肥鱼记着呢～'), 1)   // 英文数字算半个字
})

test('检查器：引号套娃', () => {
  assert.deepEqual(rules('你说「它说「好了」」'), ['引号套娃'])
  assert.deepEqual(rules('你说「它说“好了”」'), ['引号套娃'])
  assert.deepEqual(rules('我说「好了」，你说「没好」'), [])
})

test('检查器：行话黑名单（任务 ID、路径、文件名、英文技术词、引号外的英文）', () => {
  for (const bad of ['合了 #25 那个', '修了 ABC-123', '回到 85a214a 那版', '改了 src/pages/login', '动了 login.tsx', '那天合并了 3 个 PR', '你说「先 commit 吧」', '别动 〔路径〕 那个文件', '弄 Pipeline 那会儿']) {
    assert.deepEqual(rules(bad), ['行话'], bad)
  }
  assert.deepEqual(rules('你在 my-app 里耗了 3 天', { project: 'my-app' }), [])
  assert.deepEqual(rules('你说「这个 bug 还在」'), [])
  assert.deepEqual(rules('你说「问问 Claude 吧」'), [])             // 原话里的普通英文不算，黑名单里的才算
})

test('检查器：原话逐字（截断加…可以，改字不行）', () => {
  const sources = ['大哥 我目前刷新我也看不到啊，你再看看', '**改好了**，刷新就能看到']
  assert.deepEqual(rules('你说「大哥 我目前刷新我也看不到啊」', { sources }), [])
  assert.deepEqual(rules('你说「大哥 我目前刷新…」', { sources }), [])
  assert.deepEqual(rules('我说「改好了，刷新就能看到」', { sources }), [])     // markdown 记号不算字
  assert.deepEqual(rules('你说「大哥我刷新也看不到」', { sources }), ['原话'])
  assert.deepEqual(rules('主人：「饭呢？」', { sources }), ['原话'])          // 模板里编的对白不许套引号
})

test('检查器：数字都来自事件卡', () => {
  const card = { when: '11 月 6 日下午 3:06', dur: '12 分钟', rice: '3 碗白饭' }
  assert.deepEqual(rules('11 月 6 日下午，干了 12 分钟，吃了 3 碗', { card }), [])
  assert.deepEqual(rules('干了 15 分钟', { card }), ['数字'])
})

test('检查器：私事', () => {
  assert.deepEqual(rules('那天你说「我妈住院了」'), ['私事'])
  assert.deepEqual(rules('那天你在改请假条', { sensitive: ['家庭'] }), ['私事'])
})

test('检查器：口气——对主人说话、有语气词、时间说相对的、不写身体动作（惯用语不算）', () => {
  const voice = text => checkLine(text).filter(b => b.rule === '口气').map(b => b.why)[0] || null
  assert.equal(voice('主人还记得吗，上周本肥鱼报喜报早了……呜，下次看清楚嘛。'), null)
  assert.match(voice('上周本肥鱼报喜报早了，呜。'), /不是在对主人说话/)
  assert.match(voice('主人上周说本肥鱼不对，本肥鱼认了。'), /没有语气词/)
  assert.match(voice('主人，10 月 3 日本肥鱼报喜报早了嘛。'), /几月几日/)
  for (const bad of ['主人一说，本肥鱼腿都软了啦～', '主人那句话让本肥鱼脸都红了呀', '主人，本肥鱼肚子都撑圆了嘛', '主人一喊，本肥鱼就缩成一团啦', '主人看，本肥鱼尾巴翘起来了哦', '主人别说了，本肥鱼把头埋起来了呜', '主人（翻本子的手停住了）呜']) assert.match(voice(bad), /旁白式描写|括号里写了动作/, bad)
  for (const ok of ['主人，耐心是你的，脸是本肥鱼丢的嘛。', '主人，本肥鱼没脸翻这页呀。', '主人摸摸头嘛～', '主人，（小声）剩下的先欠着哦。', '主人，头发要紧呀～']) assert.equal(voice(ok), null, ok)
})

test('数字两边的空格统一，「」里的原话不动', () => {
  assert.equal(spaced('主人说了90回不对，本肥鱼在getAudio里干了22分钟，凌晨2:41「改了3回了」'), '主人说了 90 回不对，本肥鱼在 getAudio 里干了 22 分钟，凌晨 2:41「改了3回了」')
})

test('每条模板：标了情绪和态度、「」里只有原话、用典型值填出来过标准（≤60 字、最多两轮、不套娃、没行话）', () => {
  const failed = Object.values(check()).flatMap(r => r.bad)
  assert.equal(failed.length, 0, failed.map(b => `${b.id} ${b.why.join('；')}`).join('\n'))
  for (const r of Object.values(check())) assert.equal(r.dup, 0)
})

test('四种情绪、四种态度都有足够的模板（每种至少 10 条）', () => {
  const c = coverage()
  for (const [k, n] of [...Object.entries(c.mood), ...Object.entries(c.tone)]) assert.ok(n >= 10, `${k} 只有 ${n} 条`)
})

// 几天的假会话（同一天最多说两件，所以分开几天）：说好了挨骂 + 认错、被喊停、挨骂、凌晨两点、另有一件私事
function session() {
  const T0 = new Date(2026, 10, 3, 14, 0).getTime()
  const DAY = 24 * 60
  const min = m => T0 + m * 60e3
  let seq = 0
  const ev = (type, data, t) => ({ type, data, seq: seq++, time: t })
  const user = (text, t) => ev('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' } }, t)
  const bot = (text, t) => ev('assistant/message', { message: { content: [{ type: 'text', text }] }, usage: { inputTokens: 90000, outputTokens: 3000 } }, t)
  const work = (from, n) => Array.from({ length: n }, (_, i) => ev('tool/call', { name: i % 2 ? 'bash' : 'edit', arguments: JSON.stringify(i % 2 ? { command: 'npm test' } : { path: `/p/f${i}.js` }) }, min(from + i + 1)))
  const end = (t, kind = 'completed') => ev('turn/end', { reason: { kind } }, t)
  const run = (id, events) => dshTurns(id, { id, cwd: '/Users/sam/my-app' }, events)
  const turns = [
    ...run('s1', [
      ev('session/title', { title: '修登录页' }, min(0)),
      user('帮我修一下登录页的报错', min(0)), ...work(0, 12), bot('**改好了**，刷新就能看到。', min(12.5)), end(min(12.6)),
      user('大哥 我目前刷新我也看不到啊', min(20)), bot('你说得对，是我漏了一个分支。', min(21)), end(min(21)),
    ]),
    ...run('s2', [user('把注册页也照这个改一下', min(DAY)), ...work(DAY, 3), end(min(DAY + 3.5), 'interrupted'), user('先别动注册页', min(DAY + 4)), bot('好，停了。', min(DAY + 4.2)), end(min(DAY + 4.2))]),
    ...run('s3', [user('把导出按钮加上', min(2 * DAY)), bot('我看一下。', min(2 * DAY + 1)), end(min(2 * DAY + 1)), user('怎么又白屏了', min(2 * DAY + 6)), bot('我看一下。', min(2 * DAY + 6.5)), end(min(2 * DAY + 6.5))]),
    ...run('s4', [user('帮我把首页的按钮改圆一点', min(3 * DAY + 12 * 60)), ...work(3 * DAY + 12 * 60, 8), bot('按钮都改成圆角了。', min(3 * DAY + 12 * 60 + 8.5)), end(min(3 * DAY + 12 * 60 + 8.6))]),   // 凌晨 2 点
    // 另一个会话里的私事：主人那句、本肥鱼回的那句，都不说
    ...run('s5', [user('我妈住院了，帮我把请假条改得正式一点', min(40)), ...work(40, 11), bot('对不起，是我的错，请假条重新改好了。', min(51.5)), end(min(51.6)), user('还是不对', min(53))]),
  ]
  return { now: min(5 * DAY), turns }
}

test('假会话走一遍生成：默认会说的每一条都过标准（原话逐字、数字真实、没有私事）', () => {
  const { turns, now } = session()
  const all = buildMoments(turns, { now, withSource: true })
  assert.ok(all.some(m => m.sensitive.includes('家庭')), '请假条那件事应该标成私事')
  const said = all.filter(m => !m.sensitive.length)                // 私事默认不说（pet-engine.js 按 sensitive 过滤）
  for (const kind of ['late', 'caught', 'sorry', 'complain', 'stopped']) assert.ok(said.some(m => m.kind === kind), `假会话里应该挑得出 ${kind}，实际：${said.map(m => m.kind).join(',')}`)
  const failed = said.map(m => ({ m, bad: checkLine(m.text, { sources: m.source, card: m.card, project: [m.card.project, m.card.task].filter(Boolean).join(' '), sensitive: m.sensitive }) })).filter(x => x.bad.length)
  assert.equal(failed.length, 0, failed.map(x => `[${x.m.tpl}] ${x.m.text.replace(/\n/g, ' ⏎ ')}\n   ${x.bad.map(b => `${b.rule}：${b.why}`).join('；')}`).join('\n'))
  for (const m of said) assert.doesNotMatch(m.text, /请假条|住院/)
})
