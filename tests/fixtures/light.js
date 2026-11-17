/**
 * 手造的轻度数据：只有 dsh、三个月、150 条用户消息。确定性生成（不用随机数），测试和手动预览共用。
 * 时间按本地时区写（测试用 TZ=Asia/Taipei 跑）。
 */

const PHRASES = [
  '跑一下测试', '不对', '你搜搜', '继续', '先别改代码，看看为什么挂了',
  '把这个函数拆小一点', '帮我写个 README', '这个报错什么意思', '对，就这样', '换个思路',
]
const TITLES = ['修登录页的 bug', '重构数据导入', '写周报脚本', '给 CLI 加参数', '整理测试', '查内存泄漏']

/** 本地时间 → epoch ms */
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime()

/** @returns {{ header: object, events: object[] }[]} */
export function lightSessions() {
  const sessions = []
  let n = 0
  // 2026-06 ~ 2026-08，每三天一个会话，每个会话 5 条用户消息（共 30 个会话 = 150 条）
  for (let i = 0; i < 30; i++) {
    const day = new Date(2026, 5, 1 + i * 3)
    const y = day.getFullYear(), mo = day.getMonth() + 1, d = day.getDate()
    const startHour = i % 7 === 3 ? 1 : 14                      // 有几个会话在凌晨
    const id = `light-${String(i).padStart(2, '0')}`
    const events = []
    let seq = 0
    const push = (type, data, time) => events.push({ type, data, seq: seq++, time })
    for (let k = 0; k < 5; k++) {
      const t = at(y, mo, d, startHour, 10 + k * 7)
      const text = k === 0 && i === 0 ? '你好，先帮我看看这个项目的结构'
        : k === 4 && i === 24 ? `看下 /Users/sam/proj/.env 里的 key=sk-${'a'.repeat(24)} 对不对`
          : k === 2 && i === 10 ? '我最近有点焦虑，考试成绩不太好，先把这个跑完'
            : PHRASES[(n++) % PHRASES.length]
      push('turn/start', { turn: k + 1 }, t)
      push('user/message', { id: `${id}-u${k}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, t)
      if (k === 0 && i % 2 === 0) push('session/title', { title: TITLES[i % TITLES.length], messageSeqs: [], source: { kind: 'user' } }, t)
      // 注入的上下文：同样是 user/message，但不是人说的，不能算
      if (k === 0) push('user/message', { id: `${id}-ctx`, role: 'user', content: [{ type: 'text', text: '<system-context>workspace info</system-context>' }], source: { kind: 'agent-instructions' } }, t)
      push('assistant/message', { turn: k + 1, step: 1, message: { id: `${id}-a${k}`, role: 'assistant', content: [{ type: 'text', text: '好的。' }], source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' } } }, t + 30_000)
      push('turn/end', { turn: k + 1, reason: { kind: 'completed' } }, t + 31_000)
    }
    sessions.push({ header: { id, createdAt: events[0].time, cwd: '/Users/sam/proj', isSeeded: false }, events })
  }
  // 一个子代理会话：不该被算进去
  sessions.push({
    header: { id: 'light-sub', createdAt: at(2026, 7, 1, 12, 0), cwd: '/Users/sam/proj', isSeeded: false, origin: 'subagent' },
    events: [{ type: 'user/message', data: { id: 's', role: 'user', content: [{ type: 'text', text: '子代理任务' }], source: { kind: 'user' } }, seq: 0, time: at(2026, 7, 1, 12, 0) }],
  })
  return sessions
}

/** 假的 ctx.sessionQuery：和真的一样，listSessions 新的在前。 */
export function fakeSessionQuery(sessions = lightSessions()) {
  const byId = new Map(sessions.map(s => [s.header.id, s]))
  return {
    async listSessions() {
      return [...sessions].sort((a, b) => b.header.createdAt - a.header.createdAt).map(s => ({ header: s.header, live: false, persisted: true }))
    },
    async readSession(id) {
      const s = byId.get(id)
      if (!s) throw new Error(`no session ${id}`)
      return { session: s.header, inheritedEventCount: 0, events: s.events }
    },
  }
}
