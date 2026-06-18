# Gates and Task Score

This document records the first deterministic optimization layer for gate visibility, architecture conformance, and task scoring.

## Gate Status

Use `scale gates status` to inspect the active gate catalog.

```bash
scale gates status --json
```

The report separates four concepts that were previously easy to confuse:

- Core gates: `G0-G8`, used by workflow verification, preflight, and product smoke profiles.
- Meta-governance gates: `G9-G15`, used by `scale meta-governance`.
- Enhanced gates: `G16-G22`, covering commit discipline, doc hygiene, runtime evidence, code review, supply chain, context budget, and session health.
- Extension gates: policy-backed checks such as engineering standards, product smoke policy, and tool evidence.

`scale gates status` is intentionally read-only. It does not execute checks; it explains which checks exist and which policies are blocking.

## Architecture Standards Gate

Architecture and engineering standards are driven by project configuration:

- `.scale/verification.json` controls whether `engineeringStandardsGate` is `off`, `warn`, or `block`.
- `.scale/engineering-standards.json` controls standards rules and baselines.
- `.scale/frameworks.json` records project-specific framework and architecture conventions.

Preflight now uses changed-file standards scope when the target is inside a Git worktree. Non-Git projects keep the old full-scan behavior so bootstrap and fixture projects still get complete feedback.

## Enhanced Gates (G16-G22)

Added in v0.41.0, these gates cover commit discipline, runtime quality, and session hygiene:

| Gate | Name | Blocking | Description |
| --- | --- | --- | --- |
| G16 | Commit Discipline | ✅ | Uncommitted file count (warn=10, block=25), time since last commit (warn=60min, block=180min), staged files >1MB, whitespace errors |
| G17 | Documentation Hygiene | — | Changed markdown files must have valid internal links |
| G18 | Runtime Evidence | ✅ | Task must have recorded runtime evidence with matching exit codes |
| G19 | Code Review | ✅ (L/CRITICAL) | L and CRITICAL tasks require reviewed changes with resolved findings |
| G20 | Supply Chain | ✅ | No CRITICAL/HIGH vulnerabilities; lock file must be consistent |
| G21 | Context Budget | — | Advisory check on context token usage against configured budget |
| G22 | Session Health | — | Advisory check on stale worktrees and session state consistency |

Run enhanced gates individually:

```bash
bash scripts/gates/G16-verify.sh   # Commit Discipline
bash scripts/gates/G17-verify.sh   # Documentation Hygiene
bash scripts/gates/G18-verify.sh   # Runtime Evidence
bash scripts/gates/G19-verify.sh   # Code Review
bash scripts/gates/G20-verify.sh   # Supply Chain
bash scripts/gates/G21-verify.sh   # Context Budget
bash scripts/gates/G22-verify.sh   # Session Health
```

Or run all gates including enhanced:

```bash
bash scripts/gates/all.sh --all
```

## Task Score

Use `scale score task` to produce an algorithmic completion score.

```bash
scale score task --changed --json
scale score task --task-id TASK-123 --level L --changed-files src/api/foo.ts,src/workflow/bar.ts
```

The score is computed from evidence, not from a model:

- Verification: recent gate pass rate.
- Architecture standards: deterministic standards doctor result.
- Evidence completeness: persisted gate evidence records.
- Context and memory: CodeGraph/code intelligence readiness and memory provider readiness.
- Cost efficiency: governance ROI and cache/context savings.
- Risk control: task level, blocking standards, and blocking extension gates.

Default thresholds:

- `S`: 65
- `M`: 75
- `L`: 85
- `CRITICAL`: 90

Use `--warn-only` when the score should be reported without failing the command.

## Documentation Health Gate

`scripts/workflow/docs-health.mjs` is the shared implementation behind `G8`, `G17`, `make verify-docs-health`, `npm run docs:health`, and release checks.

The gate is intentionally broader than whitespace checks. It blocks on maintained docs with merge markers or mojibake, duplicate keys in workflow JSON, workflow/source/config changes without an entry-doc update, root-level generated artifacts, oversized changed files, and broken internal Markdown links.

Reports are written under `.agent/logs/docs-health/` when invoked from G8, G17, or verification profiles.
