import { LINES } from './lines.js'
import { CHAT, MOOD_ANIM, ANIM_MOOD } from './chat.js'
import { IDLE } from './idle.js'
import { emptyFeedback, normFeedback, pickRated } from './feedback.js'
/**
 * 大肥鱼引擎：不依赖 React，dsh 浮层（Pet.jsx）和桌面窗口（desktop/）共用一份。
 *
 * 手感：
 *   - 有重力，落到「地面」（容器底边）；抓起来能甩，撞墙、落地会弹，落地时压扁再弹回；拖着走时身子顺着速度歪。
 *   - 戳一下：先蹦一下，再说话。
 * 形象：小本本鲸鱼娘的透明 PNG（assets/xiaobenben/），动画全靠代码：轻轻上下浮、隔几秒换一张闭眼图眨眼、按台词类型换表情图（缺哪张就用 normal.png）。
 * 说话：
 *   - 对话版台词：一轮一行（「本肥鱼：」「主人：」标签不显示，主人的话换颜色），打字机一行一行出。
 *   - 点气泡：正在打字就直接显示完，打完了就下一行；最后一行读完自己淡出。
 *   - 说完底下一排：👍 👎 + 一个这一类的反应 + 「再翻一件」。👍👎 记在本机，以后那一类多说 / 少说。
 *   - 之后可以一直聊：她每回一句都给两个主人能说的话（src/shared/chat.js，按心情接），旁边永远有「再翻一件」。
 *   - 气泡贴着它、带尖角，靠边时自动换边；顶上一个小标签（哪一类 · 几天前）。
 * 左键点一下就翻旧账；只有主人点了才说话，不自己冒出来。
 */

export const KIND = { work: '干活', late: '深夜', report: '汇报', sorry: '认错', complain: '挨骂', caught: '被抓包', stopped: '被喊停', stat: '总账' }
export const MODES = [
  ['all', '随便', () => true],
  ['week', '最近一周', m => Date.now() - m.ts < 7 * 864e5],
  ['drama', '挨骂与认错', m => ['sorry', 'complain', 'caught', 'stopped'].includes(m.kind)],
  ['work', '干活与汇报', m => ['work', 'late', 'report'].includes(m.kind)],
  ['stat', '总账', m => m.kind === 'stat'],
  ['idle', '只随便聊聊（不翻旧账）', () => false],
]

/** 反应按钮、👍👎 的回话、想 / 催 / 生气的台词：都在 lines.js（每类十几个反应，每次随机抽两个） */
const REACT = LINES.react
const REPLY = LINES

const G = 2600            // 重力 px/s²
const BOUNCE = 0.5        // 撞墙 / 落地留下的速度
const FRICTION = 0.86     // 落地后横向每次弹跳的摩擦
const TYPE_MS = 32        // 打字机每个字
const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const shuffle = arr => arr.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1])
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const SPEAKER = /^\s*(本肥鱼|本鱼|大肥鱼|小本本|主人|你)\s*[：:]\s*/u
/**
 * 台词拆成几轮：一行一轮，去掉开头的「本肥鱼：」「主人：」标签，记下是谁说的（主人的话显示成另一种颜色）。
 * @param {string} text
 * @returns {{ who: 'me'|'master', text: string }[]}
 */
export function rounds(text) {
  // 有的模板把下一轮写在同一行（「下次呢？本肥鱼：下次早点说。」）：句末标点后面紧跟人名标签就另起一行
  return text.replace(/([。！？!?」）…])\s*(?=(本肥鱼|主人)\s*[：:])/gu, '$1\n').split('\n').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(SPEAKER)
    return { who: m && (m[1] === '主人' || m[1] === '你') ? 'master' : 'me', text: m ? s.slice(m[0].length) : s }
  })
}

/**
 * 台词里的动作 → 表情图（assets/xiaobenben/<名字>.png）。给一串的随机挑一张有图的，同一类事不总是同一个样子；
 * 都没图用 normal。表情（脸）和姿势（记账、数饭碗、本子挡脸……）混着用。
 */
export const EXPR = {
  idle: 'normal', work: ['write', 'thinking'], file: ['write', 'thinking'], yawn: ['sleep', 'sleepy'], startle: 'surprised', drag: 'dangle',
  caught: ['hide', 'shy'], bow: ['bow', 'shy'], sigh: 'sad', cheer: ['spout', 'wave', 'happy'], eat: ['count', 'eat'], poke: ['wave', 'happy'],
  angry: ['sulk', 'accuse', 'pout'], proud: 'proud', land: 'land',
}
/** 姿势图（不是单纯换脸）；没这张图时退回哪个表情 */
export const POSE_FALLBACK = {
  write: 'thinking', count: 'eat', hide: 'shy', accuse: 'pout', spout: 'happy', bow: 'shy',
  dangle: 'surprised', land: 'surprised', sit: 'normal', sleep: 'sleepy', sulk: 'pout', wave: 'happy',
}
export const POSES = Object.keys(POSE_FALLBACK)
export const FIGURES = ['normal', 'blink', 'happy', 'sad', 'surprised', 'sleepy', 'shy', 'thinking', 'eat', 'pout', 'proud', ...POSES, 'walk-1', 'walk-2', 'walk-3', 'walk-4', 'flip-1', 'flip-2', 'flip-3', 'flip-4', 'flip-5', 'flip-6']

const CSS = `
.fy-root { position: absolute; inset: 0; pointer-events: none; overflow: hidden; font-family: "XBB Rounded", -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
.fy-pet { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; will-change: transform; }
.fy-pet.drag { cursor: grabbing; }
.fy-body { width: 100%; height: 100%; transform-origin: 50% 100%; transition: transform .16s cubic-bezier(.3,1.6,.5,1); }
.fy-float { width: 100%; height: 100%; animation: fy-float 3.2s ease-in-out infinite; }
.fy-pet.drag .fy-float { animation-play-state: paused; }
.fy-float img { width: 100%; height: 100%; object-fit: contain; object-position: 50% 100%; display: block; pointer-events: none; -webkit-user-drag: none; }
@keyframes fy-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
/* 表情：没有单独表情图时，用代码加漫画符号 + 身体动作 */
.fy-fig { position: relative; width: 100%; height: 100%; transform-origin: 50% 100%; }
.fy-mark { position: absolute; left: 70%; top: 4%; font-weight: 700; font-size: 26px; line-height: 1; color: #2a241d; pointer-events: none; white-space: nowrap; opacity: 0; }
.fy-e-happy .fy-mark, .fy-e-surprised .fy-mark, .fy-e-sleepy .fy-mark, .fy-e-shy .fy-mark, .fy-e-sad .fy-mark, .fy-e-thinking .fy-mark,
.fy-e-eat .fy-mark, .fy-e-pout .fy-mark, .fy-e-proud .fy-mark { opacity: 1; }
.fy-e-eat .fy-mark { color: #e0568a; animation: fy-note 1s ease-in-out infinite; }
.fy-e-eat .fy-fig { animation: fy-hop .4s ease-in-out 3; }
.fy-e-pout .fy-mark { color: #e5484d; left: 68%; top: 10%; animation: fy-pop .2s ease-out; }
.fy-e-pout .fy-fig { animation: fy-wiggle .25s ease-in-out 4; }
.fy-e-proud .fy-mark { color: #e0a800; animation: fy-note 1.2s ease-in-out infinite; }
.fy-e-proud .fy-fig { animation: fy-hop .5s ease-in-out 1; }
.fy-e-happy .fy-mark { color: #e0568a; animation: fy-note 1s ease-in-out infinite; }
.fy-e-happy .fy-fig { animation: fy-hop .5s ease-in-out 2; }
.fy-e-surprised .fy-mark { color: #e5484d; font-size: 34px; left: 72%; animation: fy-pop .2s ease-out; }
.fy-e-surprised .fy-fig { animation: fy-jump .35s ease-out; }
.fy-e-sleepy .fy-mark { color: #5b6bbf; animation: fy-zz 2.4s ease-in-out infinite; }
.fy-e-sleepy .fy-fig { animation: fy-sway 3s ease-in-out infinite; }
.fy-e-shy .fy-mark { left: 31%; top: 34%; font-size: 15px; color: #f07a8c; letter-spacing: -2px; }
.fy-e-shy .fy-mark::after { content: "///"; position: absolute; left: 66px; }
.fy-e-shy .fy-fig { animation: fy-wiggle .6s ease-in-out 2; }
.fy-e-sad .fy-mark { color: #4ea3e8; left: 74%; top: 22%; animation: fy-drop 1.4s ease-in infinite; }
.fy-e-sad .fy-fig { transform: translateY(4px) scale(1, .97); transition: transform .3s; }
.fy-e-thinking .fy-mark { color: #8a8175; animation: fy-note 1.6s ease-in-out infinite; }
@keyframes fy-note { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-8px) rotate(8deg); } }
@keyframes fy-hop { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-14px); } }
@keyframes fy-jump { 0% { transform: translateY(0) scale(1); } 40% { transform: translateY(-22px) scale(.96, 1.05); } 100% { transform: translateY(0) scale(1); } }
@keyframes fy-sway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
@keyframes fy-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-3deg); } 75% { transform: rotate(3deg); } }
@keyframes fy-zz { 0% { transform: translate(0, 0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(14px, -22px); opacity: 0; } }
@keyframes fy-drop { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(18px); opacity: 0; } }
.fy-shadow { position: absolute; left: 50%; bottom: 2px; width: 46%; height: 10px; margin-left: -23%; border-radius: 50%; background: rgba(0,0,0,.22); filter: blur(3px); pointer-events: none; }
.fy-bubble { position: absolute; left: 0; top: 0; pointer-events: auto; max-width: 340px; min-width: 120px; box-sizing: border-box; padding: 10px 14px 11px; border-radius: 16px;
  background: #fffdf8; color: #2a241d; border: 2px solid #2a241d; box-shadow: 3px 4px 0 rgba(42,36,29,.9); font-size: 14px; line-height: 1.6; cursor: pointer;
  transform-origin: var(--ox, 50%) var(--oy, 100%); animation: fy-pop .22s cubic-bezier(.3,1.6,.5,1); }
.fy-bubble.out { animation: fy-out .2s ease-in forwards; }
.fy-bubble::after { content: ""; position: absolute; width: 14px; height: 14px; background: #fffdf8; border: 2px solid #2a241d; border-top: 0; border-left: 0;
  left: var(--tx, 50%); margin-left: -8px; }
.fy-bubble.up::after { bottom: -9px; transform: rotate(45deg); }
.fy-bubble.down::after { top: -9px; transform: rotate(225deg); }
.fy-tag { display: inline-block; font-size: 11px; line-height: 1; padding: 3px 7px; margin: 0 0 6px; border-radius: 99px; background: #2a241d; color: #fffdf8; letter-spacing: .5px; }
.fy-tag.priv { background: #c9821c; }
.fy-text { min-height: 1.6em; }
.fy-text > div + div { margin-top: 2px; }
.fy-text .fy-m { color: #c2410c; }
.fy-text .fy-m .fy-q { color: inherit; }   /* 主人的话整行一个颜色，引号不另上色 */
.fy-text .fy-q { color: #2f5bea; font-weight: 600; }
.fy-dots { margin-top: 4px; display: flex; gap: 4px; }
.fy-dots i { width: 5px; height: 5px; border-radius: 50%; background: #d8cfc0; }
.fy-dots i.on { background: #2a241d; }
.fy-think { font-weight: 500; }
.fy-ell i { font-style: normal; display: inline-block; animation: fy-ell 1s infinite; }
.fy-ell i:nth-child(2) { animation-delay: .15s; } .fy-ell i:nth-child(3) { animation-delay: .3s; }
@keyframes fy-ell { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
.fy-react { display: flex; gap: 6px; margin-top: 9px; padding-top: 8px; border-top: 1.5px dashed rgba(42,36,29,.22); flex-wrap: wrap; animation: fy-pop .2s ease-out; }
.fy-react button { font: inherit; font-size: 12px; line-height: 1; color: inherit; background: transparent; border: 1.5px solid #2a241d; border-radius: 99px; padding: 6px 10px; cursor: pointer; transition: transform .1s; }
.fy-react button.emo { font-size: 14px; padding: 4px 8px; }
.fy-rate { margin-top: 6px; } .fy-rated { font-size: 12px; opacity: .75; }
.fy-react button:hover { background: #2a241d; color: #fffdf8; transform: translateY(-1px); }
.fy-react button:active { transform: scale(.92); }
.fy-menu { position: absolute; pointer-events: auto; width: 230px; box-sizing: border-box; padding: 6px; border-radius: 14px; background: #fffdf8; color: #2a241d;
  border: 2px solid #2a241d; box-shadow: 3px 4px 0 rgba(42,36,29,.9); font-size: 13px; animation: fy-pop .16s ease-out; }
.fy-menu h6 { margin: 4px 8px; font-size: 11px; font-weight: 600; color: #8a8175; }
.fy-menu button { display: block; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: 0; border-radius: 8px; padding: 6px 8px; cursor: pointer; }
.fy-menu button:hover { background: rgba(47,91,234,.1); }
.fy-menu button.on { color: #2f5bea; font-weight: 600; }
.fy-menu hr { border: 0; height: 1px; background: rgba(0,0,0,.1); margin: 4px 6px; }
.fy-menu p { margin: 4px 8px 6px; font-size: 11px; color: #8a8175; line-height: 1.5; }
.fy-dot { position: absolute; pointer-events: auto; width: 40px; height: 40px; border-radius: 50%; border: 2px solid #2a241d; background: #fffdf8; box-shadow: 2px 3px 0 rgba(42,36,29,.9); font-size: 20px; cursor: pointer; }
@keyframes fy-pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: scale(1); } }
@keyframes fy-out { to { opacity: 0; transform: scale(.85); } }
@media (prefers-color-scheme: dark) {
  .fy-bubble, .fy-menu, .fy-dot, .fy-bubble::after { background: #262a33; color: #f1ece4; border-color: #f1ece4; }
  .fy-bubble, .fy-menu, .fy-dot { box-shadow: 3px 4px 0 rgba(0,0,0,.55); }
  .fy-tag { background: #f1ece4; color: #262a33; }
  .fy-text .fy-q { color: #8ea6ff; }
  .fy-text .fy-m { color: #fdba74; }
  .fy-mark { color: #f1ece4; }
  .fy-dots i { background: #4a4f5a; } .fy-dots i.on { background: #f1ece4; }
  .fy-menu h6, .fy-menu p { color: #9a948a; }
  .fy-react { border-top-color: rgba(241,236,228,.25); }
  .fy-react button { border-color: #f1ece4; }
  .fy-react button:hover { background: #f1ece4; color: #262a33; }
}
`


/**
 * @param {HTMLElement} host 放大肥鱼的容器（铺满可活动的区域）
 * @param {{
 *   loadMoments: (fresh?: boolean) => Promise<{ moments: any[], days?: number, report?: any[] } | null>,
 *   figureSrc: (name: string) => Promise<string|null>,   // 表情图的地址（FIGURES 里的名字），没有就 null
 *   fontSrc?: string,                                  // 气泡字体（woff2）
 *   prefs: { get(): any, set(patch: any): void },
 *   size?: number,
 *   menuExtras?: () => { label: string, onClick: () => void }[],
 *   onPointerArea?: (inside: boolean) => void,   // 桌面版：鼠标进 / 出能点的地方（切点击穿透）
 *   note?: (data: any) => string,
 * }} opts
 */
export function createPet(host, opts) {
  const size = opts.size || 200                       // 高
  const SW = Math.round(size * (opts.aspect || 1))   // 宽（立绘是竖的）
  const doc = host.ownerDocument
  if (!doc.getElementById('fy-style')) {
    const font = opts.fontSrc ? `@font-face { font-family: "XBB Rounded"; src: url("${opts.fontSrc}") format("woff2"); font-display: swap; }\n` : ''
    const st = doc.createElement('style'); st.id = 'fy-style'; st.textContent = font + CSS; doc.head.appendChild(st)
  }
  const root = doc.createElement('div'); root.className = 'fy-root'; host.appendChild(root)
  const pet = doc.createElement('div'); pet.className = 'fy-pet'; pet.style.width = SW + 'px'; pet.style.height = size + 'px'; pet.title = '点一下翻旧账；抓起来甩；右键有菜单'
  const shadow = doc.createElement('div'); shadow.className = 'fy-shadow'
  const body = doc.createElement('div'); body.className = 'fy-body'
  pet.append(shadow, body); root.appendChild(pet)

  // ---------- 形象：PNG + 代码动画 ----------
  const float = doc.createElement('div'); float.className = 'fy-float'
  const fig = doc.createElement('div'); fig.className = 'fy-fig'
  const img = doc.createElement('img'); img.alt = ''; img.draggable = false
  img.style.visibility = 'hidden'              // 没载好之前不显示（不然是个带边框的空框）
  img.addEventListener('load', () => { img.style.visibility = '' })
  img.addEventListener('error', () => {         // 这张坏了：换回 normal；normal 也坏了就保持现状（不画别的东西）
    const bad = img.getAttribute('src')
    console.warn('[小本本] 立绘载不出来', bad)
    for (const k in srcs) if (srcs[k] === bad) srcs[k] = null
    if (srcs.normal) show(expr)
  })
  const mark = doc.createElement('div'); mark.className = 'fy-mark'
  fig.append(img, mark); float.appendChild(fig); body.appendChild(float)
  const MARK = { happy: '♪', surprised: '！', sleepy: 'z', shy: '///', sad: '💧', thinking: '…', eat: '♪', pout: '💢', proud: '✦' }
  const srcs = {}                              // 名字 → 地址（null = 没这张图）
  let expr = 'normal', exprTimer = 0, lastActive = Date.now(), walking = null, walkRaf = 0, walkTimer = 0
  const ready = Promise.all(FIGURES.map(n => Promise.resolve(opts.figureSrc(n)).catch(() => null).then(u => { srcs[n] = u })))
  const srcOf = n => srcs[n] || srcs.normal
  // 没有备用形象：立绘取不到就不显示（隔 5 秒再取一次），绝不画别的东西顶上
  function show(n) { const u = srcOf(n); if (u) { if (img.getAttribute('src') !== u) img.src = u } }
  /** 换表情：有这张表情图就换图；没有就用 normal 图 + 代码画的漫画符号和动作。ms 后回到 normal（0 = 保持到下次换） */
  function setExpr(name, ms = 0) {
    clearTimeout(exprTimer)
    if (walking) { walking = null; cancelAnimationFrame(walkRaf); img.style.transform = ''; opts.prefs.set({ x, y }) }   // 换别的样子 = 不走了
    if (POSES.includes(name) && !srcs[name]) name = POSE_FALLBACK[name]
    expr = name in MARK || name === 'normal' || POSES.includes(name) ? name : 'normal'
    lastActive = Date.now()
    float.className = 'fy-float' + (expr !== 'normal' && !srcs[expr] ? ' fy-e-' + expr : '')
    mark.textContent = expr === 'shy' ? '' : MARK[expr] || ''
    show(expr)
    if (ms) exprTimer = setTimeout(() => setExpr('normal'), ms)
  }
  const playAnim = (anim, ms = 0) => {
    const e = EXPR[anim] || 'normal'
    if (!Array.isArray(e)) return setExpr(e, ms)
    const have = e.filter(n => srcs[n])
    setExpr(have.length ? have[Math.floor(Math.random() * have.length)] : e.at(-1), ms)
  }
  const idle = () => setExpr('normal')
  // 没人理她：3 分钟坐下翻本子，10 分钟（半夜 3 分钟）趴在本子上睡着。戳她 / 拖她就醒
  const restTimer = setInterval(() => {
    if (opts.prefs.get().rest === false || dragging || bubble || thinking || !(expr === 'normal' || expr === 'sit')) return
    const quiet = Date.now() - lastActive, h = new Date().getHours()
    const want = quiet > (h < 6 ? 3 : 10) * 60e3 ? 'sleep' : quiet > 3 * 60e3 ? 'sit' : null
    if (want && want !== expr && srcs[want]) { const keep = lastActive; setExpr(want); lastActive = keep }
  }, 20e3)
  // 眨眼：只在 normal 时眨，每 2.5～6 秒一次，偶尔连眨两下
  let blinkTimer = 0
  function blink() {
    blinkTimer = setTimeout(() => {
      if (expr === 'normal' && srcs.blink && !dragging) {
        show('blink'); setTimeout(() => { if (expr === 'normal') show('normal') }, 130)
        if (Math.random() < 0.2) setTimeout(() => { if (expr === 'normal') { show('blink'); setTimeout(() => { if (expr === 'normal') show('normal') }, 110) } }, 280)
      }
      blink()
    }, 2500 + Math.random() * 3500)
  }
  pet.style.visibility = 'hidden'
  async function loadFigures() {
    await Promise.all(FIGURES.filter(n => !srcs[n]).map(n => Promise.resolve(opts.figureSrc(n)).catch(() => null).then(u => { srcs[n] = u })))
    if (!srcs.normal) { console.warn('[小本本] 立绘取不到，5 秒后再试'); figTimer = setTimeout(loadFigures, 5000); return }
    pet.style.visibility = ''
    show(expr)
  }
  let figTimer = 0
  ready.then(() => { if (srcs.normal) { pet.style.visibility = ''; show(expr); if (srcs.wave) setExpr('wave', 1600) } else loadFigures(); blink(); scheduleWalk() })

  // 翻本子：点了之后先翻（2→3→4→5，记录没读完就在 4、5 之间来回翻），翻到了停在第 6 帧「看到了」
  let flipTimer = 0
  const hasFlip = () => !!(srcs['flip-2'] && srcs['flip-6'])
  function flipStart() {
    if (!hasFlip()) return false
    clearTimeout(flipTimer); clearTimeout(figTimer); clearTimeout(exprTimer)
    float.className = 'fy-float'; mark.textContent = ''
    expr = 'flip'
    const seq = ['flip-2', 'flip-3', 'flip-4', 'flip-5']
    let i = 0
    const tick = () => { show(seq[i]); i = i < seq.length - 1 ? i + 1 : 2; flipTimer = setTimeout(tick, 150) }
    tick()
    return true
  }
  /** 停在第 6 帧（抬头、嘴巴微张），ms 后交给台词的表情 */
  function flipFound() { clearTimeout(flipTimer); if (expr === 'flip') show('flip-6') }
  function flipStop() { clearTimeout(flipTimer); if (expr === 'flip') setExpr('normal') }

  // ---------- 物理 ----------
  const W = () => host.clientWidth, H = () => host.clientHeight
  const p0 = opts.prefs.get()
  let x = p0.x >= 0 ? p0.x : W() - SW - 24, y = p0.y >= 0 ? p0.y : H() - size   // 左上角
  let vx = 0, vy = 0, raf = 0, last = 0, onFloor = false
  let dragging = null, dragTalk = 0, flung = false, flingSpeed = 0
  const floor = () => H() - size
  function place(tilt = 0) {
    pet.style.transform = `translate(${x}px, ${y}px)` + (tilt ? ` rotate(${tilt}deg)` : '')
    shadow.style.opacity = String(clamp(1 - (floor() - y) / 400, 0, 1))
    positionBubble()
  }
  function squash(sx, sy, ms = 140) {
    body.style.transform = `scale(${sx}, ${sy})`
    setTimeout(() => { body.style.transform = '' }, ms)
  }
  function step(ts) {
    const dt = clamp((ts - last) / 1000, 0.004, 0.033); last = ts   // rAF 的时间戳可能早于 kick 时记的 performance.now()
    if (!W()) { raf = 0; return }                  // 容器被藏起来了（桌面版开着时网页那只），别算，更别把 -200 存进位置
    if (dragging) { raf = requestAnimationFrame(step); return }
    vy += G * dt
    x += vx * dt; y += vy * dt
    const maxX = W() - SW
    if (x < 0) { x = 0; vx = -vx * BOUNCE; squash(0.86, 1.1) }
    if (x > maxX) { x = maxX; vx = -vx * BOUNCE; squash(0.86, 1.1) }
    if (y < 0) { y = 0; vy = -vy * BOUNCE }
    if (y >= floor() && vy >= 0) {
      y = floor()
      const hit = vy
      if (hit > 260) {
        vy = -hit * BOUNCE; vx *= FRICTION; squash(1.18, 0.8)
        if (flung) { flung = false; const l = landLine(flingSpeed); say({ text: l.text, anim: 'land', rate: l.rate }) }
        else if (!bubble && (expr === 'normal' || expr === 'land')) setExpr('land', 700)
      } else if (flung && onFloor) flung = false
      else { vy = 0; vx *= 0.8 }
    }
    onFloor = y >= floor() && Math.abs(vy) < 1
    place(clamp(vx * 0.02, -18, 18))
    if (onFloor && Math.abs(vx) < 8) { vx = 0; place(); raf = 0; opts.prefs.set({ x, y }); return }
    raf = requestAnimationFrame(step)
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step) } }

  // ---------- 散步 ----------
  // 闲着站在地上时，每 15～50 秒在底下走一小段（60～260px，每秒 70px，4 帧每帧 160ms，往左走镜像）。
  // 戳、拖、说话、换表情都会打断；快到该坐下 / 睡觉的时候（3 分钟没人理）就不走了。
  function scheduleWalk() { clearTimeout(walkTimer); walkTimer = setTimeout(tryWalk, 15e3 + Math.random() * 35e3) }
  function tryWalk(force = 0) {
    if (force) return walk(force)
    scheduleWalk()
    if (opts.prefs.get().walk === false) return
    if (walking || dragging || bubble || thinking || menu || raf || expr !== 'normal' || !onFloor && y < floor() - 1 || !srcs['walk-1']) return
    if (Date.now() - lastActive > 3 * 60e3) return
    walk(0)
  }
  /** 走一段：dir 1 往右、-1 往左、0 随机 */
  function walk(dir) {
    const maxX = W() - SW
    if (!W() || maxX < 80 || !srcs['walk-1']) return
    if (walking) setExpr('normal')
    hideBubble()
    dir = dir || (Math.random() < 0.5 ? -1 : 1)
    if (x + dir * 80 < 0) dir = 1
    if (x + dir * 80 > maxX) dir = -1
    const target = clamp(x + dir * (60 + Math.random() * 200), 0, maxX)
    const me = walking = { dir, t: 0 }
    expr = 'walk'; img.style.transform = dir < 0 ? 'scaleX(-1)' : ''
    let lastTs = performance.now()
    const stepW = ts => {
      if (walking !== me) return
      const dt = clamp((ts - lastTs) / 1000, 0, 0.05); lastTs = ts
      x += dir * 70 * dt; me.t += dt
      show('walk-' + (1 + Math.floor(me.t / 0.16) % 4)); place()
      if (dir > 0 ? x >= target : x <= target) { const keep = lastActive; setExpr('normal'); lastActive = keep; return }
      walkRaf = requestAnimationFrame(stepW)
    }
    walkRaf = requestAnimationFrame(stepW)
  }

  // ---------- 拖、甩、戳 ----------
  // 防「按下 / 松开丢了一个」：macOS 第一次点没聚焦的窗口时会吞掉其中一个事件。
  // 没按着键的移动一律不算拖；丢了捕获就当松手；甩出去的速度只看最后 100ms、封顶，静止松手不甩。
  function endDrag(e, cancelled) {
    const d = dragging; dragging = null; pet.classList.remove('drag'); clearInterval(dragTalk)
    if (!d) return
    if (!d.moved) { if (!cancelled) poke(); return }
    const now = performance.now()
    const recent = d.hist.filter(h => now - h[2] <= 100)
    if (recent.length >= 2 && !cancelled) {
      const [ax, ay, at] = recent[0], [bx, by, bt] = recent.at(-1)
      const dt = Math.max(16, bt - at) / 1000
      vx = clamp((bx - ax) / dt, -1800, 1800); vy = clamp((by - ay) / dt, -1800, 1800)
    } else { vx = 0; vy = 0 }
    opts.prefs.set({ x, y })
    const fast = Math.hypot(vx, vy) > 700
    flingSpeed = Math.hypot(vx, vy)
    flung = fast || y < floor() - 120                                  // 甩出去 / 从高处松手：落地时说一句
    if (fast) say({ text: pickLine(LINES.fling), anim: 'drag', rate: '被甩' })
    else if (bubble && talk?.full && talk.line?.rate && !bubble.querySelector('.fy-rate')) {   // 慢慢放下：拎着时说的那句留着，补上 👍 👎
      addRate(bubble, talk.line.rate, talk.line.text)
      clearTimeout(talk.timer); talk.timer = setTimeout(() => { hideBubble(); idle() }, 6000)
    }
    if (!fast) idle()
    kick()
  }
  pet.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    try { pet.setPointerCapture(e.pointerId) } catch {}
    dragging = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false, hist: [[e.clientX, e.clientY, performance.now()]] }
  })
  pet.addEventListener('pointermove', e => {
    const d = dragging; if (!d) return
    if (!(e.buttons & 1)) return endDrag(e, true)        // 松手事件丢了：别让它跟着鼠标跑
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 6) return
    if (!d.moved) {
      d.moved = true; pet.classList.add('drag'); thinking = null; flipStop(); closeMenu()
      ctx.before = Date.now() < sulkUntil ? 'sulk' : walking ? 'walk' : expr === 'sleep' || expr === 'sit' ? expr : bubble && talk?.line?.react ? 'talk' : null
      const pl = pickUpLine(); say({ text: pl.text, anim: 'drag', rate: pl.rate })                     // 被拎起来要说一句；拎久了每 4 秒再抱怨一句
      clearInterval(dragTalk); const me = d; const iv = dragTalk = setInterval(() => { if (dragging === me) say({ text: pickLine(LINES.dragLong), anim: 'drag', rate: '拎太久' }); else clearInterval(iv) }, 4000)   // 只认这一次拖
    }
    d.hist.push([e.clientX, e.clientY, performance.now()]); if (d.hist.length > 8) d.hist.shift()
    const [ax, , at] = d.hist[0]
    const v = (e.clientX - ax) / Math.max(1, performance.now() - at) * 1000
    x = clamp(d.ox + dx, 0, W() - SW); y = clamp(d.oy + dy, 0, floor())
    place(clamp(v * 0.015, -25, 25))
  })
  pet.addEventListener('pointerup', e => endDrag(e, false))
  pet.addEventListener('pointercancel', e => endDrag(e, true))
  pet.addEventListener('lostpointercapture', e => { if (dragging) endDrag(e, dragging.moved ? false : true) })
  pet.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(e.clientX - host.getBoundingClientRect().left, e.clientY - host.getBoundingClientRect().top) })
  if (opts.onPointerArea) {
    root.addEventListener('pointerover', e => { if (e.target !== root) opts.onPointerArea(true) })
    root.addEventListener('pointerout', e => { if (!dragging && (!e.relatedTarget || e.relatedTarget === root || !root.contains(e.relatedTarget))) opts.onPointerArea(false) })
  }

  // ---------- 说话 ----------
  let data = null, inflight = null
  const queues = {}
  // 反馈：共用一份（opts.feedback.load / save），没有就只记在这只的偏好里
  let fb = emptyFeedback(), fbTimer = 0
  Promise.resolve(opts.feedback?.load?.()).then(d => {
    fb = normFeedback(d || {})
    const old = opts.prefs.get().fb                       // 以前按类别的票记在偏好里：并进来
    if (old && !Object.keys(fb.kinds).length) { fb.kinds = normFeedback({ kinds: old }).kinds; saveFb() }
    for (const k in queues) delete queues[k]
  }).catch(err => console.warn('[小本本] 读反馈失败', err))
  function saveFb() {
    clearTimeout(fbTimer)
    fbTimer = setTimeout(() => { Promise.resolve(opts.feedback?.save?.(fb)).catch(err => console.warn('[小本本] 存反馈失败', err)) }, 400)
    opts.onFeedback?.(fb)
  }
  function logFb(what, text, d) { fb.log.push({ t: Date.now(), what, text, d }); if (fb.log.length > 300) fb.log.splice(0, fb.log.length - 300) }
  /** 给一句话打分：1 = 👍（以后多说），-1 = 👎（以后不说），0 = 撤销 */
  function rateLine(what, text, d) {
    if (d) fb.lines[text] = d; else delete fb.lines[text]
    logFb(what, text, d); saveFb()
    if (d) noteAct({ type: 'rate', d })
  }
  const pickLine = list => pickRated(list, fb)
  // 刚才发生了什么：主人最后点了什么、她最后翻到哪类旧账、今天被扔几次。拖 / 甩 / 落地时说的话扣着这个
  const ctx = { act: null, moment: null, throws: [], before: null }
  const noteAct = a => { ctx.act = { ...a, t: Date.now() } }
  const fresh = o => o && Date.now() - o.t < 3 * 60e3
  const fillCtx = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')
  /** 落地说什么：刚才的事 > 刚翻的旧账 > 今天扔了好多次 / 半夜 / 扔得狠（各一定概率）> 一般的 */
  function landLine(speed) {
    const C = LINES.ctx, a = fresh(ctx.act) ? ctx.act : null, m = fresh(ctx.moment) ? ctx.moment : null
    const day = new Date().toDateString(); ctx.throws = ctx.throws.filter(d => d === day); ctx.throws.push(day)
    const n = ctx.throws.length, h = new Date().getHours()
    const opts2 = [
      a?.type === 'vote' && a.d < 0 && ['land_down', { kind: KIND[a.kind] || '那一' }],
      a?.type === 'vote' && a.d > 0 && ['land_up', {}],
      a?.type === 'rate' && a.d < 0 && ['land_rate_down', {}],
      a?.type === 'rate' && a.d > 0 && ['land_rate_up', {}],
      a?.type === 'chat' && ['land_chat', { label: a.label }],
      a?.type === 'sulk' && ['land_sulk', {}],
      m && C['land_' + m.kind] && ['land_' + m.kind, {}],
      n >= 3 && Math.random() < 0.6 && ['land_many', { n }],
      speed > 1500 && Math.random() < 0.5 && ['land_hard', {}],
      h < 5 && Math.random() < 0.4 && ['land_night', {}],
    ].filter(Boolean)
    if (a) ctx.act = null                                  // 一件事只拿来说一次
    if (!opts2.length) return { text: pickLine(LINES.land), rate: '落地' }
    const [k, v] = opts2[0]
    return { text: fillCtx(pickLine(C[k]), v), rate: '落地·' + k.slice(5) }
  }
  function pickUpLine() {
    const C = LINES.ctx, b = ctx.before
    const k = b === 'sleep' ? 'pick_sleep' : b === 'sit' ? 'pick_sit' : b === 'walk' ? 'pick_walk' : b === 'talk' ? 'pick_talk' : b === 'sulk' ? 'pick_sulk' : null
    return k ? { text: pickLine(C[k]), rate: '被拎起·' + k.slice(5) } : { text: pickLine(LINES.drag), rate: '被拎起' }
  }
  let bubble = null, talk = null
  function load(fresh = false) {
    if (inflight && !fresh) return inflight
    inflight = opts.loadMoments(fresh).then(d => { if (d) { data = d; for (const k in queues) delete queues[k] } return d }).finally(() => { inflight = null })
    return inflight
  }
  setTimeout(() => load(), 2500)

  function hideBubble() {
    if (talk) { clearTimeout(talk.timer); talk = null }
    if (!bubble) return
    const b = bubble; bubble = null
    b.classList.add('out'); setTimeout(() => b.remove(), 200)
  }
  function positionBubble() {
    if (!bubble) return
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight
    const cx = x + SW / 2
    const left = clamp(cx - bw / 2, 6, W() - bw - 6)
    const up = y - bh - 12 > 6
    const top = up ? y + size * 0.04 - bh - 8 : y + size + 10
    bubble.classList.toggle('up', up); bubble.classList.toggle('down', !up)
    // 用 left/top 定位，不用 transform：弹出 / 淡出动画改的是 transform，会把位置盖掉，气泡就闪到左上角
    bubble.style.left = left + 'px'; bubble.style.top = Math.max(6, top) + 'px'
    const tx = clamp(cx - left, 18, bw - 18)
    bubble.style.setProperty('--tx', tx + 'px'); bubble.style.setProperty('--ox', tx + 'px'); bubble.style.setProperty('--oy', up ? '100%' : '0%')
  }
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const paint = s => esc(s).replace(/「([^」]*)」?/g, (m) => `<span class="fy-q">${m}</span>`)

  /**
   * @param {{ text: string, tag?: string, priv?: boolean, anim?: string, react?: any }} line
   *   react：传了（一个时刻）就在最后一拍说完后，底下出 👍 👎 和两个按这一类写好的反应。
   */
  function say(line) {
    hideBubble()
    thinking = null
    const rs = rounds(line.text), parts = rs.map(r => r.text)
    const b = doc.createElement('div'); b.className = 'fy-bubble up'
    b.innerHTML = (line.tag ? `<div class="fy-tag${line.priv ? ' priv' : ''}">${esc(line.tag)}</div>` : '') + '<div class="fy-text"></div>'
    root.appendChild(b); bubble = b
    const textEl = b.querySelector('.fy-text')
    const html = (k, s) => `<div${rs[k].who === 'master' ? ' class="fy-m"' : ''}>${paint(s)}</div>`
    // 先用全文撑出最终大小再定位，打字时气泡不抖
    textEl.innerHTML = rs.map((r, k) => html(k, r.text)).join(''); b.style.width = Math.min(340, Math.max(line.react || line.chat ? 250 : 120, b.offsetWidth)) + 'px'
    textEl.innerHTML = ''
    positionBubble()
    const t = talk = { i: 0, typed: '', full: false, timer: 0, line }
    if (expr === 'flip') exprTimer = setTimeout(() => playAnim(line.anim || 'idle'), 900)   // 第 6 帧「看到了」先停一下
    else if (line.anim) playAnim(line.anim)
    const paintTo = (s) => { textEl.innerHTML = parts.slice(0, t.i).map((p, k) => html(k, p)).join('') + html(t.i, s); positionBubble() }
    function startBeat() {
      if (talk !== t) return
      const target = parts[t.i]
      let n = 0
      t.full = false
      const tick = () => {
        if (talk !== t) return
        n++
        paintTo([...target].slice(0, n).join(''))
        if (n < [...target].length) { t.timer = setTimeout(tick, TYPE_MS) } else beatDone()
      }
      t.finish = () => { clearTimeout(t.timer); paintTo(target); beatDone() }
      tick()
    }
    function beatDone() {
      if (talk !== t) return
      t.full = true
      const isLast = t.i === parts.length - 1
      if (isLast && line.rate && !dragging) addRate(b, line.rate, line.text)
      if (isLast && line.react) addReactions(b, line.react)
      else if (isLast && line.chat) addChat(b, line.chat)
      const read = Math.max(isLast ? (line.react || line.chat ? 9000 : line.rate ? 6000 : 3500) : 700, [...parts[t.i]].length * (isLast ? 110 : 40))
      t.timer = setTimeout(() => { if (isLast) { hideBubble(); idle() } else { t.i++; startBeat() } }, read)
    }
    // 鼠标停在气泡上就别收（在犹豫点哪个反应）
    b.addEventListener('pointerenter', () => { if (talk === t && t.full && t.i === parts.length - 1) clearTimeout(t.timer) })
    b.addEventListener('pointerleave', () => { if (talk === t && t.full && t.i === parts.length - 1) { clearTimeout(t.timer); t.timer = setTimeout(hideBubble, 2500) } })
    b.addEventListener('pointerdown', e => {
      e.stopPropagation()
      if (talk !== t) return
      if (!t.full) return t.finish()
      clearTimeout(t.timer)
      if (t.i < parts.length - 1) { t.i++; startBeat() } else hideBubble()
    })
    startBeat()
  }

  /** 说完后底下那一排：👍 👎（记下来，以后这一类多说 / 少说）+ 一个这一类专属的反应（点了她接一句）+「再翻一件」。 */
  function addReactions(b, m) {
    const row = doc.createElement('div'); row.className = 'fy-react'
    const opts2 = [
      ['👍', '这种好玩', () => { vote(m, 1); say({ text: pick(REPLY.up), anim: 'proud', chat: 'proud' }) }],
      ['👎', '这种没意思', () => { vote(m, -1); say({ text: pick(REPLY.down), anim: 'sigh', chat: 'sad' }) }],
      ...shuffle((REACT[m.kind] || REACT.work).filter(r => r.replies.length)).slice(0, 1).map(r => [r.label, null, () => say({ text: pick(r.replies), anim: r.anim, chat: ANIM_MOOD[r.anim] || 'happy' })]),
      ['再翻一件', null, () => poke()],
    ]
    for (const [label, title, fn] of opts2) {
      const btn = doc.createElement('button'); btn.textContent = label; if (title) { btn.title = title; btn.className = 'emo' }
      btn.addEventListener('pointerdown', e => e.stopPropagation())
      btn.addEventListener('click', e => { e.stopPropagation(); fn() })
      row.appendChild(btn)
    }
    b.appendChild(row)
    positionBubble()
  }
  /** 短句（拖、甩、落地、碎碎念）底下一对小 👍 👎：记下来，👎 的以后不说，👍 的多说 */
  function addRate(b, what, text) {
    const row = doc.createElement('div'); row.className = 'fy-react fy-rate'
    const done = msg => { row.innerHTML = ''; const s = doc.createElement('span'); s.className = 'fy-rated'; s.textContent = msg; row.appendChild(s); positionBubble() }
    for (const [label, d, msg] of [['👍', 1, '记下了，以后多说这句'], ['👎', -1, '好，这句以后不说了']]) {
      const btn = doc.createElement('button'); btn.textContent = label; btn.className = 'emo'; btn.title = d > 0 ? '这句好玩' : '这句不好'
      btn.addEventListener('pointerdown', e => e.stopPropagation())
      btn.addEventListener('click', e => {
        e.stopPropagation(); rateLine(what, text, d)
        // 打完分她要接一句（按这句是哪种：落地 / 被拎 / 碎碎念），然后接着聊
        const g = LINES.rateReply[/^落地/.test(what) ? 'land' : /^(被拎|拎|被甩)/.test(what) ? 'drag' : 'idle']
        const reply = g && pickLine(g[d > 0 ? 'up' : 'down'])
        if (reply) say({ text: reply, anim: d > 0 ? 'proud' : 'sigh', chat: d > 0 ? 'proud' : 'sad' })
        else { done(msg); if (talk) { clearTimeout(talk.timer); talk.timer = setTimeout(() => { hideBubble(); idle() }, 1500) } }
      })
      row.appendChild(btn)
    }
    b.appendChild(row)
    positionBubble()
  }
  /**
   * 无限轮：她回完一句，按她现在的心情给两个主人能说的话（chat.js），点了她接一句、换心情，再给两个……
   * 旁边永远有「再翻一件」。最近说过的按钮和回话先不重复。
   */
  const recent = { labels: [], replies: [] }
  const remember = (list, x, n) => { list.push(x); if (list.length > n) list.shift() }
  function addChat(b, mood) {
    const row = doc.createElement('div'); row.className = 'fy-react'
    const pool = CHAT[mood] || CHAT.happy
    const fresh = pool.filter(c => !recent.labels.includes(c[0]))
    // 点得多的按钮更常出现（权重 1 + 点过次数 / 2，封顶 4）
    const cw = c => Math.min(4, 1 + (fb.clicks[c[0]] || 0) / 2)
    const two = (fresh.length >= 2 ? fresh : pool).map(c => [Math.random() ** (1 / cw(c)), c]).sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1])
    for (const [label, replies, to] of two) {
      const btn = doc.createElement('button'); btn.textContent = label
      btn.addEventListener('pointerdown', e => e.stopPropagation())
      btn.addEventListener('click', e => {
        e.stopPropagation()
        remember(recent.labels, label, 8)
        fb.clicks[label] = (fb.clicks[label] || 0) + 1; logFb('聊天按钮', label, 1); saveFb()
        noteAct({ type: 'chat', label })
        const left = replies.filter(r => !recent.replies.includes(r))
        const text = pick(left.length ? left : replies)
        remember(recent.replies, text, 30)
        say({ text, anim: MOOD_ANIM[to], chat: to })
      })
      row.appendChild(btn)
    }
    const more = doc.createElement('button'); more.textContent = '再翻一件'
    more.addEventListener('pointerdown', e => e.stopPropagation())
    more.addEventListener('click', e => { e.stopPropagation(); poke() })
    row.appendChild(more)
    b.appendChild(row)
    positionBubble()
  }

  function vote(m, d) {
    const cur = fb.kinds[m.kind] || [0, 0]
    fb.kinds[m.kind] = d > 0 ? [cur[0] + 1, cur[1]] : [cur[0], cur[1] + 1]
    if (d) fb.lines[m.text] = d                      // 这一件本身也记：👎 的不再翻出来
    logFb('旧账·' + (KIND[m.kind] || m.kind), m.text, d); saveFb()
    noteAct({ type: 'vote', d, kind: m.kind })
    for (const k in queues) delete queues[k]       // 下一轮按新口味重新排
  }

  // ---------- 戳 ----------
  // 戳一下 →「让本肥鱼想想……」0.7～1.3 秒 → 说。想的时候再戳：先「别催」，连戳就生气、冷静几秒。
  let thinking = null
  let pokes = []
  let sulkUntil = 0
  function thinkBubble(text) {
    hideBubble()
    const b = doc.createElement('div'); b.className = 'fy-bubble up fy-think'
    b.innerHTML = `<div class="fy-text">${esc(text)}<span class="fy-ell"><i>.</i><i>.</i><i>.</i></span></div>`
    b.addEventListener('pointerdown', e => e.stopPropagation())
    root.appendChild(b); bubble = b
    positionBubble()
  }

  async function poke() {
    closeMenu()
    const now = Date.now()
    if (now < sulkUntil) { squash(0.9, 1.08, 120); if (!bubble) say({ text: pick(REPLY.sulk), anim: 'angry' }); return }   // 生气那句还在就别盖掉
    pokes = pokes.filter(t => now - t < 5000); pokes.push(now)
    if (pokes.length >= 5) {
      pokes = []; sulkUntil = now + 4000; noteAct({ type: 'sulk' })
      vy = -900; squash(0.8, 1.2, 160); kick()
      return say({ text: pick(REPLY.angry), anim: 'angry' })
    }
    if (thinking) {
      thinking.nags++
      squash(1.08, 0.92, 90)
      thinkBubble(pick(REPLY.nag))
      return
    }
    // 蹦一下，开始想
    vy = -620; vx = 0; squash(1.12, 0.86, 90); kick()
    // 碎碎念：「只随便聊聊」时每次都是；「随便」时大约四次里一次；别的模式不说
    const pr0 = opts.prefs.get()
    const idleOdds = pr0.mode === 'idle' ? 1 : (pr0.mode || 'all') === 'all' ? (typeof pr0.idleOdds === 'number' ? pr0.idleOdds : 0.25) : 0
    if (Math.random() < idleOdds) {
      const line = pickIdle()
      if (line) return say({ text: line.text, tag: '碎碎念', anim: MOOD_ANIM[line.mood] || 'idle', chat: line.mood, rate: '碎碎念' })
    }
    const me = thinking = { nags: 0 }
    hideBubble()
    const flipping = flipStart()                  // 有翻本子的帧就翻本子，不弹「想想」气泡
    if (!flipping) { thinkBubble(pick(REPLY.think)); setExpr('thinking') }
    const wait = new Promise(r => setTimeout(r, flipping ? 620 : 700 + Math.random() * 600))   // 至少翻完一遍
    const d = data || await load()
    await wait
    if (thinking !== me) return
    thinking = null
    if (flipping) { flipFound(); await new Promise(r => setTimeout(r, 380)) }   // 「看到了」，停一下再开口
    if (!d) { flipStop(); return say({ text: '本肥鱼脑子卡住了，想不起来……（读记录失败了）', anim: 'sigh' }) }
    const pr = opts.prefs.get()
    const f = MODES.find(m => m[0] === pr.mode)?.[2] || (() => true)
    const qk = (pr.mode || 'all') + (pr.priv === false ? 0 : 1)
    if (!queues[qk]?.length) {
      // 带权重洗牌：👍 多的那一类更常出现，👎 多的少出现（加权蓄水池抽样的 key = u^(1/w)，大的先出）
      // 👎 过的那一件不再翻；👍 过的那一件权重再乘 3
      const w = m => { const [u, dn] = fb.kinds[m.kind] || [0, 0]; return (1 + u) / (1 + dn * 2) * ((fb.lines[m.text] || 0) > 0 ? 3 : 1) }
      queues[qk] = d.moments.filter(m => f(m) && (pr.priv === false || !m.sensitive.length) && !((fb.lines[m.text] || 0) < 0))
        .map(m => [Math.random() ** (1 / w(m)), m]).sort((a, b) => a[0] - b[0]).map(x => x[1])
    }
    const m = queues[qk].pop()
    if (!m) {
      return say({ text: d.moments.length ? '这一类本肥鱼想不起来了……右键换一类？' : '本肥鱼还没跟主人一起干过活呢。派点活给本肥鱼？', anim: 'poke' })
    }
    sayMoment(m)
  }
  function sayMoment(m) {
    ctx.moment = { kind: m.kind, t: Date.now() }
    const ago = Math.round((Date.now() - m.ts) / 864e5)
    const tag = [KIND[m.kind], m.kind === 'stat' ? null : ago <= 0 ? '今天' : `${ago} 天前`].filter(Boolean).join(' · ')
    say({ text: m.text, tag: m.sensitive.length ? tag + ' · 私事' : tag, priv: m.sensitive.length > 0, anim: m.anim, react: m })
  }


  /** 挑一句碎碎念：只要现在这个钟点能说的（没写 hours 的随时能说），最近说过的 60 句先不重复 */
  const idleSeen = []
  function pickIdle() {
    const h = new Date().getHours()
    const fits = l => !l.hours || (l.hours[0] <= l.hours[1] ? h >= l.hours[0] && h < l.hours[1] : h >= l.hours[0] || h < l.hours[1])
    const pool = IDLE.filter(fits).filter(l => !((fb.lines[l.text] || 0) < 0))
    const fresh = pool.filter(l => !idleSeen.includes(l.text))
    const line = pickLine(fresh.length ? fresh : pool)
    if (line) { idleSeen.push(line.text); if (idleSeen.length > 60) idleSeen.shift() }
    return line
  }

  // ---------- 菜单 ----------
  let menu = null, folded = null
  function closeMenu() { if (menu) { menu.remove(); menu = null } }
  function openMenu(mx, my) {
    closeMenu(); hideBubble()
    const pr = opts.prefs.get()
    const m = doc.createElement('div'); m.className = 'fy-menu'
    const item = (label, on, fn) => { const b = doc.createElement('button'); b.textContent = label; if (on) b.className = 'on'; b.onclick = () => { closeMenu(); fn() }; m.appendChild(b) }
    const h = doc.createElement('h6'); h.textContent = '说哪一类'; m.appendChild(h)
    for (const [k, label] of MODES) item((pr.mode || 'all') === k ? '● ' + label : '○ ' + label, (pr.mode || 'all') === k, () => opts.prefs.set({ mode: k }))
    m.appendChild(doc.createElement('hr'))
    item((pr.priv === false ? '☐' : '☑') + ' 藏起私事（健康、感情、成绩、家庭）', false, () => { opts.prefs.set({ priv: pr.priv === false }) })
    item('重新翻记录', false, () => { say({ text: '本肥鱼重新翻一遍记录……', anim: 'file' }); load(true).then(d => d && say({ text: `翻完了：${d.moments.length} 件事可以说。`, anim: 'cheer' })) })
    for (const x of opts.menuExtras?.() || []) item(x.label, false, x.onClick)
    item('先收起来', false, fold)
    m.appendChild(doc.createElement('hr'))
    const p = doc.createElement('p'); p.textContent = (opts.note?.(data) || '') + '都在本机算，不调模型。一碗白饭 = 5 万 token。'; m.appendChild(p)
    root.appendChild(m)
    m.style.left = clamp(mx, 6, W() - m.offsetWidth - 6) + 'px'; m.style.top = clamp(my, 6, H() - m.offsetHeight - 6) + 'px'
    m.addEventListener('pointerdown', e => e.stopPropagation())
    menu = m
  }
  const onDocDown = e => { if (menu && !menu.contains(e.target)) closeMenu() }
  doc.addEventListener('pointerdown', onDocDown, true)

  function fold() {
    hideBubble(); pet.style.display = 'none'
    folded = doc.createElement('button'); folded.className = 'fy-dot'; folded.textContent = '🐳'; folded.title = '把小本本叫回来'
    folded.style.left = clamp(x + SW - 44, 0, W() - 40) + 'px'; folded.style.top = clamp(y + size - 44, 0, H() - 40) + 'px'
    folded.onclick = () => { folded.remove(); folded = null; pet.style.display = ''; opts.prefs.set({ folded: false }); idle() }
    root.appendChild(folded); opts.prefs.set({ folded: true })
  }

  const onResize = () => { x = clamp(x, 0, W() - SW); y = clamp(y, 0, floor()); place(); kick() }
  const win = doc.defaultView
  win.addEventListener('resize', onResize)

  place(); kick()
  if (p0.folded) fold()

  /** 设置页「调试」用：手动触发各种样子和动作，读当前状态 */
  async function debug(a = {}) {
    switch (a.do) {
      case 'state': return {
        expr, walking: !!walking, dragging: !!dragging, talking: !!bubble, x: Math.round(x), y: Math.round(y),
        quiet: Math.round((Date.now() - lastActive) / 1000), loaded: FIGURES.filter(n => srcs[n]).length, figures: FIGURES.length,
        moments: data ? data.moments.length : null, kinds: data ? Object.fromEntries(Object.keys(KIND).map(k => [k, data.moments.filter(m => m.kind === k).length])) : null,
        idle: IDLE.length, visible: !!W(),
      }
      case 'show': {
        hideBubble(); thinking = null
        const ms = a.ms ?? 4000
        if (a.name === 'normal' || a.name in MARK || POSES.includes(a.name)) return setExpr(a.name, ms)
        setExpr('normal'); expr = 'frame'; show(a.name)            // 单帧（眨眼、翻本子、走路）：只摆出来看
        exprTimer = setTimeout(() => setExpr('normal'), ms); return
      }
      case 'poke': return poke()
      case 'kind': {
        const d = data || await load()
        const list = (d?.moments || []).filter(m => m.kind === a.kind)
        if (!list.length) return say({ text: `「${KIND[a.kind] || a.kind}」这一类本肥鱼一件都没有。`, anim: 'sigh' })
        return sayMoment(list[Math.floor(Math.random() * list.length)])
      }
      case 'idle': { const l = pickIdle(); if (l) say({ text: l.text, tag: '碎碎念', anim: MOOD_ANIM[l.mood] || 'idle', chat: l.mood, rate: '碎碎念' }); return }
      case 'flip': hideBubble(); if (flipStart()) setTimeout(() => { flipFound(); setTimeout(flipStop, 900) }, 1500); return
      case 'walk': return walk(a.dir || 0)
      case 'sulk': pokes = []; sulkUntil = Date.now() + 4000; vy = -900; squash(0.8, 1.2, 160); kick(); return say({ text: pick(REPLY.angry), anim: 'angry' })
      case 'drop': hideBubble(); setExpr('normal'); y = 0; vy = 0; vx = 0; place(); kick(); return
      case 'home': hideBubble(); setExpr('normal'); x = W() - SW - 24; y = floor(); vx = vy = 0; place(); opts.prefs.set({ x, y }); return
      case 'feedback': return JSON.parse(JSON.stringify(fb))
      case 'unrate': rateLine('撤销', a.text, 0); for (const k in queues) delete queues[k]; return true
      case 'clearfb': fb = emptyFeedback(); saveFb(); for (const k in queues) delete queues[k]; return true
      case 'reload': data = null; for (const k in queues) delete queues[k]; { const d = await load(true); return { moments: d ? d.moments.length : null } }
    }
  }

  return {
    say, poke, debug,
    destroy() {
      cancelAnimationFrame(raf); clearInterval(dragTalk); clearTimeout(fbTimer); Promise.resolve(opts.feedback?.save?.(fb)).catch(() => {}); cancelAnimationFrame(walkRaf); clearTimeout(walkTimer); walking = null; clearInterval(restTimer); clearTimeout(blinkTimer); clearTimeout(exprTimer); clearTimeout(flipTimer); hideBubble(); closeMenu(); win.removeEventListener('resize', onResize); doc.removeEventListener('pointerdown', onDocDown, true); root.remove()
    },
  }
}
