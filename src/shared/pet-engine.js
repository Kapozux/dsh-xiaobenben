/**
 * 大肥鱼引擎：不依赖 React，dsh 浮层（Pet.jsx）和桌面窗口（desktop/）共用一份。
 *
 * 手感：
 *   - 有重力，落到「地面」（容器底边）；抓起来能甩，撞墙、落地会弹，落地时压扁再弹回；拖着走时身子顺着速度歪。
 *   - 戳一下：先蹦一下，再说话。
 * 说话：
 *   - 一句拆成两三拍（交代事 → 原话 → 反应），打字机一拍一拍出，笑点在最后一拍，动画也在最后一拍播。
 *   - 点气泡：正在打字就直接显示完，打完了就下一拍；最后一拍读完自己淡出。
 *   - 气泡贴着它、带尖角，靠边时自动换边；顶上一个小标签（哪一类 · 几天前）。
 * 只有主人戳了才说话，不自己冒出来。
 */

const KIND = { work: '干活', late: '深夜', report: '汇报', sorry: '认错', complain: '挨骂', caught: '被抓包', stopped: '被喊停', stat: '总账' }
export const MODES = [
  ['all', '随便', () => true],
  ['week', '最近一周', m => Date.now() - m.ts < 7 * 864e5],
  ['drama', '挨骂与认错', m => ['sorry', 'complain', 'caught', 'stopped'].includes(m.kind)],
  ['work', '干活与汇报', m => ['work', 'late', 'report'].includes(m.kind)],
  ['stat', '总账', m => m.kind === 'stat'],
]

const G = 2600            // 重力 px/s²
const BOUNCE = 0.5        // 撞墙 / 落地留下的速度
const FRICTION = 0.86     // 落地后横向每次弹跳的摩擦
const TYPE_MS = 32        // 打字机每个字
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * 一句台词拆成几拍：按句末标点切，引号「」里面不切；太碎的并起来，最多 3 拍。
 * @param {string} text
 */
export function beats(text) {
  const out = []
  let cur = '', depth = 0
  for (const ch of text) {
    cur += ch
    if (ch === '「') depth++
    else if (ch === '」') depth = Math.max(0, depth - 1)
    if (depth === 0 && (/[。！？!?]/.test(ch) || ch === '\n')) { if (cur.trim()) out.push(cur.trim()); cur = '' }
  }
  if (cur.trim()) out.push(cur.trim())
  // 太短的往后并（「好的好的，本鱼停手。」这种单独成拍可以，但「……」不行）
  const merged = []
  for (const s of out) {
    if (merged.length && ([...merged.at(-1)].length < 8 || [...s].length < 4)) merged[merged.length - 1] += s
    else merged.push(s)
  }
  while (merged.length > 3) {
    let best = 0
    for (let i = 1; i < merged.length - 1; i++) if (merged[i].length + merged[i + 1].length < merged[best].length + merged[best + 1].length) best = i
    merged.splice(best, 2, merged[best] + merged[best + 1])
  }
  return merged
}

const CSS = `
.fy-root { position: absolute; inset: 0; pointer-events: none; overflow: hidden; font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
.fy-pet { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; will-change: transform; }
.fy-pet.drag { cursor: grabbing; }
.fy-body { width: 100%; height: 100%; transform-origin: 50% 100%; transition: transform .16s cubic-bezier(.3,1.6,.5,1); }
.fy-body video, .fy-body svg { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; }
.fy-body video { transform: scale(1.7); transform-origin: 50% 62%; }
.fy-shadow { position: absolute; left: 50%; bottom: 2px; width: 46%; height: 10px; margin-left: -23%; border-radius: 50%; background: rgba(0,0,0,.22); filter: blur(3px); pointer-events: none; }
.fy-bubble { position: absolute; left: 0; top: 0; pointer-events: auto; max-width: 270px; min-width: 120px; box-sizing: border-box; padding: 10px 14px 11px; border-radius: 16px;
  background: #fffdf8; color: #2a241d; border: 2px solid #2a241d; box-shadow: 3px 4px 0 rgba(42,36,29,.9); font-size: 14px; line-height: 1.6; cursor: pointer;
  transform-origin: var(--ox, 50%) var(--oy, 100%); animation: fy-pop .22s cubic-bezier(.3,1.6,.5,1); }
.fy-bubble.out { animation: fy-out .2s ease-in forwards; }
.fy-bubble::after { content: ""; position: absolute; width: 14px; height: 14px; background: #fffdf8; border: 2px solid #2a241d; border-top: 0; border-left: 0;
  left: var(--tx, 50%); margin-left: -8px; }
.fy-bubble.up::after { bottom: -9px; transform: rotate(45deg); }
.fy-bubble.down::after { top: -9px; transform: rotate(225deg); }
.fy-tag { display: inline-block; font-size: 11px; line-height: 1; padding: 3px 7px; margin: 0 0 6px; border-radius: 99px; background: #2a241d; color: #fffdf8; letter-spacing: .5px; }
.fy-tag.priv { background: #c9821c; }
.fy-text { white-space: pre-line; min-height: 1.6em; }
.fy-text .fy-q { color: #2f5bea; font-weight: 600; }
.fy-dots { margin-top: 4px; display: flex; gap: 4px; }
.fy-dots i { width: 5px; height: 5px; border-radius: 50%; background: #d8cfc0; }
.fy-dots i.on { background: #2a241d; }
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
  .fy-dots i { background: #4a4f5a; } .fy-dots i.on { background: #f1ece4; }
  .fy-menu h6, .fy-menu p { color: #9a948a; }
}
`

const FISH_SVG = `<svg viewBox="0 0 120 100" aria-hidden="true"><ellipse cx="58" cy="60" rx="40" ry="30" fill="#3D6FE0"/><path d="M95 60 L116 44 L112 60 L116 76 Z" fill="#3D6FE0"/><ellipse cx="52" cy="70" rx="24" ry="12" fill="#CFE0FF"/><circle cx="42" cy="52" r="5" fill="#fff"/><circle cx="43" cy="53" r="2.6" fill="#1b2a4a"/><path d="M34 64 q6 5 12 0" stroke="#1b2a4a" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`

/**
 * @param {HTMLElement} host 放大肥鱼的容器（铺满可活动的区域）
 * @param {{
 *   loadMoments: (fresh?: boolean) => Promise<{ moments: any[], days?: number, report?: any[] } | null>,
 *   animSrc: (name: string) => Promise<string|null>,
 *   hasAnim: () => boolean,
 *   prefs: { get(): any, set(patch: any): void },
 *   size?: number,
 *   menuExtras?: () => { label: string, onClick: () => void }[],
 *   onPointerArea?: (inside: boolean) => void,   // 桌面版：鼠标进 / 出能点的地方（切点击穿透）
 *   note?: (data: any) => string,
 * }} opts
 */
export function createPet(host, opts) {
  const size = opts.size || 200
  const doc = host.ownerDocument
  if (!doc.getElementById('fy-style')) {
    const st = doc.createElement('style'); st.id = 'fy-style'; st.textContent = CSS; doc.head.appendChild(st)
  }
  const root = doc.createElement('div'); root.className = 'fy-root'; host.appendChild(root)
  const pet = doc.createElement('div'); pet.className = 'fy-pet'; pet.style.width = pet.style.height = size + 'px'; pet.title = '戳一下；抓起来甩；右键有菜单'
  const shadow = doc.createElement('div'); shadow.className = 'fy-shadow'
  const body = doc.createElement('div'); body.className = 'fy-body'
  pet.append(shadow, body); root.appendChild(pet)

  let video = null
  function ensureFigure() {
    if (opts.hasAnim()) {
      if (!video) { body.innerHTML = ''; video = doc.createElement('video'); video.muted = true; video.playsInline = true; video.addEventListener('ended', () => { if (!video.loop) idle() }); body.appendChild(video) }
    } else if (!body.firstChild) body.innerHTML = FISH_SVG
  }
  async function playAnim(name, loop = false) {
    ensureFigure(); if (!video) return
    const u = (await opts.animSrc(name)) || (loop ? null : await opts.animSrc('poke')); if (!u) return
    video.loop = loop; video.src = u; video.play().catch(() => {})
  }
  const idle = () => playAnim('idle', true)

  // ---------- 物理 ----------
  const W = () => host.clientWidth, H = () => host.clientHeight
  const p0 = opts.prefs.get()
  let x = p0.x ?? W() - size - 24, y = p0.y ?? H() - size   // 左上角
  let vx = 0, vy = 0, raf = 0, last = 0, onFloor = false
  let dragging = null
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
    if (dragging) { raf = requestAnimationFrame(step); return }
    vy += G * dt
    x += vx * dt; y += vy * dt
    const maxX = W() - size
    if (x < 0) { x = 0; vx = -vx * BOUNCE; squash(0.86, 1.1) }
    if (x > maxX) { x = maxX; vx = -vx * BOUNCE; squash(0.86, 1.1) }
    if (y < 0) { y = 0; vy = -vy * BOUNCE }
    if (y >= floor() && vy >= 0) {
      y = floor()
      const hit = vy
      if (hit > 260) { vy = -hit * BOUNCE; vx *= FRICTION; squash(1.18, 0.8) }
      else { vy = 0; vx *= 0.8 }
    }
    onFloor = y >= floor() && Math.abs(vy) < 1
    place(clamp(vx * 0.02, -18, 18))
    if (onFloor && Math.abs(vx) < 8) { vx = 0; place(); raf = 0; opts.prefs.set({ x, y }); return }
    raf = requestAnimationFrame(step)
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step) } }

  // ---------- 拖、甩、戳 ----------
  pet.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    pet.setPointerCapture(e.pointerId)
    dragging = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false, hist: [[e.clientX, e.clientY, performance.now()]] }
  })
  pet.addEventListener('pointermove', e => {
    const d = dragging; if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    if (!d.moved) { d.moved = true; pet.classList.add('drag'); hideBubble(); closeMenu(); playAnim('drag', true) }
    d.hist.push([e.clientX, e.clientY, performance.now()]); if (d.hist.length > 6) d.hist.shift()
    const [ax, , at] = d.hist[0]
    const v = (e.clientX - ax) / Math.max(1, performance.now() - at) * 1000
    x = clamp(d.ox + dx, 0, W() - size); y = clamp(d.oy + dy, 0, floor())
    place(clamp(v * 0.015, -25, 25))
  })
  pet.addEventListener('pointerup', e => {
    const d = dragging; dragging = null; pet.classList.remove('drag')
    if (!d) return
    if (d.moved) {
      const [ax, ay, at] = d.hist[0]
      const dtm = Math.max(16, performance.now() - at) / 1000
      vx = clamp((e.clientX - ax) / dtm, -3000, 3000); vy = clamp((e.clientY - ay) / dtm, -3000, 3000)
      idle(); kick()
    } else {
      poke()
    }
  })
  pet.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(e.clientX - host.getBoundingClientRect().left, e.clientY - host.getBoundingClientRect().top) })
  if (opts.onPointerArea) {
    root.addEventListener('pointerover', e => { if (e.target !== root) opts.onPointerArea(true) })
    root.addEventListener('pointerout', e => { if (!e.relatedTarget || e.relatedTarget === root || !root.contains(e.relatedTarget)) opts.onPointerArea(false) })
  }

  // ---------- 说话 ----------
  let data = null, inflight = null
  const queues = {}
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
    const cx = x + size / 2
    const left = clamp(cx - bw / 2, 6, W() - bw - 6)
    const up = y - bh - 12 > 6
    const top = up ? y + size * 0.12 - bh - 12 : y + size + 10
    bubble.classList.toggle('up', up); bubble.classList.toggle('down', !up)
    bubble.style.transform = `translate(${left}px, ${Math.max(6, top)}px)`
    const tx = clamp(cx - left, 18, bw - 18)
    bubble.style.setProperty('--tx', tx + 'px'); bubble.style.setProperty('--ox', tx + 'px'); bubble.style.setProperty('--oy', up ? '100%' : '0%')
  }
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const paint = s => esc(s).replace(/「([^」]*)」?/g, (m) => `<span class="fy-q">${m}</span>`)

  /** @param {{ text: string, tag?: string, priv?: boolean, anim?: string }} line */
  function say(line) {
    hideBubble()
    const parts = beats(line.text)
    const b = doc.createElement('div'); b.className = 'fy-bubble up'
    b.innerHTML = (line.tag ? `<div class="fy-tag${line.priv ? ' priv' : ''}">${esc(line.tag)}</div>` : '') + '<div class="fy-text"></div>' + (parts.length > 1 ? `<div class="fy-dots">${parts.map(() => '<i></i>').join('')}</div>` : '')
    root.appendChild(b); bubble = b
    const textEl = b.querySelector('.fy-text')
    // 先用全文撑出最终大小再定位，打字时气泡不抖
    textEl.textContent = parts.join(''); b.style.width = Math.min(270, Math.max(120, b.offsetWidth)) + 'px'
    textEl.textContent = ''
    positionBubble()
    const t = talk = { i: 0, typed: '', full: false, timer: 0 }
    const dots = [...b.querySelectorAll('.fy-dots i')]
    const show = (s) => { textEl.innerHTML = paint(s); positionBubble() }
    function startBeat() {
      if (talk !== t) return
      const isLast = t.i === parts.length - 1
      if (isLast && line.anim) playAnim(line.anim)
      dots.forEach((d, k) => d.classList.toggle('on', k <= t.i))
      const before = parts.slice(0, t.i).join('')
      const target = parts[t.i]
      let n = 0
      t.full = false
      const tick = () => {
        if (talk !== t) return
        n++
        show(before + [...target].slice(0, n).join(''))
        if (n < [...target].length) { t.timer = setTimeout(tick, TYPE_MS) } else beatDone()
      }
      t.finish = () => { clearTimeout(t.timer); show(before + target); beatDone() }
      tick()
    }
    function beatDone() {
      if (talk !== t) return
      t.full = true
      const isLast = t.i === parts.length - 1
      const read = Math.max(isLast ? 3500 : 900, [...parts[t.i]].length * (isLast ? 110 : 45))
      t.timer = setTimeout(() => { if (isLast) hideBubble(); else { t.i++; startBeat() } }, read)
    }
    b.addEventListener('pointerdown', e => {
      e.stopPropagation()
      if (talk !== t) return
      if (!t.full) return t.finish()
      clearTimeout(t.timer)
      if (t.i < parts.length - 1) { t.i++; startBeat() } else hideBubble()
    })
    startBeat()
  }

  async function poke() {
    closeMenu()
    // 蹦一下
    vy = -620; vx = 0; squash(1.12, 0.86, 90); kick()
    let d = data
    if (!d) { say({ text: '本鱼在翻记录……等一下下。', anim: 'file' }); d = await load() }
    if (!d) return say({ text: '本鱼脑子卡住了，想不起来……（读记录失败了）', anim: 'sigh' })
    const pr = opts.prefs.get()
    const f = MODES.find(m => m[0] === pr.mode)?.[2] || (() => true)
    const qk = (pr.mode || 'all') + (pr.priv === false ? 0 : 1)
    if (!queues[qk]?.length) {
      const pool = d.moments.filter(m => f(m) && (pr.priv === false || !m.sensitive.length))
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
      queues[qk] = pool
    }
    const m = queues[qk].pop()
    if (!m) {
      return say({ text: d.moments.length ? '这一类本鱼想不起来了……右键换一类？' : '本鱼还没跟主人一起干过活呢。派点活给本鱼？', anim: 'poke' })
    }
    const ago = Math.round((Date.now() - m.ts) / 864e5)
    const tag = [KIND[m.kind], m.kind === 'stat' ? null : ago <= 0 ? '今天' : `${ago} 天前`].filter(Boolean).join(' · ')
    say({ text: m.text, tag: m.sensitive.length ? tag + ' · 私事' : tag, priv: m.sensitive.length > 0, anim: m.anim })
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
    item('重新翻记录', false, () => { say({ text: '本鱼重新翻一遍记录……', anim: 'file' }); load(true).then(d => d && say({ text: `翻完了：${d.moments.length} 件事可以说。`, anim: 'cheer' })) })
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
    folded = doc.createElement('button'); folded.className = 'fy-dot'; folded.textContent = '🐟'; folded.title = '把大肥鱼叫回来'
    folded.style.left = clamp(x + size - 44, 0, W() - 40) + 'px'; folded.style.top = clamp(y + size - 44, 0, H() - 40) + 'px'
    folded.onclick = () => { folded.remove(); folded = null; pet.style.display = ''; opts.prefs.set({ folded: false }); idle() }
    root.appendChild(folded); opts.prefs.set({ folded: true })
  }

  const onResize = () => { x = clamp(x, 0, W() - size); y = clamp(y, 0, floor()); place(); kick() }
  const win = doc.defaultView
  win.addEventListener('resize', onResize)

  ensureFigure(); place(); idle(); kick()
  if (p0.folded) fold()

  return {
    refreshFigure() { video = null; body.innerHTML = ''; ensureFigure(); idle() },
    say, poke,
    destroy() {
      cancelAnimationFrame(raf); hideBubble(); closeMenu(); win.removeEventListener('resize', onResize); doc.removeEventListener('pointerdown', onDocDown, true); root.remove()
    },
  }
}
