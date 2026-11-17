/**
 * 「现在」的读文件部分：Claude Code 的记录直接从 ~/.claude/projects 读，不经过 dsh——
 * 桌面那只（desktop/main.cjs）每 20 秒调一次 snapshot()，dsh 没开也能陪你等活；网页那只经插件的 now 路由调。
 * 只读。最近 RECENT 内写过的记录读尾巴（判断在不在跑），一周多的历史每 10 分钟整读一遍（今天几件、这周骂了几回、上次停在哪）。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { claudeTurns } from './core/moments.js'
import { liveState } from './core/live.js'
import { SOURCE_PATHS } from './sources/files.js'
import { loadClaudeTurns } from './sources/claude-turns.js'

const RECENT = 30 * 60e3
const TAIL = 4 * 1024 * 1024        // 一份记录只读最后 4MB：够装下正在跑的这一轮
const HISTORY_DAYS = 8

let hist = { at: 0, turns: [], pending: null }

/** 一周多的历史，10 分钟重读一次；读的时候先用旧的 */
function history(root, now) {
  if (now - hist.at < 10 * 60e3 || hist.pending) return hist.turns
  hist.pending = loadClaudeTurns({ root, since: now - HISTORY_DAYS * 864e5 })
    .then(r => { hist = { at: Date.now(), turns: r.turns, pending: null } })
    .catch(err => { console.warn('[小本本] 读 Claude Code 历史失败', err?.message); hist.pending = null; hist.at = Date.now() })
  return hist.turns
}

/** 最近写过的 Claude Code 记录（跳过 claude -p 调用） */
async function recentClaude(root, now) {
  const out = []
  let dirs = []
  try { dirs = await fs.readdir(root) } catch { return out }
  for (const d of dirs) {
    let files = []
    try { files = (await fs.readdir(path.join(root, d))).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const file = path.join(root, d, f)
      try {
        const st = await fs.stat(file)
        if (now - st.mtimeMs > RECENT) continue
        const fh = await fs.open(file, 'r')
        let text
        try {
          const head = Buffer.alloc(Math.min(65536, st.size)); await fh.read(head, 0, head.length, 0)
          if (/"entrypoint":"sdk/.test(head.toString('utf8'))) continue
          const n = Math.min(TAIL, st.size), buf = Buffer.alloc(n)
          await fh.read(buf, 0, n, st.size - n)
          text = buf.toString('utf8')
        } finally { await fh.close() }
        const lines = text.split('\n'); if (st.size > TAIL) lines.shift()      // 截在半行上的第一行不要
        const turns = claudeTurns(lines, { key: file, home: os.homedir() })
        if (turns.length) out.push({ key: file, agent: 'claude', turns })
      } catch (err) { console.warn('[小本本] 读 Claude Code 记录失败', path.basename(file), err?.message) }
    }
  }
  return out
}

/**
 * @param {{ claude?: boolean, root?: string, extraRecent?: any[], extraHistory?: any[], now?: number }} [opts]
 *   claude：主人在「设置 → 年度回顾」里勾了读 Claude Code 才读；extra*：插件那边带进来的 dsh 会话
 */
export async function snapshot({ claude = true, root = SOURCE_PATHS.claude, extraRecent = [], extraHistory = [], now = Date.now() } = {}) {
  const recent = [...extraRecent], hs = [...extraHistory]
  if (claude) { recent.push(...await recentClaude(root, now)); hs.push(...history(root, now)) }
  return { ...liveState({ recent, history: hs, now }), ready: !claude || hist.at > 0, sources: { claude, dsh: extraRecent.length > 0 || extraHistory.length > 0 } }
}
