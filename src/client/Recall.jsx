/**
 * 「翻旧账」一页：一次说一件你和 agent 一起干过的真事（host 的 moments 路由算好的，确定性模板，不调模型）。
 * 装了 dsh-pet 的人还可以右键它 → 更多 → 翻旧账，让它亲口说；这一页是没装 dsh-pet 时的去处，也能看 dsh-pet 那边连没连上。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'

const KIND = { work: '干活', late: '深夜', report: '汇报', sorry: '认错', complain: '挨骂', caught: '被抓包', stopped: '被喊停', stat: '总账' }

export function Recall() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [cur, setCur] = useState(null)
  const [priv, setPriv] = useState(true)        // 藏起私事（健康、感情、成绩、家庭）
  const [link, setLink] = useState(null)
  const queue = useRef([])

  const load = useCallback(() => call('moments', {}).then(setData).catch(e => setErr(e.message)), [])
  useEffect(() => {
    load()
    call('petlink', {}).then(setLink).catch(() => {})
  }, [])

  const next = useCallback(() => {
    if (!data) return
    if (!queue.current.length) {
      queue.current = data.moments.filter(m => !priv || !m.sensitive.length)
        .map(m => [Math.random(), m]).sort((a, b) => a[0] - b[0]).map(x => x[1])
    }
    setCur(queue.current.pop() || null)
  }, [data, priv])
  useEffect(() => { queue.current = []; if (data) next() }, [data, priv])   // eslint-disable-line react-hooks/exhaustive-deps

  const ago = cur && Math.round((Date.now() - cur.ts) / 864e5)
  return (
    <div className="ay-recall">
      <h1>翻旧账</h1>
      <p className="ay-muted">本肥鱼记得你们一起干过的事。默认在本机按模板说，不调模型；也可以在下面让模型换个说法。</p>
      {err && <p className="ay-err">读记录失败：{err}</p>}
      {!data && !err && <p className="ay-muted">本肥鱼在翻记录……第一次要几秒。</p>}
      {data && !cur && <p className="ay-muted">{data.moments.length ? '这一类没有可说的了。' : '还没有可说的事：先让 agent 干点活吧（也可以去「设置 → 年度回顾」把 Claude Code 的记录勾上）。'}</p>}
      {cur && (
        <div className="ay-say" key={cur.text}>
          <div className={'ay-say-tag' + (cur.sensitive.length ? ' priv' : '')}>
            {[KIND[cur.kind], cur.kind === 'stat' ? null : ago <= 0 ? '今天' : `${ago} 天前`, cur.sensitive.length ? '私事' : null, cur.styled ? 'AI 改写' : null].filter(Boolean).join(' · ')}
          </div>
          <div>{cur.text}</div>
        </div>
      )}
      <div className="ay-row">
        <button className="ay-btn ay-primary" onClick={next} disabled={!data}>再翻一件</button>
        <label className="ay-row ay-small"><input type="checkbox" checked={priv} onChange={e => setPriv(e.target.checked)} /> 藏起私事（健康、感情、成绩、家庭）</label>
      </div>
      {data && <p className="ay-muted ay-small" style={{ marginTop: 24 }}>最近 {data.days} 天 · 共 {data.moments.length} 件可说</p>}
      <StyleSection onChanged={() => { queue.current = []; load() }} />
      <p className="ay-muted ay-small">
        {link?.connected
          ? '已接上 dsh-pet：右键它 → 更多 → 翻旧账，让它亲口说。'
          : '装了 dsh-pet 的话，右键它 → 更多 → 翻旧账，可以让它亲口说。' + (link?.error ? `（现在没接上：${link.error}）` : '')}
      </p>
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
      <p className="ay-muted ay-small">上面的话是按模板套的。可以让你在 dsh 里配的模型按大肥鱼的口吻重写：事实（时间、哪件事、原话、数字）由程序定好，模型只管怎么说；写回来的每句都核对原话一字不差、数字对得上、不超过 50 字，没过的照旧说模板的。私事不发。写好的存在本机，dsh-pet 和这一页都用它。</p>
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
