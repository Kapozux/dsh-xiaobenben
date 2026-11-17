/**
 * dsh-xiaobenben 浏览器这一半：左边栏「年度回顾」整页；设置里一页「数据来源」+「翻旧账（dsh-pet）」。
 * 槽位用法照 dsh 自带的 ui-schedule（main + sidebar.panellist）和 dsh-usage-calendar（settings.section），见 docs/dsh-api.md §2。
 * 由 tsdown.client.config.js 打成 dsh 要的 lazy-CJS factory 格式。
 */
import { YearPage } from './YearPage.jsx'
import { Sources } from './Sources.jsx'
import { PetSettings } from './PetSettings.jsx'
import { Pet } from './Pet.jsx'
import { CSS } from './style.js'

export const inject = ['slots']
const PANEL_ID = 'xiaobenben'

function Icon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M8 2.5v4M16 2.5v4M3.5 9.5h17" />
      <path d="M8 16.5l2.5-3 2 2 3.5-4" />
    </svg>
  )
}

function SourcesSection() {
  return (
    <div style={{ padding: '4px 0' }}>
      <h3 style={{ margin: '0 0 6px' }}>年度回顾 · 数据来源</h3>
      <Sources />
      <PetSettings />
    </div>
  )
}

export function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-xiaobenben'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'dsh-xiaobenben: styles')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, YearPage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: () => '年度回顾',
  }, Icon))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'xiaobenben',
    order: 60,
    label: () => '年度回顾',
  }, SourcesSection))

  // 大肥鱼：全应用浮层（list slot，新 id 加在旁边，不顶掉别人）；菜单里能「放到桌面上」
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'xiaobenben-pet',
  }, Pet))
}
