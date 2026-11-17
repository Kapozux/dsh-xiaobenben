/**
 * dsh-xiaobenben（小本本）：年度回顾 + 翻旧账。Host 这一半。
 * 只做三件事：读会话（ctx.sessionQuery + 用户勾选的外部来源）、开几个只读的 fetch 路由给页面、用户点头后调一次模型。
 * API 出处见 docs/dsh-api.md；这里用到的每个 ctx 服务都在那份文档里核对过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { Review } from './review.js'
import { Store } from './store.js'
import { dshAdapter } from './llm-adapter.js'
import { Pet } from './pet.js'
import { Desktop } from './desktop.js'
import { normFeedback, feedbackJson } from './shared/feedback.js'
import { Styler } from './styler.js'

export const name = 'dsh-xiaobenben'
export const inject = ['sessionQuery', 'connection', 'llm', 'agentDefaultModel']

/** 插件配置。改法：在 profile 的 cordis.patch.yml 里写 `- id: xiaobenben` + `config:`（整块替换，不是合并）。 */
export const Config = Schema.object({
  prices: Schema.array(Schema.object({
    provider: Schema.string().required().description('服务商 id，例 deepseek-official'),
    model: Schema.string().required().description('模型 id，例 deepseek-flash'),
    input: Schema.number().required().description('输入价格，每百万 token'),
    output: Schema.number().required().description('输出价格，每百万 token'),
    currency: Schema.string().default('USD'),
  })).default([]).description('价格表。dsh 的模型配置里没有价格；不填就只显示 token 数，不猜价。'),
  expensiveOutputPrice: Schema.number().default(0).description('输出价格（每百万 token）高于这个数就提示「可以换便宜的模型」；0 = 不提示'),
  electronPath: Schema.string().default('').description('大肥鱼桌面版用的 Electron.app 路径；空 = 自动找本机 Electron 下载缓存'),
  sensitiveExtra: Schema.dict(Schema.array(Schema.string())).default({}).description('额外的敏感词，按类：{ 健康: [...], 感情: [...], 成绩: [...], 家庭: [...] }'),
})

const PREFIX = '/api/xiaobenben.'
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url))
const ASSET_TYPES = { '.png': 'image/png', '.woff2': 'font/woff2' }
/** k 形如 xiaobenben/normal.png、fonts/xbb-rounded.woff2；只认这两个目录、这两种文件，不许 .. */
export function assetFile(k) {
  if (!/^(xiaobenben|fonts)\/[\w-]+\.(png|woff2)$/.test(k)) return null
  const f = path.join(ASSETS, k)
  try { return fs.statSync(f).isFile() ? f : null } catch { return null }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

/**
 * @param {any} ctx
 * @param {any} config
 */
export function apply(ctx, config = {}) {
  const store = new Store()
  const review = new Review({ sessionQuery: ctx.sessionQuery, store, config })
  const pet = new Pet({ sessionQuery: ctx.sessionQuery, store })
  const desktop = new Desktop({ store, pet, electron: config.electronPath || '' })
  desktop.resume()
  pet.moments().catch(err => console.warn('[dsh-xiaobenben] 预先翻记录失败', err))   // 启动就先翻好，第一次点不用等
  const adapter = dshAdapter(ctx.llm)
  const styler = new Styler({ pet, store, adapter, prices: config.prices || [] })
  let running = null                          // 同一时间只跑一个生成，不排队、不并发

  const currentRoute = () => {
    const s = ctx.agentDefaultModel.currentSelection()
    return { provider: s.provider, model: s.model }
  }

  const routes = {
    async sources() {
      return review.sources()
    },
    async 'source.set'(body) {
      review.setSource(body.id, body.enabled)
      return review.sources()
    },
    async view(body) {
      return review.view(body.range)
    },
    async models() {
      const providers = ctx.llm.listProviders()
      const out = []
      for (const p of providers) {
        try {
          const models = await ctx.llm.listModels(p.id)
          out.push({ id: p.id, name: p.name, models: models.map(m => ({ id: m.id, name: m.name || m.id })) })
        } catch (err) {
          out.push({ id: p.id, name: p.name, models: [], error: err?.message || String(err) })
        }
      }
      return { current: currentRoute(), providers: out }
    },
    async quote(body) {
      return review.quote({ range: body.range, kind: body.kind || 'all', route: body.route || currentRoute() })
    },
    async generate(body, request) {
      if (body.confirm !== true) return { ok: false, error: '没有确认，不发送' }
      if (running) return { ok: false, error: '上一次还在跑，等它结束' }
      running = review.generate({ range: body.range, kind: body.kind || 'all', route: body.route || currentRoute(), hash: body.hash, adapter, signal: request.signal })
      try { return await running } finally { running = null }
    },
    async moments(body) {
      return pet.moments({ fresh: !!body.fresh })
    },
    async now() {
      return pet.now()
    },
    async 'style.quote'(body) {
      return styler.quote({ route: body.route || currentRoute(), redo: !!body.redo })
    },
    async 'style.run'(body) {
      if (body.confirm !== true) return { ok: false, error: '没有确认，不发送' }
      return styler.start({ route: body.route || currentRoute(), hash: body.hash, redo: !!body.redo })
    },
    async 'style.status'() {
      return styler.status()
    },
    async 'style.stop'() {
      return styler.stop()
    },
    async 'style.clear'() {
      return styler.clear()
    },
    // 主人的反馈（👍👎、点过的按钮）：和桌面那只共用 feedback.json
    async feedback(body) {
      const file = path.join(path.dirname(store.file), 'feedback.json')
      if (body.fb) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, feedbackJson(body.fb)); return { ok: true } }
      try { return { fb: normFeedback(JSON.parse(fs.readFileSync(file, 'utf8'))) } } catch (err) { if (err.code !== 'ENOENT') console.warn('[dsh-xiaobenben] 读反馈失败', err.message); return { fb: null } }
    },
    async desktop(body) {
      if (body.on === true) return { desktop: await desktop.start() }
      if (body.on === false) return { desktop: desktop.stop() }
      return { desktop: desktop.status() }
    },
    async hide(body) {
      review.setHidden(body.hash, body.card, body.hidden)
      return { ok: true }
    },
  }

  // 挂件的素材（立绘 PNG、字体）：只给 assets/ 底下白名单里的文件
  Reflect.get(ctx, 'connection').fetch.register({
    path: PREFIX + 'asset',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const k = new URL(request.url, 'http://x').searchParams.get('k') || ''
      const file = assetFile(k)
      if (!file) return new Response('没有这个文件', { status: 404 })
      return new Response(fs.readFileSync(file), { headers: { 'content-type': ASSET_TYPES[path.extname(file)], 'cache-control': 'private, max-age=86400' } })
    },
  })

  for (const [key, handler] of Object.entries(routes)) {
    Reflect.get(ctx, 'connection').fetch.register({
      path: PREFIX + key,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body = {}
        try { body = JSON.parse(await request.text() || '{}') } catch { return json({ error: '请求不是 JSON' }, 400) }
        try {
          return json(await handler(body, request))
        } catch (err) {
          console.warn('[dsh-xiaobenben]', err)
          return json({ error: err?.message || String(err) }, 500)
        }
      },
    })
  }
}
