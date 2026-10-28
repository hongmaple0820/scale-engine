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

## Verification Profile Execution

`scripts/workflow/verify.sh` runs every command listed in the active profile
(`build`, `docs-health`, `learning-health`, `lint`, `typecheck`, `test`) and does
not stop at the first failure. Each check reports its own outcome, and the run
ends with an explicit summary:

```
[VERIFY] summary
[VERIFY]   passed:  root/lint, root/typecheck
[VERIFY]   failed:  root/docs-health
[VERIFY]   skipped: root/test (build failed)
```

Two rules matter when reading gate results:

- A failure in one check never hides the others. Before v0.58.0 the first failure
  set a shared status flag that skipped every later check, so `G5` could report a
  single `docs-health` failure while the test suite was never executed at all.
- Checks with a build dependency are reported as `skipped`, together with the
  reason, instead of disappearing. `test` and `coverage` depend on `build`.

## Native Module Self-Check

The artifact store, dashboard, and knowledge base load `better-sqlite3`. Up to
11.x its `.node` binary was a V8 addon bound to one Node ABI, and
`require('better-sqlite3')` still succeeded when that binary had been built for a
different Node major — the loader only failed at the first `new Database()`.
SCALE now depends on `better-sqlite3` 13.x, an N-API addon whose shipped prebuild
is ABI-stable (Node >= 22), so a Node upgrade no longer invalidates the binding.
A missing or unusable prebuild still fails the same way at the first handle, so
SCALE opens a real one in two places:

- At install time, `scripts/workflow/check-native-abi.mjs` (a `postinstall` hook)
  prints the runtime ABI, the ABI the binding was built for (when the loader
  reports one), and the fix. It never blocks the install, and stays silent when
  the binding opens.
- At runtime, `scale doctor` and `scale status` open an in-memory database before
  reporting the runtime as healthy, so a broken binding shows up as a failure
  instead of a false green.

Fix: reinstall the package (`npm install better-sqlite3`) so its prebuilt binary
is restored, or rebuild from source with `npm rebuild better-sqlite3` when a C++
toolchain is available.

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
