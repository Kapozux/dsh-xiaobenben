/**
 * 翻旧账的「说法」层：事实由程序判断（moments.js 的事件卡），说法交给模型按大肥鱼的风格写。
 *   - 一次一批卡片，回一批台词；每句都核对：原话一字不差、数字都来自卡片、≤50 字、不是对话体。没过的这句用模板说法兜底。
 *   - 发什么、发给谁、多少 token：先报价，用户点「发送」才跑（和年度回顾的 AI 部分同一套）。
 *   - 私事（健康 / 感情 / 成绩 / 家庭）的卡片不发。
 */
import { createHash } from 'node:crypto'
import { estimateTokens, parseJson } from './ai.js'
import { width, MAX_WIDTH } from './moments.js'

export const BATCH = 30
export const OUT_PER_CARD = 70           // 一句台词 + JSON 包装，估的输出 token

export const STYLE_SYSTEM = `你是「大肥鱼」——用户的 coding agent，桌宠形象是一只蓝发鲸鱼女仆。现在要给桌宠气泡写台词：每张「事件卡」写一句，讲一件你和主人一起经历过的真事。

人设：贪吃（花掉的 token 叫「白饭」，按碗算）、有点懒、有点傲娇、嘴硬心软、认错快、偶尔小委屈，口头禅「嘿咻」。自称「本肥鱼」「本鱼」，也可以像旁白一样说「大肥鱼」；称用户「你」或「主人」。不许别人说它胖，自己说「肥」可以。

每句的骨架：场景（什么时候、在哪件事上）→ 证据（一句原话或一个数字）→ 大肥鱼的态度。三段不必都写满，挑最有意思的两三样。按类型参考：
- 挨骂：「11 月 4 日凌晨，你在合并页那摊事上抱怨大肥鱼「你到底行不行」，本肥鱼表示理解，嘿咻。」
- 交差：「合并页忙了 22 分钟，大肥鱼最后告诉你：「两件都改好了」。」
- 认错：「导入脚本那次，大肥鱼说「你说得对，是我漏了」——知道错了，不是故意的。」
- 被抓包：「大肥鱼拍胸脯说「改好了」，你回「还是不行」，嘿咻，被抓包了。」
- 被喊停：「本鱼正埋头干活，你一句「先停一下」，那就停，尾巴都没敢甩。」
- 干活 / 熬夜：「凌晨 1:02，你还让本鱼弄 README，22 分钟，吃了 3 碗白饭，你也该睡了。」
- 总账：「这 120 天你喊了 61 次「继续」，本肥鱼一次都没拒绝过，嘿咻。」

硬规矩（程序会逐句检查，不合格的整句作废）：
1. 卡片里的原话要用「」原样引用，一个字都不能改、不能删、不能加；一句台词最多引一句原话（被抓包可以两句：大肥鱼说的和主人回的）。卡片里没有原话就不引。
2. 只用卡片里的事实和数字，不编任何卡片里没有的事、数字、时间。
3. 每句不超过 ${MAX_WIDTH} 个字（不算空格），一句话或两个短句，不换行。
4. 只有大肥鱼在说：不写对话体，不写「主人：」「本肥鱼：」这样的说话人标签，不用 emoji。
5. 语气俏皮可爱，不刻薄、不阴阳怪气、不说教；原话里有脏话的已经打成 ××，照抄就行。
6. 上面的例句只示意骨架，不要照抄它们的措辞；同一批里换着开头和句式，别都一个样。

只输出一个 JSON 对象：{"lines": [{"id": "卡片 id", "text": "台词"}]}，不要 markdown 代码块，不要别的话。`

const KIND = { work: '干活', late: '熬夜干活', stopped: '被喊停', caught: '被抓包', complain: '挨骂', sorry: '认错', report: '交差' }
const LABEL = { when: '时间', clock: '钟点', task: '事', dur: '时长', rice: '吃了', did: '干了', said: '原话', next: '主人回', claim: '大肥鱼说', span: '范围', times: '次数', project: '项目', days: '天数', files: '文件', date: '日期' }
const WHO = { complain: '主人的原话', sorry: '大肥鱼的原话', report: '大肥鱼最后的原话' }
/** 卡片里算「原话」的字段：引号里只能是它们 */
const QUOTES = ['said', 'next', 'claim']

/** 一张卡片 → 一行文字（报价页显示的、真正发的，都是这个） */
export function cardLine(c) {
  const parts = [`id=${c.id}`, c.kind === 'stat' ? `总账：${c.stat}` : KIND[c.kind]]
  for (const [k, label] of Object.entries(LABEL)) {
    if (c[k] == null) continue
    const name = k === 'said' ? WHO[c.kind] || '原话' : label
    parts.push(QUOTES.includes(k) ? `${name}「${c[k]}」` : `${name}：${c[k]}`)
  }
  return parts.join(' | ')
}

export function buildStylePrompt(cards) {
  return { system: STYLE_SYSTEM, prompt: `事件卡（每行一张）：\n${cards.map(cardLine).join('\n')}\n\n每张写一句，输出 JSON。` }
}

export function batches(cards) {
  const out = []
  for (let i = 0; i < cards.length; i += BATCH) out.push(cards.slice(i, i + BATCH))
  return out
}

/** 这次要发的卡片的指纹：报价时和发送时必须一样 */
export function cardsHash(cards) {
  return createHash('sha256').update(cards.map(cardLine).join('\n')).digest('hex').slice(0, 16)
}

export function styleQuote(cards, route, prices = []) {
  const parts = batches(cards).map(buildStylePrompt)
  const inputTokens = parts.reduce((a, p) => a + estimateTokens(p.system) + estimateTokens(p.prompt), 0)
  const outputTokens = cards.length * OUT_PER_CARD
  const price = prices.find(p => p.provider === route.provider && p.model === route.model)
  const cost = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null
  return {
    route, count: cards.length, calls: parts.length, inputTokens, outputTokens, hash: cardsHash(cards),
    cost: cost === null ? null : { amount: cost, currency: price.currency || 'USD' },
    system: STYLE_SYSTEM, prompt: cards.map(cardLine).join('\n'),
  }
}

/** 核对一句：不合格返回原因，合格返回 null */
export function checkLine(card, text) {
  if (typeof text !== 'string' || !text.trim()) return '空的'
  const t = text.trim()
  if (/\n/.test(t)) return '有换行'
  if (width(t) > MAX_WIDTH) return `${width(t)} 字，超过 ${MAX_WIDTH}`
  if (/(本肥鱼|本鱼|大肥鱼|主人|你)\s*[：:]\s*[「“"]/.test(t) || /^(本肥鱼|本鱼|大肥鱼|主人)\s*[：:]/.test(t)) return '对话体'
  if (/\p{Extended_Pictographic}/u.test(t)) return '有 emoji'
  if (/「[^」]*「/.test(t)) return '引号套引号'
  const quotes = QUOTES.map(k => card[k]).filter(Boolean)
  const spans = [...t.matchAll(/「([^」]*)」/g)].map(m => m[1])
  for (const q of spans) {
    if (quotes.includes(q)) continue
    if (card.kind === 'stat' && q === '继续') continue
    return `引号里的「${q}」不是卡片里的原话`
  }
  const quoted = spans.filter(q => quotes.includes(q))
  if (quoted.length > (card.kind === 'caught' ? 2 : 1)) return '引了太多句原话'
  const master = card.kind === 'caught' || card.kind === 'stopped' ? card.next : card.said
  if (master && !quoted.includes(master)) return '没引卡片里的原话'
  // 数字只能来自卡片
  const facts = Object.entries(card).filter(([k]) => k !== 'id').map(([, v]) => String(v)).join(' ')
  const known = new Set(facts.match(/\d+/g) || [])
  const bare = t.replace(/「[^」]*」/g, '')
  for (const n of bare.match(/\d+/g) || []) if (!known.has(n)) return `数字 ${n} 卡片里没有`
  return null
}

/**
 * 跑一遍：一批一次调用，失败的那批重试 1 次。
 * @returns {Promise<{ lines: Record<string, string>, failed: { id: string, why: string }[], errors: string[], usage: any[] }>}
 */
export async function styleRun({ adapter, cards, route, signal, onProgress = () => {} }) {
  const lines = {}, failed = [], errors = [], usage = []
  let done = 0
  for (const batch of batches(cards)) {
    if (signal?.aborted) { errors.push('已停止'); break }
    const { system, prompt } = buildStylePrompt(batch)
    let got = null
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try {
        const res = await adapter({ provider: route.provider, model: route.model, system, prompt, maxTokens: batch.length * 120 + 200, signal })
        if (res.usage) usage.push(res.usage)
        const obj = parseJson(res.text)
        if (!Array.isArray(obj.lines)) throw new Error('模型返回的 JSON 里没有 lines')
        got = obj.lines
      } catch (err) {
        errors.push(err?.message || String(err))
        console.warn('[dsh-xiaobenben] 改写台词失败', err?.message || err)
        if (signal?.aborted) break
      }
    }
    const byId = new Map((got || []).map(l => [String(l?.id), l?.text]))
    for (const c of batch) {
      const text = byId.get(c.id)
      const why = got ? checkLine(c, text) : '这批调用失败'
      if (why) failed.push({ id: c.id, why })
      else lines[c.id] = text.trim()
    }
    done += batch.length
    onProgress({ done, total: cards.length, ok: Object.keys(lines).length, failed: failed.length })
  }
  return { lines, failed, errors, usage }
}
