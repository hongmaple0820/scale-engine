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

## Current Scope

The workflow-eval candidate review lifecycle is persistent and review-only. Persistent rule-maturity storage and an executable Shadow replay runner remain separate follow-up work; the current `shadowStatus: pending` is a queue marker, not proof that replay ran.
