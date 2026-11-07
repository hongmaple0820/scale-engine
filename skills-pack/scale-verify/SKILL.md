---
name: scale-verify
version: 1.0.0
description: Effort-tuned verification for SCALE Engine — pick the minimum credible verification depth for a task's level, run it, and record evidence.
triggers:
  - "verify"
  - "验证"
  - "acceptance"
agents:
  - verifier
---

# SCALE Effort-Tuned Verification

Use this skill when a change is ready to verify. Depth scales with task level (S/M/L/CRITICAL):

- **S** — one minimal relevant check, no artifacts.
- **M** — one verification command + records.
- **L / CRITICAL** — full verification + clean-context isolated review (never downgraded by lean mode).

## Steps

1. Resolve the policy: `scale review <task-id> --isolated --fresh-gate block` for L/CRITICAL, plain `scale verify <task-id>` for S/M.
2. Run the configured verification commands from `.scale/verification.json`.
3. Never claim a check passed without actual command output; record it as evidence.

## Reference

- `docs/EFFORT_TUNED_VERIFICATION.md` — the full verification matrix.
- `src/workflow/LeanPolicy.ts` — deterministic policy resolver.
