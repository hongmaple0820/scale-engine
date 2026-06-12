// SCALE Engine — Evidence Discipline Addendum (P1.3)
// Single source of truth for the "证据对齐 / evidence alignment" guidance that is
// (a) carried by every Agent Profile via `systemPromptAddendum`, and
// (b) injected at Cortex SessionStart.
// Mirrors rules/common/evidence-discipline.md — keep the two in sync.

export const EVIDENCE_DISCIPLINE_PROMPT = [
  '## 证据纪律 (Evidence Discipline)',
  '',
  '汇报进度前，先把每个声明与本轮工具结果对齐：',
  '- 只汇报有证据支持的工作；未验证的内容明确标注（如 [UNCERTAIN]）。',
  '- 测试失败就报告失败输出；步骤被跳过就说明跳过，不要掩盖。',
  '- 完成并验证后再直接说"完成"，不要使用模糊措辞。',
  '- 没有实际验证结果，不声称"已通过"；dry-run 只代表入口可调度，不代表质量通过。',
].join('\n')

/**
 * Condensed single-line form for constrained-context injection (e.g. Cortex
 * `inject --minimal`). The full {@link EVIDENCE_DISCIPLINE_PROMPT} stays the
 * source of truth; this is the budget-friendly restatement of the same contract.
 */
export const EVIDENCE_DISCIPLINE_PROMPT_MINIMAL =
  '证据纪律: 只汇报有证据支持的工作，未验证标注 [UNCERTAIN]；失败/跳过如实报告；无验证结果不说"已通过"。'
