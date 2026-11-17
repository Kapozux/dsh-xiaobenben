// 大肥鱼桌面版（Electron 主进程）：一个铺满主屏工作区的透明窗口，置顶、不进 Dock、默认点击穿透；
// 鼠标移到大肥鱼 / 气泡 / 菜单上才接管点击（渲染进程通过 preload 告诉这里）。
// 台词不自己算：插件 host 写好 moments.json；立绘和字体在插件自己的 assets/ 里。dsh 关了也能用最后一份台词。
const { app, BrowserWindow, ipcMain, protocol, screen, net } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const STATE_DIR = process.env.FY_STATE_DIR          // $DSH_HOME/storages/dsh-xiaobenben
const ROOT = path.resolve(__dirname, '..')

if (!STATE_DIR) { console.error('[大肥鱼] 缺 FY_STATE_DIR'); process.exit(2) }
if (process.env.FY_SELFTEST) app.setPath('userData', path.join(require('node:os').tmpdir(), 'fy-selftest-' + process.pid))
else if (!app.requestSingleInstanceLock()) app.exit(0)

protocol.registerSchemesAsPrivileged([{ scheme: 'fy', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

const STATIC = { '/index.html': 'desktop/index.html', '/pet-engine.js': 'src/shared/pet-engine.js', '/lines.js': 'src/shared/lines.js', '/chat.js': 'src/shared/chat.js' }

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide()
  protocol.handle('fy', req => {
    const u = new URL(req.url)
    if (u.pathname === '/moments.json') {
      try { return new Response(fs.readFileSync(path.join(STATE_DIR, 'moments.json')), { headers: { 'content-type': 'application/json' } }) }
      catch (err) { console.error('[大肥鱼] 读台词失败', err.message); return new Response('{}', { status: 404 }) }
    }
    if (/^\/assets\/(xiaobenben|fonts)\/[\w-]+\.(png|woff2)$/.test(u.pathname)) {
      const f = path.join(ROOT, u.pathname)
      if (!fs.existsSync(f)) return new Response('', { status: 404 })
      return net.fetch(pathToFileURL(f).toString())
    }
    const rel = STATIC[u.pathname]
    if (!rel) return new Response('', { status: 404 })
    return net.fetch(pathToFileURL(path.join(ROOT, rel)).toString())
  })

  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    x: area.x, y: area.y, width: area.width, height: area.height,
    acceptFirstMouse: true,     // 没聚焦时第一下点击直接算数（不然 macOS 会吞掉按下 / 松开里的一个）
    transparent: true, frame: false, hasShadow: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, fullscreenable: false, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadURL('fy://app/index.html')
  win.once('ready-to-show', () => win.showInactive())
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.error('[大肥鱼页面]', e.message) })

  // 自测：FY_SELFTEST=<png 路径> 时，载入后戳一下、截一张透明窗口的图就退出（不碰屏幕上别的东西）
  if (process.env.FY_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      await wait(5000)
      if (process.env.FY_SELFTEST_CLICK) {
        // 用真的鼠标事件点大肥鱼中间，看它会不会被甩走
        const pos = () => win.webContents.executeJavaScript("(()=>{const r=document.querySelector('.fy-pet').getBoundingClientRect();return [Math.round(r.x),Math.round(r.y)]})()")
        const [px, py] = await pos(); const cx = px + 100, cy = py + 100
        console.error('[大肥鱼自测] 点之前', [px, py])
        win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy })
        await wait(50)
        win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 })
        await wait(90)
        win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 })
        for (let i = 0; i < 8; i++) { await wait(150); console.error('[大肥鱼自测] 位置', await pos()) }
        await wait(6000)
        // 松手事件丢了：按下之后直接来几个没按键的移动，往左上角去
        const [qx, qy] = await pos()
        console.error('[大肥鱼自测] 丢松手之前', [qx, qy])
        win.webContents.sendInputEvent({ type: 'mouseDown', x: qx + 100, y: qy + 100, button: 'left', clickCount: 1 })
        for (let i = 1; i <= 10; i++) { await wait(20); win.webContents.sendInputEvent({ type: 'mouseMove', x: qx + 100 - 80 * i, y: qy + 100 - 60 * i }) }
        await wait(800)
        console.error('[大肥鱼自测] 丢松手之后', await pos())
      } else await win.webContents.executeJavaScript('window.__fy.poke()')
      for (let i = 0; i < 40; i++) {      // 等到说完、底下的反应按钮出来
        await wait(500)
        if (await win.webContents.executeJavaScript("!!document.querySelector('.fy-react')")) break
      }
      await wait(400)
      const img = await win.webContents.capturePage()
      fs.writeFileSync(process.env.FY_SELFTEST, img.toPNG())
      console.error('[大肥鱼自测] 气泡：', await win.webContents.executeJavaScript("document.querySelector('.fy-text')?.textContent || '(没有)'"))
      app.quit()
    })
  }
  ipcMain.on('fy:hover', (_e, inside) => win.setIgnoreMouseEvents(!inside, { forward: true }))
  ipcMain.on('fy:quit', () => {
    try { fs.writeFileSync(path.join(STATE_DIR, 'desktop-off'), String(Date.now())) } catch (err) { console.error('[大肥鱼] 写退出标记失败', err.message) }
    app.quit()
  })
  screen.on('display-metrics-changed', () => { const a = screen.getPrimaryDisplay().workArea; win.setBounds(a) })
})
app.on('window-all-closed', () => app.quit())
