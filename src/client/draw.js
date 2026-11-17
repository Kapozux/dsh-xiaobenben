/**
 * 分享图：全部在浏览器里用 canvas 画，PNG 不出本机。
 * 宽 1080。两种输出：竖版长图（每张卡按内容高度接起来）和 3:4 分页（1080×1440，每张卡一页，内容竖直居中）。
 * 配色固定浅色（发出去的图不跟着系统深色走）：纸色底 + 墨色字 + 一个蓝、一个琥珀。
 */

export const W = 1080
export const PAGE_H = 1440
const PAD = 96
export const FOOTER = '统计和原话都在本机算；AI 只读了你同意发送的那部分。'

const C = {
  paper: '#F3EEE4', paper2: '#EAE3D6', ink: '#1E1A16', soft: '#5B544B', faint: '#9A9186',
  rule: '#D6CDBE', blue: '#3D5AFE', amber: '#C9821C', card: '#FBF8F2',
}
const SERIF = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", Georgia, serif'
const SANS = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
const MONO = '"SF Mono", Menlo, Consolas, monospace'

const font = (size, { serif = false, weight = 400, mono = false } = {}) => `${weight} ${size}px ${mono ? MONO : serif ? SERIF : SANS}`

/** 按字宽折行（中文逐字、英文尽量按词）。 */
export function wrap(g, text, maxW) {
  const out = []
  for (const para of String(text).split('\n')) {
    let line = ''
    const tokens = para.match(/[A-Za-z0-9_\-./:@〔〕]+|\s+|./gu) || ['']
    for (const tk of tokens) {
      const next = line + tk
      // 避头：句末标点、右括号不放到行首，宁可让这一行稍微超出一点
      if (g.measureText(next).width <= maxW || !line || /^[，。、；：！？）」』”’》〉…,.;:!?)\]]$/u.test(tk)) { line = next; continue }
      if (g.measureText(tk).width > maxW) {                 // 超长单词逐字断
        for (const ch of tk) {
          if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch } else line += ch
        }
        continue
      }
      out.push(line.trimEnd())
      line = tk.trimStart()
    }
    out.push(line)
  }
  return out
}

/**
 * 一个「画笔」：draw 函数用它从上往下排版；measure 模式下不真画，只算高度。
 */
class Pen {
  constructor(g, y, measure) { this.g = g; this.y = y; this.measure = measure; this.x = PAD; this.w = W - PAD * 2 }
  gap(h) { this.y += h; return this }
  text(str, { size = 42, serif = false, weight = 400, color = C.ink, lh = 1.5, maxLines = 0, align = 'left', mono = false } = {}) {
    const g = this.g
    g.font = font(size, { serif, weight, mono })
    let lines = wrap(g, str, this.w)
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '（后略）' }
    for (const line of lines) {
      if (!this.measure) {
        g.fillStyle = color
        g.textBaseline = 'alphabetic'
        g.textAlign = align
        g.fillText(line, align === 'center' ? W / 2 : this.x, this.y + size)
        g.textAlign = 'left'
      }
      this.y += size * lh
    }
    return this
  }
  kicker(str) { return this.text(str, { size: 32, weight: 700, color: C.blue, lh: 1.4 }).gap(22) }
  title(str) { return this.text(str, { size: 80, serif: true, weight: 700, lh: 1.22 }).gap(44) }
  rule() { if (!this.measure) { this.g.fillStyle = C.rule; this.g.fillRect(this.x, this.y, this.w, 2) } return this.gap(30) }
  /** 大数字 + 说明 */
  stat(value, label, { color = C.ink, size = 180 } = {}) {
    const g = this.g
    g.font = font(size, { serif: true, weight: 700 })
    if (!this.measure) { g.fillStyle = color; g.fillText(String(value), this.x, this.y + size * 0.85) }
    const vw = g.measureText(String(value)).width
    g.font = font(38)
    if (!this.measure) { g.fillStyle = C.soft; g.fillText(label, this.x + vw + 26, this.y + size * 0.85) }
    this.y += size * 1.05
    return this
  }
  /** 两列小数字 */
  pair(items) {
    const colW = this.w / items.length
    const y = this.y
    items.forEach(([value, label], i) => {
      const x = this.x + i * colW
      if (!this.measure) {
        this.g.font = font(84, { serif: true, weight: 700 }); this.g.fillStyle = C.ink; this.g.fillText(String(value), x, y + 74)
        this.g.font = font(32); this.g.fillStyle = C.soft; this.g.fillText(label, x, y + 128)
      }
    })
    this.y += 176
    return this
  }
  /** 横条：label | 条 | 百分比 */
  bar(label, share, sub, color = C.blue) {
    const g = this.g
    const y = this.y
    if (!this.measure) {
      g.font = font(40, { weight: 600 }); g.fillStyle = C.ink; g.fillText(label, this.x, y + 40)
      g.font = font(38, { mono: true }); g.fillStyle = C.soft; g.textAlign = 'right'; g.fillText(`${Math.round(share * 100)}%`, this.x + this.w, y + 40); g.textAlign = 'left'
      g.fillStyle = C.paper2; roundRect(g, this.x, y + 62, this.w, 30, 15); g.fill()
      g.fillStyle = color; roundRect(g, this.x, y + 62, Math.max(30, this.w * share), 30, 15); g.fill()
      if (sub) { g.font = font(30); g.fillStyle = C.faint; g.fillText(sub, this.x, y + 136) }
    }
    this.y += sub ? 176 : 124
    return this
  }
  /** 引用块：左边一道竖线，原话 + 出处 */
  quote(text, meta, { size = 58, maxLines = 9 } = {}) {
    const top = this.y
    this.x += 36; this.w -= 36
    this.text(text, { size, serif: true, lh: 1.55, maxLines })
    this.gap(16).text(meta, { size: 30, color: C.faint })
    this.x -= 36; this.w += 36
    if (!this.measure) { this.g.fillStyle = C.amber; this.g.fillRect(this.x, top + 8, 8, this.y - top - 48) }
    return this
  }
  /** 小时分布柱 */
  hours(hours, highlight = h => h < 5) {
    const g = this.g
    const max = Math.max(1, ...hours)
    const bw = this.w / 24
    const H = 260
    if (!this.measure) {
      hours.forEach((v, h) => {
        const bh = Math.max(3, (v / max) * H)
        g.fillStyle = highlight(h) ? C.amber : C.blue
        g.globalAlpha = v ? 1 : 0.25
        roundRect(g, this.x + h * bw + 3, this.y + H - bh, bw - 6, bh, 4); g.fill()
      })
      g.globalAlpha = 1
      g.font = font(28, { mono: true }); g.fillStyle = C.faint
      for (const h of [0, 6, 12, 18, 23]) g.fillText(String(h), this.x + h * bw + 4, this.y + H + 36)
    }
    this.y += H + 60
    return this
  }
  /** 一行「左文字 …… 右数字」 */
  row(left, right, { size = 42, color = C.ink } = {}) {
    const g = this.g
    g.font = font(size)
    let l = left
    const rw = (g.font = font(size - 4, { mono: true }), g.measureText(right).width)
    g.font = font(size)
    while (g.measureText(l).width > this.w - rw - 40 && l.length > 1) l = l.slice(0, -2) + '…'
    if (!this.measure) {
      g.fillStyle = color; g.fillText(l, this.x, this.y + size)
      g.font = font(size - 4, { mono: true }); g.fillStyle = C.soft; g.textAlign = 'right'; g.fillText(right, this.x + this.w, this.y + size); g.textAlign = 'left'
    }
    this.y += size * 1.9
    return this
  }
  /** 封面底纹：一个很大的浅色年份，压在文字下面（只是装饰） */
  watermark(str) {
    if (!this.measure) {
      const g = this.g
      g.font = font(330, { serif: true, weight: 700 })
      g.fillStyle = C.paper2
      g.fillText(str, this.x - 14, this.y + 280)
    }
    return this
  }
  /** 一排药丸标签 */
  chips(words, { size = 60 } = {}) {
    const g = this.g
    g.font = font(size, { serif: true, weight: 700 })
    let x = this.x
    let y = this.y
    const h = size * 1.9
    for (const w of words) {
      const tw = g.measureText(w).width + size * 1.4
      if (x + tw > this.x + this.w && x > this.x) { x = this.x; y += h + 18 }
      if (!this.measure) {
        g.fillStyle = C.ink; roundRect(g, x, y, tw, h, h / 2); g.fill()
        g.fillStyle = C.paper; g.fillText(w, x + size * 0.7, y + h / 2 + size * 0.36)
      }
      x += tw + 18
    }
    this.y = y + h + 20
    return this
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function background(g, y, h) {
  g.fillStyle = C.paper
  g.fillRect(0, y, W, h)
  // 细网点纹理：确定性，不随机
  g.fillStyle = 'rgba(30,26,22,0.035)'
  for (let yy = y + 12; yy < y + h; yy += 24) for (let xx = (Math.floor(yy / 24) % 2) * 12 + 12; xx < W; xx += 24) g.fillRect(xx, yy, 2, 2)
}

function footer(g, y) {
  g.font = font(26); g.fillStyle = C.faint; g.textAlign = 'center'
  g.fillText(FOOTER, W / 2, y)
  g.textAlign = 'left'
}

/** 一张卡的内容高度。 */
function measure(card) {
  const c = document.createElement('canvas')
  c.width = W; c.height = 10
  const pen = new Pen(c.getContext('2d'), 0, true)
  card.draw(pen)
  return Math.ceil(pen.y)
}

/** 3:4 单页 */
export function renderPage(card, { scale = 1 } = {}) {
  const c = document.createElement('canvas')
  c.width = W * scale; c.height = PAGE_H * scale
  const g = c.getContext('2d')
  g.scale(scale, scale)
  background(g, 0, PAGE_H)
  const h = measure(card)
  const top = Math.max(PAD, (PAGE_H - 80 - h) / 2)
  // 太高放不下的，按比例缩小
  const fit = Math.min(1, (PAGE_H - 80 - PAD * 2) / h)
  g.save()
  g.translate(W * (1 - fit) / 2, fit < 1 ? PAD : 0)
  g.scale(fit, fit)
  card.draw(new Pen(g, fit < 1 ? 0 : top, false))
  g.restore()
  footer(g, PAGE_H - 48)
  return c
}

/** 竖版长图：卡片按内容高度接起来，卡之间一道细线。 */
export function renderLong(cards) {
  const gapH = 120
  const heights = cards.map(measure)
  const total = PAD + heights.reduce((a, b) => a + b, 0) + gapH * (cards.length - 1) + PAD + 80
  const c = document.createElement('canvas')
  c.width = W; c.height = total
  const g = c.getContext('2d')
  background(g, 0, total)
  let y = PAD
  cards.forEach((card, i) => {
    card.draw(new Pen(g, y, false))
    y += heights[i]
    if (i < cards.length - 1) {
      g.fillStyle = C.rule; g.fillRect(PAD, y + gapH / 2, W - PAD * 2, 2)
      y += gapH
    }
  })
  footer(g, total - 56)
  return c
}

export const COLORS = C
