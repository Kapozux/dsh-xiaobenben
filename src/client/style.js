/** 页面样式（不是分享图的）。跟着 dsh 的明暗：颜色多用 currentColor 加透明度，不写死背景。类名一律 ay- 开头。 */
export const CSS = `
.ay-page { max-width: 1040px; margin: 0 auto; padding: 32px 24px 80px; overflow-y: auto; height: 100%; box-sizing: border-box; font-size: 14px; line-height: 1.6; }
.ay-page h1 { font-size: 26px; margin: 0 0 4px; font-weight: 700; }
.ay-page h2 { font-size: 16px; margin: 0 0 8px; font-weight: 600; }
.ay-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.ay-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ay-between { justify-content: space-between; margin: 24px 0 12px; }
.ay-muted { opacity: .68; margin: 4px 0 10px; }
.ay-small { font-size: 12px; }
.ay-err { color: #d64545; margin: 8px 0; }
.ay-warn { background: rgba(201,130,28,.14); border-radius: 8px; padding: 8px 12px; margin: 10px 0; }
.ay-box { border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
.ay-box > summary { cursor: pointer; }
.ay-btn { font: inherit; color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: 8px; padding: 6px 14px; cursor: pointer; }
.ay-btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 7%, transparent); }
.ay-btn:disabled { opacity: .45; cursor: default; }
.ay-primary { background: #3D5AFE; border-color: #3D5AFE; color: #fff; font-weight: 600; }
.ay-primary:hover:not(:disabled) { background: #2f49e0; }
.ay-sm { padding: 2px 10px; font-size: 12px; }
.ay-page select, .ay-dialog select { font: inherit; color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: 8px; padding: 5px 8px; max-width: 100%; }
.ay-page select option, .ay-dialog select option { color: #111; }
.ay-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.ay-card { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.ay-card figcaption { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ay-thumb { width: 100%; aspect-ratio: 3 / 4; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.15); display: block; }
.ay-off .ay-thumb { opacity: .25; }
.ay-tag { font-size: 11px; padding: 0 8px; border-radius: 999px; background: rgba(201,130,28,.18); }
.ay-sources { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.ay-source { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
.ay-source input { margin-top: 4px; }
.ay-source.ay-missing { opacity: .55; cursor: default; }
.ay-path { display: block; font-size: 12px; opacity: .65; word-break: break-all; }
.ay-modal { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: grid; place-items: center; z-index: 1000; padding: 16px; }
.ay-dialog { background: var(--ay-dialog-bg, Canvas); color: CanvasText; border-radius: 14px; padding: 22px 24px; width: min(640px, 100%); max-height: 88vh; overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
.ay-dialog h2 { font-size: 18px; margin: 0 0 6px; }
.ay-field { display: flex; gap: 10px; align-items: center; margin: 12px 0 2px; }
.ay-field > span { flex: none; font-weight: 600; }
.ay-field select { flex: 1; }
.ay-quote-nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
.ay-quote-nums div { border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; }
.ay-quote-nums b { font-size: 18px; }
.ay-quote-nums span { font-size: 12px; opacity: .65; }
.ay-send summary { cursor: pointer; font-weight: 600; }
.ay-send pre { white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 320px; overflow: auto; background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 8px; padding: 10px; }
.ay-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
@media (max-width: 600px) { .ay-quote-nums { grid-template-columns: 1fr; } .ay-page { padding: 20px 14px 60px; } }

.ay-recall { max-width: 640px; margin: 0 auto; padding: 48px 24px 80px; box-sizing: border-box; height: 100%; overflow-y: auto; font-size: 14px; line-height: 1.6; }
.ay-recall h1 { font-size: 22px; margin: 0 0 4px; }
.ay-say { margin: 28px 0 16px; padding: 22px 24px; border-radius: 16px; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); font-size: 17px; line-height: 1.75; white-space: pre-line; animation: ay-pop .18s ease-out; }
.ay-say-tag { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 99px; background: color-mix(in srgb, currentColor 9%, transparent); margin-bottom: 10px; }
.ay-say-tag.priv { background: rgba(201,130,28,.2); }
@keyframes ay-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`
