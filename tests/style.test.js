// 翻旧账的 AI 改写：核对规则 + 一批跑下来（假模型），不合格的用模板兜底。
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLine, cardLine, styleRun, styleQuote, cardsHash } from '../src/core/style.js'

const complain = { id: 'c1', kind: 'complain', ago: '一个多月前', when: '11 月 4 日凌晨', task: '合并页', said: '你到底行不行' }
const caught = { id: 'k1', kind: 'caught', ago: '十几天前', when: '11 月 5 日下午', task: '登录页', claim: '改好了', next: '还是不行' }
const work = { id: 'w1', kind: 'work', ago: '昨天', when: '11 月 6 日上午', task: 'README写清楚', dur: '22 分钟', rice: '3 碗白饭' }
const stat = { id: 's1', kind: 'stat', stat: '喊继续', ago: '这 120 天里', times: '61 次「继续」', dur: '5 小时' }

test('卡片一行：原话带「」，事实带名字', () => {
  assert.equal(cardLine(complain), 'id=c1 | 挨骂 | 多久之前：一个多月前 | 事：合并页 | 主人的原话「你到底行不行」')
  assert.match(cardLine(stat), /总账：喊继续/)
})

test('核对：原话要一字不差、数字只能来自卡片、≤50 字、不是对话体', () => {
  assert.equal(checkLine(complain, '一个多月前，你在合并页上冲我说「你到底行不行」，我大肥鱼表示理解，嘿咻。'), null)
  assert.match(checkLine(complain, '一个多月前，你说「你到底行不行啊」，我大肥鱼觉得懂。'), /不是卡片里的原话/)
  assert.match(checkLine(complain, '一个多月前，合并页那会儿你急了，我大肥鱼觉得懂的。'), /没引卡片里的原话/)
  assert.match(checkLine(complain, '一个多月前，你在合并页抱怨「你到底行不行」，我大肥鱼觉得干了 3 小时。'), /数字 3 卡片里没有/)
  assert.match(checkLine(complain, '一个多月前，主人：「你到底行不行」本鱼：好嘛。'), /对话体/)
  assert.match(checkLine(complain, '一个多月前，「你到底行不行」，我大肥鱼觉得' + '本鱼'.repeat(60)), /超过 \d+/)
  assert.match(checkLine(complain, '11 月 4 日凌晨，你冲我说「你到底行不行」，我大肥鱼表示理解。'), /没以「一个多月前」开头/)
  assert.match(checkLine(complain, '一个多月前，你冲我说「你到底行不行」，本鱼缩成一团。'), /没有大肥鱼的看法/)
  assert.equal(checkLine(caught, '十几天前，我拍胸脯说「改好了」，你回「还是不行」，我大肥鱼承认那句话说早了。'), null)
  assert.equal(checkLine(work, '昨天你让我把 README写清楚，22 分钟，3 碗白饭下肚，我大肥鱼觉得值。'), null)
  assert.equal(checkLine(stat, '这 120 天里你喊了 61 次「继续」，我大肥鱼觉得你离不开我。'), null)
})

test('跑一批：合格的收下，不合格的记原因（用模板兜底），调用失败重试一次', async () => {
  let calls = 0
  const adapter = async ({ prompt }) => {
    calls++
    if (calls === 1) throw new Error('网络断了')
    assert.match(prompt, /id=c1/)
    return { text: JSON.stringify({ lines: [
      { id: 'c1', text: '一个多月前，你在合并页抱怨「你到底行不行」，我大肥鱼表示理解，嘿咻。' },
      { id: 'k1', text: '十几天前，我说「改好了」，你回「根本不行」，我大肥鱼承认。' },                // 原话被改了
    ] }), usage: { input: 10, output: 10 } }
  }
  const r = await styleRun({ adapter, cards: [complain, caught, work], route: { provider: 'p', model: 'm' } })
  assert.equal(calls, 2)
  assert.deepEqual(Object.keys(r.lines), ['c1'])
  assert.deepEqual(r.failed.map(f => f.id), ['k1', 'w1'])
  assert.match(r.failed[0].why, /不是卡片里的原话/)
  assert.equal(r.failed[1].why, '空的')
})

test('报价：几次调用、多少 token、发的全文；指纹跟着卡片变', () => {
  const q = styleQuote([complain, caught], { provider: 'p', model: 'm' }, [{ provider: 'p', model: 'm', input: 1, output: 2, currency: 'CNY' }])
  assert.equal(q.count, 2)
  assert.equal(q.calls, 1)
  assert.ok(q.inputTokens > 100)
  assert.equal(q.cost.currency, 'CNY')
  assert.match(q.prompt, /你到底行不行/)
  assert.notEqual(cardsHash([complain]), cardsHash([complain, caught]))
})
