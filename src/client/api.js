/** 页面 → host 的几个 fetch 路由（src/index.js 注册的）。相对路径，跟 dsh 自带的导出插件一样。 */
export async function call(name, body = {}) {
  const res = await fetch(`api/xiaobenben.${name}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data
  try { data = await res.json() } catch { throw new Error(`服务没回 JSON（HTTP ${res.status}）`) }
  if (!res.ok || data?.error && data.ok === undefined) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export function downloadCanvas(canvas, filename) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) return reject(new Error('图片生成失败'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); resolve() }, 1000)
  }, 'image/png'))
}
