/**
 * 主人的反馈：哪句话点了 👍 / 👎、哪类旧账投了票、聊天按钮点过几次、每件旧账翻过几次（shown），外加最近 300 条记录。
 * 网页和桌面那只共用一份（插件存储目录里的 feedback.json），用来挑下一句：
 * 👎 过的那句不再说，👍 过的多说；按类别的票决定翻哪类多；点得多的聊天按钮多出现。
 */
export const emptyFeedback = () => ({ lines: {}, kinds: {}, clicks: {}, shown: {}, log: [] })
/** 同一件事翻过以后，至少隔这么久再翻 */
export const REST = 3 * 864e5
const MAX_BYTES = 512 * 1024

/** 外面读进来的（文件 / 请求体）只收认得的字段和类型 */
export function normFeedback(d) {
  const fb = emptyFeedback()
  if (!d || typeof d !== 'object') return fb
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-99, Math.min(99, Math.round(v))) : null)
  for (const [k, v] of Object.entries(d.lines || {})) if (k.length <= 400 && num(v) !== null && num(v) !== 0) fb.lines[k] = num(v)
  for (const [k, v] of Object.entries(d.kinds || {})) if (k.length <= 40 && Array.isArray(v) && v.length === 2 && v.every(n => num(n) !== null && n >= 0)) fb.kinds[k] = v.map(num)
  for (const [k, v] of Object.entries(d.clicks || {})) if (k.length <= 40 && num(v) > 0) fb.clicks[k] = num(v)
  // shown：每件事（事件编号）翻过几次、上次什么时候翻的。只留最近 1500 件
  for (const [k, v] of Object.entries(d.shown || {}).filter(([k, v]) => k.length <= 40 && Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)).sort((a, b) => b[1][1] - a[1][1]).slice(0, 1500)) fb.shown[k] = [Math.min(9999, Math.round(v[0])), Math.round(v[1])]
  fb.log = (Array.isArray(d.log) ? d.log : []).filter(e => e && typeof e.t === 'number' && typeof e.what === 'string' && typeof e.text === 'string')
    .slice(-300).map(e => ({ t: e.t, what: e.what.slice(0, 20), text: e.text.slice(0, 400), d: num(e.d) ?? 0 }))
  return fb
}
/**
 * 存之前把文件里已有的「翻过几次」并进来：同一个本子可能开着几处（两个网页标签、桌面那只），
 * 各自手里是自己那份，谁后存谁覆盖的话，另一处翻过的事就丢了，旧账会被当成没说过再翻一遍。
 * 翻过的次数只增不减，所以每件事取次数大的、时间晚的那个就行。
 */
export function mergeShown(fb, onDisk) {
  const out = normFeedback(fb), old = normFeedback(onDisk).shown
  for (const [k, [n, t]] of Object.entries(old)) { const cur = out.shown[k]; out.shown[k] = cur ? [Math.max(cur[0], n), Math.max(cur[1], t)] : [n, t] }
  return out
}
export function feedbackJson(fb) {
  const s = JSON.stringify(normFeedback(fb))
  if (s.length > MAX_BYTES) throw new Error('反馈记录太大了')
  return s
}

/** 挑一句：👎 过的不要（全被 👎 了就当没投过），👍 过的权重 3 */
export function pickRated(list, fb) {
  if (!list.length) return null
  const ok = list.filter(t => !((fb.lines[typeof t === 'string' ? t : t.text] || 0) < 0))
  const pool = ok.length ? ok : list
  const w = t => ((fb.lines[typeof t === 'string' ? t : t.text] || 0) > 0 ? 3 : 1)
  let r = Math.random() * pool.reduce((a, t) => a + w(t), 0)
  for (const t of pool) { r -= w(t); if (r <= 0) return t }
  return pool.at(-1)
}
