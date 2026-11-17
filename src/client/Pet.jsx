/**
 * 大肥鱼（dsh 网页里那只）：挂在 shell.overlay（全应用浮层，默认点不到，引擎自己给大肥鱼打开 pointer-events）。
 * 手感、说话、菜单都在 src/shared/pet-engine.js（和桌面版共用）；这里只接 dsh：取台词、取动画、记偏好、「放到桌面上」。
 * 放到桌面上之后网页里这只就藏起来，免得两只。
 */
import { useEffect, useRef } from 'react'
import { call } from './api.js'
import { createPet } from '../shared/pet-engine.js'

const LS = 'dsh-agent-year.pet'
const prefs = {
  get() { try { return { mode: 'all', priv: true, ...JSON.parse(localStorage.getItem(LS) || '{}') } } catch { return { mode: 'all', priv: true } } },
  set(patch) { try { localStorage.setItem(LS, JSON.stringify({ ...prefs.get(), ...patch })) } catch {} },
}

/** 动画：fetch 成 blob（带上 dsh 的鉴权），按名字缓存 */
const blobs = new Map()
function animSrc(name) {
  if (!blobs.has(name)) {
    blobs.set(name, fetch(`api/agent-year.anim?k=${encodeURIComponent(name)}`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(b => URL.createObjectURL(b))
      .catch(err => { console.warn('[dsh-agent-year] 动画取不到', name, err); blobs.delete(name); return null }))
  }
  return blobs.get(name)
}

export function Pet() {
  const ref = useRef(null)
  useEffect(() => {
    const host = ref.current
    let anims = false
    let engine = null
    const syncDesktop = d => { host.style.display = d?.desktop?.on ? 'none' : '' }
    const syncAnims = d => { if (d && !!d.anims?.length !== anims) { anims = !!d.anims?.length; engine?.refreshFigure() } }
    engine = createPet(host, {
      size: 260,
      prefs,
      hasAnim: () => anims,
      animSrc,
      loadMoments: fresh => call('moments', { fresh }).then(d => { syncAnims(d); return d }).catch(e => { console.warn('[dsh-agent-year] 取台词失败', e); return null }),
      note: d => d ? `最近 ${d.days} 天 · ${d.report.map(r => `${r.id === 'dsh' ? 'dsh' : 'Claude Code'} ${r.sessions ?? 0} 个会话`).join(' · ')} · ${d.moments.length} 句。` : '',
      menuExtras: () => [{
        label: '放到桌面上（关了网页也在）',
        onClick: () => {
          engine.say({ text: '本肥鱼搬家中……', anim: 'file' })
          call('desktop', { on: true }).then(d => {
            if (d.desktop?.on) syncDesktop(d)
            else engine.say({ text: '本肥鱼上不了桌面：' + (d.desktop?.error || '不知道为什么'), anim: 'sigh' })
          }).catch(e => engine.say({ text: '本肥鱼上不了桌面：' + e.message, anim: 'sigh' }))
        },
      }],
    })
    call('moments', {}).then(syncAnims).catch(() => {})
    const poll = () => call('desktop', {}).then(syncDesktop).catch(() => {})
    poll()
    const t = setInterval(poll, 5000)       // 桌面那只「回到网页里」之后，这边要再出来
    return () => { clearInterval(t); engine.destroy() }
  }, [])
  return <div ref={ref} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }} />
}
