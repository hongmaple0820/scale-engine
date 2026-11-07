// SCALE Engine — P4-A lean/governed 双形态
//
// OpenSpec 74K★ 证明「lean 半边市场」存在；治理工具最大的死法是比 spec-kit 更官僚
// （Böckeler 批评）。本模块把验证深度做成「任务等级 × 是否 lean」的确定性策略：
// 小改动（S/M）在 lean 模式只需最小验证，大改动（L/CRITICAL）即便 lean 也不降级。
//
// 纯函数，可单测。

export type TaskLevel = 'S' | 'M' | 'L' | 'CRITICAL'

export type VerificationDepth = 'minimal' | 'standard' | 'full'

export interface LeanPolicyInput {
  level: TaskLevel
  /** 是否显式请求 lean 模式（小改动快路径）。 */
  lean?: boolean
}

export interface LeanPolicy {
  level: TaskLevel
  verificationDepth: VerificationDepth
  /** 是否要求 clean-context 独立审查（P1-A）。 */
  isolatedReview: boolean
  /** fresh-gate 处置。 */
  freshGate: 'off' | 'warn' | 'block'
  /** 最少需运行的验证命令数（0=只要求任一验证）。 */
  minVerificationCommands: number
  /** 是否要求完整 artifact（plan/verification/review）。 */
  requireArtifacts: boolean
  rationale: string
}

export function resolveLeanPolicy(input: LeanPolicyInput): LeanPolicy {
  const lean = input.lean === true
  switch (input.level) {
    case 'S':
      return {
        level: 'S',
        verificationDepth: 'minimal',
        isolatedReview: false,
        freshGate: 'off',
        minVerificationCommands: lean ? 0 : 1,
        requireArtifacts: false,
        rationale: lean ? 'Lean S: run the minimal relevant check, no artifacts.' : 'S: minimal relevant verification.',
      }
    case 'M':
      return {
        level: 'M',
        verificationDepth: 'standard',
        isolatedReview: false,
        freshGate: lean ? 'off' : 'warn',
        minVerificationCommands: 1,
        requireArtifacts: !lean,
        rationale: lean ? 'Lean M: one verification command, skip heavy artifacts.' : 'M: standard verification + records.',
      }
    case 'L':
      return {
        level: 'L',
        verificationDepth: 'full',
        isolatedReview: true,
        freshGate: 'block',
        minVerificationCommands: 2,
        requireArtifacts: true,
        rationale: 'L: full verification + isolated review; lean never downgrades L.',
      }
    case 'CRITICAL':
      return {
        level: 'CRITICAL',
        verificationDepth: 'full',
        isolatedReview: true,
        freshGate: 'block',
        minVerificationCommands: 3,
        requireArtifacts: true,
        rationale: 'CRITICAL: full verification + isolated review + human confirmation; lean never downgrades CRITICAL.',
      }
    default:
      return {
        level: 'M',
        verificationDepth: 'standard',
        isolatedReview: false,
        freshGate: 'off',
        minVerificationCommands: 1,
        requireArtifacts: false,
        rationale: 'Unknown level, defaulting to standard.',
      }
  }
}
