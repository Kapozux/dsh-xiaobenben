/**
 * dsh 自己的会话：只经过 ctx.sessionQuery 读（docs/dsh-api.md §1）。
 * JSONL 和 SQLite 两种配置下 listSessions / readSession 都是基类实现，这里不分后端。
 */

/**
 * @param {{ listSessions(signal?: AbortSignal): Promise<any[]>, readSession(id: string): Promise<{ events: any[] }> }} sessionQuery
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('../core/types.js').SourceResult>}
 */
export async function loadDsh(sessionQuery, opts = {}) {
  const records = await sessionQuery.listSessions(opts.signal)
  const convs = []
  let skipped = 0
  for (const record of records) {
    const header = record.header
    if (!header || header.origin === 'subagent') continue      // 子代理开的会话不是用户开的
    let log
    try {
      log = await sessionQuery.readSession(header.id)
    } catch {
      skipped++
      continue
    }
    convs.push(convFromEvents(header.id, log.events))
  }
  return { convs: convs.filter(c => c.msgs.length), skipped }
}

/**
 * 一条 dsh 会话的事件 → 统一格式。导出给测试用。
 * - 用户的话：user/message 且 source.kind === 'user'（同一种事件也用来塞注入的上下文）
 * - agent 回复：assistant/message，只记时间
 * - 标题：最后一个 session/title
 * @param {string} id
 * @param {any[]} events
 */
export function convFromEvents(id, events) {
  const msgs = []
  let title = null
  for (const e of events) {
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      const text = (e.data.content || []).filter(b => b?.type === 'text').map(b => b.text).join('\n').trim()
      if (text) msgs.push({ t: e.time, role: 'user', text })
    } else if (e.type === 'assistant/message') {
      msgs.push({ t: e.time, role: 'assistant', text: '' })
    } else if (e.type === 'session/title' && e.data?.title) {
      title = e.data.title
    }
  }
  return { agent: 'dsh', id, title, msgs }
}
