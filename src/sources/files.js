/**
 * 可选的外部来源：Claude Code、Codex、Cursor。只读；用户在设置里逐个勾选才会调到这里。
 * 这三种都是那些工具的私有格式（docs/dsh-api.md §7），认不出的行跳过并计数，不静默吞。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()

/** 每个来源读哪里：设置页原样显示给用户看。 */
export const SOURCE_PATHS = {
  claude: path.join(HOME, '.claude', 'projects'),
  codex: path.join(HOME, '.codex', 'sessions'),
  cursor: process.platform === 'darwin'
    ? path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb')
      : path.join(HOME, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
}

function* walk(dir, ext) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p, ext)
    else if (e.name.endsWith(ext)) yield p
  }
}

async function lines(file) {
  try { return (await fs.promises.readFile(file, 'utf8')).split('\n') } catch { return [] }
}

/** 文件开头 64KB 里能看出是不是 `claude -p` 这类程序调用；是就不必整份读进来（这类文件占绝大多数）。 */
async function isClaudeSdkCall(file) {
  let fh
  try {
    fh = await fs.promises.open(file, 'r')
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(65536), 0, 65536, 0)
    const m = buffer.subarray(0, bytesRead).toString('utf8').match(/"entrypoint":"([^"]*)"/)
    return Boolean(m && m[1].startsWith('sdk'))
  } catch {
    return false
  } finally {
    await fh?.close()
  }
}

/** Claude Code 的「用户的话」：去掉命令、hook、注入的 <...> 块。 */
function claudeUserText(content) {
  if (typeof content === 'string') return content.trimStart().startsWith('<') ? '' : content.trim()
  if (!Array.isArray(content)) return ''
  // 数组形式里 tool_result 是工具回给模型的结果，不是人说的话
  if (content.some(b => b?.type === 'tool_result')) return ''
  return content.filter(b => b?.type === 'text' && !b.text.trimStart().startsWith('<')).map(b => b.text).join('\n').trim()
}

/**
 * ~/.claude/projects/<项目>/<会话>.jsonl
 * 只算交互会话（entrypoint 是 cli / claude-desktop 等）；`claude -p` 这类程序调用（sdk-*）不算人在聊天。
 * @param {string} [root]
 * @returns {import('../core/types.js').SourceResult}
 */
export async function loadClaude(root = SOURCE_PATHS.claude) {
  const convs = []
  let skipped = 0
  for (const file of walk(root, '.jsonl')) {
    if (file.includes(`${path.sep}subagents${path.sep}`)) continue
    if (await isClaudeSdkCall(file)) continue
    const conv = { agent: 'claude', id: path.basename(file, '.jsonl'), title: null, msgs: [] }
    let entry = null
    for (const line of await lines(file)) {
      if (!line.trim()) continue
      let o
      try { o = JSON.parse(line) } catch { skipped++; continue }
      if (o.type === 'ai-title' && o.aiTitle) conv.title = o.aiTitle
      if (o.type !== 'user' && o.type !== 'assistant') continue
      entry ??= o.entrypoint
      if (o.isSidechain || o.isMeta) continue
      const t = Date.parse(o.timestamp)
      if (!Number.isFinite(t)) { skipped++; continue }
      if (o.type === 'user') {
        const text = claudeUserText(o.message?.content)
        if (text) conv.msgs.push({ t, role: 'user', text })
      } else if ((o.message?.content || []).some?.(b => b?.type === 'text')) {
        conv.msgs.push({ t, role: 'assistant', text: '' })
      }
    }
    if (entry && entry.startsWith('sdk')) continue
    if (conv.msgs.length) convs.push(conv)
  }
  return { convs, skipped }
}

/**
 * ~/.codex/sessions/**\/*.jsonl
 * 用户的话只认 event_msg/user_message（response_item 里的 user 消息混着注入的说明）。
 * @param {string} [root]
 */
export async function loadCodex(root = SOURCE_PATHS.codex) {
  const convs = []
  let skipped = 0
  for (const file of walk(root, '.jsonl')) {
    const conv = { agent: 'codex', id: path.basename(file, '.jsonl'), title: null, msgs: [] }
    for (const line of await lines(file)) {
      if (!line.trim()) continue
      let o
      try { o = JSON.parse(line) } catch { skipped++; continue }
      const p = o.payload || {}
      if (o.type === 'session_meta' && p.id) conv.id = p.id
      if (o.type !== 'event_msg') continue
      const t = Date.parse(o.timestamp)
      if (!Number.isFinite(t)) { skipped++; continue }
      if (p.type === 'user_message' && typeof p.message === 'string' && p.message.trim()) {
        conv.msgs.push({ t, role: 'user', text: p.message.trim() })
      } else if (p.type === 'agent_message') {
        conv.msgs.push({ t, role: 'assistant', text: '' })
      }
    }
    if (conv.msgs.length) convs.push(conv)
  }
  return { convs, skipped }
}

/**
 * Cursor 的 state.vscdb：先复制到临时目录，只读打开副本，读完删掉。不碰原文件（Cursor 可能正开着）。
 * cursorDiskKV 表：composerData:<会话 id>（name = 标题）、bubbleId:<会话 id>:<消息 id>（type 1 = 用户，2 = 助手）。
 * @param {string} [file]
 */
export async function loadCursor(file = SOURCE_PATHS.cursor) {
  if (!fs.existsSync(file)) return { convs: [], skipped: 0 }
  const { DatabaseSync } = await import('node:sqlite')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-year-cursor-'))
  const copy = path.join(dir, 'state.vscdb')
  try {
    fs.copyFileSync(file, copy)
    for (const suffix of ['-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, copy + suffix)
    const db = new DatabaseSync(copy, { readOnly: true })
    const byId = new Map()
    let skipped = 0
    const get = id => {
      if (!byId.has(id)) byId.set(id, { agent: 'cursor', id, title: null, msgs: [] })
      return byId.get(id)
    }
    try {
      for (const { key, value } of db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").iterate()) {
        try { const o = JSON.parse(value); if (o?.name) get(key.slice('composerData:'.length)).title = o.name } catch { skipped++ }
      }
      for (const { key, value } of db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").iterate()) {
        let o
        try { o = JSON.parse(value) } catch { skipped++; continue }
        const t = typeof o?.createdAt === 'number' ? o.createdAt : Date.parse(o?.createdAt)
        if (!Number.isFinite(t)) { skipped++; continue }
        const conv = get(key.split(':')[1])
        if (o.type === 1 && typeof o.text === 'string' && o.text.trim()) conv.msgs.push({ t, role: 'user', text: o.text.trim() })
        else if (o.type === 2) conv.msgs.push({ t, role: 'assistant', text: '' })
      }
    } finally {
      db.close()
    }
    const convs = [...byId.values()].filter(c => c.msgs.length)
    for (const c of convs) c.msgs.sort((a, b) => a.t - b.t)
    return { convs, skipped }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** 设置页用：每个来源在不在、有多大。 */
export function describeSources() {
  return Object.entries(SOURCE_PATHS).map(([id, p]) => ({ id, path: p.replace(HOME, '~'), exists: fs.existsSync(p) }))
}
