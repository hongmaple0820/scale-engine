---
name: scale-review-isolated
version: 1.0.0
description: Clean-context independent review for SCALE Engine — review a diff with no access to the implementing agent's reasoning, and optionally block on an unverified verdict.
triggers:
  - "isolated review"
  - "独立审查"
  - "clean context"
agents:
  - reviewer
---

# SCALE Clean-Context Isolated Review

The reviewer must NOT see the implementer's conversation or self-assessment — only the declared
verification surface, the diff, and the gate summary. This removes self-rationalisation bias
(Cognition 2026-04: a clean-context reviewer finds ~2 bugs/PR).

## Command

```bash
scale review <task-id> --isolated --fresh-gate block   # L / CRITICAL
scale review <task-id> --isolated --fresh-gate warn    # medium risk
```

- `--isolated` = `--mode fresh-subagent`.
- `--fresh-gate off|warn|block`: an `unverified` verdict blocks the review only under `block`.
- The review record carries a `contextIsolation` proof (fedFields / excludedFields / diffHash),
  auditable under `.scale/reviews/<id>.json`.

## Reference

- `src/review/freshReviewGate.ts` — the deterministic gate.
- `docs/EFFORT_TUNED_VERIFICATION.md` — "P1-A clean-context 独立审查".
