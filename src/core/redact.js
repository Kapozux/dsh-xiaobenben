/**
 * 打码：原话显示前、发给模型前都过一遍。只替换命中的那一段，别的字一个不动。
 * 宁可多打：漏一个 key 的代价远大于多遮一个长单词。
 */

const RULES = [
  // 先遮密钥：它们可能长在 URL、路径里面
  ['密钥', /\b(?:sk|pk|rk)-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g],
  ['密钥', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['密钥', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['密钥', /\bAKIA[0-9A-Z]{16}\b/g],
  ['密钥', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['密钥', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['密钥', /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/g],                 // JWT
  ['密钥', /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi],
  ['密钥', /(?<=\b(?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd|密码|口令)\s*[:=：]\s*["']?)[^\s"'，。]{4,}/gi],
  ['密钥', /\b[a-f0-9]{32,}\b/gi],                                       // 长十六进制
  ['密钥', /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g], // 长串字母数字混排
  ['邮箱', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  // 内网地址（含端口和后面的路径）
  ['内网地址', /\b(?:https?:\/\/)?(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s，。）)]*)?/gi],
  ['内网地址', /\b(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|internal|lan|corp|intranet)\b(?::\d{2,5})?(?:\/[^\s，。）)]*)?/gi],
  // 路径：家目录、系统目录、Windows 盘符
  // Windows：盘符（C:\… 和 C:/… 都有人写，JSON 里抄出来的是 C:\\…）、网络共享 \\server\share。先遮带引号的整条；排在下面那组前面，不然 C:/Users/… 会被当成 /Users/… 只遮后半截
  ['路径', /(?<=["'`])(?:[A-Za-z]:[\\/]|\\\\[\w.$-]+\\)[^"'`\n]+(?=["'`])/g],
  ['路径', /\b[A-Za-z]:[\\/]+(?:[^\s\\/'"`，。；：！？、）)\]]+[\\/]*)+/g],
  ['路径', /\\\\[\w.$-]+\\(?:[^\s\\'"`，。；：！？、）)\]]+\\?)+/g],
  // 先遮带引号的整条（文件名里有空格时，不带引号的规则只遮到空格前，后半截会露出来）
  ['路径', /(?<=["'`])(?:~|\/(?:Users|home|root|var|etc|opt|private|tmp|mnt|Volumes|srv|data|workspace))\/[^"'`\n]+(?=["'`])/g],
  // 不带引号的：到空白为止；「\ 」转义的空格算路径的一部分
  ['路径', /(?:~|\/(?:Users|home|root|var|etc|opt|private|tmp|mnt|Volumes|srv|data|workspace))(?:\/(?:\\ |[^\s'"`，。；：！？、）)\]])+)+\/?/g],
]

/**
 * @param {string} text
 * @returns {{ text: string, hits: number }}
 */
export function redact(text) {
  let hits = 0
  let out = text
  for (const [label, re] of RULES) {
    out = out.replace(re, () => { hits++; return `〔${label}〕` })
  }
  return { text: out, hits }
}

/** 只要结果文字。 */
export const mask = text => redact(text).text
