// 接 dsh-pet：用一个假的 dsh-pet（只实现我们用到的接口）走一遍「注册 → 被点 → 占住 → 动作 + 说话 → 放开」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { PetLink } from '../src/petlink.js'

function fakeDshPet({ clicks = 1, dropOwnerOnce = false } = {}) {
  const calls = []
  let registered = 0, served = 0, dropped = false
  const ok = d => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } })
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    if (u.port !== '4321') throw new Error('ECONNREFUSED')
    const path = u.pathname.replace('/dsh-pet-7340', '')
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method: init.method || 'GET', path, q: Object.fromEntries(u.searchParams), body })
    if (path === '/state') return ok({ counter: 1, sections: {}, pets: {} })
    if (path === '/menu/item' && init.method === 'POST') { registered++; return ok({ ok: true }) }
    if (path === '/menu/item' && init.method === 'DELETE') return ok({ ok: true, removed: 1 })
    if (path === '/menu/events') {
      if (dropOwnerOnce && !dropped) { dropped = true; return ok({ ok: false, reason: 'unknown-owner' }) }
      if (served < clicks) { served++; return ok({ ok: true, events: { 翻旧账: 'main' } }) }
      await new Promise(r => setTimeout(r, 20))
      return ok({ ok: true, events: { 翻旧账: null } })
    }
    if (path === '/lock') return ok({ ok: true, lockId: 'lk-1', petId: 'main', expiresAt: Date.now() + 9e4 })
    if (path === '/anim') return ok({ ok: true, playbackId: 'pb-1' })
    if (path === '/broadcast') return ok({ ok: true })
    if (path === '/lock/release') return ok({ ok: true })
    return ok({ ok: false, reason: 'not-found' })
  }
  return { fetchImpl, calls, registered: () => registered }
}

const moments = list => ({ moments: async () => ({ moments: list }) })
const wait = ms => new Promise(r => setTimeout(r, ms))

test('找到 dsh-pet 的端口、注册「翻旧账」；被点后：占住 → 播对应动作 → 说那句 → 放开', async () => {
  const f = fakeDshPet()
  const link = new PetLink({
    pet: moments([{ kind: 'sorry', text: '本肥鱼认错：「你说得对」。', anim: 'bow', sensitive: [] }]),
    fetchImpl: f.fetchImpl, ports: async () => [9999, 4321], retryMs: 50, sayMs: () => 20,
  })
  try {
    link.start()
    await wait(300)
    assert.equal(link.status().connected, true)
    const seq = f.calls.filter(c => !['/state', '/menu/events'].includes(c.path)).map(c => c.method + ' ' + c.path)
    assert.deepEqual(seq.slice(0, 5), ['POST /menu/item', 'POST /lock', 'POST /anim', 'POST /broadcast', 'POST /lock/release'])
    const reg = f.calls.find(c => c.path === '/menu/item')
    assert.deepEqual(reg.body, { owner: 'dsh-xiaobenben', labels: ['翻旧账'] })
    const anim = f.calls.find(c => c.path === '/anim')
    assert.deepEqual(anim.q, { pet: 'main', surface: 'any', lock: 'lk-1' })
    assert.equal(anim.body.name, '女仆屈膝礼仪')
    const say = f.calls.find(c => c.path === '/broadcast')
    assert.equal(say.body.text, '本肥鱼认错：「你说得对」。')
    assert.equal(say.body.anim, false)          // 自己点了动作，就不要它再叠说话动画
    assert.deepEqual(f.calls.find(c => c.path === '/lock/release').body, { lockId: 'lk-1' })
  } finally {
    await link.stop()
  }
  assert.ok(f.calls.some(c => c.method === 'DELETE' && c.path === '/menu/item'), '停的时候撤掉菜单项')
})

test('私事不在宠物气泡里说；dsh-pet 重载丢了菜单项会重新注册；找不到 dsh-pet 时报原因', async () => {
  const f = fakeDshPet({ dropOwnerOnce: true })
  const link = new PetLink({
    pet: moments([
      { kind: 'work', text: '帮主人整理考试成绩', anim: 'work', sensitive: ['成绩'] },
      { kind: 'work', text: '帮主人重构导入脚本', anim: 'work', sensitive: [] },
    ]),
    fetchImpl: f.fetchImpl, ports: async () => [4321], retryMs: 50, sayMs: () => 20,
  })
  try {
    link.start()
    await wait(300)
    assert.equal(f.registered(), 2)
    assert.equal(f.calls.find(c => c.path === '/broadcast').body.text, '帮主人重构导入脚本')
  } finally { await link.stop() }

  const none = new PetLink({ pet: moments([]), fetchImpl: async () => { throw new Error('ECONNREFUSED') }, ports: async () => [1], retryMs: 50 })
  none.start()
  await wait(100)
  assert.deepEqual(none.status(), { connected: false, error: '没找到 dsh-pet（没装，或者还没加载）' })
  await none.stop()
})
