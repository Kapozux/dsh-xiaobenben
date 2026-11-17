/**
 * 报价页：发之前给用户看清楚——发给谁、发什么（全文可展开）、大概多少 token、多少钱（查不到价就不写）。
 * 点「发送」才会调模型。
 */
import { useEffect, useState } from 'react'
import { call } from './api.js'

const KIND_NAME = { all: '年度关键词、奖项和「这一年」', keywords: '年度关键词', awards: '年度奖项', year: '「这一年」' }

export function QuoteDialog({ range, kind, onClose, onDone }) {
  const [models, setModels] = useState(null)
  const [route, setRoute] = useState(null)
  const [q, setQ] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    call('models').then(m => { setModels(m); setRoute(m.current) }).catch(e => setError(e.message))
  }, [])
  useEffect(() => {
    if (!route) return
    setQ(null)
    call('quote', { range, kind, route }).then(setQ).catch(e => setError(e.message))
  }, [route?.provider, route?.model])

  const providerName = id => models?.providers.find(p => p.id === id)?.name || id
  const send = async () => {
    setSending(true); setError('')
    try {
      const r = await call('generate', { range, kind, route, hash: q.hash, confirm: true })
      if (!r.ok) setError(`没写成：${r.error}。图里先不放 AI 那几张。`)
      else onDone(r)
    } catch (e) { setError(e.message) } finally { setSending(false) }
  }
  const left = q ? q.maxCalls - q.calls : 0

  return (
    <div className="ay-modal" onClick={e => e.target === e.currentTarget && !sending && onClose()}>
      <div className="ay-dialog" role="dialog" aria-label="发送前确认">
        <h2>发送前确认</h2>
        <p className="ay-muted">要让模型写：{KIND_NAME[kind]}</p>

        <div className="ay-field">
          <span>发给</span>
          {models ? (
            <select value={route ? `${route.provider}\u0000${route.model}` : ''} onChange={e => { const [provider, model] = e.target.value.split('\u0000'); setRoute({ provider, model }) }}>
              {models.providers.flatMap(p => p.models.map(m => (
                <option key={`${p.id}/${m.id}`} value={`${p.id}\u0000${m.id}`}>{p.name} · {m.name}{p.id === models.current.provider && m.id === models.current.model ? '（当前默认）' : ''}</option>
              )))}
              {route && !models.providers.some(p => p.id === route.provider && p.models.some(m => m.id === route.model)) && <option value={`${route.provider}\u0000${route.model}`}>{route.provider} · {route.model}</option>}
            </select>
          ) : <span className="ay-muted">读取模型列表…</span>}
        </div>
        <p className="ay-muted ay-small">只这一次用这个模型，不改你 dsh 的默认设置。</p>

        {q && <>
          <div className="ay-quote-nums">
            <div><b>≈ {q.inputTokens.toLocaleString()}</b><span>输入 token（估算）</span></div>
            <div><b>≈ {q.outputTokens.toLocaleString()}</b><span>输出 token（估算）</span></div>
            <div>{q.cost ? <><b>≈ {q.cost.amount < 0.01 ? q.cost.amount.toFixed(4) : q.cost.amount.toFixed(2)} {q.cost.currency}</b><span>按你配置的价格</span></> : <><b>—</b><span>没配置这个模型的价格，只显示 token</span></>}</div>
          </div>
          {q.expensive && <p className="ay-warn">这个模型比较贵，可以在上面换成便宜的模型再跑。</p>}
          {q.external?.length > 0 && (
            <p className="ay-warn">
              材料里有来自 {q.external.map(x => `${x.name}（${x.count} 条）`).join('、')} 的内容。
              这些内容是第一次发给 {providerName(q.route.provider)}。
            </p>
          )}
          <details className="ay-send">
            <summary>查看要发送的全部内容（{[...q.prompt].length.toLocaleString()} 字）</summary>
            <p className="ay-muted ay-small">只有会话标题和每月抽样的你说过的短句：已打码，去掉了超长消息和涉及健康、感情、成绩、家庭的句子。agent 的回复一句都不发。</p>
            <pre>{q.system}{'\n\n'}{q.prompt}</pre>
          </details>
          <p className="ay-muted ay-small">这份回顾已调用模型 {q.calls} 次，最多 {q.maxCalls} 次（失败会自动重试 1 次，也算）。还剩 {left} 次。</p>
        </>}

        {error && <p className="ay-err">{error}</p>}
        <div className="ay-actions">
          <button className="ay-btn" onClick={onClose} disabled={sending}>取消</button>
          <button className="ay-btn ay-primary" onClick={send} disabled={!q || sending || left <= 0}>{sending ? '正在写…' : '发送'}</button>
        </div>
      </div>
    </div>
  )
}
