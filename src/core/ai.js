/**
 * AI 部分：用用户自己的模型额度。守五条（见 README）：
 *   1 点了才跑，跑完缓存     2 先报价、点头才发     3 整份回顾最多 5 次调用，失败只重试 1 次，不循环、不开子代理
 *   4 写明发到哪            5 只发标题 + 抽样短句，回来的引用逐字核对
 * 模型通过适配器调用（llm-adapter.js 包 ctx.llm.stream；测试里换成假的），这里不碰 dsh。
 */
import { createHash } from 'node:crypto'
import { materialText } from './material.js'
import { verifyResult } from './verify.js'

export const MAX_CALLS = 5
export const YEAR_MAX_CHARS = 150

const SYSTEM = `你在给一个人写「和 coding agent 一起的这一年」年度回顾。材料只有两样：他的会话标题，和每月抽样的他自己说过的短句。
规矩：
- 只能根据材料写，不许编材料里没有的事。
- 引用原话时用「」包起来，必须和材料里的句子逐字一致；拿不准就不引。
- 语气轻松、具体、带点好笑，不要鸡汤，不要夸张的形容词堆砌。
- 只输出一个 JSON 对象，不要 markdown 代码块，不要别的话。`

const ASK = {
  all: `输出 JSON：{"keywords": [3 个年度关键词，每个不超过 6 个字], "awards": [3 个奖项，每个 {"name": "奖项名，不超过 10 个字", "reason": "一句话理由，不超过 40 字", "quote": "支撑这个奖的一句原话（逐字照抄材料），没有就写 null"}], "year": "「这一年」，${YEAR_MAX_CHARS} 字以内"}`,
  keywords: '只输出 JSON：{"keywords": [3 个年度关键词，每个不超过 6 个字]}，换一组和之前不同的。',
  awards: '只输出 JSON：{"awards": [3 个奖项，每个 {"name", "reason"（不超过 40 字）, "quote"（逐字照抄材料的一句原话，或 null）}]}，换一组和之前不同的。',
  year: `只输出 JSON：{"year": "「这一年」，${YEAR_MAX_CHARS} 字以内"}，换个写法。`,
}
export const OUTPUT_ESTIMATE = { all: 700, keywords: 80, awards: 300, year: 300 }

/** 粗估 token：中日韩字符一个算一个，其它约 4 个字符一个。界面上标「估算」。 */
export function estimateTokens(text) {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[　-鿿가-힯豈-﫿＀-￯]/u.test(ch)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

/** 这次要发出去的完整内容。报价页显示的、真正发的，都从这里来。 */
export function buildPrompt(material, kind = 'all') {
  return { system: SYSTEM, prompt: `${materialText(material)}\n\n${ASK[kind]}` }
}

/** 材料的指纹：材料变了，旧缓存就不算这份回顾的了。 */
export function materialHash(material) {
  return createHash('sha256').update(materialText(material)).digest('hex').slice(0, 16)
}

/**
 * 报价。价格只从用户配置的价格表来（dsh 的模型配置里没有价格），查不到就只给 token，不猜。
 * @param {{ provider: string, model: string }} route
 * @param {{ provider: string, model: string, input: number, output: number, currency?: string }[]} prices 每百万 token
 */
export function quote(material, route, prices = [], kind = 'all', expensiveAbove = 0) {
  const { system, prompt } = buildPrompt(material, kind)
  const inputTokens = estimateTokens(system) + estimateTokens(prompt)
  const outputTokens = OUTPUT_ESTIMATE[kind]
  const price = prices.find(p => p.provider === route.provider && p.model === route.model)
  const cost = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null
  return {
    route,
    system,
    prompt,
    inputTokens,
    outputTokens,
    cost: cost === null ? null : { amount: cost, currency: price.currency || 'USD' },
    expensive: Boolean(price && expensiveAbove > 0 && price.output >= expensiveAbove),
    external: material.external,
  }
}

/** 从模型输出里拿 JSON：容忍前后多余文字和 ```json 包裹。 */
export function parseJson(text) {
  const s = text.replace(/```(?:json)?/g, '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('模型没有返回 JSON')
  return JSON.parse(s.slice(a, b + 1))
}

/** 按要的那一块检查形状；不合格就当这次失败。 */
function validate(obj, kind) {
  const out = {}
  if (kind === 'all' || kind === 'keywords') {
    if (!Array.isArray(obj.keywords) || obj.keywords.length < 1) throw new Error('缺少 keywords')
    out.keywords = obj.keywords.slice(0, 3).map(k => String(k).trim()).filter(Boolean)
  }
  if (kind === 'all' || kind === 'awards') {
    if (!Array.isArray(obj.awards) || obj.awards.length < 1) throw new Error('缺少 awards')
    out.awards = obj.awards.slice(0, 3).map(a => ({ name: String(a?.name || '').trim(), reason: String(a?.reason || '').trim(), quote: a?.quote ? String(a.quote) : null }))
    if (out.awards.some(a => !a.name)) throw new Error('有奖项没有名字')
  }
  if (kind === 'all' || kind === 'year') {
    if (typeof obj.year !== 'string' || !obj.year.trim()) throw new Error('缺少 year')
    out.year = obj.year.trim()
  }
  return out
}

/** 超过 150 字就在句号处截短（不在句中截断）。 */
export function clampYear(text) {
  if ([...text].length <= YEAR_MAX_CHARS) return text
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) || [text]
  let out = ''
  for (const s of sentences) {
    if ([...(out + s)].length > YEAR_MAX_CHARS) break
    out += s
  }
  return out || [...text].slice(0, YEAR_MAX_CHARS).join('')
}

/**
 * 跑一次（可能含 1 次重试）。调用次数记在 entry.calls 里，跨重启累计；到 5 次就不再调。
 * @param {object} p
 * @param {(req: { provider: string, model: string, system: string, prompt: string, maxTokens: number, signal?: AbortSignal }) => Promise<{ text: string, usage?: object }>} p.adapter
 * @param {{ calls: number, result?: object, usage?: object[] } | undefined} p.entry 这份回顾已有的缓存
 * @param {object} p.material
 * @param {{ provider: string, model: string }} p.route
 * @param {'all' | 'keywords' | 'awards' | 'year'} [p.kind]
 * @param {string[]} p.sources 逐字核对用：没打码前的全部用户原话 + 标题 也行，至少要包含发出去的材料
 * @returns {Promise<{ ok: boolean, entry: object, error?: string, removed?: string[] }>}
 */
export async function generate({ adapter, entry, material, route, kind = 'all', sources, signal }) {
  const e = { calls: 0, usage: [], ...(entry || {}) }
  const { system, prompt } = buildPrompt(material, kind)
  const errors = []
  for (let attempt = 0; attempt < 2; attempt++) {                  // 第一次 + 最多重试 1 次
    if (e.calls >= MAX_CALLS) {
      errors.push(`这份回顾已经调用了 ${MAX_CALLS} 次模型，到上限了`)
      break
    }
    e.calls++
    try {
      const res = await adapter({ provider: route.provider, model: route.model, system, prompt, maxTokens: 1500, signal })
      if (res.usage) e.usage = [...e.usage, { kind, ...res.usage }]
      const part = validate(parseJson(res.text), kind)
      if (part.year) part.year = clampYear(part.year)
      const merged = { keywords: [], awards: [], year: '', ...(e.result || {}), ...part }
      const v = verifyResult(merged, sources)
      return { ok: true, entry: { ...e, route, result: v.result, at: Date.now() }, removed: v.removed }
    } catch (err) {
      errors.push(err?.message || String(err))
      if (signal?.aborted) break
    }
  }
  return { ok: false, entry: e, error: errors.join('；') }
}
