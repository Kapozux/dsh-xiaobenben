/**
 * 小本本（dsh 网页里那只）：挂在 shell.overlay（全应用浮层，默认点不到，引擎自己给它打开 pointer-events）。
 * 手感、说话、表情、菜单都在 src/shared/pet-engine.js（和桌面版共用）；这里只接 dsh：取台词、立绘和字体的地址、记偏好、「放到桌面上」。
 * 放到桌面上之后网页里这只就藏起来，免得两只。
 */
import { useEffect, useRef } from 'react'
import { call } from './api.js'
import { createPet, FIGURES } from '../shared/pet-engine.js'

const LS = 'dsh-xiaobenben.pet'
const prefs = {
  get() { try { return { mode: 'all', priv: true, ...JSON.parse(localStorage.getItem(LS) || '{}') } } catch { return { mode: 'all', priv: true } } },
  set(patch) { try { localStorage.setItem(LS, JSON.stringify({ ...prefs.get(), ...patch })) } catch {} },
}

const asset = k => `api/xiaobenben.asset?k=${encodeURIComponent(k)}`
/**
 * 表情图：一开始就整张取下来、转成 blob 地址（眨眼、换表情都用内存里的，不再联网——
 * dsh 重启后旧页面的请求会被拒，以前眨眼时现取闭眼图，取不到就变成一个空框）。取不到的返回 null，引擎用别的图补。
 */
const seen = new Map()
function figureSrc(name) {
  if (!FIGURES.includes(name)) return Promise.resolve(null)
  if (!seen.has(name)) {
    seen.set(name, fetch(asset(`xiaobenben/${name}.png`), { credentials: 'same-origin' })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b ? URL.createObjectURL(b) : null))
      .catch(err => { console.warn('[dsh-xiaobenben] 立绘取不到', name, err); return null }))
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
      size: 300,
      aspect: 360 / 600,
      prefs,
      figureSrc,
      fontSrc: asset('fonts/xbb-rounded.woff2'),
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
    const poll = () => call('desktop', {}).then(syncDesktop).catch(() => {})
    poll()
    const t = setInterval(poll, 5000)       // 桌面那只「回到网页里」之后，这边要再出来
    return () => { clearInterval(t); engine.destroy() }
  }, [])
  return <div ref={ref} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }} />
}
