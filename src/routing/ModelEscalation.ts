// SCALE Engine — P4-E 多模型升级路由（smart-friend escalation）
//
// Cognition《Multi-Agents: What's Actually Working》(2026-04)：主模型卡住时，
// 把问题升级给更强的模型做一次诊断（返回 1–2k token 建议），比盲目 fan-out 更有效。
// 本模块是纯决策层：根据「连续无进展轮数 / 预算 / 是否已升级」判断是否升级、升级给谁。
//
// 纯函数，可单测；实际模型调用由宿主完成。

export interface EscalationState {
  /** 连续未产生进展的轮数。 */
  consecutiveNoProgress: number
  primaryModel: string
  /** 更强模型（升级目标）。 */
  escalateTo: string
  /** 本次任务是否已升级过（避免反复升级）。 */
  alreadyEscalated?: boolean
  /** 剩余预算 token（可选；不足时放弃升级）。 */
  remainingBudgetTokens?: number
}

export interface EscalationOptions {
  /** 触发升级的无进展轮数阈值，默认 3。 */
  threshold?: number
  /** 升级所需最小剩余预算，默认 2000。 */
  minBudgetTokens?: number
}

export interface EscalationDecision {
  escalate: boolean
  reason: string
  target?: string
}

export function decideEscalation(state: EscalationState, options: EscalationOptions = {}): EscalationDecision {
  const threshold = options.threshold ?? 3
  const minBudget = options.minBudgetTokens ?? 2000

  if (state.alreadyEscalated) {
    return { escalate: false, reason: 'Already escalated once for this task; avoid escalation loops.' }
  }
  if (state.consecutiveNoProgress < threshold) {
    return { escalate: false, reason: `No-progress streak ${state.consecutiveNoProgress} < threshold ${threshold}.` }
  }
  if (state.escalateTo === state.primaryModel) {
    return { escalate: false, reason: 'Escalation target equals the primary model; no stronger model configured.' }
  }
  if (typeof state.remainingBudgetTokens === 'number' && state.remainingBudgetTokens < minBudget) {
    return { escalate: false, reason: `Remaining budget ${state.remainingBudgetTokens} < ${minBudget}; skip escalation.` }
  }
  return {
    escalate: true,
    reason: `No progress for ${state.consecutiveNoProgress} round(s); escalate to a stronger model for a single diagnostic.`,
    target: state.escalateTo,
  }
}
