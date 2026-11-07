---
name: scale-acceptance-checks
version: 1.0.0
description: Compile EARS+ acceptance criteria into executable checks (command/property/checklist) and trace each clause bidirectionally.
triggers:
  - "acceptance"
  - "验收标准"
  - "compile checks"
agents:
  - planner
  - verifier
---

# SCALE Acceptance-Check Compiler

Turn "at least one sentence a test could fail" into machine-checkable checks.

## Command

```bash
scale spec compile-checks <bundle-dir|requirements.md> [--json]
scale spec intake-brainstorm <brainstorm.md> --compile [--json]
```

Output: per-clause `checkId`, `kind` (command/property/checklist), `needsHuman`, `commandTemplate`,
plus bidirectional traceability and a `coverage` ratio (automatable / total). Subjective wording is
honestly downgraded to `needsHuman` — it does not pretend everything is automatable.

## Reference

- `src/spec/AcceptanceCompiler.ts`
- `src/spec/BrainstormIntake.ts` (brainstorm → EARS+ → checks)
