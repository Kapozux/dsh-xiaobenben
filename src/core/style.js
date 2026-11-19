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
import { width, MAX_WIDTH, phrases } from './moments.js'
import { checkLine as standard, voiceIssue, spaced, bubbleLines } from './standard.js'
import { PERSONA } from './persona.js'
import { EMOTION_OF, signature } from './lines.js'
import { poseBeats } from '../shared/emotion.js'
import { EXAMPLE_RULES, OWNER_EXAMPLE, EXAMPLES, exampleFor } from './persona-examples.js'

export const BATCH = 10                  // 写：一次 10 件事（每件 5 版，输出不小）
export const PICK_BATCH = 20             // 挑：一次 20 件事
export const VERSIONS = 5
export const OUT_PER_CARD = 520          // 一件事五个版本（每版一两拍）+ JSON 包装，估的输出 token
export const PICK_OUT_PER_CARD = 45
export const OPT_BATCH = 10             // 写回话：一次 10 件事
export const OPT_OUT_PER_CARD = 230      // 三个按钮 + 三句回话 + JSON 包装
export const OPTCHECK_OUT_PER_CARD = 20
export const LABEL_MAX = 6               // 按钮上主人的话最多几个字

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
- 动作不写在台词里：每一拍另外从这几个里挑一个动作，让桌宠去演——${Object.keys(ACTIONS).join('、')}。

# 硬规矩（程序逐句检查，不合格的版本直接扔掉）
1. 原话一字不改：「」里只能放**事件卡第一行里「」中的那句话**，整句原样照抄，不改字、不截半句、不拼接、不加标点。那是主人说的，就写成主人说的。「当时的对话」只用来找感觉，里面的话一句都不许加引号引用——它们可能是在说别的事。第一行没有带「」的话，台词里就不要出现「」。
2. 数字不改：只用事件卡第一行里出现的阿拉伯数字（「当时的对话」里的数字不要用），不换算、不凑整、不自己算新的数，也不要把数字写成汉字。
3. 不编新事实：卡片和对话里没有的事（后来怎么样了、主人什么表情、干的活具体是什么）一概不写。
4. 时间只说相对的：用卡片第一行开头那个说法（「昨天下午」「上周三晚上」「上个月」）或者「那天」「那晚」「那次」「那阵子」。不许写几月几日；不许换成别的相对说法（卡片说上个月，就不能写上周）；卡片上没有的时间段（凌晨、夜里、早上、下午……）不许加。
5. 项目名：只在主人不靠它就认不出是哪件事的时候才用，一句最多出现一次。数字两边各空一格（「干了 22 分钟」）。「一个项目的总账」「连着好几天」「项目第一天」「往年今日」这几类必须带项目名。
6. 不写旁白式的描写：不写任何身体动作——手、腿、脸、头、身子、肚子、尾巴、鳍在干什么，缩成一团、打滚、打嗝、趴着蹲着这些都不写，也不写括号里的动作（「（把头埋进鳍里）」）。括号只许用来标语气：「（小声）」。
7. 气泡里最多两行，一行约 27 个字（英文、数字算半个）：不换行的话整句不超过 50 个字；自己换一次行的话，每行不超过 26 个字。30～45 字最好，超了直接作废。
8. 只有本肥鱼在说：不写「主人：」「本肥鱼：」这样的说话人标签，不用 emoji，不用「」以外的引号。每句里都要出现「主人」（或者「你」）——话是说给主人听的。
9. 不用任务编号、文件路径、英文技术词（commit、PR、API、token 这类；token 说「白饭」）。对话里有这些也别抄进台词。
10. 原话里打成 ×× 的脏话照抄。

每个版本写成一到两拍（beats）：一拍是气泡里的一行，带一个动作。第一拍的姿势程序会按这件事的类型定（招牌姿势），你挑的动作只在第二拍、而且情绪真的转了（比如认错认到最后嘿嘿一笑）时才用。

只输出一个 JSON 对象：{"lines": [{"id": "卡片 id", "texts": [{"beats": [{"t": "第一行", "a": "动作"}, {"t": "第二行（可以没有）", "a": "动作"}]}, …共 ${VERSIONS} 个版本]}]}，不要 markdown 代码块，不要别的话。`

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

/** 第三步：给选中的台词写主人能回的话，和本肥鱼接的那一句 */
export const OPTIONS_SYSTEM = `你来扮演「本肥鱼」。桌宠气泡里，本肥鱼刚跟主人翻完一件旧账（下面每件事给了事件卡和她说的那句台词）。现在给每件事写 3 个按钮：主人看完这句台词可能回的话，以及主人点了以后本肥鱼接的一句。

# 角色设定
${PERSONA}

# 怎么写
- label：主人自己说的话，用主人的口吻，不超过 6 个字。主人不会管自己叫「主人」：写「付得值」，不写「主人付得值」；label 里不许出现「主人」「本肥鱼」。3 个按钮语气要有区别：一个温柔（哄她、体谅她），一个吐槽（损她、不买账），一个随意（随口一句）。
- reply：本肥鱼接的那一句，只有一拍、一行，不超过 26 个字。要接住按钮的语气：温柔、安慰的按钮，回得开心、撒娇；吐槽的按钮，回嘴、顶嘴（嘴硬但不凶）；随口一句就顺着聊。
- reply 要说新的话：不许把刚才那句台词的意思再说一遍，也不要重复台词里的数字和说法。3 句 reply 之间也别用同一个说法（都是「记本子上」「记一辈子」这种不行）。
- 自称一律用「本肥鱼」，不说「我」。
- reply 也是当面对主人说话：句里有「主人」，有语气词（呜、嘿嘿、嘛、哦、～），不写身体动作；动作另外挑一个：${Object.keys(ACTIONS).join('、')}。
- 原话一字不改：要引就只能原样引事件卡第一行「」里的那句；数字只用事件卡第一行里的阿拉伯数字；不编卡片里没有的事；不说教；时间只用卡片上的说法或「那天」「那次」。
- reply 里不要再给按钮：到这一句就结束。

只输出一个 JSON 对象：{"branches": [{"id": "卡片 id", "options": [{"label": "主人说的话", "reply": {"beats": [{"t": "本肥鱼接的一句", "a": "动作"}]}}, …共 3 个]}]}，不要 markdown 代码块，不要别的话。`

/** 第四步：查回话（程序查不了的） */
export const OPTCHECK_SYSTEM = `你是台词编辑。桌宠「本肥鱼」翻完一件旧账以后，主人可以点按钮回一句，本肥鱼再接一句。下面每件事给了事件卡、她先说的台词、几组「主人的话 → 本肥鱼接的话」。检查每一组，有下面任何一条问题就记下它的编号：
A. 主语说反：派活、说那句原话的是主人，干活的是本肥鱼。
B. 编了细节，或者和事件卡的事实对不上。
C. 按钮上的话不像主人会说的（像本肥鱼自己说的、或者看不懂）。
D. 本肥鱼接的话接不上主人那句，或者读不通。
F. 语气没接住：温柔、安慰的按钮，她应该回得开心、撒娇；吐槽的按钮，她应该回嘴、顶嘴。温柔的按钮回了委屈赌气、吐槽的按钮回了道谢，都算没接住。
G. 回话只是把她先说的那句台词的意思又说了一遍，没有新的话。
H. 按钮不像主人自己的口吻（比如主人管自己叫「主人」）。
E. 说教、鸡汤，或者嘲笑主人的能力、脾气、作息。

只输出一个 JSON 对象：{"checks": [{"id": "卡片 id", "bad": [有问题的编号，从 1 开始；都没问题就是空数组]}]}，不要 markdown 代码块，不要别的话。`

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

/** 预计 token：写（没过核对的再写一次，多估三成）+ 挑 + 写回话（三个按钮和接的话）+ 查回话。后三步都要把事件卡再发一次 */
export function styleQuote(cards, route, prices = []) {
  const write = batches(cards).map(buildStylePrompt)
  const writeIn = write.reduce((a, p) => a + estimateTokens(p.system) + estimateTokens(p.prompt), 0)
  const writeOut = cards.length * OUT_PER_CARD
  const cardTok = cards.reduce((a, c) => a + estimateTokens(cardLine(c)), 0)
  const pickCalls = Math.ceil(cards.length / PICK_BATCH), optCalls = Math.ceil(cards.length / OPT_BATCH)
  const pickIn = pickCalls * estimateTokens(PICK_SYSTEM) + cardTok + cards.length * VERSIONS * 55
  const pickOut = cards.length * PICK_OUT_PER_CARD
  // 写回话：合格按钮不到 2 个的会再写一次，多估三成
  const optIn = Math.round((optCalls * estimateTokens(OPTIONS_SYSTEM) + cardTok + cards.length * 60) * 1.3), optOut = Math.round(cards.length * OPT_OUT_PER_CARD * 1.3)
  const checkIn = pickCalls * estimateTokens(OPTCHECK_SYSTEM) + cardTok + cards.length * 160, checkOut = cards.length * OPTCHECK_OUT_PER_CARD
  const inputTokens = Math.round(writeIn * 1.3 + pickIn + optIn + checkIn), outputTokens = Math.round(writeOut * 1.3 + pickOut + optOut + checkOut)
  const price = prices.find(p => p.provider === route.provider && p.model === route.model)
  const cost = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null
  return {
    route, count: cards.length, calls: write.length + pickCalls + optCalls + pickCalls, inputTokens, outputTokens, hash: cardsHash(cards),
    stages: { write: { calls: write.length, input: Math.round(writeIn * 1.3), output: Math.round(writeOut * 1.3) }, pick: { calls: pickCalls, input: pickIn, output: pickOut }, options: { calls: optCalls, input: optIn, output: optOut }, check: { calls: pickCalls, input: checkIn, output: checkOut } },
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
export function checkLine(card, text, { reply = false } = {}) {
  if (typeof text !== 'string' || !text.trim()) return '空的'
  const t = text.trim().replace(/\n{2,}/g, '\n')
  if (t.split('\n').length > 2) return '超过两行'
  if (reply && bubbleLines(t) > 1) return '回话超过一行'
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
  if (!reply && card.project && NEED_PROJECT.has(card.event) && !tight(t).includes(tight(card.project))) return `这类事必须带项目名「${card.project}」`
  const std = standard(t, { project: [card.task, card.project].filter(Boolean).join(' '), voice: false }).find(b => b.rule === '行话' || b.rule === '私事' || b.rule === '行数')
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
  if (!reply && /」[。！？…\s]*$/.test(t) && !/^「/.test(t)) return '只有钩子，引完原话就结束了，没有本肥鱼的反应'
  return null
}

/** 模型写的一拍 → { t, a }（a 是桌宠的动作名，不认识的是 null）。只认这两个字段，多出来的一律不要 */
const beatOf = b => (typeof b === 'string' ? { t: b, a: null } : { t: typeof (b?.t ?? b?.text) === 'string' ? (b.t ?? b.text) : '', a: ACTIONS[b?.a] || null })
/** 模型写的一个版本 → 几拍。认 {beats:[…]}，也认老格式 {t,a} 和一句字符串 */
const beatsOf = x => (Array.isArray(x?.beats) ? x.beats.map(beatOf) : [beatOf(x)]).filter(b => b.t.trim())

/**
 * 存进库里的一条台词，只留认得的形状，别的全截掉：
 *   { text, anim, beats: [{ t, a }], options: [{ label, reply: { beats: [{ t, a }] } }] }
 * 分支只有一层：reply 里只认 beats，里面再出现 options（或者别的任何东西）都丢掉。读库的时候也过这一遍（src/pet.js），库里被改过也不会多出一层。
 */
export function cleanLine(x) {
  if (typeof x === 'string') return x.trim() ? { text: x.trim(), anim: null, beats: [{ t: x.trim(), a: null }], options: [] } : null
  const clean = b => ({ t: String(b?.t ?? '').trim(), a: typeof b?.a === 'string' ? b.a : null })
  const beats = (Array.isArray(x?.beats) ? x.beats : typeof x?.text === 'string' ? x.text.split('\n').map((t, i) => ({ t, a: i ? null : x.anim })) : []).map(clean).filter(b => b.t).slice(0, 2)
  if (!beats.length) return null
  const options = (Array.isArray(x?.options) ? x.options : []).map(o => {
    const rb = (Array.isArray(o?.reply?.beats) ? o.reply.beats : []).map(clean).filter(b => b.t).slice(0, 1)
    return typeof o?.label === 'string' && o.label.trim() && [...o.label.trim()].length <= LABEL_MAX && rb.length ? { label: o.label.trim(), reply: { beats: rb } } : null
  }).filter(Boolean).slice(0, 3)
  return { text: beats.map(b => b.t).join('\n'), anim: beats[0].a || (typeof x?.anim === 'string' ? x.anim : null), beats, options: options.length >= 2 ? options : [] }
}

/**
 * 库里存的台词现在还能不能说：事实会变（「昨天」过一天就不是昨天了，总账的数每天在涨），所以每次用之前照现在的事件卡再核对一遍。
 * 台词本身不过 → 这件事回到模板，并且算作「还没写」（下次「更新台词」会重写）；只是某个回话不过 → 只丢那个回话。
 * @returns {ReturnType<typeof cleanLine>[]}
 */
export function validLines(card, stored) {
  return (Array.isArray(stored) ? stored : stored ? [stored] : []).map(cleanLine).filter(l => l && !checkLine(card, l.text)).map(l => {
    const options = l.options.filter(o => !checkLine(card, o.reply.beats[0].t, { reply: true }))
    return { ...l, options: options.length >= 2 ? options : [] }
  })
}

export function buildOptionsPrompt(items) {
  return { system: OPTIONS_SYSTEM, prompt: items.map(({ card, text }) => `${cardLine(card)}\n  她说的台词：${text.replace(/\n/g, ' / ')}`).join('\n\n') + '\n\n每件事写 3 个按钮，输出 JSON。' }
}
export function buildOptCheckPrompt(items) {
  return { system: OPTCHECK_SYSTEM, prompt: items.map(({ card, text, options }) => `${cardLine(card)}\n  她先说的台词：${text.replace(/\n/g, ' / ')}\n  按钮：\n${options.map((o, i) => `    ${i + 1}. 主人：${o.label} → 本肥鱼：${o.reply.beats[0].t}`).join('\n')}`).join('\n\n') + '\n\n逐组检查，输出 JSON。' }
}
/**
 * 核对模型写的一个按钮：{ label, reply }。合格返回整理好的 { label, reply: { beats: [{ t, a }] } }，不合格返回原因（字符串）。
 * reply 里只认 beats；出现 options（想再往下开一层）或者别的字段，直接丢掉不看。
 */
export function checkOption(card, opt, line = '') {
  const label = typeof opt?.label === 'string' ? opt.label.trim() : ''
  if (!label) return '按钮没有字'
  if ([...label].length > LABEL_MAX) return `按钮「${label}」超过 ${LABEL_MAX} 个字`
  if (/[「」\n]/.test(label) || /\p{Extended_Pictographic}/u.test(label)) return '按钮里有引号、换行或 emoji'
  if (/主人|本肥鱼|肥鱼|本鲸/.test(label)) return `按钮「${label}」是主人自己说的话，里面不该有「主人」「本肥鱼」`
  const beats = (Array.isArray(opt?.reply?.beats) ? opt.reply.beats : []).map(beatOf).filter(b => b.t.trim())
  if (!beats.length) return '没有回话'
  if (beats.length > 1) return '回话超过一拍'
  const why = checkLine(card, beats[0].t, { reply: true })
  if (why) return `回话：${why}`
  // 回话不许把原台词的意思再说一遍：和原台词共用一个短句（不算卡片事实里本来就有的）就算重复
  const own = new Set(phrases(card.fact || '')), said = new Set(phrases(line).filter(x => !own.has(x)))
  const again = phrases(beats[0].t).find(x => said.has(x))
  if (again) return `回话重复了原台词里的「${again}」`
  return { label, reply: { beats: [{ t: spaced(beats[0].t.trim()), a: beats[0].a }] } }
}

/**
 * 跑一遍，四步，每次调用失败重试 1 次：
 *   写（每件事 5 版，程序核对，没过的带原因再写一次）→ 挑（模型挑一版，顺带查主语说反、编细节）
 *   → 写回话（给选中的那版写 3 个按钮和接的话，程序核对）→ 查回话（模型查程序查不了的）。
 * 后两步出了问题（没写出来、核对不过、剩下不到 2 个按钮、调用失败）不影响台词本身：那件事的 options 是空的，界面上用按类型配的默认按钮。
 * avoid：{ 事件 id: 上次那句 }，这些事是换说法，把旧的给模型看、让它别写成一样的。
 * @returns {Promise<{ lines: Record<string, any[]>, failed: { id: string, why: string }[], dropped: number, errors: string[], usage: any[], picks: Record<string, any>, branches: Record<string, any> }>}
 *   lines：每件事最后选中的那一版 [{ text, anim, beats, options }]；failed：没写成的事和原因（照旧说模板的）；dropped：程序核对扔掉的版本数
 */
export async function styleRun({ adapter, cards, route, signal, onProgress = () => {}, avoid = {} }) {
  const errors = [], usage = []
  const cand = {}                                  // id → 过了程序核对的候选 { text, beats }
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
  /** 每一拍的姿势：第一拍是这件事的招牌姿势，模型另挑的不算；第二拍只有情绪真转了才换（emotion.js 的 poseBeats） */
  const fitBeats = (card, beats, text) => poseBeats(EMOTION_OF[card.event], signature(card.event), beats, text)
  /** @param {any[]} list @param {Record<string, string>} [notes] 上一遍每件事没过的原因 */
  const write = async (list, notes) => {
    const out = []
    for (const batch of batches(list)) {
      if (signal?.aborted) { out.push(...batch.map(c => ({ id: c.id, why: '已停止', text: null }))); continue }
      let { system, prompt } = buildStylePrompt(batch)
      if (notes) prompt += `\n\n这几张上一遍写的都没过检查，原因如下，这次照着改：\n${batch.map(c => `id=${c.id}：${notes[c.id]}`).join('\n')}`
      // 以前写过、已经对主人说过的事：这次换个角度，别和上次那句一样
      const again = batch.filter(c => avoid[c.id])
      if (again.length) prompt += `\n\n这几件事以前写过、主人已经听过了。这次换一个角度、换一种开头和落点，不要和旧说法像：\n${again.map(c => `id=${c.id} 旧说法：${avoid[c.id]}`).join('\n')}`
      const got = await ask(system, prompt, batch.length * 620 + 300, 'lines')
      const byId = new Map((got || []).map(l => [String(l?.id), (Array.isArray(l?.texts) ? l.texts : l?.text ? [l.text] : []).map(beatsOf)]))
      for (const c of batch) {
        const versions = byId.get(c.id) || []
        const why = [], ok = cand[c.id] || []
        for (const beats of versions.slice(0, VERSIONS + 1)) {
          const raw = beats.slice(0, 3).map(b => b.t.trim()).join('\n')
          const w = beats.length > 2 ? '超过两拍' : checkLine(c, raw)
          if (w) { why.push(w); dropped++; continue }
          const fitted = fitBeats(c, beats.map(b => ({ t: spaced(b.t.trim()), a: b.a })), raw)      // 数字两边的空格统一
          const text = fitted.map(b => b.t).join('\n')
          if (!ok.some(o => o.text === text)) ok.push({ text, beats: fitted })
        }
        if (ok.length) cand[c.id] = ok
        else out.push({ id: c.id, why: !got ? '这批调用失败' : why[0] || '空的', text: versions[0]?.[0]?.t?.slice(0, 80) ?? null })
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
  const chosen = {}, picks = {}
  const usedPhrases = new Set()                    // 同一批里同一个短句最多出现一次
  const items = cards.filter(c => cand[c.id]).map(c => ({ card: c, texts: cand[c.id].map(o => o.text) }))
  let picked = 0
  for (const batch of batches(items, PICK_BATCH)) {
    if (signal?.aborted) { errors.push('已停止'); failed.push(...batch.map(x => ({ id: x.card.id, why: '已停止', text: null }))); continue }
    const { system, prompt } = buildPickPrompt(batch)
    const got = await ask(system, prompt, batch.length * 90 + 200, 'picks')
    const byId = new Map((got || []).map(p => [String(p?.id), p]))
    for (const { card, texts } of batch) {
      const p = byId.get(card.id)
      const bad = new Set((Array.isArray(p?.bad) ? p.bad : []).map(Number))
      const best = Number(p?.best)
      if (p) picks[card.id] = { best, bad: [...bad], why: String(p.why || '').slice(0, 120), candidates: texts }
      if (!(p && best >= 1 && best <= texts.length && !bad.has(best))) {
        failed.push({ id: card.id, why: !got ? '挑的那一步调用失败' : !p ? '挑的时候漏了这件事' : `几个版本都有问题（${String(p.why || '').slice(0, 60)}）`, text: texts[0].slice(0, 80) })
        continue
      }
      // 选中的那版要是用了这一批里别的台词用过的短句，换成别的没问题的版本；都撞了就照模板念
      const own = new Set(phrases(card.fact || ''))
      const fresh = t => phrases(t).filter(x => !own.has(x)).every(x => !usedPhrases.has(x))
      const order = [best, ...texts.map((_, i) => i + 1).filter(i => i !== best && !bad.has(i))]
      const use = order.find(i => fresh(texts[i - 1]))
      if (!use) { failed.push({ id: card.id, why: '和这一批里别的台词撞了短句', text: texts[best - 1].slice(0, 80) }); continue }
      phrases(texts[use - 1]).filter(x => !own.has(x)).forEach(x => usedPhrases.add(x))
      chosen[card.id] = cand[card.id][use - 1]
    }
    picked += batch.length
    onProgress({ stage: '挑', done: picked, total: items.length, ok: Object.keys(chosen).length, failed: failed.length })
  }

  // 写回话：给选中的那版写 3 个按钮（主人的话）和本肥鱼接的一句；只有一层
  const branches = {}                              // id → { options, why: [扔掉的原因] }
  const withLine = cards.filter(c => chosen[c.id]).map(c => ({ card: c, text: chosen[c.id].text }))
  let wrote = 0
  /** @param {any[]} list @param {boolean} retry 第二遍：带上第一遍没过的原因 */
  const writeOptions = async (list, retry) => {
    for (const batch of batches(list, OPT_BATCH)) {
      if (signal?.aborted) break
      let { system, prompt } = buildOptionsPrompt(batch)
      if (retry) prompt += `\n\n这几件事上一遍写的按钮没过检查，原因如下，这次照着改（按钮不超过 ${LABEL_MAX} 个字；回话里要出现「主人」、有语气词、一行以内）：\n${batch.map(({ card }) => `id=${card.id}：${[...new Set(branches[card.id].why)].join('；')}`).join('\n')}`
      const got = await ask(system, prompt, batch.length * 330 + 300, 'branches')
      const byId = new Map((got || []).map(b => [String(b?.id), Array.isArray(b?.options) ? b.options : []]))
      for (const { card } of batch) {
        const ok = branches[card.id]?.options || [], why = []
        for (const o of (byId.get(card.id) || []).slice(0, 4)) {
          const r = checkOption(card, o, chosen[card.id]?.text)
          if (typeof r === 'string') why.push(r)
          else if (!ok.some(x => x.label === r.label)) ok.push(r)
        }
        branches[card.id] = { options: ok, why: !got ? ['这批调用失败'] : why }
      }
      if (!retry) wrote += batch.length
      onProgress({ stage: '写回话', done: wrote, total: withLine.length, ok: Object.values(branches).filter(b => b.options.length >= 2).length, failed: failed.length })
    }
  }
  await writeOptions(withLine, false)
  // 合格的按钮不到 2 个的，带着原因再写一次（只这一次）
  const short = withLine.filter(x => branches[x.card.id] && branches[x.card.id].options.length < 2 && !branches[x.card.id].why.includes('这批调用失败'))
  if (short.length && !signal?.aborted) await writeOptions(short, true)
  // 查回话：模型查程序查不了的（说反、编细节、接不上）。这一步调用失败 = 没人查过，这几件事不用模型写的按钮
  const toCheck = withLine.filter(x => (branches[x.card.id]?.options.length || 0) >= 2).map(x => ({ ...x, options: branches[x.card.id].options }))
  let checked = 0
  for (const batch of batches(toCheck, PICK_BATCH)) {
    if (signal?.aborted) { for (const x of batch) branches[x.card.id].options = []; continue }
    const { system, prompt } = buildOptCheckPrompt(batch)
    const got = await ask(system, prompt, batch.length * 40 + 200, 'checks')
    const byId = new Map((got || []).map(c => [String(c?.id), c]))
    for (const { card, options } of batch) {
      const c = byId.get(card.id)
      if (!c) { branches[card.id] = { options: [], why: [...branches[card.id].why, !got ? '查回话的那一步调用失败' : '查的时候漏了这件事'] }; continue }
      const bad = new Set((Array.isArray(c.bad) ? c.bad : []).map(Number))
      const kept = options.filter((_, i) => !bad.has(i + 1))
      if (bad.size) branches[card.id].why.push(`查出有问题的按钮：${options.filter((_, i) => bad.has(i + 1)).map(o => o.label).join('、')}`)
      branches[card.id].options = kept
    }
    checked += batch.length
    onProgress({ stage: '查回话', done: checked, total: toCheck.length, ok: Object.values(branches).filter(b => b.options.length >= 2).length, failed: failed.length })
  }

  // 同一批里，回话之间的短句不许重复（「记本子上」「记一辈子」各只能出现一次）：后出现的那个按钮丢掉
  const usedReply = new Set()
  for (const c of cards) {
    const b = branches[c.id]
    if (!b) continue
    b.options = b.options.filter(o => {
      const ph = phrases(o.reply.beats[0].t)
      const dup = ph.find(x => usedReply.has(x))
      if (dup) { b.why.push(`回话和这一批里别的回话撞了短句「${dup}」：${o.label}`); return false }
      ph.forEach(x => usedReply.add(x)); return true
    })
  }

  const lines = {}
  for (const c of cards) {
    if (!chosen[c.id]) continue
    const opts = branches[c.id]?.options || []
    const line = cleanLine({ beats: chosen[c.id].beats, options: opts.length >= 2 ? opts.slice(0, 3) : [] })
    if (line) lines[c.id] = [line]
  }
  return { lines, failed, dropped, errors, usage, picks, branches }
}
