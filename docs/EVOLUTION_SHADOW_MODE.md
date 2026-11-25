# Evolution Shadow Mode

SCALE V2 keeps self-evolution useful without letting one-off failures become hard blockers too early.

## Flow

```text
Gate Failure
  -> Defect
  -> Lesson
  -> Proposed Rule
  -> Shadow Rule
  -> Candidate Hook
  -> Approved Blocking Hook
```

## Gate Failure To Defect

`GateSystem` emits `gate.failed` for failed gate results. `AutoDefectCreator` tracks consecutive failures per session and gate stage.

Default behavior:

- three consecutive failures create one `Defect`
- a passing `gate.executed` event resets the streak
- defect payload uses `rootCauseCategory=gate_failure`
- the original blockers, evidence, evidence record id, stage, and streak count are stored in defect context

This is evidence capture only. It does not change source code or generate a hook.

## Rule Maturity

New rules start in `shadow` mode. Shadow rules can record hits, but they do not block development.

Promotion requires:

- shadow hits >= 10
- at least one defect evidence id
- rollback method present
- false positive rate within threshold
- explicit approval before a blocking hook is allowed

`RuleMaturity` exposes:

- `createShadowRuleMaturity`
- `recordShadowHit`
- `evaluateRulePromotion`
- `approveRuleMaturity`

## Persistent Shadow Evidence Ledger

Accepted workflow improvement candidates can be initialized as persistent, non-blocking maturity records with a documented rollback procedure. Records live under `.scale/evals/rule-maturity/`. Each observed hit requires an existing regular evidence file inside the project directory (maximum 10 MiB). The CLI records its SHA-256 digest as the evidence ID; duplicate content is rejected even if submitted under another filename. Paths escaping the project directory are rejected. False positives are counted against the configured promotion threshold.

The CLI exposes `shadow-init`, `shadow-hit`, `shadow-status`, and `shadow-evaluate`. These commands record external observations and calculate eligibility only. They do not execute the underlying rule against traffic, run a replay, change the maturity stage, generate hooks, or edit production policies. A passing evaluation reports `candidate-hook` as the next review stage while the persisted record remains `shadow`.

Each newly recorded CLI hit now persists a version-1 artifact manifest entry alongside its digest: normalized project-relative path, byte size, timestamp, and false-positive classification. The store validates that the manifest is unique, path-safe, and consistent with the record's evidence IDs and hit count. Existing records without an artifact manifest remain readable as legacy records; the CLI fails closed rather than silently appending a partial manifest to a legacy record whose earlier artifact paths were never captured.

每次新 CLI 命中都会在摘要之外持久化证据文件清单：版本 1 的清单项，包含规范化的项目相对路径、文件字节数、记录时间和误报标记。存储层会校验清单唯一性、路径安全性，以及证据 ID 和命中次数的一致性。没有清单的旧记录仍可读取；如果旧记录已有无法追溯文件路径的历史命中，CLI 会拒绝悄悄追加不完整清单。

持久化 Shadow 证据台账支持为已接受的改进候选创建非阻断成熟度记录，并要求提供回滚方案。每次命中必须关联项目目录内已存在的普通证据文件（最大 10 MiB），CLI 以 SHA-256 生成证据 ID；重复内容和越界路径都会被拒绝。CLI 仅记录外部观察并计算门槛，不会自动执行规则或 Replay，不会改变成熟度阶段、生成 Hook 或修改生产策略。即使评估通过，也只报告下一审核阶段为 `candidate-hook`，记录本身仍保持 `shadow`。

## Hook Boundary

`HookGenerator` still requires `rule.approved === true`.

For V2 rules that carry maturity metadata, it also requires:

```text
rule.maturity.stage === "approved-blocking"
```

That means proposed or shadow rules can be observed and improved, but cannot become blocking hooks until explicitly promoted.

## Failure Improvement Review Boundary

Workflow Eval failure promotion creates an improvement candidate only. `scale eval review-improvement <id> --decision accept|reject --reviewer <identity> --rationale <reason>` records one immutable human decision with a timestamp.

- `candidate -> accepted`: records approval and sets `shadowStatus: pending`; it does not run a replay or alter a rule.
- `candidate -> rejected`: records rejection; rejected candidates are not eligible for shadow validation.
- A second decision is rejected. Reviewer identity and rationale are mandatory.
- Candidate review metadata is stored under `.scale/evals/improvements/` and is separate from production policy and hook files.

Acceptance is not promotion to `candidate-hook` or `approved-blocking`. A separately implemented and evidenced Shadow replay remains required before any rule-maturity evaluation. No CLI path in this workflow writes production policies or hooks.

## Failure Improvement Review / 失败改进审核

Failure candidates now have a persistent, one-time review decision. Reviewer identity, rationale, and timestamp are stored with the candidate. Acceptance queues a pending Shadow validation marker only; it does not run replay or promote a rule. Rejection prevents the candidate from entering Shadow validation. Neither decision writes production policy or hook files.

失败候选现在支持持久化的一次性审核。系统记录审核人、审核理由和时间。接受只将候选标记为等待 Shadow 验证，不代表 Replay 已运行，也不代表规则已升级；拒绝的候选不会进入 Shadow 验证。两种决定都不会写入生产策略或 Hook 文件。

## Current Scope

The workflow-eval candidate review lifecycle is persistent and review-only. Persistent rule-maturity storage and an executable Shadow replay runner remain separate follow-up work; the current `shadowStatus: pending` is a queue marker, not proof that replay ran.
