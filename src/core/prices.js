/**
 * 默认价格表和高峰时段。只用来把 token 换算成钱（报价、自动补货的每月上限），不影响发什么。
 *
 * 价格是 DeepSeek 官方价，2026-11-19 查询：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 * 单位：元 / 百万 token，[空闲时段, 高峰时段]。官方改价以后这里会过时，插件配置里的 prices 可以覆盖。
 */
export const PRICE_SOURCE = { url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', checked: '2026-11-19' }
export const DEFAULT_PRICES = {
  'deepseek-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-pro': { hit: [0.15, 0.30], miss: [4.5, 9], out: [13.5, 27] },
}
/** 表里没有、配置里也没有的模型：按 deepseek-flash 高峰价估（偏贵的那一头，月上限宁可早停） */
const UNKNOWN = { hit: 0.04, miss: 2, out: 8 }

/**
 * 高峰时段：北京时间工作日 9:00–12:00、14:00–18:00；其余都是空闲（午休、晚上、周末）。
 * 法定节假日和调休每年由国务院公布，这里没有内置：holidays 里列出的日子（'2026-10-01'）算空闲，workdays 里列出的周末算工作日。
 * @param {number} ts @param {{ holidays?: string[], workdays?: string[] }} [cal]
 */
export function isPeak(ts, { holidays = [], workdays = [] } = {}) {
  const bj = new Date(ts + 8 * 3600e3)             // 用 UTC 的读法读北京时间
  const date = bj.toISOString().slice(0, 10), day = bj.getUTCDay(), h = bj.getUTCHours()
  if (holidays.includes(date)) return false
  if ((day === 0 || day === 6) && !workdays.includes(date)) return false
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

/**
 * 这个模型此刻的价格（元 / 百万 token）：{ hit 缓存命中的输入, miss 没命中的输入, out 输出, currency, source }
 * source：'config' 用的是插件配置里的 prices（不分时段、不分命中）；'official' 默认表；'assumed' 表里没有这个模型，估的。
 */
export function priceAt(route, userPrices = [], ts = Date.now(), cal) {
  const u = userPrices.find(p => p.provider === route.provider && p.model === route.model)
  if (u) return { hit: u.input, miss: u.input, out: u.output, currency: u.currency || 'USD', source: 'config', peak: isPeak(ts, cal) }
  const d = DEFAULT_PRICES[route.model], k = isPeak(ts, cal) ? 1 : 0
  if (d) return { hit: d.hit[k], miss: d.miss[k], out: d.out[k], currency: 'CNY', source: 'official', peak: !!k, ...PRICE_SOURCE }
  return { ...UNKNOWN, currency: 'CNY', source: 'assumed', peak: !!k }
}
/** 一次调用花了多少钱。usage：{ in 没命中缓存的输入, cache 命中缓存的输入, out 输出 } */
export const costOf = (u, p) => ((u.in || 0) * p.miss + (u.cache || 0) * p.hit + (u.out || 0) * p.out) / 1e6

/** 给只认 { provider, model, input, output } 的老报价函数用：配置里的照旧，默认表里的模型按此刻的时段补上 */
export function listPrices(route, userPrices = [], ts = Date.now(), cal) {
  const p = priceAt(route, userPrices, ts, cal)
  return p.source === 'config' ? userPrices : [...userPrices, { provider: route.provider, model: route.model, input: p.miss, output: p.out, currency: p.currency }]
}
