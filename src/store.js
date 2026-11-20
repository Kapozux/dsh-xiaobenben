/**
 * 插件自己的本地状态：一份 JSON，放在 $DSH_HOME/storages/dsh-xiaobenben/state.json（默认 ~/.dsh）。
 * 存：数据源勾选、AI 结果缓存（含调用次数）、卡片隐藏状态、翻旧账的 AI 改写台词（styled，里面会有引用的原话）。
 * 没用 dsh 的 storageDomain：那套要 zod schema 和 defineDomain，单一 JSON 文件就够了，也好让用户一眼看到存了什么。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function dshHome() {
  const env = process.env.DSH_HOME?.trim()
  return env ? path.resolve(env.replace(/^~(?=$|[/\\])/, os.homedir())) : path.join(os.homedir(), '.dsh')
}

/**
 * 改名盖掉旧文件。Windows 上目标文件正被别的程序读着（杀毒、索引、另一个 dsh 进程）时会报 EPERM / EBUSY / EACCES，
 * 过几十毫秒就好：最多等 5 次（共约 0.3 秒），还不行才抛。别的系统一次就成。
 */
export function renameOver(from, to) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to) } catch (err) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) { try { fs.unlinkSync(from) } catch {} throw err }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1))
    }
  }
}

export class Store {
  constructor(file = path.join(dshHome(), 'storages', 'dsh-xiaobenben', 'state.json')) {
    this.file = file
  }

  read() {
    try {
      return { sources: {}, ai: {}, hidden: {}, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }
    } catch {
      return { sources: {}, ai: {}, hidden: {} }
    }
  }

  /** 读-改-写；先写临时文件再改名，写一半崩了也不会坏掉。 */
  update(fn) {
    const next = fn(this.read()) ?? this.read()
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameOver(tmp, this.file)
    return next
  }
}
