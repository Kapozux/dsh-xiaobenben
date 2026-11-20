// 跑全部测试。测试里的钟点按台北时间写的，所以固定 TZ；写成脚本是因为 `TZ=… node` 这种写法在 Windows 的 cmd / PowerShell 里不认。
// 跑：npm test（或 node scripts/test.mjs tests/core.test.js 只跑一个）
import { spawnSync } from 'node:child_process'

const files = process.argv.slice(2)
const r = spawnSync(process.execPath, ['--test', ...(files.length ? files : ['tests/*.test.js'])], { stdio: 'inherit', env: { ...process.env, TZ: 'Asia/Taipei' } })
process.exit(r.status ?? 1)
