/**
 * 大肥鱼桌面版的 host 这一半：起 / 停那个 Electron 窗口，给它写台词文件。
 * - 台词：pet.moments() 的结果写到 $DSH_HOME/storages/dsh-xiaobenben/moments.json，开着时每 10 分钟重写一次。
 *   桌面窗口自己不读任何聊天记录，只读这一份；dsh 关了它也还在，用的是最后一份。
 * - Electron：配置里给了路径就用；否则依次找：解到插件目录里的那份 → dsh-pet 装过的那份（$DSH_HOME/electron）
 *   → 本机 Electron 官方下载缓存（~/Library/Caches/electron/<hash>/electron-v*-darwin-<arch>.zip）解一份。
 *   都没有才下载：用官方的 @electron/get（带 SHA256 校验，下到上面那个缓存里），默认走 npmmirror 镜像，和 dsh-pet 一样。
 *   下载在后台跑（约 120 MB），status() 里带进度；下完自己上桌面。这是插件唯一会自己联网的地方，只在主人点「放到桌面上」时发生。
 * - 主人在桌面那只的菜单里点「回到 dsh 网页里」→ 它写个 desktop-off 标记再退出；这边看到标记就把开关关掉。
 */
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const MAIN = fileURLToPath(new URL('../desktop/main.cjs', import.meta.url))
const BIN_IN_APP = 'Electron.app/Contents/MacOS/Electron'
export const ELECTRON_VERSION = '43.3.0'
export const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'

/** 真去下载：返回缓存里那个 zip 的路径。onProgress(0..100) */
async function fetchElectron({ version, mirror, onProgress, signal }) {
  const { downloadArtifact } = await import('@electron/get')
  return downloadArtifact({
    version: `v${version}`,
    artifactName: 'electron',
    mirrorOptions: { mirror: mirror.replace(/\/$/, '') + '/' },
    downloadOptions: {
      signal, quiet: true,
      getProgressCallback: async p => { if (p.total) onProgress(Math.min(100, Math.floor(p.transferred / p.total * 100))) },
    },
  })
}

function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }

export class Desktop {
  /**
   * @param {{ store: import('./store.js').Store, pet: import('./pet.js').Pet, electron?: string, mirror?: string, version?: string,
   *   download?: typeof fetchElectron, launch?: (bin: string) => { pid?: number }, cacheDir?: string }} deps
   *   download / launch / cacheDir 只给测试换
   */
  constructor({ store, pet, electron = '', mirror = '', version = '', download = fetchElectron, launch = null, cacheDir = '' }) {
    this.store = store
    this.pet = pet
    this.electron = electron
    this.mirror = mirror || process.env.XBB_ELECTRON_MIRROR || ELECTRON_MIRROR
    this.version = version || process.env.XBB_ELECTRON_VERSION || ELECTRON_VERSION
    this.download = download
    this.launch = launch || (bin => this.#spawn(bin))
    this.cacheDir = cacheDir || path.join(os.homedir(), 'Library/Caches/electron')
    this.dir = path.dirname(store.file)
    this.timer = null
    this.dl = null            // 正在下载：{ percent, promise }
  }

  status() {
    const off = path.join(this.dir, 'desktop-off')
    if (fs.existsSync(off)) {
      try { fs.unlinkSync(off) } catch {}
      this.store.update(s => ({ ...s, desktop: { on: false } }))
      this.#stopTimer()
    }
    const d = this.store.read().desktop || {}
    const on = !!d.on && alive(d.pid)
    if (d.on && !on) this.#stopTimer()
    return { on, error: d.error || null, downloading: this.dl ? `正在下载 Electron ${this.version}（约 120 MB）· ${this.dl.percent}%` : null }
  }

  /** 插件启动时：上次开着就接着开（窗口已经在就只接上定时重写） */
  async resume() {
    const d = this.store.read().desktop
    if (!d?.on) return
    if (alive(d.pid)) { await this.#writeMoments(true).catch(err => console.warn('[dsh-xiaobenben] 重写台词失败', err)); this.#startTimer(); return }
    await this.start().catch(err => console.warn('[dsh-xiaobenben] 大肥鱼上桌面失败', err))
  }

  async start() {
    try {
      await this.#writeMoments(false)
      const cur = this.store.read().desktop
      if (cur?.on && alive(cur.pid)) { this.#startTimer(); return this.status() }
      if (this.dl) return this.status()                       // 还在下，别再起一个
      const bin = await this.#findElectron()
      if (!bin) { this.#startDownload(); return this.status() }   // 本机哪都没有：后台下载，下完自己上桌面
      const child = this.launch(bin)
      this.store.update(s => ({ ...s, desktop: { on: true, pid: child.pid, error: null } }))
      this.#startTimer()
      return this.status()
    } catch (err) {
      const msg = err?.message || String(err)
      console.warn('[dsh-xiaobenben] 大肥鱼上桌面失败', msg)
      this.store.update(s => ({ ...s, desktop: { on: false, error: msg } }))
      return { on: false, error: msg }
    }
  }

  #spawn(bin) {
    const child = spawn(bin, [MAIN], {
      detached: true,
      stdio: ['ignore', 'ignore', fs.openSync(path.join(this.dir, 'desktop.log'), 'a')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', FY_STATE_DIR: this.dir },
    })
    child.unref()
    return child
  }

  /** 后台下载 Electron（最多 20 分钟：实测走镜像 122 MB 要 5 分钟上下），下完解开、上桌面；失败把原因记在 desktop.error 里 */
  #startDownload() {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new Error('下载 Electron 超过 20 分钟，先停了')), 20 * 60e3)
    timer.unref?.()
    const dl = { percent: 0, ctrl, promise: null }
    this.dl = dl
    this.store.update(s => ({ ...s, desktop: { on: false, error: null } }))
    console.info(`[dsh-xiaobenben] 本机没有 Electron，开始下载 v${this.version}（${this.mirror}）`)
    dl.promise = this.download({ version: this.version, mirror: this.mirror, signal: ctrl.signal, onProgress: p => { dl.percent = p } })
      .then(zip => this.#unzip(zip))
      .then(() => { this.dl = null; return this.start() })
      .catch(err => {
        this.dl = null
        const msg = `下载 Electron 失败：${err?.message || err}。可以换个镜像（环境变量 XBB_ELECTRON_MIRROR），或在插件设置里填 Electron.app 的路径`
        console.warn('[dsh-xiaobenben]', msg)
        this.store.update(s => ({ ...s, desktop: { on: false, error: msg } }))
        return { on: false, error: msg }
      })
      .finally(() => clearTimeout(timer))
  }

  stop() {
    this.dl?.ctrl.abort(new Error('主人取消了'))
    const d = this.store.read().desktop
    if (alive(d?.pid)) { try { process.kill(d.pid) } catch (err) { console.warn('[dsh-xiaobenben] 关桌面大肥鱼失败', err.message) } }
    this.store.update(s => ({ ...s, desktop: { on: false } }))
    this.#stopTimer()
    return this.status()
  }

  async #writeMoments(fresh) {
    const v = await this.pet.moments({ fresh })
    const file = path.join(this.dir, 'moments.json')
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify({ at: Date.now(), days: v.days, moments: v.moments }), { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
  }

  #startTimer() {
    if (this.timer) return
    this.timer = setInterval(() => this.#writeMoments(true).catch(err => console.warn('[dsh-xiaobenben] 重写台词失败', err)), 10 * 60e3)
    this.timer.unref?.()
  }
  #stopTimer() { clearInterval(this.timer); this.timer = null }

  /** 本机找 Electron：找到返回可执行文件路径，哪都没有返回 null（那就去下载） */
  async #findElectron() {
    if (this.electron) {
      const p = this.electron.endsWith('.app') ? path.join(this.electron, 'Contents/MacOS/Electron') : this.electron
      if (fs.existsSync(p)) return p
      throw new Error(`配置里的 Electron 路径不存在：${p}`)
    }
    if (process.platform !== 'darwin') throw new Error('桌面版目前只支持 macOS')
    const mine = path.join(this.dir, 'electron', BIN_IN_APP)
    if (fs.existsSync(mine)) return mine
    const shared = path.join(this.dir, '..', '..', 'electron', BIN_IN_APP)      // dsh-pet 下载解好的那份（$DSH_HOME/electron）
    if (fs.existsSync(shared)) return shared
    const want = new RegExp(`^electron-v[\\d.]+-darwin-${process.arch}\\.zip$`)
    const zips = []
    try {
      for (const h of fs.readdirSync(this.cacheDir)) {
        try { for (const f of fs.readdirSync(path.join(this.cacheDir, h))) if (want.test(f)) zips.push(path.join(this.cacheDir, h, f)) } catch {}
      }
    } catch {}
    zips.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (!zips.length) return null
    return this.#unzip(zips[0])
  }

  async #unzip(zip) {
    const mine = path.join(this.dir, 'electron', BIN_IN_APP)
    const dest = path.join(this.dir, 'electron')
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    await run('/usr/bin/ditto', ['-x', '-k', zip, dest], { timeout: 120000 })
    if (!fs.existsSync(mine)) throw new Error(`解开 ${path.basename(zip)} 之后没找到 Electron`)
    return mine
  }
}
