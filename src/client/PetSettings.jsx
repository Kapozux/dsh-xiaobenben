/**
 * 设置 → 年度回顾 里的「翻旧账（dsh-pet）」一块：dsh-pet 接没接上，以及「让模型换个说法」的发送确认。
 * 翻旧账只在桌宠上说（右键 dsh-pet → 更多 → 翻旧账），没有单独的页面。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'

export function PetSettings() {
  const [link, setLink] = useState(null)
  useEffect(() => { call('petlink', {}).then(setLink).catch(() => {}) }, [])
  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ margin: '0 0 6px' }}>翻旧账（dsh-pet）</h3>
      <p className="ay-small">
        {link?.connected
          ? '已接上 dsh-pet：右键它 → 更多 → 翻旧账，它会说一件你们以前一起干过的事。'
          : '要装 dsh-pet 才能用：装好后右键它 → 更多 → 翻旧账。' + (link?.error ? `（现在没接上：${link.error}）` : '')}
      </p>
      <StyleSection onChanged={() => {}} />
    </div>
  )
}

/** 让大肥鱼换个说法：事实不变，说法交给模型按人设写；每句都核对过才用，没过的照旧说模板的 */
function StyleSection({ onChanged }) {
  const [st, setSt] = useState(null)
  const [open, setOpen] = useState(null)        // null | { redo }
  const [err, setErr] = useState('')
  const refresh = useCallback(() => call('style.status').then(setSt).catch(e => setErr(e.message)), [])
  useEffect(() => { refresh() }, [])
  const wasRunning = useRef(false)
  useEffect(() => {
    if (st?.running) { wasRunning.current = true; const t = setTimeout(refresh, 1500); return () => clearTimeout(t) }
    if (wasRunning.current) { wasRunning.current = false; onChanged() }
  }, [st])

  const why = st?.last?.why ? Object.entries(st.last.why).map(([k, n]) => `${k} ${n} 句`).join('、') : ''
  return (
    <div className="ay-style">
      <h2>让大肥鱼换个说法</h2>
      <p className="ay-muted ay-small">上面的话是按模板套的。可以让你在 dsh 里配的模型按大肥鱼的口吻重写：事实（时间、哪件事、原话、数字）由程序定好，模型只管怎么说；写回来的每句都核对原话一字不差、数字对得上、不超过 50 字，没过的照旧说模板的。私事不发。写好的存在本机，dsh-pet 说的时候就用它。</p>
      {st && <p className="ay-small">已改写 {st.styled} 件{st.meta?.route ? `（${st.meta.route.provider} · ${st.meta.route.model}）` : ''}</p>}
      {st?.running && (
        <div className="ay-row">
          <span className="ay-small">正在写：{st.running.done} / {st.running.total}，已通过 {st.running.ok} 句</span>
          <button className="ay-btn" onClick={() => call('style.stop').then(refresh)}>停止</button>
        </div>
      )}
      {!st?.running && st?.last && (
        <p className="ay-small ay-muted">
          上次：{st.last.ok} 句写好了{st.last.failed ? `，${st.last.failed} 句没过核对、照旧说模板的（${why || '调用失败'}）` : ''}。
          {st.last.errors?.length ? ` 出错：${st.last.errors.join('；')}` : ''}
        </p>
      )}
      {!st?.running && (
        <div className="ay-row">
          <button className="ay-btn ay-primary" onClick={() => setOpen({ redo: false })}>{st?.styled ? '改写新增的' : '看看要发什么'}</button>
          {st?.styled > 0 && <button className="ay-btn" onClick={() => setOpen({ redo: true })}>全部重写</button>}
          {st?.styled > 0 && <button className="ay-btn" onClick={() => call('style.clear').then(() => { refresh(); onChanged() })}>不用改写的了</button>}
        </div>
      )}
      {err && <p className="ay-err">{err}</p>}
      {open && <StyleDialog redo={open.redo} onClose={() => setOpen(null)} onStarted={() => { setOpen(null); refresh() }} />}
    </div>
  )
}

function StyleDialog({ redo, onClose, onStarted }) {
  const [models, setModels] = useState(null)
  const [route, setRoute] = useState(null)
  const [q, setQ] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => { call('models').then(m => { setModels(m); setRoute(m.current) }).catch(e => setError(e.message)) }, [])
  useEffect(() => {
    if (!route) return
    setQ(null)
    call('style.quote', { route, redo }).then(setQ).catch(e => setError(e.message))
  }, [route?.provider, route?.model])
  const send = async () => {
    setSending(true); setError('')
    try {
      const r = await call('style.run', { route, redo, hash: q.hash, confirm: true })
      if (!r.ok) setError(r.error); else onStarted()
    } catch (e) { setError(e.message) } finally { setSending(false) }
  }
  return (
    <div className="ay-modal" onClick={e => e.target === e.currentTarget && !sending && onClose()}>
      <div className="ay-dialog" role="dialog" aria-label="发送前确认">
        <h2>发送前确认</h2>
        <p className="ay-muted">让模型按大肥鱼的口吻{redo ? '重写全部' : '改写还没改写过的'}台词</p>
        <div className="ay-field">
          <span>发给</span>
          {models ? (
            <select value={route ? `${route.provider}\u0000${route.model}` : ''} onChange={e => { const [provider, model] = e.target.value.split('\u0000'); setRoute({ provider, model }) }}>
              {models.providers.flatMap(p => p.models.map(m => (
                <option key={`${p.id}/${m.id}`} value={`${p.id}\u0000${m.id}`}>{p.name} · {m.name}{p.id === models.current.provider && m.id === models.current.model ? '（当前默认）' : ''}</option>
              )))}
            </select>
          ) : <span className="ay-muted">读取模型列表…</span>}
        </div>
        <p className="ay-muted ay-small">只这一次用这个模型，不改你 dsh 的默认设置。</p>
        {q && <>
          <div className="ay-quote-nums">
            <div><b>{q.count}</b><span>件事，分 {q.calls} 次发</span></div>
            <div><b>≈ {(q.inputTokens + q.outputTokens).toLocaleString()}</b><span>token（估算，输入 {q.inputTokens.toLocaleString()}）</span></div>
            <div>{q.cost ? <><b>≈ {q.cost.amount < 0.01 ? q.cost.amount.toFixed(4) : q.cost.amount.toFixed(2)} {q.cost.currency}</b><span>按你配置的价格</span></> : <><b>—</b><span>没配置这个模型的价格，只显示 token</span></>}</div>
          </div>
          {q.privateSkipped > 0 && <p className="ay-muted ay-small">涉及健康、感情、成绩、家庭的 {q.privateSkipped} 件不发。</p>}
          <details className="ay-send">
            <summary>查看要发送的全部内容（{[...q.prompt].length.toLocaleString()} 字）</summary>
            <p className="ay-muted ay-small">每件事一行：类型、时间、哪件事、一句原话（已打码）、数字。agent 的回复只有它自己那一句原话会发。</p>
            <pre>{q.system}{'\n\n'}{q.prompt}</pre>
          </details>
          <p className="ay-muted ay-small">每次调用失败自动重试 1 次。可以中途停止，写好的那部分照样留下。</p>
        </>}
        {q && q.count === 0 && <p className="ay-muted">没有要改写的了。</p>}
        {error && <p className="ay-err">{error}</p>}
        <div className="ay-actions">
          <button className="ay-btn" onClick={onClose} disabled={sending}>取消</button>
          <button className="ay-btn ay-primary" onClick={send} disabled={!q || !q.count || sending}>{sending ? '开始…' : '发送'}</button>
        </div>
      </div>
    </div>
  )
}
