// 把手造的轻度数据写成真正的 dsh 会话文件（session.v3.jsonl.zstd），给一个单独的 DSH_HOME 用，
// 好在真的 dsh 里测两种后端。跑：node scripts/write-light-home.mjs <DSH_HOME 目录>
// 只写进你给的那个目录；格式照 dsh 仓库里的样例会话（docs/dsh-api.md §1），dsh 读的时候自己升级到当前版本。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { lightSessions } from '../tests/fixtures/light.js'

const home = process.argv[2]
if (!home) { console.error('用法：node scripts/write-light-home.mjs <DSH_HOME 目录>'); process.exit(1) }
const Z = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
const seg = s => [...s].map((c, i) => (c !== '~' && /^[A-Za-z0-9._-]$/.test(c) ? c : '~' + s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'))).join('')
const projectKey = cwd => `--${cwd.replace(/[/\\:]+/g, '-').replace(/^-+/, '')}--`

let n = 0
for (const { header, events } of lightSessions()) {
  if (header.origin === 'subagent') continue
  const out = []
  for (const e of events) {
    // 注入上下文那条（source.kind 不是 user）只用于单元测试，不写进真文件
    if (e.type === 'user/message' && e.data.source.kind !== 'user') continue
    // 真日志里 assistant/message 夹在 step/start 和 step/end 之间
    if (e.type === 'assistant/message') out.push({ type: 'step/start', data: { turn: e.data.turn, step: 1 }, seq: out.length, time: e.time })
    const ev = { type: e.type, data: e.data, seq: out.length, time: e.time }
    if (e.type === 'user/message') ev.surfaceOp = 'append'
    if (e.type === 'assistant/message') {
      const text = e.data.message.content[0].text
      ev.data = { ...e.data, stream: [{ type: 'chunk', time: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } }, { type: 'text-chunks', time0: 0, index: 0, dt: [], texts: [text] }, { type: 'chunk', time: 0, chunk: { type: 'block-end', index: 0, block: { type: 'text', text } } }, { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } }] }
      ev.surfaceOp = 'append'
    }
    out.push(ev)
    if (e.type === 'assistant/message') out.push({ type: 'step/end', data: { turn: e.data.turn, step: 1 }, seq: out.length, time: e.time })
  }
  const h = { type: 'session', version: 3, ...header, delegationDepth: 0, agentPreset: 'standard' }
  const dir = path.join(home, 'sessions', projectKey(header.cwd), seg(header.id))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.v3.jsonl.zstd'), Buffer.concat([zlib.zstdCompressSync(JSON.stringify(h) + '\n', Z), zlib.zstdCompressSync(out.map(e => JSON.stringify(e)).join('\n') + '\n', Z)]))
  n++
}
console.log(`写了 ${n} 个会话到 ${path.join(home, 'sessions')}`)
