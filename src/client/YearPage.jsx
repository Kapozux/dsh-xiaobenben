/**
 * 「年度回顾」整页：统计和原话打开就有（本机算、不调模型）；AI 那三块点了、确认了才写。
 * 每张卡可以隐藏 / 显示；涉及健康、感情、成绩、家庭的默认藏起来；AI 卡可以单独重新生成。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { call, downloadCanvas } from './api.js'
import { buildCards } from './cards.js'
import { renderLong, renderPage } from './draw.js'
import { QuoteDialog } from './QuoteDialog.jsx'
import { Sources } from './Sources.jsx'

const AI_CARDS = { keywords: 'keywords', awards: 'awards', year: 'year' }
/** 整张卡就是一句原话的：敏感就整张默认隐藏。列表卡只把敏感的那几条拿掉。 */
const SINGLE = new Set(['first', 'late'])

function rangeOptions() {
  const now = new Date()
  const y = now.getFullYear()
  return [
    { id: 'last', label: '过去一年', range: null },
    { id: String(y), label: `${y} 年`, range: { start: new Date(y, 0, 1).getTime(), end: Date.now() } },
    { id: String(y - 1), label: `${y - 1} 年`, range: { start: new Date(y - 1, 0, 1).getTime(), end: new Date(y, 0, 1).getTime() - 1 } },
  ]
}

function Thumb({ card }) {
  const src = useMemo(() => renderPage(card, { scale: 0.34 }).toDataURL('image/png'), [card])
  return <img className="ay-thumb" src={src} alt={card.name} />
}

export function YearPage() {
  const ranges = useMemo(rangeOptions, [])
  const [rangeId, setRangeId] = useState('last')
  const range = ranges.find(r => r.id === rangeId).range
  const [v, setV] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(null)          // 'all' | 'keywords' | 'awards' | 'year'
  const [note, setNote] = useState('')
  const [reveal, setReveal] = useState({})
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setV(await call('view', { range })) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [rangeId])
  useEffect(() => { load() }, [load])

  const cards = useMemo(() => (v ? buildCards(v, reveal) : []), [v, reveal])
  const isHidden = c => v.hidden[c.id] ?? (SINGLE.has(c.id) && c.sensitive.length > 0)
  const shown = cards.filter(c => !isHidden(c))

  const setHidden = async (c, hidden) => {
    setV(prev => ({ ...prev, hidden: { ...prev.hidden, [c.id]: hidden } }))
    try { await call('hide', { hash: v.hash, card: c.id, hidden }) } catch (e) { setError(e.message) }
  }

  const exportLong = async () => {
    setBusy('long')
    try { await downloadCanvas(renderLong(shown), `agent-年度回顾-长图.png`) } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const exportPages = async () => {
    setBusy('pages')
    try {
      for (let i = 0; i < shown.length; i++) await downloadCanvas(renderPage(shown[i]), `agent-年度回顾-${String(i + 1).padStart(2, '0')}-${shown[i].name}.png`)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  if (loading && !v) return <div className="ay-page"><p className="ay-muted">正在读这一年的会话…（第一次读 Claude Code 的记录可能要十几秒）</p></div>
  if (!v) return <div className="ay-page"><p className="ay-err">{error || '读不出来'}</p><button className="ay-btn" onClick={load}>再试一次</button></div>

  const s = v.stats
  const sensitiveNames = c => [...new Set(c.sensitive)].join('、')

  return (
    <div className="ay-page">
      <header className="ay-head">
        <div>
          <h1>Agent 年度回顾</h1>
          <p className="ay-muted">
            {s.firstDay ? `${s.firstDay} → ${s.lastDay} · ` : ''}{s.totals.sessions} 个会话 · 你说了 {s.totals.userMsgs.toLocaleString()} 句
            {s.light ? ' · 不到 200 句，用轻量版式：少放数字，多放原话' : ''}
          </p>
        </div>
        <div className="ay-row">
          <select value={rangeId} onChange={e => setRangeId(e.target.value)}>{ranges.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          <button className="ay-btn" onClick={load} disabled={loading}>{loading ? '读取中…' : '重新读取'}</button>
        </div>
      </header>

      <details className="ay-box">
        <summary>数据来源：{v.report.map(r => `${({ dsh: 'DeepSeek Harness', claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' })[r.id]} ${r.sessions} 个会话${r.skipped ? `（${r.skipped} 行认不出，跳过）` : ''}${r.error ? `（读取失败：${r.error}）` : ''}`).join(' · ')}</summary>
        <Sources onChange={load} />
      </details>

      {s.totals.userMsgs === 0 ? (
        <div className="ay-box"><p>这段时间里还没有你说过的话。可以换个时间范围，或者在上面勾选别的 agent 的记录。</p></div>
      ) : <>
        <section className="ay-box">
          <h2>AI 部分（可选）</h2>
          {v.ai?.result ? (
            <p className="ay-muted">已写好（{v.ai.route?.provider} · {v.ai.route?.model}）。这份回顾调用了模型 {v.ai.calls} / {v.ai.maxCalls} 次。结果存在本机，下次打开不会重跑；想换就在下面对应卡片上点「重新生成」。</p>
          ) : (
            <p className="ay-muted">用你自己的模型额度写 3 个年度关键词、3 个奖项和 150 字以内的「这一年」。不写也行，下面的图已经是完整的。{v.ai?.calls ? `（之前试过 ${v.ai.calls} 次没成功）` : ''}</p>
          )}
          {!v.ai?.result && <button className="ay-btn ay-primary" onClick={() => setDialog('all')}>看看要发什么</button>}
          {note && <p className="ay-muted ay-small">{note}</p>}
        </section>

        <section>
          <div className="ay-row ay-between">
            <h2>预览（{shown.length} / {cards.length} 张会出现在图里）</h2>
            <div className="ay-row">
              <button className="ay-btn ay-primary" onClick={exportLong} disabled={!!busy || !shown.length}>{busy === 'long' ? '生成中…' : '下载长图'}</button>
              <button className="ay-btn" onClick={exportPages} disabled={!!busy || !shown.length}>{busy === 'pages' ? '生成中…' : `下载 3:4 卡片（${shown.length} 张）`}</button>
            </div>
          </div>
          {error && <p className="ay-err">{error}</p>}
          <div className="ay-grid">
            {cards.map(c => {
              const hidden = isHidden(c)
              return (
                <figure key={c.id} className={`ay-card${hidden ? ' ay-off' : ''}`}>
                  <Thumb card={c} />
                  <figcaption>
                    <span>{c.name}</span>
                    {c.sensitive.length > 0 && <span className="ay-tag" title="涉及这些内容的句子默认不显示">涉及{sensitiveNames(c)}</span>}
                  </figcaption>
                  <div className="ay-row ay-small">
                    <button className="ay-btn ay-sm" onClick={() => setHidden(c, !hidden)}>{hidden ? '放进图里' : '隐藏'}</button>
                    {c.sensitive.length > 0 && !SINGLE.has(c.id) && (
                      <button className="ay-btn ay-sm" onClick={() => setReveal(r => ({ ...r, [c.id]: !r[c.id] }))}>{reveal[c.id] ? '藏起敏感句' : '显示敏感句'}</button>
                    )}
                    {AI_CARDS[c.id] && <button className="ay-btn ay-sm" onClick={() => setDialog(AI_CARDS[c.id])}>重新生成</button>}
                  </div>
                </figure>
              )
            })}
          </div>
          <p className="ay-muted ay-small">图底部会写：「统计和原话都在本机算；AI 只读了你同意发送的那部分。」</p>
        </section>
      </>}

      {dialog && (
        <QuoteDialog
          range={range}
          kind={dialog}
          onClose={() => setDialog(null)}
          onDone={r => { setDialog(null); setNote(r.removed?.length ? `有 ${r.removed.length} 处引用在你的原话里找不到，已经删掉：${r.removed.map(x => `「${x}」`).join(' ')}` : ''); load() }}
        />
      )}
    </div>
  )
}
