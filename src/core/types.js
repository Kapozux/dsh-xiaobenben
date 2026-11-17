/**
 * 统一的会话格式：各数据源都转成这个样子，后面的统计、原话、抽样只认它。
 *
 * @typedef {'dsh' | 'claude' | 'codex' | 'cursor'} AgentId
 * @typedef {{ t: number, role: 'user' | 'assistant', text: string }} Msg
 *   t 是 epoch 毫秒。assistant 的 text 一律是空串：agent 的回复只用来数轮次，不进任何候选，也不发给模型。
 * @typedef {{ agent: AgentId, id: string, title: string | null, msgs: Msg[] }} Conv
 * @typedef {{ convs: Conv[], skipped: number, error?: string }} SourceResult
 */

/** 各 agent 的显示名。 */
export const AGENT_NAMES = {
  dsh: 'DeepSeek Harness',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
}

/** 不是 dsh 的来源：这些内容发给模型时要单独提示「第一次发给某服务商」。 */
export const EXTERNAL_AGENTS = ['claude', 'codex', 'cursor']
