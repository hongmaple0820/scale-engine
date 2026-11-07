// SCALE Engine — P4-B 上下文工程（compaction）
//
// Anthropic《Effective context engineering》(2025-09) 的核心技术之一：**compaction**
// —— 当上下文接近预算时，保留近期高信号尾部、把前缀压成一条摘要占位，而不是无限增长
// 或被粗暴截断。配合 progress 文件（磁盘持久状态）实现长任务的可续跑。
//
// 纯函数：给定消息序列 + token 预算，产出保留/压缩方案（不真正调 LLM；摘要占位由调用方填充）。

export interface CompactMessage {
  role: string
  content: string
  /** 预估 token；缺省按字符数/4 估算。 */
  tokens?: number
}

export interface CompactionInput {
  messages: CompactMessage[]
  budgetTokens: number
  /** 至少保留的尾部消息数，默认 6。 */
  keepTail?: number
}

export interface CompactionResult {
  kept: CompactMessage[]
  /** 被压缩进摘要占位的前缀消息数。 */
  summarizedPrefixCount: number
  /** 压缩后估算 token。 */
  estimatedTokens: number
  compacted: boolean
  /** 摘要占位（调用方用真实摘要替换 content）。 */
  summaryPlaceholder?: CompactMessage
}

function estimateTokens(message: CompactMessage): number {
  if (typeof message.tokens === 'number' && message.tokens >= 0) return message.tokens
  return Math.ceil(message.content.length / 4)
}

export function totalTokens(messages: CompactMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0)
}

export function compactMessages(input: CompactionInput): CompactionResult {
  const keepTail = Math.max(0, input.keepTail ?? 6)
  const total = totalTokens(input.messages)

  if (total <= input.budgetTokens) {
    return { kept: [...input.messages], summarizedPrefixCount: 0, estimatedTokens: total, compacted: false }
  }

  const tail = input.messages.slice(Math.max(0, input.messages.length - keepTail))
  const prefix = input.messages.slice(0, Math.max(0, input.messages.length - keepTail))
  const summaryPlaceholder: CompactMessage = {
    role: 'system',
    content: `[compacted ${prefix.length} earlier message(s) — summary to be filled by the agent]`,
    tokens: 200,
  }
  const estimatedTokens = totalTokens([summaryPlaceholder, ...tail])
  return {
    kept: tail,
    summarizedPrefixCount: prefix.length,
    estimatedTokens,
    compacted: true,
    summaryPlaceholder,
  }
}
