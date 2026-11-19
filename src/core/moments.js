/**
 * 「时刻」：从会话记录里挑出值得大肥鱼说一句的事，套本肥鱼的口吻写成台词。确定性，不调模型。
 *
 * 两步：
 *   1. 把会话切成「轮」（主人说一句 → agent 埋头干 → 下一句主人的话为止），数出干了多久、改了几个文件、跑了几条命令、吃了多少 token。
 *      dsh 的事件（ctx.sessionQuery）和 Claude Code 的 JSONL 各有一个切法，切出来的轮长得一样。
 *   2. 从轮里挑时刻：干活、深夜、被喊停、说好了结果挨骂、挨骂、认错、汇报，再加几条总账。
 *
 * 私事判断只看原话素材（不看模板，模板里的「有感情了」不算感情）。原话都过 redact 打码。
 */
import { TPL, KIND_OF, EMOTION_OF, FACT, signature } from './lines.js'
import { checkLine } from './standard.js'
import crypto from 'node:crypto'
import { redact } from './redact.js'
import { sensitiveCats } from './sensitive.js'

export const INJECTED = ['<', '[Request interrupted', 'Another Claude session sent a message', 'This session is being continued',
  'Base directory for this skill', '# Workflow authoring reference', 'Continue from where you left off', 'Caveat: The messages below']
export const FILLER = /^(继续|继续吧|接着|接着来|ok|okay|好|好的|行|可以|嗯|对|是|yes|go|continue|嗯嗯|好滴|没事|随便|你看着办|你决定|都行)[\s。.!！~～（(）)…]*$/i
export const COMPLAIN = /(不对|错了|又错|又是|你又|搞什么|什么鬼|还是报错|还是不行|还是不对|没用(啊|的|了|吧|[。！!？?]|$)|有什么用|乱改|别乱|不是这样|离谱|难绷|无语|哪来的|你在干嘛|干嘛呢|为什么又|怎么又|怎么还|不是让你|我不是说|白屏|挂了|崩了|\?\?|？？)/
const SORRY = /(你说得对|你是对的|是我的错|我的错|我搞错了|我错了|我理解错了|我看错了|抱歉|对不起|是我疏忽|我疏忽了|我漏了|我刚才.{0,8}(错|不对)|you'?re right|my mistake|i was wrong|apologi)/i
const ASK = /(帮我|给我|你(去|来|先|把|再|直接)|修|改|加|写|做|弄|查|跑|删|换|整理|实现|接入|装|看看|试试|重构|优化|导出)/
const DONE = /(改好了|修好了|修复了|已修复|已经修好|搞定|都过了|全过了|通过了|全部通过|已完成|完成了|做好了|写好了|加好了|弄好了|接好了|换好了|好了|没问题了|可以用了|能用了|生效了|已经(改|加|修|换|删|接|做|写|装|去掉|处理)|现在(可以|会|能|就|已经)|已(改|加|修|换|删|接|装|去掉)|fixed|done|all tests pass|works now)/i
/** 「说好了却挨骂」的那句回嘴：比 COMPLAIN 宽，加上「还是 / 没变 / 不行 / 看不到」这类「你说好了但其实没好」 */
const BACKFIRE = new RegExp(COMPLAIN.source + '|还是(不|没|报错|一样|有|那样|空)|没变|没反应|没效果|没有用|不行|用不了|不能用了|不好使|没有(用|变|反应|效果|出来)|还没|根本|怎么(还|又|没|不)|为什么(还|又|没|不)|bug|报错|失败|不显示|看不到|没看到|打不开|是空的|白的|卡住|有问题|不work|doesn.?t work|not working|still', 'i')

/** 一段空闲最多算 3 分钟：等主人点批准、去吃饭，不算本肥鱼在干活。 */
const IDLE_CAP = 180e3
/** 一碗白饭 = 5 万 token（输入 + 输出 + 缓存写入；缓存读取不算）。换算着玩的，界面上写明。 */
export const RICE = 50_000

const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''

export function newTurn({ key, title = null, project = null, start, text }) {
  return { key, title, project, start, end: start, last: start, active: 0, text, next: null, tokens: 0, tools: 0, commands: 0, reads: 0, agents: 0, edited: new Set(), texts: [], interrupted: false, cwd: null, subs: {} }
}
/** 改的文件在工作目录的哪个子文件夹里（工作目录是个装了很多项目的大文件夹时，子文件夹才是「哪个项目」；是不是项目由读文件的那层判断） */
function noteSub(t, file) {
  if (!t.cwd || !String(file).startsWith(t.cwd + '/')) return
  const segs = String(file).slice(t.cwd.length + 1).split('/')
  if (segs.length > 1) t.subs[segs[0]] = (t.subs[segs[0]] || 0) + 1
}
export function markTurn(t, ts) {
  const gap = ts - t.last
  if (gap > 0) t.active += Math.min(gap, IDLE_CAP)
  t.last = Math.max(t.last, ts)
  t.end = Math.max(t.end, ts)
}

// ---------------- Claude Code JSONL → 轮 ----------------

/**
 * @param {string[]} lines 一个会话文件的行
 * @param {{ key: string, home?: string }} opts
 */
export function claudeTurns(lines, { key, home = '' }) {
  const turns = []
  let title = null, cur = null, project = null, cwd = null
  const seenMsg = new Set()
  const close = () => { if (cur) turns.push(cur); cur = null }
  for (const line of lines) {
    if (!line) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'ai-title' && o.aiTitle) { title = o.aiTitle; continue }
    // 一轮做完 Claude Code 会记一条 system/turn_duration：现在在不在跑看它（core/live.js）
    if (o.type === 'system' && o.subtype === 'turn_duration' && !o.isSidechain) { if (cur) cur.ended = true; continue }
    if (o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) continue
    const t = Date.parse(o.timestamp); if (!t) continue
    if (o.cwd) { cwd = o.cwd; project = home && o.cwd === home ? '主目录' : base(o.cwd) }
    const c = o.message?.content
    if (o.type === 'user') {
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : ''
      const isResult = Array.isArray(c) && c.some(b => b?.type === 'tool_result')
      const s = text.trim()
      if (s.startsWith('[Request interrupted')) { if (cur) { cur.interrupted = true; cur.ended = true; cur.end = t } continue }
      if (isResult || !s || INJECTED.some(p => s.startsWith(p))) { if (cur) markTurn(cur, t); continue }
      if (cur) { cur.next = s; close() } else if (turns.length) turns.at(-1).next ??= s
      cur = newTurn({ key, title, project, start: t, text: s })
      cur.cwd = cwd
      continue
    }
    if (!cur) continue
    markTurn(cur, t)
    cur.ended = false                         // 做完又被后台通知叫起来接着干：又算在跑
    const mid = o.message?.id
    if (mid && !seenMsg.has(mid) && o.message.usage) {
      seenMsg.add(mid)
      const u = o.message.usage
      cur.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0)
    }
    for (const b of Array.isArray(c) ? c : []) {
      if (b.type === 'text' && b.text?.trim()) cur.texts.push(b.text.trim())
      if (b.type !== 'tool_use') continue
      cur.tools++
      const n = b.name
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(n) && b.input?.file_path) { cur.edited.add(base(b.input.file_path)); noteSub(cur, b.input.file_path) }
      if (n === 'Bash') { cur.commands++; noteSub(cur, (String(b.input?.command || '').match(/\/[^\s'"`;&|]+/g) || []).find(p => cur.cwd && p.startsWith(cur.cwd + '/')) || '') }
      if (n === 'Read') { cur.reads++; noteSub(cur, b.input?.file_path || '') }
      if (n === 'Agent' || n === 'Task') cur.agents++
    }
  }
  close()
  for (const tr of turns) tr.title ||= title          // ai-title 往往在会话中途才出现
  return turns
}

// ---------------- dsh 事件 → 轮 ----------------
// 事件形状见 docs/dsh-api.md §1 和 dsh 源码 packages/core/session/src/types.ts（tool/call、assistant/message.usage、turn/end.reason）。

const DSH_EDIT = new Set(['edit', 'write', 'str_replace_editor', 'apply_patch', 'multi_edit'])
const DSH_SHELL = new Set(['bash', 'shell_command', 'exec_command'])
const textOf = content => (Array.isArray(content) ? content : []).filter(b => b?.type === 'text').map(b => b.text).join('\n')

/**
 * @param {string} id
 * @param {any} header 会话头（cwd、origin）
 * @param {{type:string,time:number,data:any}[]} events
 */
export function dshTurns(id, header, events) {
  if (header?.origin === 'subagent') return []
  const turns = []
  let title = null, cur = null
  const project = base(header?.cwd)
  const close = () => { if (cur) turns.push(cur); cur = null }
  for (const e of events) {
    const d = e.data || {}
    if (e.type === 'session/title' && d.title) { title = d.title; continue }
    if (e.type === 'user/message') {
      if (d.source?.kind !== 'user') { if (cur) markTurn(cur, e.time); continue }
      const s = textOf(d.content).trim()
      if (!s) continue
      if (cur) { cur.next = s; close() }
      cur = newTurn({ key: id, title, project, start: e.time, text: s })
      cur.cwd = header?.cwd || null
      continue
    }
    if (!cur) continue
    markTurn(cur, e.time)
    if (e.type === 'assistant/message') {
      const t = textOf(d.message?.content).trim()
      if (t) cur.texts.push(t)
      const u = d.usage
      if (u) cur.tokens += (u.inputTokens || 0) + (u.outputTokens || 0)
    } else if (e.type === 'tool/call') {
      cur.tools++
      let args = {}
      try { args = JSON.parse(d.arguments || '{}') } catch {}
      const n = d.name || ''
      const file = args.path || args.file_path || args.filePath
      if (DSH_EDIT.has(n) && file) { cur.edited.add(base(file)); noteSub(cur, file) }
      if (DSH_SHELL.has(n)) cur.commands++
      if (n === 'read') cur.reads++
      if (n.startsWith('subagent')) cur.agents++
    } else if (e.type === 'turn/end') {
      cur.ended = true                         // 现在在不在跑（core/live.js）：最后一轮没有 turn/end 就是还在跑
      if (d.reason?.kind === 'interrupted' || d.reason?.kind === 'aborted') cur.interrupted = true
    }
  }
  close()
  for (const tr of turns) tr.title ||= title
  return turns
}

// ---------------- 轮 → 时刻 ----------------

const pad = n => String(n).padStart(2, '0')
export function when(ts) {
  const d = new Date(ts), h = d.getHours()
  const part = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上'
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日${part} ${clock(ts)}`
}
/** 钟点：「1:02」（只有 late 用得上） */
export const clock = ts => { const d = new Date(ts), h = d.getHours(); return `${h > 12 ? h - 12 : h}:${pad(d.getMinutes())}` }
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export function dur(ms) {
  const m = Math.round(ms / 60e3)
  if (m < 60) return `${Math.max(1, m)} 分钟`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} 小时 ${r} 分钟` : `${h} 小时`
}
/** 带前导空格（「吃了 3 碗」/「吃了小半碗」），模板里直接接。 */
export const bowls = tokens => { const b = tokens / RICE; return b < 0.7 ? '小半碗' : b < 10 ? ` ${Math.max(1, Math.round(b))} 碗` : ` ${Math.round(b)} 大碗` }
const clean = s => redact(s.replace(/\[Image[^\]]*\]/g, '').replace(/\*\*|`/g, '').replace(/^>\s*/gm, '').replace(/\s+/g, ' ').trim()).text
const len = s => [...s].length
/** 核对原话用：记录里的一段话，按 short() 同样的处理（打码、去 markdown、去引号、脏话 ××）之后的样子。台词里「」中的字必须是它的一段。 */
export const quoteNorm = s => clean(String(s || '')).replace(/[「」『』“”"]/g, '').replace(CUSS, '××')
/** 原话：第一行、去掉里面的引号（外面由模板套一层「」，不套娃），长了在标点处截，截不到再硬截加「…」 */
const CUSS = /他妈的?|他吗的?|她妈的?|特么的?|妈的|tmd|TMD|卧槽|我操|操你|傻逼|傻b|sb(?![a-z])|SB(?![A-Z])|nmsl|靠北|fuck\w*|shit/giu
const cjk = s => (s.match(/[\u4e00-\u9fff]/g) || []).length
export function short(s, max = 14) {
  const t = clean(s.split('\n')[0]).replace(/[「」『』“”"]/g, '').replace(CUSS, '××')   // 宠物冒泡不念脏话
  if (len(t) <= max) return unq(t) || t
  const cut = [...t].slice(0, max).join('')
  const at = Math.max(...['，', '。', '！', '？', ',', '；', ' '].map(p => cut.lastIndexOf(p)))   // 很多人拿空格当逗号
  return at >= 4 && cjk(cut.slice(0, at)) >= 2 ? cut.slice(0, at) : cut + '…'
}
/** 气泡里一句话的长度：不算空格（数字两边的空格是排版用的） */
export const width = s => len(s.replace(/\s/g, ''))
export const MAX_WIDTH = 60          // 一段台词最多几个字（不算空格、换行），见 docs/lines-standard.md

/**
 * 任务名压成 10 字以内的话题，不带引号：去客套（帮我把…一下）、去长英文技术词（能留下至少两个汉字时）、去路径。
 * 「帮我把导入脚本重构一下」→「导入脚本重构」；「合并 Pipeline 和 Creators 页」→「合并页」。压不出两个字就返回 null。
 */
const GENERIC = /^(帮我|请|你)?(查看|看看|看下|看一下|检查|列出|打开)?(一下)?(当前|这个|我的)?(文件夹|目录|项目|仓库|代码)(的|里的?)?(内容|结构|文件|有什么)?[。.!！?？]*$|^(继续|接着|好的?|嗯|ok|go|你好|hi|hello|test|测试)[。.!！]*$/i
export function topic(s, max = 10) {
  let t = clean(s.split('\n')[0]).replace(/[「」『』“”"]/g, '')
  if (/〔[^〕]*〕/.test(t)) return null
  if (GENERIC.test(t.replace(/\s+/g, ''))) return null                // 「查看当前文件夹内容」「继续」这种说不出是哪件事                     // 带路径 / 密钥的，删掉之后剩下的不成话
  t = t.replace(/\s*[（(].*$/u, m => len(t) - len(m) >= 2 ? '' : m)   // 括号里的补充说明不要
  t = t.replace(/^(你|请你?|麻烦你?|能不能|可以|可不可以|帮忙|帮我|给我|我想|我要|我们|现在|再|先|然后)+/u, '')
  t = t.replace(/^(把|将|给)/u, '').replace(/[吧呢啊呀嘛吗。！!？?，,.\s]+$/u, '').replace(/(一下|下|一点|一些)$/u, '').replace(/(?<=.)一下(?=.)/u, '').trim()
  const noAscii = t.replace(/[A-Za-z][\w.+#-]*(\s*[和与跟、/&+]\s*[A-Za-z][\w.+#-]*)*/g, m => m.length <= 4 && !/\s/.test(m) ? m : '').replace(/\s+/g, '').replace(/^[和与跟、的]+|[和与跟、的]+$/g, '')
  if (!/[\u4e00-\u9fff]/.test(t)) return len(t) <= max ? t : null    // 纯英文：放得下就原样，放不下不硬截
  if ((/[A-Za-z]{7,}/.test(t) || len(t.replace(/\s/g, '')) > max) && len((noAscii.match(/[\u4e00-\u9fff]/g) || []).join('')) >= 2) t = noAscii
  t = t.replace(/\s+(?=[\u4e00-\u9fff])|(?<=[\u4e00-\u9fff])\s+/g, '')
  if (len(t) > max) t = t.split(/然后|并且|顺便|接着|，|。|；|,/u)[0] || t          // 只取第一件事
  if (len(t) > max) t = t.replace(/(?<=.)的(?=.)/gu, '')                        // 「首页的按钮」→「首页按钮」
  if (len(t) > max) return null                   // 找不到自然断点就不硬截（半句话读着别扭），交给会话标题或干脆不说
  t = t.replace(/[，、,：:的和与]+$/u, '')
  return len(t.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')) >= 2 ? t : null
}
const unq = s => s && s.replace(/[。.!！；;，,]+$/u, '')
function sentenceWith(text, re, max = 36) {
  for (const s of clean(text).split(/(?<=[。！？!?\n])|(?<=\.)\s/)) {
    const t = s.trim()
    if (re.test(t) && /[一-鿿]/.test(t) && !/[|│]|^[-*#>]|：\s*$/.test(t) && len(t) <= max && len(t) >= 4) return unq(t)   // 表格行、列表符号、半截引言不算一句话
  }
  return null
}
/** 填模板：{w} {clock} {task} {dur} {doing} {rice} {next} {claim} {said} {project} {days} {files} {n} {span} {date}。缺的变量填空串（只会是可选的）。 */
export function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
    .replace(/(\d) +(?=小半碗)/g, '$1').replace(/ +(?=小半碗)/g, '')     // 「吃了 小半碗」→「吃了小半碗」
    .replace(/(分钟|小时|碗) +(?=[\u4e00-\u9fff（「])/g, '$1')                  // 「干了 2 分钟 才说」→「干了 2 分钟才说」
    .replace(/ {2,}/g, ' ')
}
const rice = tokens => bowls(tokens).trim()
const hash = seed => parseInt(crypto.createHash('md5').update(String(seed)).digest('hex').slice(0, 8), 16)
const pick = (arr, seed) => arr[hash(seed) % arr.length]
/** 按种子挑一条，填出来超过 40 字（或套了两层引号）就顺次换下一条；全都超了返回 null，这件事不说 */
export function fillFit(list, seed, ...varsList) {
  const start = hash(seed) % list.length
  for (const vars of varsList) {                // 先试原话完整的那一版，塞不下再试截短的
    for (let i = 0; i < list.length; i++) {
      const out = fill(list[(start + i) % list.length], vars)
      if (width(out) <= MAX_WIDTH && !/「[^」]*「/.test(out)) return out
    }
  }
  return null
}
/** 多久之前：「今天」「昨天」「5 天前」「十几天前」「一个多月前」……（翻旧账先说这个，读的人才知道是旧事） */
export function ago(ts, now = Date.now()) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0)
  const d = Math.round((d0 - new Date(new Date(ts).setHours(0, 0, 0, 0))) / 864e5)
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d === 2) return '前天'
  if (d <= 10) return `${d} 天前`
  if (d < 15) return '十几天前'
  if (d < 30) return '大半个月前'
  const m = Math.floor(d / 30)
  if (m < 6) return `${'一两三四五'[m - 1]}个多月前`
  if (m < 12) return '半年多前'
  return '一年多前'
}

const NEED = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1])
/** 一条模板填出来，气泡里显示的样子 */
export const render = (t, vars) => fill(t, vars).replace(/(\d:\d\d)(?=[\u4e00-\u9fff])/g, '$1 ')   // 「2:05 开工」，钟点后面空一格
  .replace(/\u200b(?=[，。、！？\s]|$)/g, '').replace(/\u200b/g, '，')                                 // 「在弄什么」后面没有标点的补个逗号
/**
 * 按种子从这类事件的模板里挑一条：缺值的跳过，填出来不过台词标准（超 40 字、超两轮、引号套娃、有行话）的换下一条；都不行返回 null（这件事不说）。
 * varsList：几版说法依次试（带上在弄什么的、不带的；原话完整的、截短的）。
 */
export function say(event, seed, ...varsList) {
  const list = TPL[event]
  const start = hash(seed) % list.length
  const used = say.used[event] ||= {}
  // 用得少的模板排前面（同一个句式别翻来覆去地说），一样多的按种子排
  const order = list.map((_, i) => (start + i) % list.length).sort((a, b) => (used[a] || 0) - (used[b] || 0))
  for (const vars of varsList) {
    if (!vars) continue
    for (const idx of order) {
      const t = list[idx].t
      if (NEED(t).some(k => vars[k] === undefined || vars[k] === null || vars[k] === '')) continue
      const out = render(t, vars)
      // 同一批台词里，同一个短句（「嗝，谢谢款待」「谢谢主人没换鱼呀」）最多出现一次
      const mine = phrases(t)
      if (mine.some(x => say.phrases.has(x))) continue
      if (checkLine(out, { project: [vars.project, vars.place].filter(Boolean).join(' ') }).length) continue
      say.last = `${event}#${idx}`
      used[idx] = (used[idx] || 0) + 1
      mine.forEach(x => say.phrases.add(x))
      return out
    }
  }
  return null
}

say.used = {}
say.phrases = new Set()
/** 一句话里的短句：按标点切开，去掉占位符、引号里的话、「本肥鱼」「主人」，剩下 4 个字以上的 */
export const phrases = t => String(t).replace(/「[^」]*」/g, '|').replace(/\{\w+\}/g, '|').split(/[，。！？…、：\n|～,.!?]+/).map(x => x.replace(/本肥鱼|主人|\s/g, '')).filter(x => [...x].length >= 4)

const WEEK = '日一二三四五六'
const partOf = h => h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上'
const daysAgo = (ts, now) => { const d0 = new Date(now); d0.setHours(0, 0, 0, 0); return Math.round((d0 - new Date(new Date(ts).setHours(0, 0, 0, 0))) / 864e5) }
export const dateWord = ts => { const d = new Date(ts); return `${d.getMonth() + 1} 月 ${d.getDate()} 日` }
/**
 * 什么时候：越近说得越口语（「昨天下午」「上周三晚上」），远了说几月几日。凌晨的事带钟点（钟点本身就是看点）。
 * @param {{ clock?: boolean, part?: boolean }} [o]  part = false 不说上午下午（远的事省字）
 */
export function timeWord(ts, now = Date.now(), { clock: withClock = false, part = true } = {}) {
  const d = new Date(ts), n = daysAgo(ts, now)
  const tail = withClock ? `${partOf(d.getHours())} ${clock(ts)}` : part ? partOf(d.getHours()) : ''
  if (n <= 0) return '今天' + tail
  if (n === 1) return '昨天' + tail
  if (n === 2) return '前天' + tail
  const mon = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x.getTime() }   // 那一周的周一
  const weeks = Math.round((mon(now) - mon(ts)) / (7 * 864e5))
  if (weeks === 0) return `这周${WEEK[d.getDay()]}` + tail
  if (weeks === 1) return `上周${WEEK[d.getDay()]}` + tail
  return dateWord(ts) + tail
}

/**
 * 相对的说法（给模型写台词用，像聊天不像日志）：「昨天下午」「上周三晚上」「前阵子」「上个月」「两个月前」。
 * 一周以外不说上午下午；凌晨的事带钟点。
 */
export function relWord(ts, now = Date.now(), { clock: withClock = false, part = true, some = '' } = {}) {
  const d = new Date(ts), n = daysAgo(ts, now), t = new Date(now)
  const months = (t.getFullYear() - d.getFullYear()) * 12 + t.getMonth() - d.getMonth()
  const near = timeWord(ts, now, { clock: withClock, part })
  if (n <= 2 || !/月/.test(near)) return near                      // 今天 / 昨天 / 前天 / 这周X / 上周X
  const far = months <= 0 || n < 14 ? '前阵子' : months === 1 ? '上个月' : months === 2 ? '两个月前' : months === 3 ? '三个月前' : '好几个月前'
  return far + (withClock ? `有一天${partOf(d.getHours())} ${clock(ts)}` : some)
}

/** 这些文件夹名说不出是哪个项目 */
const VAGUE = /^(主目录|某个文件夹|downloads?|desktop|documents?|memory|projects?|src|app|apps|work|tmp|temp|eval|results?|assets|shots|hub|code|dev|test|tests|data|home|\d+|[-.].*)$/i
/** 在弄什么：项目文件夹名（主人自己起的，认得）；说不出是哪个项目的，用会话标题压出来的中文话题；都没有就是 null */
export function placeOf(tr) {
  if (tr.project && !tr.loose && !VAGUE.test(tr.project) && len(tr.project) <= 16) return tr.project
  for (const tp of [tr.title && topic(tr.title, 8), tr.about]) if (tp && len(tp) <= 8 && !/[A-Za-z0-9]/.test(tp) && !/^[\p{P}\s]/u.test(tp)) return tp
  return null
}
const VERB = /^(改|修|加|写|做|查|整理|实现|导出|导入|重构|优化|下载|转写|合并|翻译|安装|测试|生成|分析|提取|设计|画|录|剪|配|接入|搭|调|拆|删|换|迁移|更新|发布|部署)/
/** 「在弄什么」换着说，别每条都是「弄 X 那阵」 */
const AROUND = (p, k = 0) => /^[\x00-\x7f]+$/.test(p) ? [`弄 ${p} 那阵`, `在 ${p} 里`, ` ${p} 那边`][k % 3] : VERB.test(p) ? [`${p}那阵`, `${p}那会儿`][k % 2] : [`弄${p}那阵`, `忙${p}那会儿`][k % 2]
/**
 * {t} 的几版说法，依次试：带上在弄什么的在前。一个月以上的旧事必须带（不带认不出是哪回事），带不上就不说。
 * @returns {{ t: string, place?: string }[]}
 */
function tVars(tr, ts, now, o = {}) {
  const n = daysAgo(ts, now), place = placeOf(tr)
  const rel = relWord(ts, now, o), time = timeWord(ts, now, { clock: o.clock, part: o.part !== false && (n <= 7 || !!o.clock) })
  const out = []
  // 一周以内的事，说什么时候就认得出；再早的带上在弄什么
  if (place && n > 7) { const around = AROUND(place, hash(place + ts)).trimStart(); out.push({ t: rel + (o.clock ? '，' : /^[A-Za-z0-9]/.test(around) ? ' ' : '') + around + '\u200b', place, time, rel }) }
  if (n <= 30) out.push({ t: rel, time, rel })
  return out
}
/**
 * 原话：放得下就整句；放不下只在逗号句号处截，而且截出来得是半句完整的话（不以「是 / 在 / 的」这种字收尾）；截不出来就不要。
 * 至少两个汉字，或者是脏话。
 */
function quote(s, max = 14) {
  const full = short(String(s || ''), 999)
  if (!full || len(full) < 2) return null
  let q = full
  if (len(full) > max) {
    const head = [...full].slice(0, max + 1).join('')
    const at = Math.max(...['，', '。', '！', '？', ',', '；'].map(p => head.lastIndexOf(p)))
    if (at < 4) return null
    q = head.slice(0, at)
    if (/[是在把被让给对和与跟的地得就也都还又要会能说]$/.test(q)) return null
  }
  if ((q.match(/[（(]/g) || []).length !== (q.match(/[）)]/g) || []).length) return null     // 半个括号的话读着像没说完
  return cjk(q) >= 2 || /××/.test(q) ? q : null
}
/**
 * 主人的原话（挨骂、喊停、被抓包时回的那句、半夜那句）能不能引：离开当时的对话也得看得懂。
 *   - 带情绪（问号、不行、无语、太丑了……），没有数字和英文（半截技术指令不引）；
 *   - 后半句是冲着当时那件活说的（「你几十个百个测」「我看不是网络又断了下」）就只留前半句；前半句自己站不住就整句不引。
 * 引不了返回 null：这句不进事件卡，也就不会被模型引用。
 */
function ownerQuote(s, max = 14) {
  const full = short(String(s || ''), 999)
  if (!full) return null
  const parts = full.split(/(?<=[，。！？,；!?\s])/)             // 空格也留着：原话一个字符都不动
  for (let k = parts.length; k >= 1; k--) {
    if (!parts[k - 1].trim() || (k > 1 && len(parts[k - 1].replace(/[\s\p{P}]/gu, '')) === 1)) continue      // 最后一小段只有一个字（「还是不行，跑」）是截断的
    const cand = unq(parts.slice(0, k).join('').trim()) || ''
    if (len(cand) > max || len(cand) < 2) continue
    if (parts.slice(1, k).some(p => /^(你|我看(?!不到|不见|不了)|我要你|然后|另外|顺便)/.test(p.trim()))) continue
    if (/[是在把被让给对和与跟的地得就也都还又要会能说]$/.test(cand)) continue
    if ((cand.match(/[（(]/g) || []).length !== (cand.match(/[）)]/g) || []).length) continue
    if (!(cjk(cand) >= 2 || /××/.test(cand))) continue
    if (plain(cand)) return cand
  }
  return null
}
/** 本肥鱼自己的话（认错那句、说好了那句）：整句、没有数字和英文 */
const agentQuote = (s, max = 14) => { const q = quote(s, max); return q && !/\d|[A-Za-z]{2,}/.test(q) ? q : null }
/** 主人认可的话、「做吧」这类：本来就短，只挡数字和英文 */
const shortQuote = agentQuote

/** 聊天口吻不像任务名：带你 / 我、语气词、催促，或者以标点开头 */
const CHATTY = /[你我啊吧呢吗嘛哈呀]|^[赶快再先又还就也中的里]|^(自己|完整|这个|那个)|^[\p{P}\s]/u
export function task(tr) {
  // 会话标题（dsh 和 Claude Code 自己起的）比主人随口那句更像「哪件事」，先用它
  const title = tr.title && topic(tr.title)
  if (title && !/^[\p{P}\s]/u.test(title)) return title
  const first = tr.text.split('\n')[0].trim()
  if (!FILLER.test(first) && len(first) >= 4 && len(first) <= 50 && ASK.test(first)) {
    const t = topic(first)
    if (t && !CHATTY.test(t)) return t
  }
  return null
}
export const isHuman = s => s && !INJECTED.some(p => s.startsWith(p))

/** 认可的话（主人不常说，说了就记） */
const PASS = /^(额|嗯|好|ok|哈+|卧槽|我操|应该|终于|这下|现在|这次)?[，, ]*(可以了|可以的|就这样|就是这个|有用了|成了|对了|不错|牛|厉害|完美|好看|很好|挺好|太好了|好多了|舒服|真棒|太棒了|谢谢|辛苦了)/i
/** 真认错（光一句「你说得对」不算） */
const REAL_SORRY = /((对不起|抱歉)(?=[，,。！!]|$)|是我的错|我的错|我搞错了|我错了|我理解错了|我看错了|是我疏忽|我疏忽了|我漏了)/
/** 被抓包时主人回的那句：得是明摆着在说「没好」 */
const NOT_DONE = /(还是|没变|没反应|没效果|看不到|没看到|打不开|不行|报错|没好|怎么(还|又)|为啥(还|又)|[?？]{2,}|用不了|不能用|失败|白屏|卡住|无语|太慢|根本)/
/** 主人说的是自己的事（我点错了 / 我网掉了），不是在说本肥鱼 */
const OWN = /^我/
/** 比 COMPLAIN 宽一点的「又被说了」：数连着被说了几回用 */
const NAG = new RegExp(COMPLAIN.source + '|^(（|\\()?不是[ ，,（(]|^不行|还是(不|没)|为啥|咋(又|还)')
const minuteOf = ts => new Date(ts).getHours() * 60 + new Date(ts).getMinutes()
/** 离开当时的对话也看得懂的话：带情绪（问号、不行、无语、太丑了……），而且没有数字和英文（半截技术指令不引） */
const EMO = /[?？！!]|不行|无语|看不到|没好|没用|还是|怎么|为啥|为什么|太[\u4e00-\u9fff]|什么鬼|离谱|啥意思|什么意思|错了|不对|算了|××|丑|慢|烦|别[\u4e00-\u9fff]|停/
const plain = q => !!q && EMO.test(q) && !/\d|[A-Za-z]{2,}/.test(q)
/** 「去干吧」这类话：短，谁看都懂 */
const GO = /^(继续|接着|做吧|都做吧|去吧|去做吧|都去做吧|开始吧|改吧|修吧|都修了|搞吧|试试|好|行|可以|ok|嗯)[啊吧呀。！!\s]*$/i
/** 同一天最多说两件，先留有看头的 */
const RANK = ['caught', 'marks', 'passafter', 'streak', 'pass', 'cuss', 'night', 'late', 'terse', 'long', 'complain', 'sorryday', 'eater', 'stopped', 'sorry', 'halt']
const CAP = { caught: 60, complain: 60, cuss: 20, streak: 30, marks: 20, sorry: 60, sorryday: 20, stopped: 60, late: 40, night: 30, long: 40, terse: 40, eater: 20, pass: 40, passafter: 20 }

/**
 * @param {ReturnType<typeof newTurn>[]} turns
 * @param {{ since?: number, now?: number, days?: number, withSource?: boolean }} [opts]  withSource：每个时刻带上那一轮的原始记录（m.source），只给检查脚本核对原话用
 * @returns {{ kind: string, event: string, ts: number, day: string, hour: number, text: string, anim: string, sensitive: string[], card: object, tpl: string }[]}
 */
export function buildMoments(turns, { since = 0, now = Date.now(), days = null, withSource = false } = {}) {
  const moments = []
  say.used = {}
  say.phrases = new Set()
  const seenSrc = new Set()
  // 同一轮只算一次：Claude Code 续上旧会话时会把前面的记录抄进新文件
  const seenTurn = new Set()
  const real = turns.filter(t => t.start >= since && !seenTurn.has(t.start + '|' + t.text) && seenTurn.add(t.start + '|' + t.text)).sort((a, b) => a.start - b.start)
  const first = t => t.text.split('\n')[0].trim()

  // 私事：这一轮、或者同一个会话里前后三轮，有一句命中私事词，这一轮的事就算私事（聊私事的那一段整段不说）
  const bySession = {}
  for (const t of real) (bySession[t.key] ||= []).push(t)
  const priv = new Map()
  // 事发前后的原文：上一轮（主人一句、本肥鱼最后一句）、这一轮、主人的下一句。每句截短，合起来不超过 300 字。打码、脏话打 ××。
  const prevOf = new Map()
  for (const ts of Object.values(bySession)) ts.forEach((t, i) => prevOf.set(t, ts[i - 1] || null))
  const utter = (s, max) => { const t = clean(String(s || '').split('\n').filter(l => l.trim())[0] || '').replace(CUSS, '××'); return len(t) > max ? [...t].slice(0, max).join('') + '…' : t }
  const contextOf = tr => {
    const p = prevOf.get(tr), lines = []
    const push = (who, s, max) => { const t = s && isHuman(s) ? utter(s, max) : ''; if (t) lines.push(`${who}：${t}`) }
    if (p) { push('主人', p.text, 50); push('本肥鱼', p.texts.at(-1), 50) }
    push('主人', tr.text, 70); push('本肥鱼', tr.texts.at(-1), 70); push('主人', tr.next, 50)
    let out = lines.join('\n')
    while (len(out) > 300 && lines.length > 1) { lines.shift(); out = lines.join('\n') }
    return out || null
  }
  for (const ts of Object.values(bySession)) {
    const own = ts.map(t => sensitiveCats(`${t.text} ${t.next || ''} ${t.title || ''}`))
    ts.forEach((t, i) => priv.set(t, [...new Set(own.slice(Math.max(0, i - 3), i + 4).flat())]))
  }

  /**
   * @param {string} event 事件（TPL 的键）
   * @param {number} ts
   * @param {string|null} text
   * @param {{ turn?: any, src?: string, card?: object, sources?: string[] }} [o] turn：这件事出自哪一轮（判断私事、核对原话）；src：去重用
   */
  const add = (event, ts, text, { turn = null, src = '', card = {}, sources = null } = {}) => {
    if (!text) return                         // 没有一条模板填得进标准：这件事不说
    const kind = KIND_OF[event] || 'stat'
    const key = event + '|' + (src ? src.replace(/\s+/g, '').slice(0, 120) : text)
    if (seenSrc.has(key)) return
    // 同一天同一句原话只在一件事里用（被喊停的那句，不再当成挨骂说一遍）
    const qk = [card.next, card.said].filter(Boolean).map(q => dayKey(ts) + q)
    if (kind !== 'stat' && qk.some(q => seenSrc.has(q))) return
    seenSrc.add(key); qk.forEach(q => seenSrc.add(q))
    // 事件卡：只放程序判断 / 算出来的事实。核对数字、给 AI 改写（core/style.js）都用它
    // 事件的编号要稳定（模型写的台词按它存）：按「现在」算的总账不带时间，否则每次都是新编号
    const id = crypto.createHash('md5').update(event + '|' + (src || text) + '|' + (kind === 'stat' && ts === now ? '' : ts)).digest('hex').slice(0, 10)
    const c = Object.fromEntries(Object.entries({ id, kind, event, ago: kind === 'stat' ? null : ago(ts, now), ...card }).filter(([, v]) => v !== null && v !== undefined && v !== ''))
    if (FACT[event]) c.fact = FACT[event](c).replace(/\s+/g, ' ')          // 大白话描述：发给模型的就是这句（core/style.js）
    if (turn && kind !== 'stat') c.ctx = contextOf(turn)                   // 事发前后几句原文（打码、≤300 字），给模型找味道用
    const sensitive = [...new Set([...(turn ? priv.get(turn) || [] : []), ...sensitiveCats(text)])]
    const m = { kind, event, ts, day: dayKey(ts), hour: new Date(ts).getHours(), text, emotion: EMOTION_OF[event] || null, anim: signature(event), sensitive, card: c, tpl: say.last }
    if (withSource) m.source = sources || (turn ? [turn.text, turn.next, turn.title, ...turn.texts].filter(Boolean) : [])
    moments.push(m)
  }
  /** 一类事件的几版变量：{t} 的每种说法 × 原话的每种截法 */
  const PICKER = { next: ownerQuote, said: ownerQuote, claim: agentQuote }
  const variants = (tr, ts, base, quotes = {}, o = {}, pickers = {}) => {
    const qs = [14, 10, 7].map(max => { const e = Object.entries(quotes).map(([k, v]) => [k, (pickers[k] || PICKER[k])(v, max)]); return e.every(([, v]) => v) ? Object.fromEntries(e) : null }).filter(Boolean)
    const uniq = [...new Map(qs.map(q => [JSON.stringify(q), q])).values()]
    if (Object.keys(quotes).length && !uniq.length) return []
    return tVars(tr, ts, now, o).flatMap(tv => (uniq.length ? uniq : [{}]).map(q => ({ ...base, ...tv, ...q })))
  }
  const cardOf = v => v && { when: v.t && v.t.replace(/\u200b/g, '').trim(), time: v.time, rel: v.rel, task: v.place, said: v.said, next: v.next, claim: v.claim, dur: v.dur || v.few || v.long, len: v.len, rice: v.rice && v.rice + '白饭', times: v.n, clock: v.clock }
  /** 挑一条说，顺手记下用的是哪版变量（事件卡里的事实要和台词里的一样） */
  const tell = (event, seed, vs) => { for (const v of vs) { const text = say(event, seed, v); if (text) return { text, v } } return {} }

  // 这个会话在弄什么：前面哪一轮派活时说得出话题，后面的轮都沿用（文件夹名说不出是哪个项目时用它交代）
  for (const ts of Object.values(bySession)) { let about = null; for (const t of ts) { const a = first(t); if (!FILLER.test(a) && len(a) >= 4 && len(a) <= 50 && ASK.test(a)) { const tp = topic(a, 8); if (tp && !CHATTY.test(tp) && VERB.test(tp) && len(tp) >= 4 && !/[这那啥么吗谁哪第步版]/.test(tp)) about = tp } t.about = about } }

  const nagged = t => NAG.test(first(t)) && len(first(t)) <= 60 && isHuman(first(t)) && !(OWN.test(first(t)) && !/你/.test(first(t)))
  const caughtNext = new Set(), inStreak = new Set()

  // 连着被说：同一个会话，两小时内三回以上
  for (const ts of Object.values(bySession)) {
    const c = ts.filter(nagged)
    for (let i = 0; i < c.length; i++) {
      let j = i
      while (j + 1 < c.length && c[j + 1].start - c[i].start < 120 * 60e3) j++
      const run = c.slice(i, j + 1)
      if (run.length >= 3) {
        const last = run.at(-1)
        run.forEach(t => inStreak.add(t))
        const base = { n: run.length }
        const { text, v } = tell('streak', last.key + last.start, [...variants(last, last.start, base, { said: first(last) }), ...variants(last, last.start, base)])
        add('streak', last.start, text, { turn: last, src: 'streak' + run[0].start, card: cardOf(v), sources: run.map(t => t.text) })
        // 说了几回之后，主人终于说行了
        const idx = ts.indexOf(last)
        const ok = ts.slice(idx + 1, idx + 6).find(t => PASS.test(first(t)) && len(first(t)) <= 14 && !/[?？]/.test(first(t)) && t.start - last.start < 120 * 60e3)
        if (ok) {
          const r = tell('passafter', ok.key + ok.start, variants(ok, ok.start, base, { said: first(ok) }, {}, { said: shortQuote }))
          add('passafter', ok.start, r.text, { turn: ok, src: 'passafter' + ok.start, card: cardOf(r.v) })
        }
        i = j
      }
    }
  }

  for (const tr of real) {
    const ask = first(tr)
    const seed = tr.key + tr.start
    const hour = new Date(tr.start).getHours()

    // 被抓包：这一轮最后几段话里有一句「好了 / 已经改了」，主人下一句就是「还是不行」之类
    let claim = null
    for (const tx of tr.texts.slice(-3).reverse()) { claim = sentenceWith(tx, DONE, 40); if (claim) { claim = claim.replace(/^[-*#>\s]+/, ''); if (cjk(claim) < 2) { claim = null; continue }; break } }
    const nextFirst = (tr.next || '').split('\n')[0].trim()
    if (claim && isHuman(tr.next) && !FILLER.test(nextFirst) && BACKFIRE.test(nextFirst) && NOT_DONE.test(nextFirst) && len(nextFirst) >= 2 && len(nextFirst) <= 60) {
      const vs = [...variants(tr, tr.start, {}, { next: nextFirst, claim }).filter(v => len(v.claim) <= 8), ...variants(tr, tr.start, {}, { next: nextFirst })]
      const { text, v } = tell('caught', seed, vs.filter(v => NOT_DONE.test(v.next) && plain(v.next)))        // 截短以后还得看得出是在说没好
      add('caught', tr.start, text, { turn: tr, src: claim + ' ' + nextFirst, card: cardOf(v) })
      if (text) caughtNext.add(tr.next)
    }

    // 被喊停：那句话离开当时也看得懂才引，否则只说被按停了
    if (tr.interrupted && tr.active >= 60e3 && isHuman(tr.next) && !FILLER.test(tr.next.trim()) && len(tr.next) >= 3 && len(tr.next) <= 40) {
      // 说法跟着干了多久变：十分钟以内「才干了…」，半小时以上「干了好久…」
      const mins = tr.active / 60e3, len2 = mins < 10 ? 'short' : mins >= 30 ? 'long' : 'mid'
      const base = { [len2 === 'short' ? 'few' : len2 === 'long' ? 'long' : 'dur']: dur(tr.active), len: len2 }
      const withQuote = tell('stopped', seed, variants(tr, tr.start, base, { next: tr.next }))
      if (withQuote.text) add('stopped', tr.start, withQuote.text, { turn: tr, src: tr.next, card: cardOf(withQuote.v) })
      else if (tr.active >= 5 * 60e3) { const { text, v } = tell('halt', seed, variants(tr, tr.start, base)); add('halt', tr.start, text, { turn: tr, src: 'halt' + tr.start, card: cardOf(v) }) }
    }

    // 主人的一句话：只回问号 / 带脏话 / 不满意 / 认可
    if (isHuman(ask) && !caughtNext.has(tr.text)) {
      const marks = /^[?？!！。.…\s]+$/.test(ask) ? (ask.match(/[?？]/g) || []).length : 0
      const cussed = CUSS.test(ask); CUSS.lastIndex = 0
      const praise = PASS.test(ask) && len(ask) <= 14 && !/[?？]/.test(ask)
      const own = OWN.test(ask) && (!/你/.test(ask) || /你(看看|继续|先)/.test(ask))
      if (marks >= 2) {
        const { text, v } = tell('marks', seed, variants(tr, tr.start, { n: marks }))
        add('marks', tr.start, text, { turn: tr, src: 'marks' + tr.start, card: cardOf(v) })
      } else if (praise) {
        const { text, v } = tell('pass', seed, variants(tr, tr.start, {}, { said: ask }, {}, { said: shortQuote }))
        add('pass', tr.start, text, { turn: tr, src: ask, card: cardOf(v) })
      } else if (cussed && len(ask) <= 40) {
        const { text, v } = tell('cuss', seed, variants(tr, tr.start, {}, { said: ask }))
        add('cuss', tr.start, text, { turn: tr, src: ask, card: cardOf(v) })
      } else if (COMPLAIN.test(ask) && len(ask) <= 40 && !own) {
        const { text, v } = tell('complain', seed, variants(tr, tr.start, {}, { said: ask }))
        add('complain', tr.start, text, { turn: tr, src: ask, card: cardOf(v) })
      }
    }

    // 认错：一句以认错开头的短话
    for (const tx of tr.texts) {
      const s = sentenceWith(tx, SORRY, 24)
      if (!s || !REAL_SORRY.test(s) || s.search(SORRY) > 2) continue
      const { text, v } = tell('sorry', seed + s, variants(tr, tr.start, {}, { said: s }, {}, { said: agentQuote }))
      add('sorry', tr.start, text, { turn: tr, src: s, card: cardOf(v) })
      break
    }

    // 干得久 / 话少活长 / 吃得多
    if (!tr.interrupted && isHuman(ask)) {
      const base = { dur: dur(tr.active), rice: rice(tr.tokens) }
      if (tr.active >= 20 * 60e3 && GO.test(ask) && quote(ask, 8) && tr.text.trim() === ask) {
        const { text, v } = tell('terse', seed, variants(tr, tr.start, base, { said: ask }, {}, { said: shortQuote }))
        add('terse', tr.start, text, { turn: tr, src: 'terse' + ask.replace(/[啊吧呀。！!\s]/g, ''), card: cardOf(v) })      // 同一句话（「继续」）只说最早那回
      } else if (tr.active >= 40 * 60e3) {
        const { text, v } = tell('long', seed, variants(tr, tr.start, tr.tokens >= 10 * RICE ? base : { dur: base.dur }))
        add('long', tr.start, text, { turn: tr, src: 'long' + tr.start, card: cardOf(v) })
      } else if (tr.tokens >= 20 * RICE) {
        const { text, v } = tell('eater', seed, variants(tr, tr.start, base))
        add('eater', tr.start, text, { turn: tr, src: 'eater' + tr.start, card: cardOf(v) })
      }
    }
  }

  // 按天算的：一晚上零点后派了几个活、一天认了几回错
  const byDay = {}
  for (const t of real) (byDay[dayKey(t.start)] ||= []).push(t)
  for (const [day, ts] of Object.entries(byDay)) {
    // 熬夜：一晚只说一条，说最晚的那一句；1:30 以前不算熬夜
    const night = ts.filter(t => new Date(t.start).getHours() < 5 && isHuman(first(t)))
    const last = night.at(-1)
    if (last && minuteOf(last.start) >= 90) {
      if (night.length >= 3) {
        const vs = tVars(last, last.start, now, { part: false, some: '有一晚' }).map(tv => ({ ...tv, n: night.length, clock: clock(last.start) }))
        const { text, v } = tell('night', day, vs)
        add('night', last.start, text, { turn: last, src: 'night' + day, card: cardOf(v) })
      } else {
        const o = { clock: true }, ask = first(last)
        const { text, v } = tell('late', day, [...variants(last, last.start, {}, { said: ask }, o), ...variants(last, last.start, {}, {}, o)])
        add('late', last.start, text, { turn: last, src: 'late' + day, card: v && { ...cardOf(v), clock: clock(last.start) } })
      }
    }
    const sorry = ts.filter(t => t.texts.some(tx => { const s = sentenceWith(tx, SORRY, 40); return s && s.search(SORRY) <= 2 }))
    if (sorry.length >= 3) {
      const last = sorry.at(-1)
      const { text, v } = tell('sorryday', day, tVars(last, last.start, now, { part: false, some: '有一天' }).map(tv => ({ ...tv, n: sorry.length })))
      add('sorryday', last.start, text, { turn: last, src: 'sorryday' + day, card: cardOf(v) })
    }
  }

  // ---- 总账 ----
  const span = days || Math.max(1, Math.ceil((now - Math.max(since, real[0]?.start ?? now)) / 864e5))
  const DATED = ['stat_first', 'stat_streak', 'stat_busiest', 'stat_latest']
  const stat = (event, ts, seed, v0, extra = {}) => {
    const v = DATED.includes(event) ? { ...v0, rel: relWord(ts, now, { part: false }), relday: relWord(ts, now, { part: false, some: '有一天' }) } : v0
    return add(event, ts, say(event, seed, v), { src: event + seed, card: { stat: event.slice(5), span: `${span} 天`, ...v, ...extra.card }, sources: extra.sources, turn: extra.turn })
  }
  const projects = {}
  for (const t of real) {
    const p = placeOf({ ...t, title: null, about: null })
    if (!p) continue
    const v = (projects[p] ||= { ms: 0, tok: 0, files: new Set(), days: new Set(), first: t })
    v.ms += t.active; v.tok += t.tokens; t.edited.forEach(f => v.files.add(f)); v.days.add(dayKey(t.start))
  }
  for (const [project, v] of Object.entries(projects)) {
    if (v.ms < 10 * 3600e3 || v.days.size < 3) continue
    stat('stat_project', now, project, { project, days: v.days.size, dur: dur(v.ms), files: v.files.size || null, span })
    // 第一天：项目是这段时间里才开的头（头两周就有的，可能更早就在弄，不敢说第一次）。只在整十天、整星期那天说天数
    const f = v.first
    if (f.start > since + 14 * 864e5 && daysAgo(f.start, now) >= 7 && !(priv.get(f) || []).length) {
      const n = daysAgo(f.start, now), said = isHuman(first(f)) ? quote(first(f), 12) : null
      stat('stat_first', f.start, project, { project, date: dateWord(f.start), said: null, n: n % 10 === 0 ? n : null, w: n % 10 && n % 7 === 0 ? n / 7 : null }, { turn: f })
    }
    // 连着几天
    const ds = [...v.days].sort()
    let best = [], run = []
    for (const d of ds) { run = run.length && Math.round((new Date(d) - new Date(run.at(-1))) / 864e5) === 1 ? [...run, d] : [d]; if (run.length > best.length) best = run }
    if (best.length >= 4) stat('stat_streak', new Date(best[0] + 'T12:00').getTime(), project, { project, n: best.length, date: dateWord(new Date(best[0] + 'T12:00').getTime()) })
  }
  const perDay = Object.entries(byDay).map(([d, ts]) => [d, ts.reduce((a, t) => a + t.active, 0)]).sort((a, b) => b[1] - a[1])
  if (perDay[0] && perDay[0][1] >= 2 * 3600e3) {
    const ts = new Date(perDay[0][0] + 'T12:00').getTime()
    stat('stat_busiest', ts, perDay[0][0], { date: dateWord(ts), dur: dur(perDay[0][1]), span })
  }
  const cont = real.filter(t => /^(继续|接着)/.test(first(t)) && len(first(t)) <= 6)
  if (cont.length >= 5) stat('stat_continue', cont.at(-1).start, 'c' + cont.length, { n: cont.length, span }, { sources: ['继续'] })
  const nights = real.filter(t => new Date(t.start).getHours() < 5 && isHuman(first(t)))
  const latest = [...nights].sort((a, b) => (new Date(b.start).getHours() * 60 + new Date(b.start).getMinutes()) - (new Date(a.start).getHours() * 60 + new Date(a.start).getMinutes()))[0]
  if (latest && daysAgo(latest.start, now) >= 3) stat('stat_latest', latest.start, 'latest', { date: dateWord(latest.start), clock: clock(latest.start), span })
  const nightDays = new Set(nights.map(t => dayKey(t.start))).size
  if (nightDays >= 3) stat('stat_nights', now, 'nights', { n: nightDays, span })
  const count = ev => moments.filter(m => m.event === ev).length
  const nCaught = count('caught'), nSorry = real.filter(t => t.texts.some(tx => SORRY.test(tx))).length, nNag = real.filter(nagged).length
  if (nCaught >= 3) stat('stat_caught', now, 'caught', { n: nCaught, span })
  if (nNag > nSorry && nSorry >= 1) stat('stat_owe', now, 'owe', { n: nNag, m: nSorry, k: nNag - nSorry, span })
  const bowlsAll = Math.round(real.reduce((a, t) => a + t.tokens, 0) / RICE)
  if (bowlsAll >= 10) stat('stat_rice', now, 'rice', { n: bowlsAll, span })
  if (Object.keys(byDay).length >= 5 && days) stat('stat_days', now, 'days', { n: Object.keys(byDay).length, span })
  const asks = real.filter(t => isHuman(first(t)) && !FILLER.test(first(t))).length
  if (asks >= 20) stat('stat_asks', now, 'asks', { n: asks, span })
  const nStop = real.filter(t => t.interrupted && t.active >= 60e3).length
  if (nStop >= 5) stat('stat_stops', now, 'stops', { n: nStop, span })
  const nPass = real.filter(t => PASS.test(first(t)) && len(first(t)) <= 14 && !/[?？]/.test(first(t))).length
  if (nPass >= 1 && nNag >= nPass * 3) stat('stat_passnag', now, 'passnag', { n: nNag, m: nPass, span })
  const nCuss = real.filter(t => { const c = isHuman(first(t)) && CUSS.test(first(t)); CUSS.lastIndex = 0; return c }).length
  if (nCuss >= 3) stat('stat_cuss', now, 'cuss', { n: nCuss, span })
  const nShort = real.filter(t => isHuman(first(t)) && t.text.trim() === first(t) && len(first(t)) <= 4).length
  if (nShort >= 10) stat('stat_short', now, 'short', { n: nShort, span })
  if (nightDays >= 3 && days) stat('stat_owl', now, 'owl', { n: Object.keys(byDay).length, m: nightDays, span })
  // 上周 / 上个月 / 两三个月前的今天
  const today = new Date(now)
  for (const [label, back] of [['上周的今天', d => d.setDate(d.getDate() - 7)], ['上个月的今天', d => d.setMonth(d.getMonth() - 1)], ['两个月前的今天', d => d.setMonth(d.getMonth() - 2)], ['三个月前的今天', d => d.setMonth(d.getMonth() - 3)]]) {
    const d = new Date(now); back(d)
    if (label !== '上周的今天' && d.getDate() !== today.getDate()) continue       // 31 号往回数没有 31 号的月份
    const ts = (byDay[dayKey(d.getTime())] || []).filter(t => !(priv.get(t) || []).length)
    const per = {}
    for (const t of ts) { const p = placeOf({ ...t, title: null, about: null }); if (p) per[p] = (per[p] || 0) + t.active }
    const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] >= 3 * 3600e3) stat('stat_today', d.getTime(), label, { t: label, project: top[0], dur: dur(top[1]) })
  }

  // 同一天最多留两件（总账不算），先留有看头的
  const perDayKept = {}
  const kept = new Set([...moments].sort((a, b) => RANK.indexOf(a.event) - RANK.indexOf(b.event)).filter(m => m.kind === 'stat' || (perDayKept[m.day + !!m.sensitive.length] = (perDayKept[m.day + !!m.sensitive.length] || 0) + 1) <= 2))   // 私事单算：默认不说的不占名额
  const seen = new Set()
  const capped = {}
  return moments.filter(m => kept.has(m) && !seen.has(m.text) && seen.add(m.text)).sort((a, b) => b.ts - a.ts)
    .filter(m => (capped[m.event] = (capped[m.event] || 0) + 1) <= (CAP[m.event] || 100))
}
