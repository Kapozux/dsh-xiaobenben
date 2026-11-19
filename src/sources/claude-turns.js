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
        if (t.length) { sessions++; turns.push(...await resolveProjects(t)) }
      } catch (err) {
        console.warn('[dsh-xiaobenben] 读 Claude Code 记录失败', file, err?.message)
      }
    }
  }
  markLoose(turns)
  return { turns, sessions, skipped }
}

/** 哪个工作目录底下认出过项目，它就是个装项目的大文件夹：在它里面、没认出是哪个项目的那些轮，文件夹名说不出是哪件事（t.loose） */
export function markLoose(turns) {
  const own = t => t.cwd && t.project === t.cwd.split('/').pop()
  const containers = new Set(turns.filter(t => t.cwd && t.project && !own(t) && t.project !== '主目录').map(t => t.cwd))
  for (const t of turns) if (containers.has(t.cwd) && own(t)) t.loose = true
  return turns
}

const MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'README.md']
const isProject = new Map()
/**
 * 工作目录是个装了很多项目的大文件夹时（在 ~/code 里开的会话，改的是 ~/code/my-app/…），「哪个项目」算子文件夹：
 * 子文件夹里有 .git / package.json / README 之类才算。一个会话里没改文件的轮，沿用前面认出来的那个。
 */
export async function resolveProjects(turns, exists = p => fs.access(p).then(() => true, () => false)) {
  let last = null
  for (const t of turns) {
    const top = Object.entries(t.subs || {}).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (top && t.cwd) {
      const dir = path.join(t.cwd, top)
      if (!isProject.has(dir)) isProject.set(dir, (await Promise.all(MARKERS.map(m => exists(path.join(dir, m))))).some(Boolean))
      if (isProject.get(dir)) last = { cwd: t.cwd, name: top }
    }
    if (last && last.cwd === t.cwd) t.project = last.name
  }
  return turns
}
