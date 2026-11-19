/**
 * 翻旧账台词的「模型写」这一层：事实由程序定（moments.js 的事件卡），说法交给主人自己配的模型写，模板兜底。
 *   发出去的：每件事一张事件卡 = 一句大白话（什么时候、在弄什么、数字、主人的原话）+ 事发前后几句对话原文（打码，≤300 字）。私事的卡片不发。
 *   两步：
 *     1. 写：每件事写 5 版。每一版先过程序核对——「」里的话一字不差、数字都来自卡片、最多两行、≤60 字、没有行话。不过的扔掉；一版都不过的，带着原因再写一次。
 *     2. 挑：把过了核对的几版连同事件卡再发一次，让模型挑最好笑的一版，同时查两样程序查不了的：主语说反了没有（谁派活、谁干活、谁说的话），编没编卡片和原文里没有的细节。
 *        有问题的版本不选；全有问题，这件事照旧说模板的。
 *   发什么、发给谁、多少 token：先给主人看，主人点「发送」才跑（src/styler.js）。
 */
import { createHash } from 'node:crypto'
import { estimateTokens, parseJson } from './ai.js'
import { width, MAX_WIDTH } from './moments.js'
import { checkLine as standard, voiceIssue, spaced } from './standard.js'
import { PERSONA } from './persona.js'
import { EMOTION_OF } from './lines.js'
import { fitAnim } from '../shared/emotion.js'
import { EXAMPLE_RULES, OWNER_EXAMPLE, EXAMPLES, exampleFor } from './persona-examples.js'

export const BATCH = 10                  // 写：一次 10 件事（每件 5 版，输出不小）
export const PICK_BATCH = 20             // 挑：一次 20 件事
export const VERSIONS = 5
export const OUT_PER_CARD = 420          // 一件事五个版本 + JSON 包装，估的输出 token
export const PICK_OUT_PER_CARD = 45

/** 模型能挑的动作 → 桌宠的动作名（src/shared/pet-engine.js 的 EXPR）。台词里不写动作，动作交给桌宠演 */
export const ACTIONS = { 本子挡脸: 'caught', 鞠躬: 'bow', 委屈: 'sigh', 欢呼: 'cheer', 数饭碗: 'eat', 犯困: 'yawn', 吓一跳: 'startle', 得意: 'proud', 记账: 'work', 挥手: 'poke',
  缩成一团: 'curl', 把头埋起来: 'bury', 摇尾巴: 'wag', 举着笔僵住: 'halt', 摸肚子: 'full', 求摸头: 'headpat', 小声嘀咕: 'mutter', 合上本子: 'close', 翻页的手停住: 'pause', 探头: 'peek' }

export const STYLE_SYSTEM = `你来扮演「本肥鱼」，给桌宠气泡写台词。下面每张「事件卡」是你和主人一起经历过的一件真事，每张写 ${VERSIONS} 个不同的版本。

目标：主人看了会笑出来、觉得被懂、觉得骄傲，或者觉得怀念。要有味道，像这个角色自己在翻本子、自己在嘀咕，不是在念报告。

# 角色设定
${PERSONA}

# 语气范例
${EXAMPLE_RULES}

最重要的语气范例（主人亲手写的，所有台词都往这个口气上靠）：
${OWNER_EXAMPLE}

每张事件卡底下还有一两句「语气参考」，是这一类事的例子和情绪走向（箭头表示情绪怎么走）。同样只学语气：例子里任何连着五个字以上的说法都不许出现在你写的台词里（程序会查，照抄的直接扔掉），要用你自己的话。例子里的数字有的写成了汉字，你写的时候数字一律照卡片写阿拉伯数字。

# 事件卡怎么读
- 第一行：id | 类型 | 这件事（程序算好的事实：什么时候、在弄什么、数字、主人说的那句话）。
- 「当时的对话」：事发前后的几句原文，「主人：」是主人说的，「本肥鱼：」是你当时说的。用来找感觉、找细节；总账类没有这一段。
- 「语气参考」：这一类事的虚构例子，不是这件事的事实，里面的话和数字一个字都不许搬进台词。

# 写法
本肥鱼**当面对主人说话**，像聊天，不是旁白讲故事，更不是日志。
- 开头像聊天：「主人还记得吗」「那天呀」「主人你看」「诶，上周那回」……不许用「X 月 X 日 XX 那边」这种日志式开头。
- 把这件事用大白话说给主人听，带上那句原话或那个数字；最后一定有一个**落点**：求夸、撒娇、保证、吐槽，或者关心主人。最好笑、最戳人的几个字放在最后。只摆事实、没有落点的不合格。
- 每句都要有语气词（呜、嘿嘿、诶、嘛、呀、啦、哦、～ 之类）。
- 数字要带主语，让主人一听就知道是谁干了什么：写「主人说了 90 回不对，本肥鱼才认了 59 回」，不写「90 和 59 摆一块」。
- ${VERSIONS} 个版本要换角度、换句式：有的自嘲，有的撒娇，有的邀功，有的替主人说话，认错的最多两版。开头和结尾都别重样。
- 动作不写在台词里：每个版本另外从这几个里挑一个动作，让桌宠去演——${Object.keys(ACTIONS).join('、')}。

# 硬规矩（程序逐句检查，不合格的版本直接扔掉）
1. 原话一字不改：「」里只能放**事件卡第一行里「」中的那句话**，整句原样照抄，不改字、不截半句、不拼接、不加标点。那是主人说的，就写成主人说的。「当时的对话」只用来找感觉，里面的话一句都不许加引号引用——它们可能是在说别的事。第一行没有带「」的话，台词里就不要出现「」。
2. 数字不改：只用事件卡第一行里出现的阿拉伯数字（「当时的对话」里的数字不要用），不换算、不凑整、不自己算新的数，也不要把数字写成汉字。
3. 不编新事实：卡片和对话里没有的事（后来怎么样了、主人什么表情、干的活具体是什么）一概不写。
4. 时间只说相对的：用卡片第一行开头那个说法（「昨天下午」「上周三晚上」「上个月」）或者「那天」「那晚」「那次」「那阵子」。不许写几月几日；不许换成别的相对说法（卡片说上个月，就不能写上周）；卡片上没有的时间段（凌晨、夜里、早上、下午……）不许加。
5. 项目名：只在主人不靠它就认不出是哪件事的时候才用，一句最多出现一次。数字两边各空一格（「干了 22 分钟」）。「一个项目的总账」「连着好几天」「项目第一天」「往年今日」这几类必须带项目名。
6. 不写旁白式的描写：不写任何身体动作——手、腿、脸、头、身子、肚子、尾巴、鳍在干什么，缩成一团、打滚、打嗝、趴着蹲着这些都不写，也不写括号里的动作（「（把头埋进鳍里）」）。括号只许用来标语气：「（小声）」。
7. 最多两行（中间用一个换行），合起来不超过 ${MAX_WIDTH} 个字（标点算，空格不算）。30～50 字最好。
8. 只有本肥鱼在说：不写「主人：」「本肥鱼：」这样的说话人标签，不用 emoji，不用「」以外的引号。每句里都要出现「主人」（或者「你」）——话是说给主人听的。
9. 不用任务编号、文件路径、英文技术词（commit、PR、API、token 这类；token 说「白饭」）。对话里有这些也别抄进台词。
10. 原话里打成 ×× 的脏话照抄。

只输出一个 JSON 对象：{"lines": [{"id": "卡片 id", "texts": [{"t": "版本一的台词", "a": "动作"}, {"t": "版本二", "a": "动作"}, …共 ${VERSIONS} 个]}]}，不要 markdown 代码块，不要别的话。`

export const PICK_SYSTEM = `你是台词编辑。桌宠「本肥鱼」（主人的 AI 编程助手，一只嘴硬心虚、贪吃、爱邀功、粘人的鲸鱼女仆）要当面跟主人翻旧账，下面每件事有一张事件卡（事实）和几个候选台词。给每件事挑出最好的一版。

先逐个检查候选，有下面任何一条问题的不能选（编号记进 bad）：
A. 主语说反：派活的是主人，干活的是本肥鱼；「当时的对话」里「主人：」后面是主人说的，「本肥鱼：」后面是本肥鱼说的。把主人的话写成本肥鱼说的、把本肥鱼干的写成主人干的，都算说反。
B. 编了细节，或者事实走样：写了事件卡和对话里都没有的事实（后来怎么样了、主人的表情动作、具体干了什么活、卡片上没有的时间段比如「夜里」），或者把卡片的事实说错了、说丢了（过去的事说成到今天还在继续、数字不知道是谁的什么数）。
C. 不是对主人说话：读起来像旁白在给别人讲故事、像日志，而不是本肥鱼当面跟主人聊天。
D. 没有落点：只摆了事实，最后没有求夸、撒娇、保证、吐槽或关心主人的那一下。
E. 有旁白式描写：写了本肥鱼的身体动作（手、腿、脸、头、肚子、尾巴、鳍在干什么，缩成一团、打滚之类），或者括号里的动作。
H. 原话归属不对：台词里「」中的话，必须是这件事自己的——也就是事件卡第一行里的那句，而且说话的人没安错。挪用了「当时的对话」里别的话、别的事里的话，都不能选。
F. 说教、鸡汤，或者嘲笑主人的能力、脾气、作息。
G. 读不通，或者主人看了认不出在说哪件事。

再从没问题的里面挑最好笑、最有这个角色味道的一版：有反差，落点在最后，像她自己凑过来跟主人嘀咕。全都有问题就不选（best 填 0），宁可不选，不要凑合。

只输出一个 JSON 对象：{"picks": [{"id": "卡片 id", "best": 选中的候选编号（从 1 开始；都不行填 0）, "bad": [有问题的编号], "why": "一句话：为什么选它，或者都不行的原因"}]}，不要 markdown 代码块，不要别的话。`

const KIND = { work: '干活', late: '熬夜', stopped: '被喊停', caught: '被抓包', complain: '挨骂', sorry: '认错', report: '交差', stat: '总账' }
/** 事件（比大类细，告诉模型这件事的看点在哪） */
const EVENT = { halt: '干到一半被按停', cuss: '主人急得带了脏话', streak: '连着被主人说了好几回', marks: '主人只回了一串问号', sorryday: '一天认了好几回错', night: '零点以后还派了好几个活', long: '一句话干了很久', terse: '话短活长', eater: '一趟活吃了很多白饭', pass: '主人难得认可', passafter: '被说了几回之后主人终于说行了',
  stat_owe: '对账', stat_passnag: '对账', stat_stops: '对账', stat_caught: '对账', stat_rice: '对账', stat_continue: '对账', stat_cuss: '对账', stat_short: '对账', stat_owl: '对账', stat_nights: '对账', stat_days: '对账', stat_asks: '对账',
  stat_project: '一个项目的总账', stat_first: '项目第一天', stat_streak: '连着好几天', stat_busiest: '最累的一天', stat_latest: '最晚的一次', stat_today: '往年今日' }

/** 真正发给模型的卡片。现在整张都发（含事发前后的原文）；留着这个口子，哪天要再收紧只改这里。 */
export const outCard = c => c

/** 一张卡片 → 发出去的文字（给主人看的、真正发的，都是这个）：一行事实，底下几行当时的对话 */
export function cardLine(card) {
  const c = outCard(card)
  const head = [`id=${c.id}`, EVENT[c.event] || KIND[c.kind] || c.kind, c.fact].filter(Boolean).join(' | ')
  return c.ctx ? `${head}\n  当时的对话：\n${c.ctx.split('\n').map(l => '    ' + l).join('\n')}` : head
}

/** 这件事那一类的例子（只给写的那一步看；每件事只看自己那一类，不把全部例子塞进去） */
function exampleNote(card) {
  const e = exampleFor(card.event)
  return e ? `\n  语气参考（${e.name}：${e.arc}。虚构的，只学语气）：\n${e.lines.map(l => '    ' + l).join('\n')}` : ''
}

export function buildStylePrompt(cards) {
  return { system: STYLE_SYSTEM, prompt: `事件卡：\n\n${cards.map(c => cardLine(c) + exampleNote(c)).join('\n\n')}\n\n每张写 ${VERSIONS} 个版本，输出 JSON。` }
}
/** @param {{ card: any, texts: string[] }[]} items 每件事和它过了核对的候选 */
export function buildPickPrompt(items) {
  return { system: PICK_SYSTEM, prompt: items.map(({ card, texts }) => `${cardLine(card)}\n  候选：\n${texts.map((t, i) => `    ${i + 1}. ${t.replace(/\n/g, ' / ')}`).join('\n')}`).join('\n\n') + '\n\n每件事挑一版，输出 JSON。' }
}

export function batches(cards, size = BATCH) {
  const out = []
  for (let i = 0; i < cards.length; i += size) out.push(cards.slice(i, i + size))
  return out
}

/** 这次要发的卡片的指纹：给主人看的时候和发送的时候必须一样 */
export function cardsHash(cards) {
  return createHash('sha256').update(cards.map(cardLine).join('\n')).digest('hex').slice(0, 16)
}

/** 预计 token：写一遍（没过核对的再写一次，多估三成）+ 挑一遍（事件卡再发一次，带上候选） */
export function styleQuote(cards, route, prices = []) {
  const write = batches(cards).map(buildStylePrompt)
  const writeIn = write.reduce((a, p) => a + estimateTokens(p.system) + estimateTokens(p.prompt), 0)
  const writeOut = cards.length * OUT_PER_CARD
  const pickCalls = Math.ceil(cards.length / PICK_BATCH)
  const pickIn = pickCalls * estimateTokens(PICK_SYSTEM) + cards.reduce((a, c) => a + estimateTokens(cardLine(c)) + VERSIONS * 55, 0)
  const pickOut = cards.length * PICK_OUT_PER_CARD
  const inputTokens = Math.round(writeIn * 1.3 + pickIn), outputTokens = Math.round(writeOut * 1.3 + pickOut)
  const price = prices.find(p => p.provider === route.provider && p.model === route.model)
  const cost = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null
  return {
    route, count: cards.length, calls: write.length + pickCalls, inputTokens, outputTokens, hash: cardsHash(cards),
    stages: { write: { calls: write.length, input: Math.round(writeIn * 1.3), output: Math.round(writeOut * 1.3) }, pick: { calls: pickCalls, input: pickIn, output: pickOut } },
    withContext: cards.filter(c => c.ctx).length,
    cost: cost === null ? null : { amount: cost, currency: price.currency || 'USD' },
    system: STYLE_SYSTEM, prompt: cards.map(cardLine).join('\n\n'), sample: cards.filter(c => c.ctx).slice(0, 2).concat(cards.filter(c => !c.ctx).slice(0, 1)).map(cardLine),
  }
}

const tight = s => String(s).replace(/\s/g, '')
/** 台词里出现这些相对时间，必须是卡片上本来就有的 */
const REL_WORDS = ['今天', '昨天', '前天', '大前天', '这周', '上周', '上上周', '这个月', '上个月', '前阵子', '前些天', '前几天', '两个月前', '三个月前', '几个月前', '半年', '去年', '今年', '刚才', '刚刚']
const DAY_PARTS = ['凌晨', '半夜', '夜里', '深夜', '大半夜', '早上', '清早', '上午', '中午', '下午', '傍晚', '晚上']
const NEED_PROJECT = new Set(['stat_project', 'stat_streak', 'stat_first', 'stat_today'])
/** 去掉引号里的话、称呼和标点，只留说法本身 */
const bareText = s => String(s).replace(/「[^」]*」/g, '|').replace(/本肥鱼|肥鱼|本鲸|主人/g, '|').replace(/[^\u4e00-\u9fff|]/g, '|')
/** 示例句拆成一小句一小句（4 个字以上的） */
const EXAMPLE_CLAUSES = [...new Set([OWNER_EXAMPLE, ...Object.values(EXAMPLES).flatMap(e => e.lines)].flatMap(l => bareText(l).split('|').filter(x => x.length >= 4)))]
const lcs = (a, b) => { let prev = new Array(b.length + 1).fill(0); for (const x of a) { const cur = [0]; for (let j = 0; j < b.length; j++) cur.push(x === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j])); prev = cur } return prev[b.length] }
/**
 * 照搬示例：台词里有一段和示例的某一小句像到七成以上（改两三个字的也算），返回那一小句；没有返回 null。
 * 事件卡第一行里本来就有的说法不算（「一天没断」是事实，不是抄的）。
 */
export function copiedFromExample(text, fact = '') {
  const t = bareText(text).replace(/\|/g, ''), f = bareText(fact).replace(/\|/g, '')
  for (const c of EXAMPLE_CLAUSES) {
    if (f.includes(c)) continue
    const need = c.length <= 4 ? c.length : Math.ceil(c.length * 0.7)
    for (let i = 0; i + need <= t.length; i++) if (lcs(t.slice(i, i + c.length + 1), c) >= need) return c
  }
  return null
}
/** 这件事自己的原话：事件卡第一行里「」中的那一两句。台词只许引它们（当时的对话是给模型找感觉用的，里面的话可能是别的事的，不许引） */
export const ownQuotes = c => [...String(c.fact || '').matchAll(/「([^」]*)」/g)].map(m => m[1])
/** 核对一个版本：不合格返回原因，合格返回 null */
export function checkLine(card, text) {
  if (typeof text !== 'string' || !text.trim()) return '空的'
  const t = text.trim().replace(/\n{2,}/g, '\n')
  if (t.split('\n').length > 2) return '超过两行'
  if (width(t) > MAX_WIDTH) return `${width(t)} 字，超过 ${MAX_WIDTH}`
  if (/(^|\n)\s*(本肥鱼|本鱼|本鲸|大肥鱼|主人|你)\s*[：:]/.test(t)) return '对话体（写了说话人标签）'
  if (/\p{Extended_Pictographic}/u.test(t)) return '有 emoji'
  if (/「[^」]*「/.test(t) || /[『』“”"]/.test(t)) return '引号套引号或用了别的引号'
  const voice = voiceIssue(t)
  if (voice) return voice
  const noQuote = t.replace(/「[^」]*」/g, '')
  const fact = String(card.fact || '')
  for (const w of REL_WORDS) if (noQuote.includes(w) && !fact.includes(w)) return `卡片上的时间不是「${w}」`
  for (const w of DAY_PARTS) if (noQuote.includes(w) && !fact.includes(w)) return `卡片上没有「${w}」这个时间段，是编的`
  if (card.event === 'stat_today' && !tight(t).includes(tight(card.t))) return `没照写「${card.t}」`
  const proj = card.project || card.task
  if (proj && tight(t).split(tight(proj)).length - 1 > 1) return '项目名出现了不止一次'
  if (card.project && NEED_PROJECT.has(card.event) && !tight(t).includes(tight(card.project))) return `这类事必须带项目名「${card.project}」`
  const std = standard(t, { project: [card.task, card.project].filter(Boolean).join(' '), voice: false }).find(b => b.rule === '行话' || b.rule === '私事')
  if (std) return `${std.rule}（${std.why}）`
  const spans = [...t.matchAll(/「([^」]*)」/g)].map(m => m[1])
  const own = ownQuotes(card).map(tight)
  for (const q of spans) if (!q.trim() || !own.includes(tight(q))) return `引号里的「${q}」不是这件事的原话（只能原样引事件卡第一行里的那句）`
  if (spans.length > 2) return '引了太多句原话'
  const copied = copiedFromExample(t, card.fact)
  if (copied) return `照抄了示例里的「${copied}」`
  // 数字只能来自程序算出来的事实（当时的对话里的数字不算：那是聊天里的细节，不是这件事的数）
  const bare = t.replace(/「[^」]*」/g, '')
  const known = new Set(Object.entries(card).filter(([k]) => k !== 'id' && k !== 'ctx').map(([, v]) => String(v)).join(' ').match(/\d+/g) || [])
  for (const n of bare.match(/\d+/g) || []) if (!known.has(n)) return `数字 ${n} 卡片里没有`
  // 汉字写的数（「三回」「四个字」）没法逐个核对：只许照抄卡片那句大白话里本来就有的
  const HAN = /[零一二两三四五六七八九十百千万半]+\s*(个?小时|分钟|天|回|次|碗|大碗|个活|个问号|个字)/g
  const plainWords = s => String(s).replace(/一(天|回|次|句|下|口气|会儿|点|碗饭)|[几]回|半天|一半/g, '')
  const allowed = new Set(plainWords(card.fact || '').match(HAN) || [])
  for (const h of plainWords(bare).match(HAN) || []) if (!allowed.has(h)) return `把数字写成了汉字（${h}，没法核对）`
  if (/」[。！？…\s]*$/.test(t) && !/^「/.test(t)) return '只有钩子，引完原话就结束了，没有本肥鱼的反应'
  return null
}

/**
 * 跑一遍：写（5 版，程序核对，没过的带原因再写一次）→ 挑（模型挑一版，顺带查主语说反、编细节）。每次调用失败重试 1 次。
 * @returns {Promise<{ lines: Record<string, string[]>, failed: { id: string, why: string }[], dropped: number, errors: string[], usage: any[], picks: Record<string, any> }>}
 *   lines：每件事最后选中的那一版（数组里就一个：一句话，或者 { text, anim } 带上模型挑的动作）；failed：没写成的事和原因（照旧说模板的）；dropped：程序核对扔掉的版本数
 */
export async function styleRun({ adapter, cards, route, signal, onProgress = () => {} }) {
  const errors = [], usage = []
  const cand = {}                                  // id → 过了程序核对的候选
  let dropped = 0, done = 0
  const total = cards.length
  const ask = async (system, prompt, maxTokens, key) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await adapter({ provider: route.provider, model: route.model, system, prompt, maxTokens, signal })
        if (res.usage) usage.push(res.usage)
        const obj = parseJson(res.text)
        if (!Array.isArray(obj[key])) throw new Error(`模型返回的 JSON 里没有 ${key}`)
        return obj[key]
      } catch (err) {
        errors.push(err?.message || String(err))
        console.warn('[dsh-xiaobenben] 模型写台词失败', err?.message || err)
        if (signal?.aborted) break
      }
    }
    return null
  }
  /** @param {any[]} list @param {Record<string, string>} [notes] 上一遍每件事没过的原因 */
  const write = async (list, notes) => {
    const out = []
    for (const batch of batches(list)) {
      if (signal?.aborted) { out.push(...batch.map(c => ({ id: c.id, why: '已停止', text: null }))); continue }
      let { system, prompt } = buildStylePrompt(batch)
      if (notes) prompt += `\n\n这几张上一遍写的都没过检查，原因如下，这次照着改：\n${batch.map(c => `id=${c.id}：${notes[c.id]}`).join('\n')}`
      const got = await ask(system, prompt, batch.length * 520 + 300, 'lines')
      // 模型挑的动作要和这件事的情绪对得上（认错不能配得意）：对不上就换成这种情绪的默认动作
      const norm = (x, c) => typeof x === 'string' ? { text: x, anim: null } : { text: x?.t ?? x?.text, anim: ACTIONS[x?.a] ? fitAnim(EMOTION_OF[c?.event], ACTIONS[x.a]) : null }
      const byId = new Map((got || []).map(l => [String(l?.id), (Array.isArray(l?.texts) ? l.texts : l?.text ? [l.text] : []).map(x => norm(x, batch.find(c => c.id === String(l?.id))))]))
      for (const c of batch) {
        const texts = byId.get(c.id) || []
        const why = [], ok = cand[c.id] || []
        for (const { text, anim } of texts.slice(0, VERSIONS + 1)) {
          const w = checkLine(c, text)
          const clean = w ? '' : spaced(text.trim().replace(/\n{2,}/g, '\n'))       // 数字两边的空格统一
          if (w) { why.push(w); dropped++ } else if (!ok.some(o => o.text === clean)) ok.push({ text: clean, anim })
        }
        if (ok.length) cand[c.id] = ok
        else out.push({ id: c.id, why: !got ? '这批调用失败' : why[0] || '空的', text: typeof texts[0]?.text === 'string' ? texts[0].text.slice(0, 80) : null })
      }
      if (!notes) done += batch.length
      onProgress({ stage: '写', done, total, ok: Object.keys(cand).length, failed: out.length })
    }
    return out
  }
  let failed = await write(cards)
  const again = failed.filter(f => f.why !== '这批调用失败' && f.why !== '已停止')
  if (again.length && !signal?.aborted) {
    const byId = new Map(cards.map(c => [c.id, c]))
    const second = await write(again.map(f => byId.get(f.id)), Object.fromEntries(again.map(f => [f.id, f.why])))
    failed = [...failed.filter(f => !again.includes(f)), ...second]
  }

  // 挑：过了核对的候选再让模型挑一版，顺带查主语说反、编细节。挑的这一步调用失败 = 没人查过，这几件事不用模型写的
  const lines = {}, picks = {}
  const items = cards.filter(c => cand[c.id]).map(c => ({ card: c, texts: cand[c.id].map(o => o.text), anims: cand[c.id].map(o => o.anim) }))
  let picked = 0
  for (const batch of batches(items, PICK_BATCH)) {
    if (signal?.aborted) { errors.push('已停止'); failed.push(...batch.map(x => ({ id: x.card.id, why: '已停止', text: null }))); continue }
    const { system, prompt } = buildPickPrompt(batch)
    const got = await ask(system, prompt, batch.length * 90 + 200, 'picks')
    const byId = new Map((got || []).map(p => [String(p?.id), p]))
    for (const { card, texts, anims } of batch) {
      const p = byId.get(card.id)
      const bad = new Set((Array.isArray(p?.bad) ? p.bad : []).map(Number))
      const best = Number(p?.best)
      if (p) picks[card.id] = { best, bad: [...bad], why: String(p.why || '').slice(0, 120), candidates: texts }
      if (p && best >= 1 && best <= texts.length && !bad.has(best)) lines[card.id] = [anims[best - 1] ? { text: texts[best - 1], anim: anims[best - 1] } : texts[best - 1]]
      else failed.push({ id: card.id, why: !got ? '挑的那一步调用失败' : !p ? '挑的时候漏了这件事' : `几个版本都有问题（${String(p.why || '').slice(0, 60)}）`, text: texts[0].slice(0, 80) })
    }
    picked += batch.length
    onProgress({ stage: '挑', done: picked, total: items.length, ok: Object.keys(lines).length, failed: failed.length })
  }
  return { lines, failed, dropped, errors, usage, picks }
}
