// 抽 60 条给主人打分：按「模板类型 × 多久以前」分层，同一类里尽量每条用不同的模板、不同的会话。
// 私事不抽（默认本来就不说）。同一轮号抽出来的结果固定。产物：out/round-N.sample.json
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { realMoments, OUT, AGES } from './real.mjs'

const rnd = (seed, s) => parseInt(crypto.createHash('md5').update(seed + '|' + s).digest('hex').slice(0, 8), 16)

/**
 * 轮着从每种事件里各拿一条，拿到 60 条为止：事件少的先拿（保证每种都有），
 * 每次优先拿「这个时间段目前抽得最少」「这条模板还没用过」「不是同一句原话」的。
 */
export async function sample(round, total = 60) {
  const { moments, ...meta } = await realMoments()
  const pool = moments.filter(m => !m.sensitive.length)
  const seed = 'round' + round
  const byType = {}
  for (const m of pool) (byType[m.type] ||= []).push(m)
  for (const list of Object.values(byType)) list.sort((a, b) => rnd(seed, a.card.id) - rnd(seed, b.card.id))
  const types = Object.keys(byType).sort((a, b) => byType[a].length - byType[b].length)
  const picked = [], ages = {}, usedTpl = new Set(), usedQuote = new Set()
  const quoteOf = m => m.card.said || m.card.next || m.card.project || m.card.id
  for (let lap = 0; picked.length < total && lap < 50; lap++) {
    let any = false
    for (const type of types) {
      if (picked.length >= total) break
      const left = byType[type].filter(m => !picked.includes(m))
      if (!left.length) continue
      const score = m => (usedQuote.has(quoteOf(m)) ? 100 : 0) + (usedTpl.has(m.tpl) ? 10 : 0) + (ages[m.age] || 0) / 100
      const m = left.sort((a, b) => score(a) - score(b))[0]
      if (usedQuote.has(quoteOf(m)) && lap < 3) continue             // 同一句原话先不重复抽
      picked.push(m); usedTpl.add(m.tpl); usedQuote.add(quoteOf(m)); ages[m.age] = (ages[m.age] || 0) + 1; any = true
    }
    if (!any && lap >= 3) break
  }
  const items = picked.sort((a, b) => rnd(seed + 'order', a.card.id) - rnd(seed + 'order', b.card.id))
    .map(m => ({ id: m.card.id, text: m.text, type: m.type, kind: m.kind, tpl: m.tpl, age: m.age, ageDays: m.ageDays, bad: m.bad, card: m.card }))
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(`${OUT}/round-${round}.sample.json`, JSON.stringify({ round, at: new Date().toISOString(), meta, pool: pool.length, items }, null, 1))
  return items
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const round = Number(process.argv[2] || 1)
  const items = await sample(round)
  const count = k => items.reduce((a, m) => (a[m[k]] = (a[m[k]] || 0) + 1, a), {})
  console.log(`第 ${round} 轮：${items.length} 条，用了 ${new Set(items.map(m => m.tpl)).size} 条不同的模板`)
  console.log(count('type')); console.log(count('age'))
}
