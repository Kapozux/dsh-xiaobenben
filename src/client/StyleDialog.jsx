/**
 * 「让本肥鱼用你的模型写一批台词？」的确认框：给谁发、发出去的样子（样例 + 全文）、大约多少 token；点「发送」才发。
 * 第一次打开时小本本自己会问（Pet.jsx），设置页里也能打开（PetSettings.jsx）。
 */
import { useEffect, useState } from 'react'
import { call } from './api.js'

export function StyleDialog({ redo, onClose, onStarted }) {
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
        <h2>让本肥鱼用你的模型写一批台词？</h2>
        <p className="ay-muted">{redo ? '全部重写一遍。' : '只写本子里还没有的事。'}写好存在本机，之后点她只从本机抽，不再调模型。不发也行，她照模板念。</p>
        <p className="ay-small"><b>会发送事发前后的几句对话</b>（你说的和它回的原文，每件事不超过 300 字），外加程序算出来的事实。都打过码；涉及健康、感情、成绩、家庭的事整件不发。</p>
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
            <div><b>{q.count}</b><span>件事（{q.withContext} 件带对话原文），每件写 5 版挑 1 版，再写 3 个回话按钮，共调 {q.calls} 次</span></div>
            <div><b>≈ {(q.inputTokens + q.outputTokens).toLocaleString()}</b><span>token（估算，输入 {q.inputTokens.toLocaleString()}）</span></div>
            <div>{q.cost ? <><b>≈ {q.cost.amount < 0.01 ? q.cost.amount.toFixed(4) : q.cost.amount.toFixed(2)} {q.cost.currency}</b><span>按你配置的价格</span></> : <><b>—</b><span>没配置这个模型的价格，只显示 token</span></>}</div>
          </div>
          {q.sample?.length > 0 && <>
            <p className="ay-small" style={{ margin: '10px 0 4px' }}>发出去的长这样（这是其中 {q.sample.length} 件）：</p>
            <pre className="ay-sample" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{q.sample.join('\n')}</pre>
          </>}
          {q.privateSkipped > 0 && <p className="ay-muted ay-small">涉及健康、感情、成绩、家庭的 {q.privateSkipped} 件不发。</p>}
          <details className="ay-send">
            <summary>查看要发送的全部内容（{[...q.prompt].length.toLocaleString()} 字）</summary>
            <p className="ay-muted ay-small">前面是给模型的角色设定和写法要求，后面是每件事：一行事实（类型、什么时候、在弄什么、数字），底下是当时的几句对话原文（已打码）。后面三步（挑一版、写回话按钮、查回话）会把这些事件卡连同写好的台词再各发一次，上面的 token 已经算进去了。</p>
            <pre>{q.system}{'\n\n'}{q.prompt}</pre>
          </details>
          <p className="ay-muted ay-small">写回来的每个版本都逐字核对原话、核对数字，不过的扔掉；再让模型挑一版，把话说反、编了细节的不选。每件事另外写 3 个回话按钮和她接的一句（只有一层，点了不再调模型），没写成的用默认按钮。调用失败自动重试 1 次，还不行就照模板念。</p>
        </>}
        {q && q.count === 0 && <p className="ay-muted">没有新的事要写。</p>}
        {error && <p className="ay-err">{error}</p>}
        <div className="ay-actions">
          <button className="ay-btn" onClick={onClose} disabled={sending}>不发，照模板念</button>
          <button className="ay-btn ay-primary" onClick={send} disabled={!q || !q.count || sending}>{sending ? '开始…' : '发送'}</button>
        </div>
      </div>
    </div>
  )
}

