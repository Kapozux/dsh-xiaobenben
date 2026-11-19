/**
 * 台词标准里机器能查的部分（docs/lines-standard.md 第 4、5、6、8、9、10 条和行话黑名单）。
 * checkLine(text, ctx) 返回这条台词不过的地方：[{ rule, why }]，空数组 = 过。
 * 生成台词时就用它把关（moments.js 的 say：不过的换下一条模板，都不过这件事不说）；测试、真实数据检查、打分页抽样也用它。
 */
import { width, quoteNorm } from './moments.js'
import { sensitiveCats } from './sensitive.js'

export const MAX = 60
export const MAX_ROUNDS = 2

/** 英文技术词：出现在哪都算行话（原话里也算：原话不能改，所以这句原话不能用） */
export const TECH_WORDS = ['commit', 'commits', 'merge', 'merged', 'PR', 'PRs', 'MR', 'push', 'pull', 'rebase', 'branch', 'repo', 'token', 'tokens', 'API', 'SDK', 'CLI', 'MCP', 'JSON', 'JSONL', 'YAML', 'config', 'deploy', 'build', 'debug', 'diff', 'prompt', 'subagent', 'hook', 'hooks', 'npm', 'pnpm', 'git', 'stash', 'lint', 'CI', 'regex', 'schema', 'endpoint', 'payload', 'runtime', 'stdout', 'stderr', 'localhost', 'README', 'TODO', 'WIP', 'LGTM', 'refactor', 'worktree', 'checkpoint', 'pipeline', 'frontend', 'backend', 'SQL', 'HTTP', 'URL', 'UUID', 'CSS', 'HTML', 'DOM']
const TECH_RE = new RegExp(`(?<![A-Za-z])(${TECH_WORDS.join('|')})(?![A-Za-z])`, 'i')
/** 引号外也能出现的英文：大家都当中文用的 */
export const PLAIN_ENGLISH = new Set(['ai', 'ok', 'bug', 'app', 'ppt', 'pdf', 'gif', 'logo', 'demo', 'wifi', 'emoji'])

const ID_RULES = [
  ['任务 ID', /#\d+/],
  ['任务 ID', /\b[A-Z]{2,}-\d+\b/],
  ['任务 ID', /\b[0-9a-f]{7,}\b/i],
  ['打码残留', /〔[^〕]*〕/],
]
const PATH_RULES = [
  ['路径', /(~|\.{1,2})?\/[\w.-]+\/[\w.-]+|[A-Za-z]:\\|\w\\\w/],
  ['文件名', /[\w-]+\.(js|jsx|ts|tsx|mjs|cjs|py|json|jsonl|md|html|css|yml|yaml|toml|sh|txt|csv|png|jpg|mp4|lock|env)\b/i],
]
const QUOTE = /「([^」]*)」/g
const INNER_QUOTE = /[「」『』“”"]/

/** 「」里的片段 */
export const quotesOf = text => [...text.matchAll(QUOTE)].map(m => m[1])
const outside = text => text.replace(QUOTE, '「」')

/**
 * @param {string} text 气泡里显示的整条台词（一轮一行）
 * @param {{ sources?: string[], card?: object, project?: string, sensitive?: string[], voice?: boolean }} [ctx]  voice: false 不查口气
 *   sources：那一轮的原始记录（有才核对原话）；card：事件卡（有才核对数字）；project：主人的项目文件夹名（英文也不算行话）；sensitive：这件事命中的私事类别
 * @returns {{ rule: string, why: string }[]}
 */
export function checkLine(text, ctx = {}) {
  const bad = []
  const add = (rule, why) => bad.push({ rule, why })

  const w = width(text)
  if (w > MAX) add('字数', `${w} 字，超过 ${MAX}`)

  const n = text.split('\n').filter(l => l.trim()).length
  if (n > MAX_ROUNDS) add('轮数', `${n} 轮，超过 ${MAX_ROUNDS}`)

  if (/「[^」]*「/.test(text) || quotesOf(text).some(q => INNER_QUOTE.test(q)) || /『[^』]*[「“"]|“[^”]*[「『"]/.test(text)) add('引号套娃', '引号里还有引号')
  if ((text.match(/「/g) || []).length !== (text.match(/」/g) || []).length) add('引号套娃', '「」不成对')

  for (const [name, re] of [...ID_RULES, ...PATH_RULES]) { const m = text.match(re); if (m) add('行话', `${name}：${m[0]}`) }
  const tech = text.match(TECH_RE)
  if (tech) add('行话', `英文技术词：${tech[0]}`)
  const project = (ctx.project || '').toLowerCase()
  for (const m of outside(text).matchAll(/[A-Za-z][A-Za-z0-9_.+-]{2,}/g)) {
    const word = m[0].toLowerCase()
    if (PLAIN_ENGLISH.has(word) || (project && project.includes(word)) || TECH_RE.test(m[0])) continue
    add('行话', `引号外的英文：${m[0]}`)
  }

  if (ctx.sources) {
    const src = ctx.sources.map(quoteNorm)
    for (const q of quotesOf(text)) {
      const body = q.replace(/…$/, '').trim()
      if (!body) { add('原话', '空引号'); continue }
      if (!src.some(s => s.includes(body))) add('原话', `记录里找不到「${q}」`)
    }
  }

  if (ctx.card) {
    const real = new Set(JSON.stringify(ctx.card).match(/\d+/g) || [])
    for (const num of outside(text).match(/\d+/g) || []) if (!real.has(num)) add('数字', `${num} 不在事件卡里`)
  }

  if (ctx.voice !== false) { const v = voiceIssue(text); if (v) add('口气', v) }

  const cats = [...new Set([...(ctx.sensitive || []), ...sensitiveCats(text)])]
  if (cats.length) add('私事', `涉及${cats.join('、')}`)

  return bad
}

/** 身体动作的描写（旁白）：台词里只说话，动作交给桌宠演。惯用语（丢脸、没脸、脸皮、摸摸头）不算 */
const BODY = [
  /腿|身子|身体|肚子|肚皮|脑袋|爪子?|尾巴|鳍(?!子)|耳朵|眼皮|膝盖|胸脯|胳膊|脖子|后背|屁股/,
  /(?<![丢没要厚赏翻])脸(?![皮是面色])/,
  /[低抬摇点埋歪缩]头|把头|头都/,
  /手(抖|停|都|还|一|举|心)|(本肥鱼|本鲸|肥鱼)的手/,
  /缩成一团|缩了一下|打了?个?滚|打了?个?嗝|趴[着在下]|蹲[着在下]|瘫[着在了]|钻[进到]|跺脚|捂[着住]|眨[眼了]|白眼|发抖|哆嗦/,
]
/** 括号只许标语气 */
const TONE_HINT = /^(小声|大声|嘀咕|小小声|超小声|理直气壮|心虚|委屈|认真|偷偷)$/
/**
 * 口气（docs/persona.md）：本肥鱼当面对主人说话。模型写的、模板填出来的都过这一关。
 * @returns {string|null} 不合格的原因
 */
export function voiceIssue(text) {
  const t = outside(text)
  if (!/主人|你/.test(t)) return '不是在对主人说话（整句没有「主人」）'
  if (!/[呜嘿诶欸嘛呀啦哦呢吧嗝哼哇唉嘻呼～~]/.test(t)) return '没有语气词'
  if (/\d+\s*月\s*\d+\s*[日号]|\d+\s*[日号](?!子)|\d+\s*月(?!前)/.test(t)) return '写了几月几日（时间只说相对的）'
  for (const m of t.matchAll(/[（(]([^）)]*)[）)]/g)) if (!TONE_HINT.test(m[1].trim())) return `括号里写了动作「${m[1]}」（括号只许标语气）`
  for (const re of BODY) { const m = t.match(re); if (m) return `旁白式描写（写了身体动作：${m[0]}）` }
  return null
}

/** 数字两边的空格统一：汉字和数字、汉字和英文之间空一格（「」里的原话不动；钟点、标点旁边不加） */
export function spaced(text) {
  return String(text).split(/(「[^」]*」)/).map((seg, i) => i % 2 ? seg : seg
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, '$1 $2').replace(/ {2,}/g, ' ')).join('')
}

/** 按规则汇总：{ 字数: 12, 轮数: 3, … } */
export function tally(results) {
  const out = {}
  for (const bad of results) for (const rule of new Set(bad.map(b => b.rule))) out[rule] = (out[rule] || 0) + 1
  return out
}
