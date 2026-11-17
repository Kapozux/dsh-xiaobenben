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

.ay-pet { position: fixed; z-index: 2147483000; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.ay-pet:active { cursor: grabbing; }
.ay-pet video { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; transform: scale(1.7); transform-origin: 50% 62%; }
.ay-pet-bubble { position: fixed; z-index: 2147483001; pointer-events: auto; width: 320px; box-sizing: border-box; padding: 12px 14px 10px; border-radius: 14px;
  background: #fffdf8; color: #1f1b16; border: 1px solid rgba(0,0,0,.1); box-shadow: 0 8px 28px rgba(0,0,0,.16); font-size: 14px; line-height: 1.65; white-space: pre-line; cursor: pointer;
  animation: ay-pet-pop .18s ease-out; }
.ay-pet-meta { margin-top: 6px; font-size: 12px; color: #8a8175; }
@keyframes ay-pet-pop { from { opacity: 0; transform: translateY(6px) scale(.96); } to { opacity: 1; transform: none; } }
.ay-pet-menu { position: fixed; z-index: 2147483002; pointer-events: auto; width: 228px; box-sizing: border-box; padding: 6px; border-radius: 12px; background: #fffdf8; color: #1f1b16;
  border: 1px solid rgba(0,0,0,.1); box-shadow: 0 10px 30px rgba(0,0,0,.18); font-size: 13px; }
.ay-pet-menu-h { padding: 4px 8px; font-size: 12px; color: #8a8175; }
.ay-pet-item { display: block; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: 0; border-radius: 8px; padding: 6px 8px; cursor: pointer; }
.ay-pet-item:hover { background: rgba(61,90,254,.1); }
.ay-pet-item.on { color: #3D5AFE; }
.ay-pet-sep { height: 1px; background: rgba(0,0,0,.08); margin: 4px 6px; }
.ay-pet-note { padding: 4px 8px 6px; font-size: 12px; color: #8a8175; line-height: 1.5; }
.ay-pet-dot { position: fixed; z-index: 2147483000; pointer-events: auto; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(0,0,0,.12);
  background: #fffdf8; box-shadow: 0 4px 14px rgba(0,0,0,.15); font-size: 20px; cursor: pointer; }
@media (prefers-color-scheme: dark) {
  .ay-pet-bubble, .ay-pet-menu, .ay-pet-dot { background: #242832; color: #ece8e1; border-color: rgba(255,255,255,.12); }
  .ay-pet-meta, .ay-pet-menu-h, .ay-pet-note { color: #9a948a; }
  .ay-pet-sep { background: rgba(255,255,255,.1); }
  .ay-pet-item.on { color: #8ea6ff; }
}
`
