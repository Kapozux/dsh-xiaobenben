/**
 * 小本本（dsh 网页里那只）：挂在 shell.overlay（全应用浮层，默认点不到，引擎自己给它打开 pointer-events）。
 * 手感、说话、表情、菜单都在 src/shared/pet-engine.js（和桌面版共用）；这里只接 dsh：取台词、立绘和字体的地址、记偏好、「放到桌面上」。
 * 放到桌面上之后网页里这只就藏起来，免得两只。
 */
import { useEffect, useRef } from 'react'
import { call } from './api.js'
import { createPet, FIGURES } from '../shared/pet-engine.js'

const LS = 'dsh-xiaobenben.pet'
export const prefs = {
  get() { try { return { mode: 'all', priv: true, ...JSON.parse(localStorage.getItem(LS) || '{}') } } catch { return { mode: 'all', priv: true } } },
  set(patch) { try { localStorage.setItem(LS, JSON.stringify({ ...prefs.get(), ...patch })) } catch {} },
}

const asset = k => `api/xiaobenben.asset?k=${encodeURIComponent(k)}`
/**
 * 表情图：一开始就整张取下来、转成 blob 地址（眨眼、换表情都用内存里的，不再联网——
 * dsh 重启后旧页面的请求会被拒，以前眨眼时现取闭眼图，取不到就变成一个空框）。取不到的返回 null（下次再取），引擎不画任何备用形象。
 */
const seen = new Map()
function figureSrc(name) {
  if (!FIGURES.includes(name)) return Promise.resolve(null)
  if (!seen.has(name)) {
    seen.set(name, fetch(asset(`xiaobenben/${name}.png`), { credentials: 'same-origin' })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b ? URL.createObjectURL(b) : null))
      .catch(err => { console.warn('[dsh-xiaobenben] 立绘取不到', name, err); return null })
      .then(u => { if (!u) seen.delete(name); return u }))
  }
  return seen.get(name)
}

export function Pet() {
  const ref = useRef(null)
  useEffect(() => {
    const host = ref.current
    let engine = null
    const syncDesktop = d => { host.style.display = d?.desktop?.on ? 'none' : '' }
    engine = createPet(host, {
      size: 340,
      aspect: 576 / 680,
      prefs,
      figureSrc,
      fontSrc: asset('fonts/xbb-rounded.woff2'),
      feedback: { load: () => call('feedback', {}).then(r => r.fb), save: fb => call('feedback', { fb }) },
      loadNow: () => call('now', {}),
      loadMoments: fresh => call('moments', { fresh }).catch(e => { console.warn('[dsh-xiaobenben] 取台词失败', e); return null }),
      note: d => d ? `最近 ${d.days} 天 · ${d.report.map(r => `${r.id === 'dsh' ? 'dsh' : 'Claude Code'} ${r.sessions ?? 0} 个会话`).join(' · ')} · ${d.moments.length} 件。` : '',
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
    // 设置页「调试」发来的指令（同一个页面里的事件，不联网）
    const onDebug = e => { const r = engine.debug(e.detail || {}); e.detail?.reply?.(r) }
    window.addEventListener('xiaobenben:debug', onDebug)
    const poll = () => call('desktop', {}).then(syncDesktop).catch(() => {})
    poll()
    const t = setInterval(poll, 5000)       // 桌面那只「回到网页里」之后，这边要再出来
    return () => { clearInterval(t); window.removeEventListener('xiaobenben:debug', onDebug); engine.destroy() }
  }, [])
  return <div ref={ref} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }} />
}
