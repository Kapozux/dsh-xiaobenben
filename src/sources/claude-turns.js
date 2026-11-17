/**
 * Claude Code 记录 → 轮（给大肥鱼挑时刻用）。和 files.js 的 loadClaude 读同一个目录，但要工具调用和时间，所以单独读一遍。
 * 只读；跳过 `claude -p` 调用（entrypoint sdk-*，别的程序调的，不是主人在说话）。只看最近修改过的文件。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { claudeTurns } from '../core/moments.js'
import { SOURCE_PATHS } from './files.js'

/**
 * @param {{ root?: string, since?: number }} [opts]
 * @returns {Promise<{ turns: any[], sessions: number, skipped: number }>}
 */
export async function loadClaudeTurns({ root = SOURCE_PATHS.claude, since = 0 } = {}) {
  const turns = []
  let sessions = 0, skipped = 0
  let dirs = []
  try { dirs = await fs.readdir(root) } catch { return { turns, sessions, skipped } }
  for (const d of dirs) {
    let files = []
    try { files = (await fs.readdir(path.join(root, d))).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const file = path.join(root, d, f)
      try {
        const st = await fs.stat(file)
        if (st.mtimeMs < since) continue
        // 先只读开头 64KB 判断是不是 claude -p 调用（这种文件有好几千个），是就不整份读
        const fh = await fs.open(file, 'r')
        let head
        try { const buf = Buffer.alloc(65536); const { bytesRead } = await fh.read(buf, 0, buf.length, 0); head = buf.subarray(0, bytesRead).toString('utf8') } finally { await fh.close() }
        if (/"entrypoint":"sdk/.test(head)) { skipped++; continue }
        const text = await fs.readFile(file, 'utf8')
        const t = claudeTurns(text.split('\n'), { key: file, home: os.homedir() })
        if (t.length) { sessions++; turns.push(...t) }
      } catch (err) {
        console.warn('[dsh-agent-year] 读 Claude Code 记录失败', file, err?.message)
      }
    }
  }
  return { turns, sessions, skipped }
}
