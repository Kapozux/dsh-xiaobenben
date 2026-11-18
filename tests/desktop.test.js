// 桌面版找 / 下载 Electron：不真联网、不真开窗口（download 和 launch 换成假的）。只在 macOS 上跑（解压用系统的 ditto）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Desktop, ELECTRON_MIRROR, ELECTRON_VERSION } from '../src/desktop.js'

const mac = { skip: process.platform !== 'darwin' }
const BIN = 'Electron.app/Contents/MacOS/Electron'

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xbb-desk-'))            // 假的 $DSH_HOME
  const dir = path.join(home, 'storages', 'dsh-xiaobenben')
  fs.mkdirSync(dir, { recursive: true })
  let state = {}
  const store = { file: path.join(dir, 'state.json'), read: () => state, update: fn => { state = fn(state) } }
  const pet = { moments: async () => ({ days: 120, moments: [] }) }
  const launched = []
  // 假装开了窗口：起一个 sleep 当那个进程（stop() 会真的去杀这个 pid，不能给自己的）
  const launch = bin => { launched.push(bin); const c = spawn('/bin/sleep', ['30'], { stdio: 'ignore' }); c.unref(); return c }
  return { home, dir, store, pet, launched, launch, cacheDir: path.join(home, 'no-cache') }
}
/** 做一个假的 Electron zip，结构和官方的一样 */
function fakeZip(home) {
  const src = path.join(home, 'zip-src')
  fs.mkdirSync(path.join(src, path.dirname(BIN)), { recursive: true })
  fs.writeFileSync(path.join(src, BIN), '#!/bin/sh\n')
  const zip = path.join(home, `electron-v${ELECTRON_VERSION}-darwin-${process.arch}.zip`)
  execFileSync('/usr/bin/ditto', ['-c', '-k', src, zip])
  return zip
}

test('本机哪都没有 Electron：后台下载（默认 npmmirror），带进度，下完自己上桌面', mac, async () => {
  const t = setup()
  let asked, finish
  const download = async req => { asked = req; req.onProgress(37); await new Promise(r => { finish = r }); return fakeZip(t.home) }
  const d = new Desktop({ ...t, download })
  const first = await d.start()
  assert.equal(first.on, false)
  assert.match(first.downloading, /正在下载 Electron 43\.3\.0（约 120 MB）· 37%/)
  assert.equal(asked.mirror, ELECTRON_MIRROR)
  assert.equal(asked.version, ELECTRON_VERSION)
  assert.equal((await d.start()).on, false)                    // 下载中再点一次：不会起第二个下载
  assert.equal(t.launched.length, 0)
  finish(); await d.dl.promise
  assert.deepEqual(t.launched, [path.join(t.dir, 'electron', BIN)])
  assert.deepEqual(d.status(), { on: true, error: null, downloading: null })
  d.stop()
})

test('下载失败：说清原因和怎么办，不上桌面', mac, async () => {
  const t = setup()
  const d = new Desktop({ ...t, download: async () => { throw new Error('getaddrinfo ENOTFOUND') } })
  await d.start(); await d.dl?.promise
  const s = d.status()
  assert.equal(s.on, false)
  assert.match(s.error, /下载 Electron 失败：getaddrinfo ENOTFOUND.*XBB_ELECTRON_MIRROR.*Electron\.app 的路径/)
  assert.equal(t.launched.length, 0)
})

test('本机已经有的不下载：dsh-pet 装过的那份（$DSH_HOME/electron）、官方下载缓存里的 zip', mac, async () => {
  const noDownload = async () => { throw new Error('不该下载') }
  const a = setup()
  fs.mkdirSync(path.join(a.home, 'electron', path.dirname(BIN)), { recursive: true })
  fs.writeFileSync(path.join(a.home, 'electron', BIN), '')
  const da = new Desktop({ ...a, download: noDownload })
  assert.equal((await da.start()).on, true)
  assert.equal(fs.realpathSync(a.launched[0]), fs.realpathSync(path.join(a.home, 'electron', BIN)))
  da.stop()

  const b = setup()
  fs.mkdirSync(path.join(b.cacheDir, 'abc'), { recursive: true })
  fs.renameSync(fakeZip(b.home), path.join(b.cacheDir, 'abc', `electron-v${ELECTRON_VERSION}-darwin-${process.arch}.zip`))
  const db = new Desktop({ ...b, download: noDownload })
  assert.equal((await db.start()).on, true)
  assert.deepEqual(b.launched, [path.join(b.dir, 'electron', BIN)])
  db.stop()
})
