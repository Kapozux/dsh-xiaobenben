// 翻旧账的 AI 改写：核对规则 + 一批跑下来（假模型），不合格的用模板兜底。
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLine, cardLine, styleRun, styleQuote, cardsHash } from '../src/core/style.js'

const complain = { id: 'c1', kind: 'complain', when: '11 月 4 日凌晨', task: '合并页', said: '你到底行不行' }
const caught = { id: 'k1', kind: 'caught', when: '11 月 5 日下午', task: '登录页', claim: '改好了', next: '还是不行' }
const work = { id: 'w1', kind: 'work', when: '11 月 6 日上午', task: 'README写清楚', dur: '22 分钟', rice: '3 碗白饭' }
const stat = { id: 's1', kind: 'stat', stat: '喊继续', span: '这 120 天', times: '61 次「继续」', dur: '5 小时' }

test('卡片一行：原话带「」，事实带名字', () => {
  assert.equal(cardLine(complain), 'id=c1 | 挨骂 | 时间：11 月 4 日凌晨 | 事：合并页 | 主人的原话「你到底行不行」')
  assert.match(cardLine(stat), /总账：喊继续/)
})

test('核对：原话要一字不差、数字只能来自卡片、≤50 字、不是对话体', () => {
  assert.equal(checkLine(complain, '11 月 4 日凌晨，你在合并页那摊事上抱怨大肥鱼「你到底行不行」，本肥鱼表示理解，嘿咻。'), null)
  assert.match(checkLine(complain, '你说「你到底行不行啊」，本鱼懂。'), /不是卡片里的原话/)
  assert.match(checkLine(complain, '合并页那会儿你急了，本鱼懂的。'), /没引卡片里的原话/)
  assert.match(checkLine(complain, '你在合并页抱怨「你到底行不行」，本鱼干了 3 小时。'), /数字 3 卡片里没有/)
  assert.match(checkLine(complain, '主人：「你到底行不行」本鱼：好嘛。'), /对话体/)
  assert.match(checkLine(complain, '「你到底行不行」' + '本鱼'.repeat(30)), /超过 50/)
  assert.equal(checkLine(caught, '大肥鱼拍胸脯说「改好了」，你回「还是不行」，嘿咻，被抓包了。'), null)
  assert.equal(checkLine(work, '你让本鱼把 README写清楚，22 分钟，3 碗白饭下肚，嘿咻。'), null)
  assert.equal(checkLine(stat, '这 120 天你喊了 61 次「继续」，本肥鱼一次都没拒绝过。'), null)
})

test('跑一批：合格的收下，不合格的记原因（用模板兜底），调用失败重试一次', async () => {
  let calls = 0
  const adapter = async ({ prompt }) => {
    calls++
    if (calls === 1) throw new Error('网络断了')
    assert.match(prompt, /id=c1/)
    return { text: JSON.stringify({ lines: [
      { id: 'c1', text: '你在合并页抱怨大肥鱼「你到底行不行」，本肥鱼表示理解，嘿咻。' },
      { id: 'k1', text: '本鱼说「改好了」，你回「根本不行」。' },                // 原话被改了
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
