# 1.0.0 Beta Readiness Qualification Runbook

Status: qualification protocol; **not a completed qualification report**  
Owner: release maintainer  
Related: [Issue #71](https://github.com/hongmaple0820/scale-engine/issues/71)

This runbook defines how to collect reproducible evidence for three representative clean projects. A green unit-test workflow, the built-in demo, or a dashboard screenshot is not a substitute for a clean-project qualification run.

本文件是验收执行规程，不代表三个项目已经通过。没有真实运行记录、命令退出码和可复核报告时，不得把对应项目标记为通过，也不得据此宣称 1.0.0 Beta 已就绪。

## 1. Qualification matrix

Use fresh clones or freshly generated repositories. Do not reuse a maintainer working tree with an existing `.scale/` directory.

| ID | Project profile | Minimum characteristics | Qualification focus |
| --- | --- | --- | --- |
| `node-ts-library` | Node.js / TypeScript library | package manager lockfile, build, unit tests, package entry point | install, verification evidence, package/build checks |
| `python-service` | Python service | dependency manifest/lock, test command, service entry point | non-Node project discovery, command evidence, health/smoke path |
| `multi-package-app` | Multi-package or full-stack app | at least two workspaces/packages or frontend + backend, independent checks | project scope, multi-command verification, dashboard and workflow orchestration |

The fixtures must be representative, minimal, public or internally approved, and free of credentials. Record the source repository and exact commit for each fixture. If a profile cannot be supported by the current CLI, record a scoped blocker rather than silently substituting the built-in demo.

## 2. Run isolation and prerequisites

For every qualification run:

1. Use a fresh checkout in a new temporary directory.
2. Record the SCALE Engine source commit and package version under test.
3. Record OS, architecture, Node.js, npm, Python (where applicable), and package manager versions.
4. Start with no `.scale/` directory and no prior SCALE runtime state.
5. Do not reuse reports from another project or another commit.
6. Redact tokens, private URLs, usernames, local absolute paths, and customer data before retaining evidence.

Suggested environment capture:

```bash
git rev-parse HEAD
git status --short
node --version
npm --version
python --version
uname -a
```

On Windows, capture `git`, `node`, `npm`, and `python` versions plus `[System.Runtime.InteropServices.RuntimeInformation]::OSDescription` and `OSArchitecture` from PowerShell.

## 3. Qualification procedure

Run the following stages independently for each project. Capture the exact command line, start/end time, exit code, stdout/stderr artifact path, and SCALE-generated report path. Resolve command syntax from the installed CLI's `--help` output before execution; do not replace an unsupported command with a guessed equivalent.

| Stage | Required evidence | Minimum pass condition |
| --- | --- | --- |
| Install / init | install command, exit code, resulting file inventory | install succeeds in a clean project; no secrets or unexpected files |
| Upgrade / migration | upgrade/check and migration command output; before/after config inventory | supported upgrade path is explicit and non-destructive; unsupported paths are recorded as blockers |
| AI OS plan | plan command and machine-readable plan artifact | plan identifies project/workflow scope and actionable steps |
| Governed run | run command, gate decisions, runtime evidence | run reaches a terminal state with evidence; blocked actions remain blocked |
| Dashboard health | daemon status and health response | health endpoint is reachable and reports the expected project/runtime |
| Agent Control | readiness/status output and a minimal message-loop result, if enabled for this profile | readiness is explicit; unavailable optional integrations are reported as unavailable, not passed |
| Benchmark / eval | benchmark JSON, WORKFLOW_EVAL run/report | command completes and metrics are traceable to this run; no cross-project aggregation |
| Smoke / preflight | smoke, doctor, preflight, verification output | all required checks pass or have a documented, accepted exception |
| Package / build | build output, package smoke and tarball file list where relevant | build and package checks pass for the project profile |

Useful existing entry points include:

```bash
scale install --dir .
scale doctor --dir . --json
scale status --dir .
scale preflight --preflight-profile quick --dir .
scale dashboard daemon status --dir . --json
scale eval run --suite workflow-baseline --json
scale eval report --run <run-id>
```

For AI OS planning/runs, benchmark, upgrade, and migration, first capture the exact supported syntax with the installed CLI help (for example, `scale ai-os --help`, `scale benchmark --help`, and `scale migrate --help`). Store the help output alongside the run so a reviewer can reproduce the command against the same package version.

## 4. Machine-readable evidence record

Create one record per project run under a curated evidence directory, for example:

```text
docs/qa/beta-readiness/
  README.md
  evidence/
    node-ts-library/<run-id>.json
    python-service/<run-id>.json
    multi-package-app/<run-id>.json
```

Do not commit raw local `.scale/` runtime state, full environment dumps, secrets, or unredacted command output. Retain only the minimal JSON record and redacted reports needed to reproduce and review the result.

Use this record shape (all fields are required unless explicitly marked optional):

```json
{
  "schemaVersion": 1,
  "qualificationId": "node-ts-library",
  "runId": "replace-with-unique-run-id",
  "status": "blocked",
  "source": {
    "scaleEngineVersion": "0.0.0",
    "scaleEngineCommit": "40-character-git-sha",
    "fixtureRepository": "public-or-approved-repository",
    "fixtureCommit": "40-character-git-sha"
  },
  "environment": {
    "os": "name-and-version",
    "architecture": "x64-or-arm64",
    "node": "version",
    "npm": "version",
    "python": "version-or-not-applicable"
  },
  "stages": [
    {
      "id": "install",
      "command": "exact command, including arguments",
      "exitCode": 0,
      "startedAt": "ISO-8601 timestamp",
      "finishedAt": "ISO-8601 timestamp",
      "stdoutArtifact": "relative/path/to/redacted-output.txt",
      "stderrArtifact": "relative/path/or-null",
      "reportArtifacts": [],
      "status": "passed",
      "notes": []
    }
  ],
  "residualRisks": [],
  "review": {
    "reviewer": "GitHub handle",
    "reviewedAt": "ISO-8601 timestamp",
    "decision": "pending"
  }
}
```

Allowed stage statuses: `passed`, `failed`, `blocked`, `not-applicable`. Allowed overall statuses: `passed`, `failed`, `blocked`, `pending-review`. A project is not `passed` while any required stage is missing, failed, blocked, or not reviewed.

## 5. Failure-learning safety proof

For at least one deliberately selected failure in the qualification set:

1. Run an eval case that produces a failure replay.
2. Capture the failure ID and the replay artifact.
3. Ingest it as a candidate and show that it remains a candidate, not a production rule.
4. Exercise both reject and accept/review paths where supported.
5. Verify that production rules, hooks, and policy files did not change as a side effect of ingestion or review.
6. If a candidate is explicitly promoted, capture the reviewer, rationale, resulting diff, and replay result.

The expected safety property is: **failure observation may create a reviewable candidate; it must not silently harden production policy.** A successful eval command alone does not prove this property.

## 6. Chinese / English documentation parity

Review both language surfaces for equivalent operational information:

- install and clean initialization
- upgrade and migration compatibility
- AI OS plan and governed run
- Dashboard health and Agent Control readiness
- benchmark and WORKFLOW_EVAL interpretation
- smoke, preflight, verification, and package checks
- failure recovery, evidence retention, and secret redaction

Record the exact Chinese and English document paths, the reviewer, and any missing or contradictory instructions. Translation presence alone is not parity.

## 7. Public-claim gate

Every public statement about token reduction, hallucination reduction, productivity, reliability, or supported project coverage must link to a benchmark, eval, runtime evidence, or qualification record that actually measures that statement.

Until the three project records and failure-learning review are complete:

- describe AI Engineering OS as the project's direction, not a fully qualified release claim;
- do not publish percentage gains without a baseline, sample size, methodology, and raw/curated evidence;
- do not infer real-project readiness from unit tests, CI, or the built-in demo.

## 8. Completion checklist

- [ ] Node/TypeScript library clean-project run recorded and reviewed.
- [ ] Python service clean-project run recorded and reviewed.
- [ ] Multi-package/full-stack clean-project run recorded and reviewed.
- [ ] Install, upgrade/migration, plan/run, dashboard, benchmark/eval, smoke/preflight, verification, and package/build evidence captured for each supported profile.
- [ ] Failure-learning candidate accept/reject/replay behavior reviewed; no silent production-policy mutation.
- [ ] Chinese/English operational documentation parity reviewed.
- [ ] Public claims mapped to measured evidence.
- [ ] All residual risks explicitly accepted or tracked.

A missing artifact is a missing proof, not an implicit pass.
