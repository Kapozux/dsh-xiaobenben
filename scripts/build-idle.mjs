// 碎碎念：把 data/idle/*.json（每份一个主题，[{ text, mood, hours? }]）检查一遍、合并成 src/shared/idle.js。
// 用法：node scripts/build-idle.mjs        有不合格的就列出来、退出码 1、不写文件
import fs from 'node:fs'
import path from 'node:path'
import { CHAT } from '../src/shared/chat.js'

const DIR = new URL('../data/idle/', import.meta.url).pathname
const OUT = new URL('../src/shared/idle.js', import.meta.url).pathname
const width = s => [...s.replace(/\s/g, '')].length

const all = [], bad = [], seen = new Set()
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  const topic = path.basename(f, '.json')
  for (const l of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
    const why = [
      typeof l.text !== 'string' && '没有 text',
      l.text && width(l.text) > 40 && `${width(l.text)} 字`,
      l.text && /[\n]|(本肥鱼|主人)\s*[：:]/.test(l.text) && '换行或说话人标签',
      l.text && /「[^」]*「/.test(l.text) && '引号套娃',
      l.text && /\p{Extended_Pictographic}/u.test(l.text) && 'emoji',
      !CHAT[l.mood] && `心情 ${l.mood} 不认识`,
      l.hours && !(Array.isArray(l.hours) && l.hours.length === 2 && l.hours.every(h => Number.isInteger(h) && h >= 0 && h <= 24)) && 'hours 格式不对',
      seen.has(l.text) && '重复',
    ].filter(Boolean)
    if (why.length) { bad.push(`${topic}: ${why.join('，')} ← ${l.text}`); continue }
    seen.add(l.text)
    all.push({ text: l.text, mood: l.mood, ...(l.hours ? { hours: l.hours } : {}), topic })
  }
}
if (bad.length) { console.log(bad.join('\n')); process.exit(1) }
const by = {}; for (const l of all) by[l.topic] = (by[l.topic] || 0) + 1
fs.writeFileSync(OUT, `/** 碎碎念：不看记录、随口说的（饿了、困了、无聊……），${all.length} 句。由 scripts/build-idle.mjs 从 data/idle/*.json 生成，别手改。 */\nexport const IDLE = ${JSON.stringify(all, null, 0).replace(/\},\{/g, '},\n  {').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')}\n`)
console.log(`${all.length} 句：`, Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · '))
