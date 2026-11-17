/**
 * 设置 → 年度回顾 里的「翻旧账」一块：怎么玩，以及「让模型换个说法」的发送确认。
 * 翻旧账只在挂件上说（左键点小本本），没有单独的页面。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { FIGURES, KIND } from '../shared/pet-engine.js'
import { prefs } from './Pet.jsx'

export function PetSettings() {
  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ margin: '0 0 6px' }}>翻旧账</h3>
      <p className="ay-small">点一下右下角的小本本，她就翻一件你们以前一起干过的事；右键她有菜单（说哪一类、藏起私事、放到桌面上）。</p>
      <StyleSection onChanged={() => {}} />
      <DebugSection />
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
      <p className="ay-muted ay-small">上面的话是按模板套的。可以让你在 dsh 里配的模型按大肥鱼的口吻重写：事实（时间、哪件事、原话、数字）由程序定好，模型只管怎么说；写回来的每句都核对原话一字不差、数字对得上、不超过 50 字，没过的照旧说模板的。私事不发。写好的存在本机，小本本说的时候就用它。</p>
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

// ---------- 调试 ----------
const FIG_LABEL = {
  normal: '平时', blink: '眨眼', happy: '开心', sad: '委屈', surprised: '吃惊', sleepy: '犯困', shy: '害羞', thinking: '思考', eat: '吃饭', pout: '鼓脸', proud: '得意',
  write: '记账', count: '数饭碗', hide: '本子挡脸', accuse: '翻本子质问', spout: '喷水欢呼', bow: '鞠躬',
  dangle: '被拎起', land: '落地', sit: '坐着翻本子', sleep: '趴着睡', sulk: '背对生闷气', wave: '挥手',
}
const figLabel = n => FIG_LABEL[n] || n.replace(/^flip-(\d)$/, '翻本子 $1').replace(/^walk-(\d)$/, '走路 $1')

/** 给挂件发一条指令（同一页面里的事件）；挂件不在这个页面上就 3 秒后得到 undefined */
function pet(detail) {
  return new Promise(res => {
    const t = setTimeout(() => res(undefined), 3000)
    window.dispatchEvent(new CustomEvent('xiaobenben:debug', { detail: { ...detail, reply: r => Promise.resolve(r).then(v => { clearTimeout(t); res(v ?? null) }) } }))
  })
}

function DebugSection() {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState(null)
  const [desk, setDesk] = useState(null)
  const [deskBusy, setDeskBusy] = useState(false)
  const [pr, setPr] = useState(prefs.get())
  const [msg, setMsg] = useState('')
  const [fb, setFb] = useState(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    const tick = () => { pet({ do: 'state' }).then(s => alive && setSt(s === undefined ? 'none' : s)); pet({ do: 'feedback' }).then(f => alive && f && setFb(f)); call('desktop', {}).then(d => alive && setDesk(d.desktop)).catch(() => {}) }
    tick(); const t = setInterval(tick, 1000)
    return () => { alive = false; clearInterval(t) }
  }, [open])
  const setPref = patch => { prefs.set(patch); setPr(prefs.get()) }
  const desktop = on => {
    setDeskBusy(true); setMsg('')
    call('desktop', { on }).then(d => { setDesk(d.desktop); if (on && !d.desktop?.on) setMsg('上不了桌面：' + (d.desktop?.error || '不知道为什么')) })
      .catch(e => setMsg(e.message)).finally(() => setDeskBusy(false))
  }
  const act = (detail, label) => { setMsg(''); pet(detail).then(r => { if (r === undefined) setMsg('挂件没在这个页面上（桌面版开着时网页这只是藏着的）'); else if (label && r) setMsg(label(r)) }) }
  const B = ({ children, ...p }) => <button className="ay-btn" style={{ margin: '0 6px 6px 0' }} {...p}>{children}</button>
  const hidden = desk?.on

  return (
    <div className="ay-style" style={{ marginTop: 28 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        调试 <button className="ay-btn" onClick={() => setOpen(!open)}>{open ? '收起' : '展开'}</button>
      </h2>
      {!open && <p className="ay-muted ay-small">手动让她摆每一种样子、做每一个动作，开关散步 / 坐下睡觉，放到桌面上。</p>}
      {open && <>
        <p className="ay-small">
          {st === 'none' || st === null ? '挂件没在这个页面上。' : <>
            现在：<b>{figLabel(st.expr) || st.expr}</b>{st.walking ? '（在走）' : ''}{st.talking ? '（在说话）' : ''}
            {' · '}立绘 {st.loaded}/{st.figures} 张{' · '}旧账 {st.moments ?? '还没读'} 件{' · '}碎碎念 {st.idle} 句
            {' · '}没人理 {st.quiet} 秒{' · '}位置 {st.x}, {st.y}
          </>}
        </p>

        <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>桌面版</h3>
        <p className="ay-small ay-muted">
          {desk ? (desk.on ? '在桌面上（网页这只藏起来了，下面的按钮要先收回来才看得到）。' : '没开。') : '…'}
          {desk?.error && !desk.on ? ` 上次出错：${desk.error}` : ''}
        </p>
        <div>
          {!desk?.on && <B disabled={deskBusy} onClick={() => desktop(true)}>{deskBusy ? '启动中…' : '放到桌面上'}</B>}
          {desk?.on && <B disabled={deskBusy} onClick={() => desktop(false)}>收回网页里</B>}
        </div>

        <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>开关</h3>
        <label className="ay-small" style={{ display: 'block' }}><input type="checkbox" checked={pr.walk !== false} onChange={e => setPref({ walk: e.target.checked })} /> 闲着时自己散步</label>
        <label className="ay-small" style={{ display: 'block' }}><input type="checkbox" checked={pr.rest !== false} onChange={e => setPref({ rest: e.target.checked })} /> 没人理时坐下、再久点趴着睡</label>
        <label className="ay-small" style={{ display: 'block' }}><input type="checkbox" checked={!!pr.quiet} onChange={e => setPref({ quiet: e.target.checked })} /> 安静一点（拖她、甩她不说话，点她照样说）</label>
        <label className="ay-small" style={{ display: 'block' }}>气泡停多久{' '}
          <select value={pr.linger || 'normal'} onChange={e => setPref({ linger: e.target.value })}>
            {[['short', '短（一半不到）'], ['normal', '默认'], ['long', '长']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="ay-small" style={{ display: 'block' }}>「随便」模式里碎碎念占{' '}
          <select value={String(typeof pr.idleOdds === 'number' ? pr.idleOdds : 0.25)} onChange={e => setPref({ idleOdds: Number(e.target.value) })}>
            {[['0', '不说'], ['0.25', '四次里一次（默认）'], ['0.5', '一半'], ['1', '每次都是']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>

        <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>动作</h3>
        <div style={{ opacity: hidden ? 0.5 : 1 }}>
          <B onClick={() => act({ do: 'poke' })}>翻旧账（同左键）</B>
          <B onClick={() => act({ do: 'idle' })}>碎碎念一句</B>
          <B onClick={() => act({ do: 'flip' })}>翻本子动画</B>
          <B onClick={() => act({ do: 'walk', dir: -1 })}>往左走</B>
          <B onClick={() => act({ do: 'walk', dir: 1 })}>往右走</B>
          <B onClick={() => act({ do: 'drop' })}>从天上掉下来</B>
          <B onClick={() => act({ do: 'sulk' })}>闹别扭</B>
          <B onClick={() => act({ do: 'home' })}>回到右下角</B>
          <B onClick={() => act({ do: 'reload' }, r => `重新读了记录：${r.moments ?? 0} 件`)}>重新读记录</B>
        </div>

        <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>按类别翻旧账</h3>
        <div style={{ opacity: hidden ? 0.5 : 1 }}>
          {Object.entries(KIND).map(([k, l]) => <B key={k} onClick={() => act({ do: 'kind', kind: k })}>{l}{st?.kinds ? ` ${st.kinds[k]}` : ''}</B>)}
        </div>

        <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>每一张立绘（摆 4 秒）</h3>
        <div style={{ opacity: hidden ? 0.5 : 1 }}>
          {FIGURES.map(n => <B key={n} onClick={() => act({ do: 'show', name: n })}>{figLabel(n)}</B>)}
        </div>
        <FeedbackView fb={fb} act={act} />
        {msg && <p className="ay-small ay-err">{msg}</p>}
      </>}
    </div>
  )
}

/** 反馈记录：点过的 👍👎、按类别的票、常点的聊天按钮、最近几条；👎 过的可以一条条恢复 */
function FeedbackView({ fb, act }) {
  if (!fb) return null
  const lines = Object.entries(fb.lines || {})
  const up = lines.filter(([, d]) => d > 0), down = lines.filter(([, d]) => d < 0)
  const kinds = Object.entries(fb.kinds || {}).map(([k, [u, d]]) => `${KIND[k] || k} 👍${u} 👎${d}`)
  const clicks = Object.entries(fb.clicks || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`)
  const recent = (fb.log || []).slice(-8).reverse()
  const time = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
  const cut = (t, n = 36) => ([...t].length > n ? [...t].slice(0, n).join('') + '…' : t)
  return (
    <>
      <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>反馈记录（网页和桌面共用）</h3>
      <p className="ay-small">
        喜欢的 {up.length} 句（以后多说）· 不想听的 {down.length} 句（以后不说）
        {kinds.length ? <><br />按类别：{kinds.join('　')}</> : null}
        {clicks.length ? <><br />常点的聊天按钮：{clicks.join('　')}</> : null}
      </p>
      {recent.length > 0 && <div className="ay-small ay-muted" style={{ marginBottom: 6 }}>
        {recent.map((e, i) => <div key={i}>{time(e.t)} · {e.what} · {e.d > 0 ? '👍' : e.d < 0 ? '👎' : '撤销'} · {cut(e.text)}</div>)}
      </div>}
      {down.length > 0 && <div className="ay-small" style={{ marginBottom: 6 }}>
        {down.map(([t]) => <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
          <span style={{ flex: 1 }}>👎 {cut(t, 50)}</span>
          <button className="ay-btn" onClick={() => act({ do: 'unrate', text: t })}>恢复</button>
        </div>)}
      </div>}
      {(lines.length > 0 || kinds.length > 0 || clicks.length > 0) && <button className="ay-btn" onClick={() => act({ do: 'clearfb' })}>清空反馈</button>}
    </>
  )
}
