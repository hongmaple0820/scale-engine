# Governance Dashboard

Status: implemented baseline
Since: v0.25 development branch

Governance Dashboard turns existing SCALE evidence into a single reviewable HTML page. It does not replace Markdown, JSON, runtime evidence, eval records, or memory. It is a human-facing view over those sources.

## Command

```bash
scale artifact dashboard
scale artifact dashboard --task-id <task-id>
scale artifact dashboard --dir /path/to/project
scale artifact dashboard --output docs/worklog/tasks/<task-id>/artifacts/governance-dashboard.html
scale artifact dashboard --json
```

## Live Dashboard Server

The live SPA dashboard is served by:

```bash
npm run serve
```

The server prints direct URLs after startup, for example:

```text
SCALE Dashboard is running:
- scale-engine: http://127.0.0.1:3210/spa/ (E:\project\scale-engine)
```

Default behavior is intentionally compatible with earlier versions:

- project: current working directory
- port: `3210`
- host: `0.0.0.0`

For one explicit project:

```bash
SCALE_DASHBOARD_PROJECT_DIR=/path/to/project SCALE_DASHBOARD_PORT=3210 npm run serve
```

For multiple projects, use a semicolon-separated project list. Each item can be either a path or `name=path`:

```bash
SCALE_DASHBOARD_PROJECTS="scale-engine=/path/to/scale-engine;scaffold=/path/to/project-scaffold" SCALE_DASHBOARD_PORT=auto npm run serve
```

When `SCALE_DASHBOARD_PORT=auto`, `SCALE_DASHBOARD_AUTO_PORT=1`, or more than one project is configured, the launcher probes ports starting from the base port and skips occupied ports. Each project gets its own dashboard process binding and each dashboard exposes `/api/projects` so the SPA can switch to sibling project URLs.

The live dashboard currently exposes:

- `Documents`: preview `.html`, `.md`, and `.json` from `.scale/docs`, `.scale/artifacts`, and `docs`.
- `Knowledge`: browse local Memory Brain nodes and run explicit provider recall queries through the configured memory provider route.

Knowledge review actions are governed write operations, not direct database edits. The dashboard API accepts `POST /api/knowledge/local/:id/review` with one of four actions:

| Action | Allowed transition |
| --- | --- |
| `approve` | `candidate` -> `active`, requiring existing evidence paths |
| `reject` | `candidate` -> `rejected` |
| `stale` | `active` -> `stale` |
| `restore` | `stale` or `rejected` -> `active`, requiring existing evidence paths |

Invalid transitions return an error and leave the Memory Brain unchanged. Every successful transition writes append-only runtime evidence under `.scale/evidence/runtime/` with `taskId=dashboard-memory-review`, the previous and next status, the action, and the reviewed memory node id. Provider recall remains read-only in this surface; exporting or changing external provider memory must use the provider's own governed API.

Default output:

```text
.scale/reports/governance-dashboard.html
.scale/reports/governance-dashboard-manifest.json
```

The default lifecycle is `generated-report` and the default Git policy is `ignore`. Promote or commit only dashboards that are intentionally used as reviewed task evidence or release evidence.

When `--dir` is used and `SCALE_DIR` is not set, the default `.scale` directory is resolved inside the target project directory, not inside the shell's current working directory. This matters for scaffold and multi-repo validation runs.

## Inputs

The dashboard reads existing local evidence:

| Area | Source |
| --- | --- |
| Runtime evidence | `.scale/evidence/runtime/` |
| Workflow eval | `.scale/evals/runs/` and `.scale/evals/failures/` |
| Workflow metrics | `.scale/metrics/tasks.jsonl` |
| Gate evidence | `.scale/evidence/GATE-*.json` |
| Command runs | `.scale/evidence/command-runs/` |
| Model usage | `.scale/model-usage/usage.jsonl` |
| Memory Brain | `.scale/memory/brain.sqlite` |
| Resource Governance | workspace files plus `.scale/resource-policy.json` and `.scale/assets.json` |
| HTML artifacts | task artifact manifests and rendered HTML files |

## Aggregated Metrics

V2.0 adds `MetricsAggregator` as the dashboard aggregation layer. It keeps the dashboard read-only and derives the following metrics from existing evidence:

- recent task count and first-pass rate
- average fix iterations
- gate failure distribution
- command output compression token savings
- model usage and prompt-cache savings

Each number must trace back to local JSON/JSONL evidence. If a source is absent, the dashboard reports zero rather than inventing values.

You can inspect the same model-usage ledger directly without opening the HTML dashboard:

```bash
scale token report --since-days 7
scale token report --day 2026-05-23 --json
```

## Workflow Effectiveness CLI

For release readiness, workflow reviews, and cross-methodology audits, use:

```bash
scale workflow effectiveness
scale workflow effectiveness --json
scale workflow effectiveness --days 30 --json
scale workflow effectiveness --memory-query "release gate lessons" --json
scale workflow effectiveness --skip-memory-recall --json
```

This report is stricter than the HTML dashboard. It combines gate evidence, workflow eval runs, failure replays, task metrics, memory provider status, a read-only provider recall probe, workflow skill readiness, Cortex ROI metrics, and DORA-style delivery signals into one reviewable model. Signals with no authoritative source are reported as `missing`, not as zero. This keeps missing deployment frequency, lead time, restore time, long-task evidence, memory recall quality, or instinct hit-rate evidence visible instead of silently improving the score.

The memory section does not treat "provider installed" as enough. By default, `scale workflow effectiveness` runs a read-only provider recall query and reports provider recall hit rate, returned item count, and context-savings evidence. Use `--skip-memory-recall` only for deterministic unit tests or offline environments; otherwise an available gbrain that returns no relevant context is reported as a workflow gap.

The Agent Loop section is report-only in v1, so it is counted in measured/missing signals but is not part of the weighted score. It reads existing `.scale/evidence`, `.scale/evidence/runtime`, `.scale/reviews`, and `.scale/ai-os/runs` evidence to check tool execution, failure recovery, guardrails, budget controls, handoff/delegation, and termination evidence. `scale ai-os status --json` exposes the same roll-up as the `agent-loop-readiness` intelligence signal and `agentLoopQuality` summary.

Deployment evidence is append-only runtime state:

```bash
scale ship <task-id> --record-deployment --deploy-environment production --deploy-version v0.49.0 --json
scale workflow deploy record --git-tag v0.49.0 --json
scale workflow deploy record --version v0.49.0 --commit <sha> --commit-time <iso> --completed-at <iso> --source release --json
scale workflow deploy record --status failed --failed-at <iso> --restored-at <iso> --source ci --json
scale workflow deploy list --days 30 --json
```

These commands write `.scale/release/deployments.jsonl`. `scale ship --record-deployment` records only after a real governed ship commit succeeds; `--no-commit` delivery reports are not counted as deployments. `scale workflow deploy record --git-tag <tag>` infers version, commit SHA, commit timestamp, release timestamp, source, and tag evidence from the local Git tag, while explicit fields remain available for CI or external release systems. `scale workflow effectiveness` reads the ledger for DORA deployment frequency, lead time for changes, change failure rate, and recovery time. Failed deployments without `restoredAt` remain partial evidence until recovery is closed.

Cortex instinct hit rate is measured only from runtime evidence. The denominator comes from session-start Cortex metadata in `.scale/events/sessions/*.jsonl` (`metadata.cortex.instinctsApplied`), and successful outcomes come from `.scale/instincts/.audit.jsonl` `apply` entries with `application-succeeded`. Legacy YAML counters are treated as partial evidence; static instincts alone do not prove that learning reached the runtime.

## Status Model

- Runtime evidence failures are blocking.
- Memory contradictions are blocking.
- Resource Governance failures are blocking.
- Open eval failure replays are warnings, because they may be intentional baseline failures or pending improvement work.
- Missing task HTML artifacts are informational.

This keeps the dashboard useful as a review surface without turning every observation into a hard gate.

## Recommended Use

For M/L/CRITICAL work:

```bash
scale verify <task-id>
scale eval run --suite workflow-baseline
scale memory dream --json
scale artifact dashboard --task-id <task-id>
```

For release review:

```bash
scale artifact dashboard
scale artifact open --artifact-dir .scale/reports --type governance-dashboard --print-only
```

The dashboard should be attached to a release or PR only when it is deliberately selected as a review artifact. Routine generated dashboards should stay local.
