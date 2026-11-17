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
import { TPL } from './lines.js'
import crypto from 'node:crypto'
import { redact } from './redact.js'
import { sensitiveCats } from './sensitive.js'

export const INJECTED = ['<', '[Request interrupted', 'Another Claude session sent a message', 'This session is being continued',
  'Base directory for this skill', '# Workflow authoring reference', 'Continue from where you left off', 'Caveat: The messages below']
export const FILLER = /^(继续|继续吧|接着|接着来|ok|okay|好|好的|行|可以|嗯|对|是|yes|go|continue|嗯嗯|好滴|没事|随便|你看着办|你决定|都行)[\s。.!！~～（(）)…]*$/i
const COMPLAIN = /(不对|错了|又错|又是|你又|搞什么|什么鬼|还是报错|还是不行|还是不对|没用(啊|的|了|吧|[。！!？?]|$)|有什么用|乱改|别乱|不是这样|离谱|难绷|无语|哪来的|你在干嘛|干嘛呢|为什么又|怎么又|怎么还|不是让你|我不是说|白屏|挂了|崩了|\?\?|？？)/
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
  return { key, title, project, start, end: start, last: start, active: 0, text, next: null, tokens: 0, tools: 0, commands: 0, reads: 0, agents: 0, edited: new Set(), texts: [], interrupted: false }
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
  let title = null, cur = null, project = null
  const seenMsg = new Set()
  const close = () => { if (cur) turns.push(cur); cur = null }
  for (const line of lines) {
    if (!line) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'ai-title' && o.aiTitle) { title = o.aiTitle; continue }
    if (o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) continue
    const t = Date.parse(o.timestamp); if (!t) continue
    if (o.cwd) project = home && o.cwd === home ? '主目录' : base(o.cwd)
    const c = o.message?.content
    if (o.type === 'user') {
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : ''
      const isResult = Array.isArray(c) && c.some(b => b?.type === 'tool_result')
      const s = text.trim()
      if (s.startsWith('[Request interrupted')) { if (cur) { cur.interrupted = true; cur.end = t } continue }
      if (isResult || !s || INJECTED.some(p => s.startsWith(p))) { if (cur) markTurn(cur, t); continue }
      if (cur) { cur.next = s; close() } else if (turns.length) turns.at(-1).next ??= s
      cur = newTurn({ key, title, project, start: t, text: s })
      continue
    }
    if (!cur) continue
    markTurn(cur, t)
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
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(n) && b.input?.file_path) cur.edited.add(base(b.input.file_path))
      if (n === 'Bash') cur.commands++
      if (n === 'Read') cur.reads++
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
      if (DSH_EDIT.has(n) && file) cur.edited.add(base(file))
      if (DSH_SHELL.has(n)) cur.commands++
      if (n === 'read') cur.reads++
      if (n.startsWith('subagent')) cur.agents++
    } else if (e.type === 'turn/end') {
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
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日${part} ${h > 12 ? h - 12 : h}:${pad(d.getMinutes())}`
}
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
function short(s, max = 22) { const t = clean(s.split('\n')[0]); return len(t) > max ? [...t].slice(0, max).join('') + '…' : t }
const unq = s => s && s.replace(/[。.!！；;，,]+$/u, '')
function sentenceWith(text, re, max = 36) {
  for (const s of clean(text).split(/(?<=[。！？!?\n])|(?<=\.)\s/)) {
    const t = s.trim()
    if (re.test(t) && /[一-鿿]/.test(t) && len(t) <= max && len(t) >= 4) return unq(t)
  }
  return null
}
/** 填模板：{w} {task} {dur} {doing} {rice} {next} {claim} {said} {project} {days} {files} {n} {span} {date}。缺的变量填空串（只会是可选的）。 */
export function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
    .replace(/(\d) +(?=小半碗)/g, '$1').replace(/ +(?=小半碗)/g, '')     // 「吃了 小半碗」→「吃了小半碗」
    .replace(/(^|[，。！？「（\n])，/g, '$1')                         // {doing} 为空 / 接在标点后
    .replace(/(分钟|小时|碗) +(?=[\u4e00-\u9fff（「])/g, '$1')                  // 「干了 2 分钟 才说」→「干了 2 分钟才说」
    .replace(/ {2,}/g, ' ')
}
const rice = tokens => bowls(tokens).trim()
const pick = (arr, seed) => arr[parseInt(crypto.createHash('md5').update(String(seed)).digest('hex').slice(0, 8), 16) % arr.length]
function task(tr) {
  const first = tr.text.split('\n')[0].trim()
  if (!FILLER.test(first) && len(first) >= 6 && len(first) <= 50 && ASK.test(first)) return `「${short(first)}」`
  if (tr.title) return `「${short(tr.title, 20)}」那摊事`
  return null
}
const isHuman = s => s && !INJECTED.some(p => s.startsWith(p))

const CAP = { work: 400, late: 150, report: 200, sorry: 150, complain: 150, caught: 100, stopped: 150, stat: 50 }

/**
 * @param {ReturnType<typeof newTurn>[]} turns
 * @param {{ since?: number, now?: number, days?: number, me?: string }} [opts]  me：本肥鱼的自称（默认「本肥鱼」）
 * @returns {{ kind: string, ts: number, day: string, hour: number, text: string, anim: string, sensitive: string[], agent?: string }[]}
 */
export function buildMoments(turns, { since = 0, now = Date.now(), days = null } = {}) {
  const moments = []
  const seenSrc = new Set()
  const add = (kind, ts, text, anim, src = '') => {
    // 同一件事只说一次：Claude Code 续上旧会话时会把前面的记录抄进新文件，同一轮会出现好几次（模板按种子挑，文字不同，光按文字去重拦不住）
    const key = kind + '|' + (src ? src.replace(/\s+/g, '').slice(0, 120) : text)
    if (kind !== 'stat' && seenSrc.has(key)) return
    seenSrc.add(key)
    moments.push({ kind, ts, day: dayKey(ts), hour: new Date(ts).getHours(), text, anim, sensitive: src ? sensitiveCats(src) : [] })
  }
  const real = turns.filter(t => t.start >= since)
  const caughtNext = new Set()

  for (const tr of real) {
    const tk = task(tr)
    const w = when(tr.start)
    const acts = [tr.edited.size && `改了 ${tr.edited.size} 个文件`, tr.commands && `跑了 ${tr.commands} 条命令`, tr.reads >= 10 && `翻了 ${tr.reads} 个文件`, tr.agents && `还喊了 ${tr.agents} 个帮手`].filter(Boolean)
    const doing = acts.length ? '，' + acts.join('、') : ''
    const seed = tr.key + tr.start
    const src = tr.text + ' ' + (tr.title || '')

    if (tk && tr.active >= 5 * 60e3 && !tr.interrupted) {
      const late = new Date(tr.start).getHours() < 5
      add(late ? 'late' : 'work', tr.start, fill(pick(late ? TPL.late : TPL.work, seed), { w, task: tk, dur: dur(tr.active), doing, rice: rice(tr.tokens) }), late ? 'yawn' : 'work', src)
    }

    if (tr.interrupted && tr.active >= 60e3 && isHuman(tr.next) && !FILLER.test(tr.next.trim()) && len(tr.next) >= 3 && len(tr.next) <= 40) {
      add('stopped', tr.end, fill(pick(TPL.stopped, seed), { w, dur: dur(tr.active), next: short(tr.next, 30) }), 'startle', tr.next)
    }

    const lastText = tr.texts.at(-1) || ''
    // 被抓包：这一轮最后几段话里有一句「好了 / 已经改了」，主人下一句就是「还是不行」之类
    let claim = null
    for (const tx of tr.texts.slice(-3).reverse()) { claim = sentenceWith(tx, DONE, 40); if (claim) { claim = claim.replace(/^[-*#>\s]+/, ''); break } }
    const nextFirst = (tr.next || '').split('\n')[0].trim()
    if (claim && isHuman(tr.next) && !FILLER.test(nextFirst) && BACKFIRE.test(nextFirst) && len(nextFirst) >= 2 && len(nextFirst) <= 60) {
      add('caught', tr.start, fill(pick(TPL.caught, seed), { w, claim, next: short(nextFirst, 30) }), 'caught', claim + ' ' + nextFirst)
      caughtNext.add(tr.next)
    }

    const first = tr.text.split('\n')[0].trim()
    if (COMPLAIN.test(first) && len(first) <= 40 && !caughtNext.has(tr.text)) {     // 已经当成「被抓包」说过的那句不再当挨骂说
      add('complain', tr.start, fill(pick(TPL.complain, seed), { w, said: unq(short(first, 30)) }), 'sigh', first)
    }

    for (const tx of tr.texts) {
      const s = sentenceWith(tx, SORRY, 40)
      if (!s) continue
      add('sorry', tr.start, fill(pick(TPL.sorry, seed + s), { w, said: s }), 'bow', s)
      break
    }

    if (tr.active >= 10 * 60e3 && !tr.interrupted) {
      const s = sentenceWith(lastText, /./, 40)
      if (s && !SORRY.test(s)) {
        add('report', tr.end, fill(pick(TPL.report, seed + 'r'), { w: when(tr.end), dur: dur(tr.active), said: s }), 'cheer', s)
      }
    }
  }

  // 总账
  const span = days ? `这 ${days} 天` : '这段时间'
  const fillers = real.filter(t => FILLER.test(t.text.split('\n')[0].trim()) && /继续|continue|接着/i.test(t.text))
  if (fillers.length >= 5) {
    add('stat', fillers.at(-1).start, fill(pick(TPL.stat_continue, fillers.length), { span, n: fillers.length, dur: dur(fillers.reduce((a, t) => a + t.active, 0)) }), 'eat')
  }
  const byProject = {}
  for (const t of real) {
    const p = t.project || '某个文件夹'
    const v = (byProject[p] ||= { ms: 0, tok: 0, files: new Set(), days: new Set() })
    v.ms += t.active; v.tok += t.tokens; t.edited.forEach(f => v.files.add(f)); v.days.add(dayKey(t.start))
  }
  for (const [p, v] of Object.entries(byProject)) {
    if (v.ms < 60 * 60e3) continue
    add('stat', now, fill(pick(TPL.stat_project, p), { project: p, dur: dur(v.ms), days: v.days.size, files: v.files.size, rice: rice(v.tok) }), 'file')
  }
  const longest = [...real].sort((a, b) => b.active - a.active)[0]
  if (longest && task(longest)) add('stat', longest.start, fill(pick(TPL.stat_longest, longest.key + longest.start), { w: when(longest.start), task: task(longest), dur: dur(longest.active), rice: rice(longest.tokens) }), 'eat', longest.text)
  const perDay = {}
  for (const t of real) perDay[dayKey(t.start)] = (perDay[dayKey(t.start)] || 0) + t.active
  const busiest = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0]
  if (busiest && busiest[1] >= 30 * 60e3) add('stat', new Date(busiest[0] + 'T12:00').getTime(), fill(pick(TPL.stat_busiest, busiest[0]), { date: `${+busiest[0].slice(5, 7)} 月 ${+busiest[0].slice(8)} 日`, dur: dur(busiest[1]) }), 'eat')

  const seen = new Set()
  const capped = {}
  return moments.filter(m => !seen.has(m.text) && seen.add(m.text)).sort((a, b) => b.ts - a.ts)
    .filter(m => (capped[m.kind] = (capped[m.kind] || 0) + 1) <= (CAP[m.kind] || 100))
}
