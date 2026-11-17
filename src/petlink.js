/**
 * 接 dsh-pet：在它右键菜单「更多」里挂一项「翻旧账」，被点了就让那只宠物说一件真事、播一个对应动作。
 * 只用它公开的 HTTP 接口（docs: github.com/PC2005-cloud/dsh-pet API.md / openapi.yaml），不碰它的代码和素材：
 *   POST /menu/item 注册 → GET /menu/events 长轮询（读取即消费）→ POST /lock 占住 → /anim + /broadcast → /lock/release
 * dsh-pet 的接口挂在 dsh 网页服务同一个端口、只听 127.0.0.1、不鉴权。端口按顺序找：启动参数 --port → 本进程实际在听的端口（lsof）→ 默认 3080。
 * 没装 dsh-pet：每 60 秒再看一次（它可能比我们晚加载），什么都不打扰。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ANIM } from './pet.js'

const run = promisify(execFile)
const OWNER = 'dsh-xiaobenben'
const LABEL = '翻旧账'
const PREFIX = '/dsh-pet-7340'

async function candidatePorts() {
  const out = []
  const i = process.argv.indexOf('--port')
  if (i > 0 && Number(process.argv[i + 1]) > 0) out.push(Number(process.argv[i + 1]))
  const eq = process.argv.find(a => a.startsWith('--port='))
  if (eq && Number(eq.slice(7)) > 0) out.push(Number(eq.slice(7)))
  try {
    const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(process.pid)], { timeout: 5000 })
    for (const m of stdout.matchAll(/127\.0\.0\.1:(\d+)|\[::1\]:(\d+)|\*:(\d+)|localhost:(\d+)/g)) out.push(Number(m[1] || m[2] || m[3] || m[4]))
  } catch (err) { if (err?.code !== 'ENOENT') console.warn('[dsh-xiaobenben] 查本进程端口失败', err?.message) }
  out.push(3080)
  return [...new Set(out)]
}

export class PetLink {
  /** @param {{ pet: import('./pet.js').Pet, fetchImpl?: typeof fetch, ports?: () => Promise<number[]>, retryMs?: number, sayMs?: (text: string) => number }} deps */
  constructor({ pet, fetchImpl = fetch, ports = candidatePorts, retryMs = 60e3, sayMs = text => Math.min(20000, Math.max(6000, [...text].length * 170)) }) {
    this.sayMs = sayMs
    this.pet = pet
    this.fetch = fetchImpl
    this.ports = ports
    this.retryMs = retryMs
    this.base = null
    this.connected = false
    this.error = null
    this.stopped = false
    this.queue = []
    this.busy = false
  }

  status() { return { connected: this.connected, error: this.connected ? null : this.error } }

  async #req(method, path, body, timeoutMs = 5000) {
    const res = await this.fetch(this.base + PREFIX + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    let data = null
    try { data = await res.json() } catch { throw new Error(`dsh-pet 没回 JSON（HTTP ${res.status}）`) }
    return data
  }

  /** 找 dsh-pet：哪个端口的 /state 回得出 sections 就是它 */
  async #discover() {
    for (const port of await this.ports()) {
      try {
        const res = await this.fetch(`http://127.0.0.1:${port}${PREFIX}/state`, { signal: AbortSignal.timeout(2000) })
        if (!res.ok) continue
        const d = await res.json()
        if (d && d.sections) { this.base = `http://127.0.0.1:${port}`; return true }
      } catch {}
    }
    return false
  }

  async #register() {
    const d = await this.#req('POST', '/menu/item', { owner: OWNER, labels: [LABEL] })
    if (!d?.ok) throw new Error('注册菜单项被拒：' + (d?.reason || JSON.stringify(d)))
  }

  /** 主循环：找到 → 注册 → 长轮询点击；断了就回头重新找 */
  async start() {
    while (!this.stopped) {
      try {
        if (!this.base && !(await this.#discover())) {
          this.connected = false; this.error = '没找到 dsh-pet（没装，或者还没加载）'
          await this.#sleep(this.retryMs); continue
        }
        await this.#register()
        if (!this.connected) console.info(`[dsh-xiaobenben] 已接上 dsh-pet（${this.base}），右键它 → 更多 → ${LABEL}`)
        this.connected = true; this.error = null
        while (!this.stopped) {
          const d = await this.#req('GET', `/menu/events?owner=${encodeURIComponent(OWNER)}&wait=10000`, null, 15000)
          if (!d?.ok) {
            if (d?.reason === 'unknown-owner') { await this.#register(); continue }   // dsh-pet 重载过，菜单项没了
            throw new Error('查点击失败：' + (d?.reason || JSON.stringify(d)))
          }
          const petId = d.events?.[LABEL]
          if (petId) this.#perform(petId).catch(err => console.warn('[dsh-xiaobenben] 让 dsh-pet 说话失败', err))
        }
      } catch (err) {
        if (this.stopped) break
        if (this.connected) console.warn('[dsh-xiaobenben] 和 dsh-pet 断开了，稍后重连：', err?.message || err)
        this.connected = false; this.error = err?.message || String(err); this.base = null
        await this.#sleep(Math.min(this.retryMs, 15e3))
      }
    }
  }

  async stop() {
    this.stopped = true
    clearTimeout(this.sleepTimer); this.wake?.()
    if (!this.base) return
    try { await this.#req('DELETE', `/menu/item?owner=${encodeURIComponent(OWNER)}`) } catch (err) { console.warn('[dsh-xiaobenben] 撤菜单项失败', err?.message) }
  }

  #sleep(ms) { return new Promise(r => { this.wake = r; this.sleepTimer = setTimeout(r, ms) }) }

  /** 挑下一件：洗过的队列一件件拿，私事（健康 / 感情 / 成绩 / 家庭）不在宠物气泡里说 */
  async #nextMoment() {
    const { moments } = await this.pet.moments()
    if (!this.queue.length) {
      this.queue = moments.filter(m => !m.sensitive.length).map(m => [Math.random(), m]).sort((a, b) => a[0] - b[0]).map(x => x[1])
    }
    return this.queue.pop() || null
  }

  /** 点了「翻旧账」：占住这只 → 播动作 → 说一句 → 说完放开 */
  async #perform(petId) {
    if (this.busy) return                       // 上一句还没说完，连点不排队
    this.busy = true
    const q = `?pet=${encodeURIComponent(petId)}&surface=any`
    let lockId = null
    try {
      const m = await this.#nextMoment()
      const text = m ? m.text : '本肥鱼还没跟主人一起干过活呢。派点活给本肥鱼？'
      const duration = this.sayMs(text)          // 气泡停多久：按字数，6～20 秒
      const lock = await this.#req('POST', '/lock' + q, { ttl: duration + 5000 })
      if (!lock?.ok && !lock?.lockId) throw new Error('占不到这只宠物：' + (lock?.reason || JSON.stringify(lock)))
      lockId = lock.lockId
      const lq = q + `&lock=${encodeURIComponent(lockId)}`
      const name = m && ANIM[m.anim]
      if (name) {
        const a = await this.#req('POST', '/anim' + lq, { name })
        if (!a?.ok && !a?.playbackId) console.warn('[dsh-xiaobenben] dsh-pet 不播这个动作', name, a?.reason)
      }
      const b = await this.#req('POST', '/broadcast' + lq, { text, duration, anim: !name })
      if (!b?.ok) throw new Error('dsh-pet 不让说：' + (b?.reason || JSON.stringify(b)))
      await new Promise(r => setTimeout(r, duration))
    } finally {
      if (lockId) {
        try { await this.#req('POST', `/lock/release?pet=${encodeURIComponent(petId)}&surface=any`, { lockId }) } catch (err) { console.warn('[dsh-xiaobenben] 放开 dsh-pet 失败', err?.message) }
      }
      this.busy = false
    }
  }
}
