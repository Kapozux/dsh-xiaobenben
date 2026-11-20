// 在一份全新的 dsh 里真装、真起、真请求一遍（Windows / macOS / Linux 都能跑；.github/workflows/windows.yml 用的就是它）。
//   1. 临时目录当 DSH_HOME 和家目录（不碰你自己的 ~/.dsh、~/.claude），`dsh plugin --profile web add <包>` 装进去
//   2. 写几条造出来的 dsh 会话和一条 Claude Code 记录（路径用这台机器自己的写法）
//   3. 起 `dsh web`，带着它给的 token 请求插件的每个接口，核对回来的东西
//   4. 加 --browser：再用无头浏览器打开页面，看右下角的挂件出没出来、点一下说不说话（要先装 playwright；装在别的目录就用环境变量 XBB_PLAYWRIGHT 指过去）
// 跑：node scripts/smoke-dsh.mjs <包名 | 包名@版本 | ./xxx.tgz | 目录> [--browser] [--expect <版本>] [--shot <截图路径>]
// 要求：PATH 里有 dsh 和 pnpm。不调任何模型。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1] }
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
const expect = opt('--expect'), shot = opt('--shot'), browser = flag('--browser')
let spec = args[0]
if (!spec) { console.error('用法：node scripts/smoke-dsh.mjs <包名 | 包名@版本 | ./xxx.tgz | 目录> [--browser] [--expect <版本>] [--shot <截图路径>]'); process.exit(2) }
if (fs.existsSync(spec)) spec = path.resolve(spec)

const WIN = process.platform === 'win32'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xbb-smoke-'))
const DSH_HOME = path.join(tmp, 'dsh'), HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME, { recursive: true })

let failed = 0
const ok = (cond, msg, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${msg}${!cond && detail ? `\n    ${String(detail).slice(0, 600)}` : ''}`); if (!cond) failed++; return !!cond }
const info = msg => console.log(`  ${msg}`)
// npm 全局装的 dsh / pnpm 在 Windows 上是 .cmd，要经过 shell 才起得来
const sh = (cmd, a, env = {}) => spawnSync(cmd, a, { encoding: 'utf8', shell: WIN, env: { ...process.env, ...env } })

let web = null
function stopWeb() {
  if (!web?.pid) return
  if (WIN) spawnSync('taskkill', ['/pid', String(web.pid), '/T', '/F'], { stdio: 'ignore' })      // 经过 shell 起的，要连子进程一起杀
  else try { process.kill(web.pid) } catch {}
  web = null
}
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })

async function main() {
  console.log(`系统：${process.platform} ${os.release()} · node ${process.version} · dsh ${sh('dsh', ['--version']).stdout.trim() || '（没找到）'} · pnpm ${sh('pnpm', ['--version']).stdout.trim() || '（没找到）'}`)

  // ── 1. 安装 ──
  const add = sh('dsh', ['plugin', '--profile', 'web', 'add', spec], { DSH_HOME })
  const pkgFile = path.join(DSH_HOME, 'profiles', 'web', 'node_modules', 'dsh-xiaobenben', 'package.json')
  if (!ok(add.status === 0 && fs.existsSync(pkgFile), `dsh plugin --profile web add ${spec}`, add.stdout + add.stderr)) return
  const version = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version
  info(`装上的版本：${version}`)
  if (expect) ok(version === expect, `装上的是 ${expect}`, `实际是 ${version}`)
  const pkgDir = path.dirname(pkgFile)
  ok(fs.existsSync(path.join(pkgDir, 'lib', 'client.js')), '包里有网页那一半（lib/client.js）')

  // ── 2. 造数据 ──
  const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'write-light-home.mjs'), DSH_HOME], { encoding: 'utf8' })
  ok(seed.status === 0, `造 dsh 会话：${seed.stdout.trim()}`, seed.stderr)
  // 一条 Claude Code 记录：工作目录是个装项目的大文件夹，改的是里面 my-app 的文件（my-app 里真有 package.json）
  const cwd = path.join(HOME, 'code'), app = path.join(cwd, 'my-app')
  fs.mkdirSync(path.join(app, 'src'), { recursive: true })
  fs.writeFileSync(path.join(app, 'package.json'), '{}')
  const t0 = Date.now() - 2 * 864e5, at = m => new Date(t0 + m * 60e3).toISOString()
  const use = (i, name, input) => JSON.stringify({ type: 'assistant', timestamp: at(i), message: { id: 'm' + i, content: [{ type: 'tool_use', name, input }], usage: { input_tokens: 40000, output_tokens: 9000 } } })
  const claudeDir = path.join(HOME, '.claude', 'projects', 'smoke-code')
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(path.join(claudeDir, 'smoke-1.jsonl'), [
    JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: at(0), cwd, message: { content: '帮我把导入脚本重构一下' } }),
    ...Array.from({ length: 30 }, (_, i) => use(i + 1, i % 3 ? 'Bash' : 'Edit', i % 3 ? { command: `node ${path.join(app, 'run.js')}` } : { file_path: path.join(app, 'src', `import-${i}.js`) })),
    JSON.stringify({ type: 'assistant', timestamp: at(31), message: { id: 'done', content: [{ type: 'text', text: '改好了，测试都过了。' }] } }),
    JSON.stringify({ type: 'user', timestamp: at(33), message: { content: '还是报错，你再看看' } }),
    JSON.stringify({ type: 'assistant', timestamp: at(34), message: { id: 'sorry', content: [{ type: 'text', text: '你说得对，是我的错，我漏了一处。' }] } }),
  ].join('\n') + '\n')

  // ── 3. 起 dsh web ──
  const port = await freePort()
  const log = []
  web = spawn('dsh', ['web', '--no-open', '--port', String(port)], { shell: WIN, env: { ...process.env, DSH_HOME, HOME, USERPROFILE: HOME }, stdio: ['ignore', 'pipe', 'pipe'] })
  web.stdout.on('data', d => log.push(String(d))); web.stderr.on('data', d => log.push(String(d)))
  let exited = null
  web.on('exit', code => { exited = code })
  let url = null
  for (let i = 0; i < 240 && !url && exited === null; i++) {                  // 最多等 2 分钟
    url = log.join('').match(/https?:\/\/[^\s]+token=[^\s]+/)?.[0] || null
    if (!url) await new Promise(r => setTimeout(r, 500))
  }
  if (!ok(url, `dsh web 起来了（端口 ${port}）`, log.join('') || `进程退出，代码 ${exited}`)) return
  const base = new URL(url).origin + '/'
  const auth = await fetch(url, { redirect: 'manual' })
  const cookie = (auth.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')
  if (!ok(cookie, '拿 token 换到登录 cookie', `HTTP ${auth.status}`)) return

  const call = async (name, body = {}) => {
    const res = await fetch(`${base}api/xiaobenben.${name}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch {}
    return { status: res.status, data, text }
  }
  const good = (r, check) => r.status === 200 && r.data && (!check || check(r.data))

  // ── 4. 接口 ──
  let r = await call('sources')
  ok(good(r, d => Array.isArray(d) && ['dsh', 'claude', 'codex', 'cursor'].every(id => d.some(s => s.id === id))), 'sources：四个来源都列出来了', r.text)
  for (const s of r.data || []) if (s.id !== 'dsh') info(`${s.id}：${s.path}${s.exists ? '（有）' : '（没有）'}`)
  ok((r.data || []).find(s => s.id === 'claude')?.exists === true, 'sources：找到了家目录里的 Claude Code 记录')

  r = await call('source.set', { id: 'claude', enabled: true })
  ok(good(r, d => d.find(s => s.id === 'claude')?.enabled === true), 'source.set：勾上 Claude Code')

  r = await call('view', {})
  ok(good(r, d => d.stats?.totals?.userMsgs > 0 && d.report?.some(x => x.id === 'dsh' && x.sessions > 0)), `view：年度回顾有数（${r.data?.stats?.totals?.sessions} 个会话、${r.data?.stats?.totals?.userMsgs} 句）`, r.text)
  ok(good(r, d => d.report?.some(x => x.id === 'claude' && x.sessions > 0 && !x.error)), 'view：读到了 Claude Code 的会话', JSON.stringify(r.data?.report))

  r = await call('moments', { fresh: true })
  ok(good(r, d => Array.isArray(d.moments) && d.moments.length > 0), `moments：翻得出旧账（${r.data?.moments?.length} 件，${JSON.stringify(r.data?.report)}）`, r.text)
  const cl = (r.data?.report || []).find(x => x.id === 'claude')
  ok(cl?.sessions > 0, 'moments：读到了 Claude Code 的轮', JSON.stringify(r.data?.report))
  const mine = (r.data?.moments || []).find(m => /还是报错/.test(m.text))
  ok(mine, `moments：Claude Code 那条记录里的事翻出来了${mine ? `：「${String(mine.text).replace(/\n/g, ' / ')}」` : ''}`, JSON.stringify((r.data?.moments || []).map(m => m.text)))
  ok(!JSON.stringify(r.data || {}).includes(HOME), 'moments：回来的东西里没有本机路径')

  r = await call('now')
  ok(good(r, d => typeof d === 'object' && 'sources' in d), 'now：能问「现在」', r.text)

  r = await call('style.status')
  ok(good(r, d => 'auto' in d), 'style.status：台词库状态', r.text)

  r = await call('models')
  ok(good(r, d => Array.isArray(d.providers)), 'models：列得出模型（没配也行）', r.text)

  const fb = { v: 1, up: [], down: [], shown: { 'smoke-card': { n: 2, at: Date.now() } } }
  r = await call('feedback', { fb })
  const r2 = await call('feedback')
  ok(good(r) && good(r2, d => d.fb && typeof d.fb === 'object'), 'feedback：写进去再读得回来', r.text + ' / ' + r2.text)
  const stateDir = path.join(DSH_HOME, 'storages', 'dsh-xiaobenben')
  ok(fs.existsSync(path.join(stateDir, 'state.json')) && fs.existsSync(path.join(stateDir, 'feedback.json')), `状态存在 ${path.join('$DSH_HOME', 'storages', 'dsh-xiaobenben')}`, fs.existsSync(stateDir) ? fs.readdirSync(stateDir).join(', ') : '目录不存在')

  r = await call('nope')
  ok(r.status === 404, '不存在的接口回 404', `HTTP ${r.status}`)

  // 素材
  const asset = k => fetch(`${base}api/xiaobenben.asset?k=${encodeURIComponent(k)}`, { headers: { cookie } })
  let a = await asset('xiaobenben/normal.png'), buf = Buffer.from(await a.arrayBuffer())
  ok(a.status === 200 && a.headers.get('content-type') === 'image/png' && buf.subarray(1, 4).toString() === 'PNG', `asset：立绘取得到（${buf.length} 字节）`, `HTTP ${a.status} ${a.headers.get('content-type')}`)
  a = await asset('fonts/xbb-rounded.woff2'); buf = Buffer.from(await a.arrayBuffer())
  ok(a.status === 200 && buf.subarray(0, 4).toString() === 'wOF2', `asset：字体取得到（${buf.length} 字节）`, `HTTP ${a.status}`)
  for (const k of ['xiaobenben/../../package.json', 'xiaobenben\\..\\..\\package.json', '../package.json', 'xiaobenben/nope.png']) {
    a = await asset(k)
    ok(a.status === 404, `asset：${k} 不给`, `HTTP ${a.status}`)
  }

  // 桌面模式：macOS 以外必须说清楚不支持，并且什么都不下载
  r = await call('desktop')
  if (process.platform === 'darwin') {
    ok(good(r, d => d.desktop?.on === false && d.desktop?.supported !== false), 'desktop：macOS 上可以放到桌面（这里不真开窗口）', r.text)
  } else {
    ok(good(r, d => d.desktop?.on === false && d.desktop?.supported === false), 'desktop：状态里写明这台电脑不支持桌面模式', r.text)
    r = await call('desktop', { on: true })
    ok(good(r, d => d.desktop?.on === false && /只支持 macOS/.test(d.desktop?.error || '')), `desktop：点「放到桌面上」得到清楚的提示：${r.data?.desktop?.error}`, r.text)
    ok(!fs.existsSync(path.join(stateDir, 'electron')) && !fs.existsSync(path.join(stateDir, 'moments.json')), 'desktop：没有下载 Electron、没有写桌面用的台词文件')
    r = await call('desktop')
    ok(good(r, d => !d.desktop?.downloading), 'desktop：没有在后台下载', r.text)
  }

  // ── 5. 浏览器里的挂件 ──
  if (browser) await inBrowser(url)

  const errs = log.join('').split('\n').filter(l => /dsh-xiaobenben|小本本/.test(l) && /Error|失败|出错|ENOENT|EPERM/i.test(l))
  ok(errs.length === 0, 'dsh 的输出里没有插件报的错', errs.join('\n    '))
}

async function inBrowser(url) {
  let chromium
  try {
    // playwright 不进本包的依赖：装在别处时用 XBB_PLAYWRIGHT 指那个目录（里面有 node_modules/playwright）
    const from = process.env.XBB_PLAYWRIGHT ? pathToFileURL(createRequire(path.join(path.resolve(process.env.XBB_PLAYWRIGHT), 'x.js')).resolve('playwright')).href : 'playwright'
    const m = await import(from)
    chromium = m.chromium || m.default?.chromium
    if (!chromium) throw new Error('playwright 里没有 chromium')
  } catch (err) { ok(false, '浏览器检查要先装 playwright（npm i --no-save playwright && npx playwright install chromium）', err.message); return }
  const b = await chromium.launch()
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error' && /xiaobenben/i.test(m.text())) errors.push(m.text()) })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const pet = page.locator('.fy-pet')
    const shown = await pet.waitFor({ state: 'visible', timeout: 60000 }).then(() => true, () => false)
    if (!ok(shown, '网页：右下角的挂件出来了', errors.join('\n    '))) { if (shot) await page.screenshot({ path: shot }); return }
    const drawn = await page.waitForFunction(() => { const i = document.querySelector('.fy-pet img'); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 30000 }).then(() => true, () => false)
    ok(drawn, '网页：立绘画出来了')
    const box = await pet.boundingBox()
    ok(box && box.x > 640 && box.y > 300, `网页：她在右下角（${Math.round(box?.x)}, ${Math.round(box?.y)}）`)
    const font = await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter(f => /xbb|rounded/i.test(f.family)).map(f => `${f.family}:${f.status}`)))
    info(`字体：${font.join('、') || '（没登记）'}`)
    // 全新的 dsh 第一次打开有个「Preview Notice」弹窗，开着时整页点不动（inert）：先点掉。按钮要等几秒才亮
    const blocked = () => page.evaluate(() => !!document.querySelector('.fy-pet')?.closest('[inert]'))
    for (let i = 0; i < 5 && await blocked(); i++) {
      const go = page.locator('[role=dialog] button:enabled, dialog button:enabled, [class*=dialog] button:enabled').last()
      await go.click({ timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(500)
    }
    if (!ok(!(await blocked()), '网页：dsh 第一次打开的弹窗点掉了，挂件点得到')) { if (shot) await page.screenshot({ path: shot }); return }
    await pet.click({ position: { x: box.width / 2, y: box.height / 2 } })
    const bubble = page.locator('.fy-bubble:not(.fy-think)')
    const said = await bubble.first().waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false)
    const text = said ? (await bubble.first().innerText()).replace(/\s+/g, ' ').slice(0, 80) : ''
    ok(said && text.length > 0, `网页：点一下她说话了：「${text}」`, errors.join('\n    '))
    // 右键菜单：macOS 以外不该有「放到桌面上」
    await page.keyboard.press('Escape')
    await pet.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } })
    const menu = page.locator('.fy-menu')
    const opened = await menu.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)
    const items = opened ? await menu.locator('button').allInnerTexts() : []
    ok(opened && items.length > 0, `网页：右键有菜单（${items.length} 项）`)
    const hasDesk = items.some(t => /放到桌面上/.test(t))
    ok(hasDesk === (process.platform === 'darwin'), process.platform === 'darwin' ? '网页：菜单里有「放到桌面上」' : '网页：菜单里没有「放到桌面上」（这台电脑用不了）', items.join(' | '))
    if (shot) { await page.screenshot({ path: shot }); info(`截图：${shot}`) }
    ok(errors.length === 0, '网页：没有报错', errors.join('\n    '))
  } finally { await b.close() }
}

try { await main() } catch (err) { ok(false, '冒烟脚本自己出错了', err?.stack || err) } finally {
  stopWeb()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch (err) { info(`临时目录没删干净：${tmp}（${err.code}）`) }
}
console.log(failed ? `\n${failed} 项没过` : '\n全部通过')
process.exit(failed ? 1 : 0)
