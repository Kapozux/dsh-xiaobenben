/**
 * 把后台给的统计 / 原话 / AI 结果排成一组卡片。每张卡：id、名字、涉及的敏感类别、draw(pen)。
 * 两套版式：用户消息 ≥200 条用「完整版」；不到 200 条用「轻量版」——少放数字，多放原话。
 * 没跑 AI（或 AI 失败）时，AI 那几张卡直接不出现，剩下的照样排成一张完整的图，不留空位。
 */
import { COLORS } from './draw.js'

const fmtDay = d => { const [y, m, dd] = d.split('-'); return `${y} 年 ${+m} 月 ${+dd} 日` }
const fmtMonth = m => `${+m.split('-')[1]} 月`
const num = n => n.toLocaleString('zh-CN')
const meta = q => `${fmtDay(q.day)}${q.time ? ` ${q.time}` : ''} · ${q.agentName}`

/** 一列里去掉敏感的，除非这张卡被手动「显示敏感内容」。 */
const visible = (items, reveal) => items.filter(q => reveal || !q.sensitive?.length)

/**
 * @param {any} v  /api/agent-year.view 的结果
 * @param {Record<string, boolean>} reveal 哪些卡打开了敏感内容
 */
export function buildCards(v, reveal = {}) {
  const s = v.stats
  const q = v.quotes
  const ai = v.ai?.result
  const light = s.light
  const yearLabel = s.firstDay && s.lastDay && s.firstDay.slice(0, 4) !== s.lastDay.slice(0, 4)
    ? `${s.firstDay.slice(0, 4)}—${s.lastDay.slice(0, 4)}` : (s.lastDay || '').slice(0, 4)
  const cards = []
  const add = (id, name, draw, sensitive = []) => cards.push({ id, name, draw, sensitive })

  add('cover', '封面', p => {
    p.watermark(yearLabel.slice(-4)).kicker('AGENT 年度回顾').gap(120).title(`${yearLabel}\n和 agent 一起的这一年`)
    if (light) {
      p.text(`${s.activeDays} 天里，你开了 ${s.totals.sessions} 个会话，说了 ${num(s.totals.userMsgs)} 句话。`, { size: 44, color: COLORS.soft })
    } else {
      p.stat(s.activeDays, '天在和 agent 说话', { color: COLORS.blue }).gap(10)
      p.pair([[num(s.totals.sessions), '个会话'], [num(s.totals.userMsgs), '句你说的话'], [num(s.totals.rounds), '轮来回']])
    }
  })

  if (!light) {
    add('numbers', '节奏', p => {
      p.kicker('节奏').title('你是怎么用的')
      if (s.longestStreak) p.stat(s.longestStreak.days, `天连续不断  ${s.longestStreak.from.slice(5)} → ${s.longestStreak.to.slice(5)}`, { size: 100 }).gap(10)
      if (s.busiestMonth) p.row(`最忙的月份  ${fmtMonth(s.busiestMonth.month)}`, `${num(s.busiestMonth.count)} 句`)
      if (s.lateNight) p.row(`凌晨说话最多的一天  ${+s.lateNight.day.slice(5, 7)} 月 ${+s.lateNight.day.slice(8)} 日`, `${s.lateNight.count} 句`)
      p.gap(30).text('一天里什么时候找 agent（琥珀色是 0–5 点）', { size: 32, color: COLORS.faint }).gap(10).hours(s.hours)
    })
  }

  if (s.shares.length > 1 || !light) {
    add('agents', '各 agent', p => {
      p.kicker('搭档').title(s.shares.length > 1 ? `${s.shares.length} 个 agent 分了这一年` : `这一年的搭档：${s.shares[0]?.name}`)
      const palette = [COLORS.blue, COLORS.amber, COLORS.ink, COLORS.soft]
      s.shares.forEach((x, i) => {
        const per = s.perAgent.find(a => a.agent === x.agent)
        p.bar(x.name, x.share, per && !light ? `${per.sessions} 个会话 · ${num(per.userMsgs)} 句 · ${per.activeDays} 天` : null, palette[i % palette.length])
      })
    })
  }

  if (s.longest) {
    add('longest', '最长的会话', p => {
      p.kicker('最长的一次').text(s.longest.label.text || '（没有标题）', { size: 72, serif: true, weight: 700, lh: 1.3, maxLines: 3 }).gap(36)
      p.row(`${fmtDay(s.longest.day)} · ${({ dsh: 'DeepSeek Harness', claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' })[s.longest.agent] || s.longest.agent}`, `${s.longest.rounds} 轮`, { size: 36, color: COLORS.soft })
      if (!s.longest.label.fromTitle) p.text('（没有标题，这是它第一句话的前 20 个字）', { size: 30, color: COLORS.faint })
    })
  }

  const rep = visible(q.repeated, reveal.repeated)
  if (rep.length) {
    add('repeated', '口头禅', p => {
      p.kicker('口头禅').title('你说得最多的几句')
      rep.slice(0, light ? 3 : 5).forEach((x, i) => p.row(`「${x.text}」`, `${x.count} 次`, { size: i ? 46 : 64, color: i ? COLORS.ink : COLORS.blue }))
    }, q.repeated.flatMap(x => x.sensitive))
  }

  if (q.first) add('first', '全年第一句', p => {
    p.kicker('全年第一句').quote(q.first.text, meta(q.first))
  }, q.first.sensitive)

  if (q.late) add('late', '凌晨最晚的一句', p => {
    p.kicker(`凌晨 ${q.late.time}`).title('那天最晚的一句').quote(q.late.text, meta(q.late))
  }, q.late.sensitive)

  if (light) {
    const ex = visible(q.extras || [], reveal.extras)
    if (ex.length) add('extras', '平时说的话', p => {
      p.kicker('平时说的话')
      ex.slice(0, 4).forEach(x => p.quote(x.text, meta(x), { size: 44, maxLines: 3 }).gap(36))
    }, (q.extras || []).flatMap(x => x.sensitive))
  }

  if (ai?.keywords?.length) add('keywords', '年度关键词（AI）', p => {
    p.kicker('年度关键词 · AI 写的').chips(ai.keywords)
  })
  if (ai?.awards?.length) add('awards', '年度奖项（AI）', p => {
    p.kicker('年度奖项 · AI 写的')
    ai.awards.forEach(a => {
      p.text(`🏆 ${a.name}`, { size: 56, serif: true, weight: 700, lh: 1.3 }).gap(10)
      if (a.reason) p.text(a.reason, { size: 38, color: COLORS.soft })
      if (a.quote) p.gap(6).text(`「${a.quote}」`, { size: 36, color: COLORS.amber })
      p.gap(48)
    })
  })
  if (ai?.year) add('year', '这一年（AI）', p => {
    p.kicker('这一年 · AI 写的').text(ai.year, { size: 50, serif: true, lh: 1.7 })
  })

  return cards
}
