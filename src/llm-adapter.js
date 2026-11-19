/**
 * 把 ctx.llm.stream 包成 ai.js 要的适配器（docs/dsh-api.md §3）。
 * stream 失败不抛，最后一个 finish chunk 的 reason.kind 是 error / aborted，带 failure.message。
 */
import { randomUUID } from 'node:crypto'

/**
 * 这个模型思考强度最低的那一档（写气泡台词用不着长考）：有「off」用 off，没有就挑最低的；模型不分档就返回 undefined（不传，用它自己的默认）。
 * 不调低的话，默认开着高强度思考的模型会把输出额度全用在思考上，一个字都不返回。
 */
export async function lowestEffort(llm, { provider, model }) {
  try {
    const info = (await llm.listModels(provider)).find(m => m.id === model)
    const ids = (info?.reasoning?.efforts || []).map(e => String(e.id))
    return ['off', 'none', 'disabled', 'minimal', 'low'].find(x => ids.includes(x)) ?? undefined
  } catch { return undefined }
}

/**
 * @param {{ stream(options: object): AsyncIterable<any>, listModels?(provider: string): Promise<any[]> }} llm
 * @param {{ quick?: boolean }} [opts] quick：用思考强度最低的那一档
 */
export function dshAdapter(llm, { quick = false } = {}) {
  const efforts = new Map()                  // provider/model → 用哪一档（null = 不传，用模型自己的默认）
  const once = async ({ provider, model, system, prompt, maxTokens, signal }, reasoningEffort) => {
    const messages = [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }]
    let text = '', delta = '', reasoning = 0, usage, finish
    for await (const chunk of llm.stream({ provider, model, system, messages, maxTokens, signal, ...(reasoningEffort ? { reasoningEffort } : {}) })) {
      if (chunk.type === 'text-delta') delta += chunk.text || ''
      else if (chunk.type === 'reasoning-delta') reasoning += (chunk.text || '').length
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text') text += chunk.block.text
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      throw new Error(`${provider}/${model}：${finish.failure?.message || finish.kind}`)
    }
    if (!text.trim()) text = delta                    // 没收到整块的文字就用一段段攒起来的
    if (!text.trim()) throw new Error(`${provider}/${model} 没有返回文字（结束原因：${finish?.kind || '不明'}；输出 ${usage?.outputTokens ?? '?'} token；思考了 ${reasoning} 个字；思考档位：${reasoningEffort || '模型默认'}）`)
    return { text, usage }
  }
  return async req => {
    if (!quick) return once(req)
    // 写台词用思考强度最低的一档：先看模型列出来的档位；列不出来就直接试「off」，模型不认再退回它自己的默认
    const k = req.provider + '/' + req.model
    if (!efforts.has(k)) efforts.set(k, (await lowestEffort(llm, req)) ?? 'off')
    const effort = efforts.get(k)
    if (!effort) return once(req)
    try { return await once(req, effort) } catch (err) {
      if (!/reasoning effort|reasoningEffort|UNSUPPORTED/i.test(err?.message || '')) throw err
      efforts.set(k, null)
      return once(req)
    }
  }
}
