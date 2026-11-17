/**
 * 大肥鱼：挂在 dsh 的 shell.overlay（全应用浮层，默认点不到，本组件自己打开 pointer-events）。
 * 戳一下 → 说一句「时刻」（host 的 /api/agent-year.moments 算好的，确定性，不调模型）。
 * 能拖、位置记在本机；右键菜单换分类、藏私事、收起来。只在主人点了才说话，不会自己冒出来。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'

const KIND = { work: '干活', late: '深夜', report: '汇报', sorry: '认错', complain: '挨骂', caught: '被抓包', stopped: '被喊停', stat: '总账' }
const MODES = [
  ['all', '随便', () => true],
  ['week', '最近一周', m => Date.now() - m.ts < 7 * 864e5],
  ['drama', '挨骂与认错', m => ['sorry', 'complain', 'caught', 'stopped'].includes(m.kind)],
  ['work', '干活与汇报', m => ['work', 'late', 'report'].includes(m.kind)],
  ['stat', '总账', m => m.kind === 'stat'],
]
const SIZE = 210
const LS = 'dsh-agent-year.pet'

function loadPrefs() {
  try { return { x: null, y: null, mode: 'all', priv: true, folded: false, ...JSON.parse(localStorage.getItem(LS) || '{}') } } catch { return { x: null, y: null, mode: 'all', priv: true, folded: false } }
}
function savePrefs(p) { try { localStorage.setItem(LS, JSON.stringify(p)) } catch {} }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** 动画：用 fetch 取成 blob（带上 dsh 的鉴权），按名字缓存 */
const blobs = new Map()
function animUrl(name) {
  if (!blobs.has(name)) {
    blobs.set(name, fetch(`api/agent-year.anim?k=${encodeURIComponent(name)}`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(b => URL.createObjectURL(b))
      .catch(err => { console.warn('[dsh-agent-year] 动画取不到', name, err); blobs.delete(name); return null }))
  }
  return blobs.get(name)
}

/** 没有动画时的备用形象：一条圆滚滚的蓝鱼 */
function FallbackFish() {
  return (
    <svg viewBox="0 0 120 100" width="100%" height="100%" aria-hidden="true">
      <ellipse cx="58" cy="56" rx="40" ry="30" fill="#3D6FE0" />
      <path d="M95 56 L116 40 L112 56 L116 72 Z" fill="#3D6FE0" />
      <ellipse cx="52" cy="66" rx="24" ry="12" fill="#CFE0FF" />
      <circle cx="42" cy="48" r="5" fill="#fff" /><circle cx="43" cy="49" r="2.6" fill="#1b2a4a" />
      <path d="M34 60 q6 5 12 0" stroke="#1b2a4a" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function Pet() {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [data, setData] = useState(null)        // { moments, anims, report, days }
  const [err, setErr] = useState(null)
  const [say, setSay] = useState(null)          // { text, meta }
  const [menu, setMenu] = useState(null)        // {x, y}
  const videoRef = useRef(null)
  const queue = useRef({})
  const hideTimer = useRef(null)
  const drag = useRef(null)

  const update = useCallback(patch => setPrefs(p => { const n = { ...p, ...patch }; savePrefs(n); return n }), [])

  // 位置：默认右下角，窗口变小时拉回可见范围
  const [vw, setVw] = useState(() => window.innerWidth)
  const [vh, setVh] = useState(() => window.innerHeight)
  useEffect(() => {
    const on = () => { setVw(window.innerWidth); setVh(window.innerHeight) }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const x = clamp(prefs.x ?? vw - SIZE - 28, 0, vw - SIZE)
  const y = clamp(prefs.y ?? vh - SIZE - 120, 0, vh - SIZE)

  const inflight = useRef(null)
  const load = useCallback((fresh = false) => {
    if (inflight.current && !fresh) return inflight.current
    const p = call('moments', { fresh })
      .then(d => { setData(d); setErr(null); queue.current = {}; return d })
      .catch(e => { setErr(e.message); return null })
      .finally(() => { if (inflight.current === p) inflight.current = null })
    inflight.current = p
    return p
  }, [])
  useEffect(() => { const t = setTimeout(() => load(), 3000); return () => clearTimeout(t) }, [load])

  const hasAnim = !!data?.anims?.length
  const playIdle = useCallback(async () => {
    const v = videoRef.current; if (!v) return
    const u = await animUrl('idle'); if (!u) return
    v.loop = true; v.src = u; v.play().catch(() => {})
  }, [])
  const play = useCallback(async name => {
    const v = videoRef.current; if (!v) return
    const u = (await animUrl(name)) || (await animUrl('poke')); if (!u) return
    v.loop = false; v.src = u; v.play().catch(() => {})
  }, [])
  useEffect(() => { if (hasAnim && !prefs.folded) playIdle() }, [hasAnim, prefs.folded, playIdle])

  const showLine = useCallback((text, meta, anim) => {
    setSay({ text, meta })
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setSay(null), Math.max(7000, text.length * 160))
    if (anim && hasAnim) play(anim)
  }, [hasAnim, play])

  const poke = useCallback(async () => {
    setMenu(null)
    let d = data
    if (!d) { showLine('本鱼在翻记录……等一下下。', null, 'file'); d = await load() }
    if (!d) return showLine('本鱼脑子卡住了，一时想不起来……（读记录失败：' + (err || '没连上') + '）', null, 'sigh')
    const f = MODES.find(m => m[0] === prefs.mode)?.[2] || (() => true)
    const qk = prefs.mode + (prefs.priv ? 1 : 0)
    if (!queue.current[qk]?.length) {
      const pool = d.moments.filter(m => f(m) && (!prefs.priv || !m.sensitive.length))
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
      queue.current[qk] = pool
    }
    const m = queue.current[qk].pop()
    if (!m) {
      const empty = !d.moments.length
      return showLine(empty
        ? '本鱼还没跟主人一起干过活呢。派点活给本鱼？（也可以去「设置 → 年度回顾」把 Claude Code 的记录勾上，本鱼帮你翻旧账）'
        : '这一类本鱼想不起来了……右键换一类？', null, 'poke')
    }
    const ago = Math.round((Date.now() - m.ts) / 864e5)
    const meta = [KIND[m.kind], m.kind === 'stat' ? null : ago <= 0 ? '今天' : `${ago} 天前`, m.sensitive.length ? `私事：${m.sensitive.join('、')}` : null].filter(Boolean).join(' · ')
    showLine(m.text, meta, m.anim)
  }, [data, load, err, prefs.mode, prefs.priv, showLine])

  // 拖动：移动超过 5px 才算拖，否则算戳
  const onDown = e => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false }
  }
  const onMove = e => {
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    if (!d.moved) { d.moved = true; setSay(null); if (hasAnim) play('drag') }
    setPrefs(p => ({ ...p, x: clamp(d.ox + dx, 0, vw - SIZE), y: clamp(d.oy + dy, 0, vh - SIZE) }))
  }
  const onUp = () => {
    const d = drag.current; drag.current = null
    if (!d) return
    if (d.moved) { setPrefs(p => { savePrefs(p); return p }); if (hasAnim) playIdle() } else poke()
  }
  const onVideoEnd = () => { if (videoRef.current && !videoRef.current.loop) playIdle() }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  if (prefs.folded) {
    return (
      <button className="ay-pet-dot" style={{ left: clamp(x + SIZE - 40, 0, vw - 40), top: clamp(y + SIZE - 40, 0, vh - 40) }}
        title="把大肥鱼叫回来" onClick={() => update({ folded: false })}>🐟</button>
    )
  }

  const bubbleLeft = clamp(x + SIZE / 2 - 160, 8, vw - 328)
  const bubbleAbove = y > 200
  return (
    <>
      {say && (
        <div className="ay-pet-bubble" role="status" onClick={() => setSay(null)}
          style={bubbleAbove ? { left: bubbleLeft, bottom: vh - y + 6 } : { left: bubbleLeft, top: y + SIZE + 6 }}>
          <div className="ay-pet-say">{say.text}</div>
          {say.meta && <div className="ay-pet-meta">{say.meta}</div>}
        </div>
      )}
      <div className="ay-pet" style={{ left: x, top: y, width: SIZE, height: SIZE }}
        title="戳一下；拖着走；右键有菜单"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onContextMenu={e => { e.preventDefault(); setSay(null); setMenu({ x: clamp(e.clientX, 8, vw - 236), y: clamp(e.clientY, 8, vh - 372) }) }}>
        {hasAnim
          ? <video ref={videoRef} muted playsInline onEnded={onVideoEnd} draggable={false} />
          : <FallbackFish />}
      </div>
      {menu && (
        <div className="ay-pet-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()}>
          <div className="ay-pet-menu-h">说哪一类</div>
          {MODES.map(([k, label]) => (
            <button key={k} className={'ay-pet-item' + (prefs.mode === k ? ' on' : '')} onClick={() => { update({ mode: k }); setMenu(null) }}>
              {prefs.mode === k ? '● ' : '○ '}{label}
            </button>
          ))}
          <div className="ay-pet-sep" />
          <button className="ay-pet-item" onClick={() => update({ priv: !prefs.priv })}>{prefs.priv ? '☑' : '☐'} 藏起私事（健康、感情、成绩、家庭）</button>
          <button className="ay-pet-item" onClick={() => { setMenu(null); load(true).then(d => d && showLine(`重新翻了一遍记录：${d.moments.length} 件事可以说。`, null, 'file')) }}>重新翻记录</button>
          <button className="ay-pet-item" onClick={() => { setMenu(null); setSay(null); update({ folded: true }) }}>先收起来</button>
          <div className="ay-pet-sep" />
          <div className="ay-pet-note">
            {data ? `最近 ${data.days} 天 · ${data.report.map(r => `${r.id === 'dsh' ? 'dsh' : 'Claude Code'} ${r.sessions ?? 0} 个会话`).join(' · ')} · ${data.moments.length} 句` : err ? `读记录失败：${err}` : '还在翻记录……'}
            <br />都在本机算，不调模型。一碗白饭 = 5 万 token。
          </div>
        </div>
      )}
    </>
  )
}
