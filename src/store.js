/**
 * 插件自己的本地状态：一份 JSON，放在 $DSH_HOME/storages/dsh-agent-year/state.json（默认 ~/.dsh）。
 * 存：数据源勾选、AI 结果缓存（含调用次数）、卡片隐藏状态。不存聊天内容本身。
 * 没用 dsh 的 storageDomain：那套要 zod schema 和 defineDomain，单一 JSON 文件就够了，也好让用户一眼看到存了什么。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function dshHome() {
  const env = process.env.DSH_HOME?.trim()
  return env ? path.resolve(env.replace(/^~(?=$|[/\\])/, os.homedir())) : path.join(os.homedir(), '.dsh')
}

export class Store {
  constructor(file = path.join(dshHome(), 'storages', 'dsh-agent-year', 'state.json')) {
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
    fs.renameSync(tmp, this.file)
    return next
  }
}
