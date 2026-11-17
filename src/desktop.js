/**
 * 大肥鱼桌面版的 host 这一半：起 / 停那个 Electron 窗口，给它写台词文件。
 * - 台词：pet.moments() 的结果写到 $DSH_HOME/storages/dsh-agent-year/moments.json，开着时每 10 分钟重写一次。
 *   桌面窗口自己不读任何聊天记录，只读这一份；dsh 关了它也还在，用的是最后一份。
 * - Electron：配置里给了路径就用；否则用解到插件目录里的那份；再没有就从本机 Electron 官方下载缓存
 *   （~/Library/Caches/electron/<hash>/electron-v*-darwin-<arch>.zip，别的 Electron 程序装的时候留下的）解一份。都没有就明说。
 * - 主人在桌面那只的菜单里点「回到 dsh 网页里」→ 它写个 desktop-off 标记再退出；这边看到标记就把开关关掉。
 */
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { ANIM } from './pet.js'

const run = promisify(execFile)
const MAIN = fileURLToPath(new URL('../desktop/main.cjs', import.meta.url))
const BIN_IN_APP = 'Electron.app/Contents/MacOS/Electron'

function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }

export class Desktop {
  /** @param {{ store: import('./store.js').Store, pet: import('./pet.js').Pet, electron?: string }} deps */
  constructor({ store, pet, electron = '' }) {
    this.store = store
    this.pet = pet
    this.electron = electron
    this.dir = path.dirname(store.file)
    this.timer = null
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
    return { on, error: d.error || null }
  }

  /** 插件启动时：上次开着就接着开（窗口已经在就只接上定时重写） */
  async resume() {
    const d = this.store.read().desktop
    if (!d?.on) return
    if (alive(d.pid)) { await this.#writeMoments(true).catch(err => console.warn('[dsh-agent-year] 重写台词失败', err)); this.#startTimer(); return }
    await this.start().catch(err => console.warn('[dsh-agent-year] 大肥鱼上桌面失败', err))
  }

  async start() {
    try {
      await this.#writeMoments(false)
      const cur = this.store.read().desktop
      if (cur?.on && alive(cur.pid)) { this.#startTimer(); return this.status() }
      const bin = await this.#findElectron()
      const child = spawn(bin, [MAIN], {
        detached: true,
        stdio: ['ignore', 'ignore', fs.openSync(path.join(this.dir, 'desktop.log'), 'a')],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', FY_STATE_DIR: this.dir, FY_ANIM_DIR: this.pet.assetsDir || '', FY_ANIM_MAP: JSON.stringify(ANIM) },
      })
      child.unref()
      this.store.update(s => ({ ...s, desktop: { on: true, pid: child.pid, error: null } }))
      this.#startTimer()
      return this.status()
    } catch (err) {
      const msg = err?.message || String(err)
      console.warn('[dsh-agent-year] 大肥鱼上桌面失败', msg)
      this.store.update(s => ({ ...s, desktop: { on: false, error: msg } }))
      return { on: false, error: msg }
    }
  }

  stop() {
    const d = this.store.read().desktop
    if (alive(d?.pid)) { try { process.kill(d.pid) } catch (err) { console.warn('[dsh-agent-year] 关桌面大肥鱼失败', err.message) } }
    this.store.update(s => ({ ...s, desktop: { on: false } }))
    this.#stopTimer()
    return this.status()
  }

  async #writeMoments(fresh) {
    const v = await this.pet.moments({ fresh })
    const file = path.join(this.dir, 'moments.json')
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify({ at: Date.now(), days: v.days, anims: v.anims, moments: v.moments }), { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
  }

  #startTimer() {
    if (this.timer) return
    this.timer = setInterval(() => this.#writeMoments(true).catch(err => console.warn('[dsh-agent-year] 重写台词失败', err)), 10 * 60e3)
    this.timer.unref?.()
  }
  #stopTimer() { clearInterval(this.timer); this.timer = null }

  async #findElectron() {
    if (this.electron) {
      const p = this.electron.endsWith('.app') ? path.join(this.electron, 'Contents/MacOS/Electron') : this.electron
      if (fs.existsSync(p)) return p
      throw new Error(`配置里的 Electron 路径不存在：${p}`)
    }
    if (process.platform !== 'darwin') throw new Error('桌面版目前只支持 macOS')
    const mine = path.join(this.dir, 'electron', BIN_IN_APP)
    if (fs.existsSync(mine)) return mine
    const cache = path.join(os.homedir(), 'Library/Caches/electron')
    const want = new RegExp(`^electron-v[\\d.]+-darwin-${process.arch}\\.zip$`)
    const zips = []
    try {
      for (const h of fs.readdirSync(cache)) {
        try { for (const f of fs.readdirSync(path.join(cache, h))) if (want.test(f)) zips.push(path.join(cache, h, f)) } catch {}
      }
    } catch {}
    zips.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (!zips.length) throw new Error('本机没找到 Electron（桌面版要用它开透明窗口）。可以在插件设置里填 Electron.app 的路径')
    const dest = path.join(this.dir, 'electron')
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    await run('/usr/bin/ditto', ['-x', '-k', zips[0], dest], { timeout: 120000 })
    if (!fs.existsSync(mine)) throw new Error(`解开 ${path.basename(zips[0])} 之后没找到 Electron`)
    return mine
  }
}
