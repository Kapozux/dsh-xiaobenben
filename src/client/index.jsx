/**
 * dsh-agent-year 浏览器这一半：左边栏「年度回顾」整页、「翻旧账」一页；设置里一页「数据来源」。
 * 槽位用法照 dsh 自带的 ui-schedule（main + sidebar.panellist）和 dsh-usage-calendar（settings.section），见 docs/dsh-api.md §2。
 * 由 tsdown.client.config.js 打成 dsh 要的 lazy-CJS factory 格式。
 */
import { YearPage } from './YearPage.jsx'
import { Sources } from './Sources.jsx'
import { Recall } from './Recall.jsx'
import { CSS } from './style.js'

export const inject = ['slots']
const PANEL_ID = 'agent-year'
const RECALL_ID = 'agent-year-recall'

function RecallIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z" />
      <path d="M5 16.5a3 3 0 0 1 3-3h11" />
      <path d="M9 8.5h6" />
    </svg>
  )
}

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
    </div>
  )
}

export function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-agent-year'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'dsh-agent-year: styles')

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
    id: 'agent-year',
    order: 60,
    label: () => '年度回顾',
  }, SourcesSection))

  // 翻旧账：一页只说一件事（没装 dsh-pet 的人从这里看；装了的右键 dsh-pet → 更多 → 翻旧账，让它亲口说）
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: RECALL_ID,
  }, Recall))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: RECALL_ID,
    order: 31,
    label: () => '翻旧账',
  }, RecallIcon))
}
