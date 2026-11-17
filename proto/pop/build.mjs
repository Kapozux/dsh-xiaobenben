// 「戳一下大肥鱼」独立网页版原型：用插件同一套挑台词的逻辑（src/core/moments.js），从本机 Claude Code 记录生成一个本地 HTML。
// 不调模型、不联网；生成的文件（含你的原话、复制来的动画）放在 proto/pop/out/，git 不收。
// 跑：node proto/pop/build.mjs [--days 120]   然后双击 proto/pop/out/pop.html
import fs from 'node:fs'
import path from 'node:path'
import { buildMoments, RICE } from '../../src/core/moments.js'
import { loadClaudeTurns } from '../../src/sources/claude-turns.js'
import { ANIM, findPetAssets } from '../../src/pet.js'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(HERE, 'out')
const i = process.argv.indexOf('--days')
const DAYS = i > 0 ? Number(process.argv[i + 1]) : 120
const since = Date.now() - DAYS * 864e5

const { turns, sessions, skipped } = await loadClaudeTurns({ since })
const moments = buildMoments(turns, { since, days: DAYS })

const PET = findPetAssets(process.env.PET_ASSETS) || findPetAssets(path.join(process.env.HOME, 'dsh-try/profiles/web/node_modules/dsh-pet/assets/webm'))
fs.mkdirSync(path.join(OUT, 'anim'), { recursive: true })
const anims = []
for (const [k, name] of Object.entries(ANIM)) {
  const src = PET && path.join(PET, name + '.webm')
  if (src && fs.existsSync(src)) { fs.copyFileSync(src, path.join(OUT, 'anim', k + '.webm')); anims.push(k) }
}
const real = turns.filter(t => t.start >= since)
const counts = moments.reduce((a, m) => (a[m.kind] = (a[m.kind] || 0) + 1, a), {})
const meta = { days: DAYS, turns: real.length, sessions, sdkSkipped: skipped, counts, rice: RICE, anims }
const tpl = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8')
fs.writeFileSync(path.join(OUT, 'pop.html'), tpl.replace('/*DATA*/null', JSON.stringify({ meta, moments }).replace(/</g, '\\u003c')))
console.log(`${sessions} 个会话、${real.length} 轮（跳过 claude -p 调用 ${skipped} 个）→ ${moments.length} 句`, counts)
console.log('动画', anims.length, '/', Object.keys(ANIM).length, PET ? '' : '（没找到 dsh-pet，页面用备用形象）', '→', path.join(OUT, 'pop.html'))
