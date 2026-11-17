// 大肥鱼的台词：dsh 事件和 Claude Code JSONL 切出来的轮一样算；挑时刻的规则；私事只看原话。
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMoments, claudeTurns, dshTurns, fill } from '../src/core/moments.js'
import { TPL } from '../src/core/lines.js'
import { LINES } from '../src/shared/lines.js'

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
  assert.match(work.text, /「帮我修一下登录页的报错」/)
  assert.match(work.text, /9 分钟/)
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

const REQ = { work: ['task', 'dur', 'rice'], late: ['task', 'dur', 'rice'], stopped: ['dur', 'next'], caught: ['claim', 'next'], complain: ['said'], sorry: ['said'], report: ['dur', 'said'],
  stat_continue: ['span', 'n', 'dur'], stat_project: ['project', 'dur', 'days'], stat_longest: ['task', 'dur'], stat_busiest: ['date', 'dur'] }

test('800 条模板：必须的占位符各一次；填完（含 {doing} 为空）没有残留括号、没有「，，」、不超长', () => {
  const full = { w: '10 月 3 日中午 12:28', task: '「帮我把导入脚本重构一下」', dur: '12 分钟', doing: '，改了 4 个文件、跑了 19 条命令', rice: '小半碗', next: '还是不对啊你再看看', claim: '改好了，测试全过了', said: '你说得对，是我漏了一个分支', project: 'pdf2md-web', days: 23, files: 41, n: 37, span: '这 120 天', date: '10 月 3 日' }
  for (const [k, list] of Object.entries(TPL)) {
    assert.ok(list.length >= 25, k)
    for (const t of list) {
      for (const r of REQ[k]) assert.equal(t.split(`{${r}}`).length - 1, 1, `${k} 缺 {${r}}：${t}`)
      for (const vars of [full, { ...full, doing: '', rice: '3 碗' }]) {
        const out = fill(t, vars)
        assert.doesNotMatch(out, /[{}]|，，|。，|「，/, out)
        assert.ok([...out].length <= 110, out)
        assert.doesNotMatch(out, / 小半碗/, out)
        assert.doesNotMatch(out, /(分钟|小时) [\u4e00-\u9fff]/, out)
      }
    }
  }
})

test('反应：每类至少 10 个按钮、按钮 ≤6 字；👍👎 第一句是主人给的', () => {
  for (const [k, list] of Object.entries(LINES.react)) {
    assert.ok(list.length >= 10, k)
    for (const r of list) assert.ok([...r.label].length <= 6, r.label)
  }
  assert.equal(LINES.up[0], '本肥鱼看来说的挺有道理，谢谢主人对我的鼓励！')
  assert.equal(LINES.down[0], '呜呜呜主人，你不能这么说我')
})
