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

  useEffect(() => {
    call('moments', {}).then(setData).catch(e => setErr(e.message))
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
      <p className="ay-muted">本肥鱼记得你们一起干过的事。都在本机算，不调模型。</p>
      {err && <p className="ay-err">读记录失败：{err}</p>}
      {!data && !err && <p className="ay-muted">本肥鱼在翻记录……第一次要几秒。</p>}
      {data && !cur && <p className="ay-muted">{data.moments.length ? '这一类没有可说的了。' : '还没有可说的事：先让 agent 干点活吧（也可以去「设置 → 年度回顾」把 Claude Code 的记录勾上）。'}</p>}
      {cur && (
        <div className="ay-say" key={cur.text}>
          <div className={'ay-say-tag' + (cur.sensitive.length ? ' priv' : '')}>
            {[KIND[cur.kind], cur.kind === 'stat' ? null : ago <= 0 ? '今天' : `${ago} 天前`, cur.sensitive.length ? '私事' : null].filter(Boolean).join(' · ')}
          </div>
          <div>{cur.text}</div>
        </div>
      )}
      <div className="ay-row">
        <button className="ay-btn ay-primary" onClick={next} disabled={!data}>再翻一件</button>
        <label className="ay-row ay-small"><input type="checkbox" checked={priv} onChange={e => setPriv(e.target.checked)} /> 藏起私事（健康、感情、成绩、家庭）</label>
      </div>
      {data && <p className="ay-muted ay-small" style={{ marginTop: 24 }}>最近 {data.days} 天 · 共 {data.moments.length} 件可说</p>}
      <p className="ay-muted ay-small">
        {link?.connected
          ? '已接上 dsh-pet：右键它 → 更多 → 翻旧账，让它亲口说。'
          : '装了 dsh-pet 的话，右键它 → 更多 → 翻旧账，可以让它亲口说。' + (link?.error ? `（现在没接上：${link.error}）` : '')}
      </p>
    </div>
  )
}
