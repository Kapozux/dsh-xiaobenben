/** 数据来源：dsh 默认读；Claude Code / Codex / Cursor 逐个勾选才读。设置页和回顾页共用。 */
import { useEffect, useState } from 'react'
import { call } from './api.js'

export function Sources({ onChange }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { call('sources').then(setList).catch(e => setError(e.message)) }, [])
  const toggle = async (id, enabled) => {
    try { setList(await call('source.set', { id, enabled })); onChange?.() } catch (e) { setError(e.message) }
  }
  return (
    <div className="ay-sources">
      <p className="ay-muted ay-small">勾选后只在本机只读这些文件，不上传。读出来的东西只用来算统计和挑原话；只有你在「发送前确认」里点了发送，抽样的短句才会发给模型。</p>
      {error && <p className="ay-err">{error}</p>}
      {list?.map(s => (
        <label key={s.id} className={`ay-source${s.exists ? '' : ' ay-missing'}`}>
          <input type="checkbox" checked={s.enabled} disabled={s.fixed || !s.exists} onChange={e => toggle(s.id, e.target.checked)} />
          <span>
            <b>{s.name}</b>{s.fixed ? '（默认）' : ''}
            <span className="ay-path">{s.path}{s.exists ? '' : ' —— 这台电脑上没有'}</span>
            {s.id === 'cursor' && <span className="ay-path">会先复制一份到临时目录再读，读完删掉，不碰 Cursor 正在用的文件。</span>}
          </span>
        </label>
      ))}
    </div>
  )
}
