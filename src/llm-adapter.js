/**
 * 把 ctx.llm.stream 包成 ai.js 要的适配器（docs/dsh-api.md §3）。
 * stream 失败不抛，最后一个 finish chunk 的 reason.kind 是 error / aborted，带 failure.message。
 */
import { randomUUID } from 'node:crypto'

/** @param {{ stream(options: object): AsyncIterable<any> }} llm */
export function dshAdapter(llm) {
  return async ({ provider, model, system, prompt, maxTokens, signal }) => {
    const messages = [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }]
    let text = ''
    let usage
    let finish
    for await (const chunk of llm.stream({ provider, model, system, messages, maxTokens, signal })) {
      if (chunk.type === 'block-end' && chunk.block?.type === 'text') text += chunk.block.text
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      throw new Error(`${provider}/${model}：${finish.failure?.message || finish.kind}`)
    }
    if (!text.trim()) throw new Error(`${provider}/${model} 没有返回文字`)
    return { text, usage }
  }
}
