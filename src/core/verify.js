/**
 * 模型写回来的内容里引用的原话，回到发过去的材料逐字核对；对不上的删掉。
 * 「原话」= 写在「」『』“”"" 里的片段。比对时只忽略首尾空白，其余一个字都要对上。
 */

const QUOTE_RE = /「([^」]+)」|『([^』]+)』|“([^”]+)”|"([^"]+)"/g

/** 一段文字里所有引号里的片段。 */
export function quotedSpans(text) {
  const out = []
  for (const m of text.matchAll(QUOTE_RE)) out.push({ full: m[0], inner: (m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), index: m.index })
  return out
}

/** 片段是否逐字出现在某条材料里。 */
export function isVerbatim(inner, sources) {
  if (!inner) return false
  return sources.some(s => s.includes(inner))
}

/**
 * 去掉引用对不上的句子。
 * @param {string} text
 * @param {string[]} sources 发过去的每条原话和标题
 * @returns {{ text: string, removed: string[] }}
 */
export function dropUnverifiedSentences(text, sources) {
  const removed = []
  // 按句切：保留句末标点
  const sentences = text.match(/[^。！？!?\n]+[。！？!?]?|\n/g) || []
  const kept = sentences.filter(s => {
    const bad = quotedSpans(s).filter(q => !isVerbatim(q.inner, sources))
    if (bad.length) removed.push(...bad.map(q => q.inner))
    return bad.length === 0
  })
  return { text: kept.join('').trim(), removed }
}

/**
 * 核对整份 AI 结果。奖项的 quote 字段对不上就置空；理由和「这一年」里对不上的句子删掉。
 * @param {{ keywords: string[], awards: { name: string, reason: string, quote?: string | null }[], year: string }} result
 * @param {string[]} sources
 */
export function verifyResult(result, sources) {
  const removed = []
  const awards = result.awards.map(a => {
    let quote = a.quote ? String(a.quote).trim() : null
    if (quote && !isVerbatim(quote, sources)) { removed.push(quote); quote = null }
    const r = dropUnverifiedSentences(a.reason, sources)
    removed.push(...r.removed)
    return { ...a, quote, reason: r.text }
  })
  const y = dropUnverifiedSentences(result.year, sources)
  removed.push(...y.removed)
  return { result: { ...result, awards, year: y.text }, removed }
}
