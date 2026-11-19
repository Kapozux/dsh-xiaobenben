// 打分页：一条一条看，每条四个按钮（哈哈 / 有感觉 / 干巴 / 看不懂）。只听本机 127.0.0.1，不联网。
// 跑：node proto/lines-review/serve.mjs [轮号]   没抽过样就先抽。每点一下就存盘（out/round-N.ratings.json），中途关掉再开接着标。
// 全部标完：打印统计、写报告、自己退出。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { OUT } from './real.mjs'
import { sample } from './sample.mjs'
import { load, report, RATINGS } from './stats.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const round = Number(process.argv[2] || 1)
const PORT = Number(process.env.PORT || 47600)
if (!fs.existsSync(`${OUT}/round-${round}.sample.json`)) await sample(round)
const { sample: s, ratings } = load(round)
const file = `${OUT}/round-${round}.ratings.json`
const save = () => fs.writeFileSync(file, JSON.stringify(ratings, null, 1))
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(HERE, 'page.html')))
  if (req.method === 'GET' && url.pathname === '/head.png') return send(res, 200, 'image/png', fs.readFileSync(path.join(HERE, '../../assets/xiaobenben/head.png')))
  // 只给台词本身：打分的人不看类型、模板、日期，和平时在气泡里看到的一样
  if (req.method === 'GET' && url.pathname === '/data') return send(res, 200, 'application/json', JSON.stringify({ round, items: s.items.map(i => ({ id: i.id, text: i.text })), ratings }))
  if (req.method === 'POST' && url.pathname === '/rate') {
    let body = ''
    req.on('data', d => { body += d; if (body.length > 1e4) req.destroy() })
    req.on('end', () => {
      try {
        const { id, rating } = JSON.parse(body)
        if (!s.items.some(i => i.id === id) || !RATINGS.includes(rating)) return send(res, 400, 'text/plain', 'bad')
        ratings[id] = rating; save()
        const done = Object.keys(ratings).length
        send(res, 200, 'application/json', JSON.stringify({ done, total: s.items.length }))
      } catch { send(res, 400, 'text/plain', 'bad') }
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/finish') {
    send(res, 200, 'application/json', '{}')
    if (Object.keys(ratings).length < s.items.length) return
    const r = report(round)
    console.log(r.text.split('### 标成')[0]); console.log('完整报告 →', r.file)
    server.close(); setTimeout(() => process.exit(0), 300)
    return
  }
  send(res, 404, 'text/plain', 'not found')
})
server.listen(PORT, '127.0.0.1', () => console.log(`第 ${round} 轮打分页：http://127.0.0.1:${PORT}/   （${s.items.length} 条，已标 ${Object.keys(ratings).length}）`))
