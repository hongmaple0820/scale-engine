# Governance Dashboard

Status: implemented baseline, Vue dashboard default at the server root
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

The live dashboard is served by the Hono dashboard server. The Vue 3 + Vite + Naive UI dashboard is the default at the server root `/`. Old `/spa/` and `/vue/` preview URLs redirect to `/` for compatibility; `/classic/` is no longer a supported dashboard surface.

```bash
npm run serve
```

The server prints direct URLs after startup, for example:

```text
SCALE Dashboard is running:
- scale-engine: http://127.0.0.1:3210/ (E:\project\scale-engine)
```

Open the printed root URL for the default dashboard. If an old process is still bound to the port, stop it and restart `npm run serve`; otherwise the browser may show an older dashboard bundle and newer APIs such as `/api/prompts` or `/api/dashboard/capabilities` may be missing.

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

- `Overview`: data-source readiness, realtime mode, artifact/event snapshots, and partial/missing source explanations.
- `Workflow`: artifact/FSM closure status and runtime-evidence visibility.
- `Topology`: codegraph-derived topology, layer/kind filtering, domain summary, node detail, and JSON/SVG export.
- `Monitoring`: detector, defect, event, command pass/fail, and token-compression monitoring.
- `Tokens & Cost`: command-output compression metrics and model usage from `.scale/model-usage/usage.jsonl`.
- `Documents`: preview `.html`, `.md`, and `.json` from `.scale/docs`, `.scale/artifacts`, `.scale/knowledge`, `.scale/graphify-knowledge/entries`, `graphify-out`, and `docs`, grouped by directory with copy/download/export actions.
- `Knowledge`: separate repo knowledge base, gbrain memory, and graph views. The knowledge-base tab reads knowledge documents, `.scale/knowledge.db`, Karpathy/LLM guidance docs, and Graphify outputs; the memory tab remains the gbrain review/recall surface.
- `Prompts`: browse built-in vibe coding templates, phase prompt registry entries, project/global custom prompts, prompt packs, and the deterministic prompt optimizer.

## Live Data Contract

The Vue dashboard does not treat an empty chart as success. It reads `GET /api/dashboard/capabilities` and shows each data source as `ready`, `partial`, `missing`, or `error`, including the source path, refresh mode, count, and empty-state reason.

Important signals:

| Signal | Ready when | Partial or missing when |
| --- | --- | --- |
| Runtime evidence | `.scale/evidence/runtime/*.json` exists | no governed runtime evidence has been recorded |
| Command runs | `.scale/evidence/command-runs/*.json` exists | commands were not recorded through the governed runner |
| Model usage | `.scale/model-usage/usage.jsonl` has records | no `scale token record` data exists, so token/cost charts stay empty |
| gbrain memory | `.scale/memory/brain.sqlite` has memory nodes | database is absent or exists with zero nodes |
| Knowledge base | knowledge docs, `.scale/knowledge.db` entries, or `graphify-out/graph.json` exist | no knowledge docs, SQLite entries, or Graphify graph were found |
| Documents/prototypes | `.html`, `.md`, or `.json` files exist under configured doc/artifact roots | no previewable files were found |
| Prompt Studio | built-in or project prompt templates are discovered | prompt registry discovery failed |
| Event stream | server was started with an EventBus | normal `npm run serve` is heartbeat-only SSE plus polling |
| Artifact transitions | server was started with artifact store and FSM | normal `npm run serve` is read-mostly and transition APIs report partial |

This is intentional: the dashboard should tell users whether a capability is actually wired, not silently present empty UI as a healthy state. A `partial` or `missing` panel usually means one of two things: the repository has not produced that evidence yet, or the live server was started without an optional runtime dependency such as EventBus/FSM/store injection. The Vue implementation is served from the root URL so users do not need to remember an internal `/spa/` path.

Knowledge is not treated as the same thing as memory. The dashboard keeps `GET /api/knowledge` as the gbrain/provider-memory endpoint, and exposes `GET /api/knowledge-base` for repository knowledge sources: previewable knowledge documents, SQLite knowledge entries, Graphify graph/report artifacts, and a derived gbrain memory graph for visualization/export.

## Documents And Knowledge Maintenance

The live dashboard supports governed maintenance for previewable documents and repository knowledge files:

- document preview: `.md`, `.json`, and `.html` files can be opened from the grouped directory tree.
- document editing: Markdown, JSON, and HTML documents discovered by the dashboard can be edited online through `PUT /api/documents/*`.
- download/copy: document and knowledge preview panes support content copy and single-file download through `/api/documents/*?download=1`.
- JSON guard: JSON edits are parsed before write; invalid JSON is rejected and the original file is left unchanged.
- path guard: write operations are constrained to discovered dashboard documents and `.scale/knowledge/imports/`.
- knowledge import: new knowledge documents can be imported into `.scale/knowledge/imports/` from the Knowledge page.
- evidence: successful document edits and knowledge imports write append-only runtime evidence under `.scale/evidence/runtime/` with `taskId=dashboard-document-maintenance`.

These operations are intentionally file-oriented. They do not mutate `.scale/knowledge.db` rows or external gbrain/provider memory directly; database and provider maintenance should still go through their own governed APIs.

## Graph Views

The Knowledge graph tab renders both Graphify repository knowledge and the derived gbrain memory graph when those sources exist. The graph workbench uses Apache ECharts graph series rather than a hand-rolled SVG layout. It provides one large graph canvas, force-directed layout, mouse wheel zoom, drag pan, draggable nodes, adjacency emphasis, graph JSON download, clickable nodes, and a separate node inspector. Large graphs default to a high-degree interactive subgraph with a visible node-count selector so the browser remains usable; the JSON download still exports the full graph. If a node points at a previewable document path, the inspector can jump back to that document for copy, download, or editing.

Graph data still follows the live data contract above: no graph source means the panel reports `missing`, and sparse graph metadata means the node preview falls back to structural fields such as id, label, kind, group, source, and path.

## Prompt Studio

The live SPA exposes prompt assets through `GET /api/prompts` and local prompt optimization through `POST /api/prompts/optimize`.

Prompt Studio is a usability surface, not a new prompt-only execution model. It reads these existing sources:

| Area | Source |
| --- | --- |
| Vibe templates | `src/prompts/VibeTemplateGallery.ts` |
| Phase prompts and packs | `src/prompts/PhasePromptRegistry.ts` |
| Project custom prompts | `.scale/prompts/*.md` |
| Global custom prompts | `~/.claude/prompts/*.md` |
| Prompt optimizer | `src/prompts/PromptOptimizer.ts` |

The page supports search, source filtering, copy, command copy, JSON export, and prompt download. Custom registry prompts that do not have a CLI route are marked copy-only in the dashboard rather than pretending they can be executed through `scale vibe`.

The built-in Vibe template gallery includes Agentic workflow packs for company-style delivery: `agentic-company-flow`, `multi-agent-delivery`, and `long-task-autopilot`. These packs adapt SCALE workflow gates, agent profiles, role perspectives, runtime evidence, gbrain memory, repository knowledge, review ledgers, and token/cost budgets into copyable prompts. The design is informed by agent-loop and multi-agent research patterns such as ReAct-style observation/action feedback, Reflexion/Self-Refine revision loops, MetaGPT-style SOPs, AutoGen/CAMEL/AgentVerse-style role collaboration, and FrugalGPT-style cost control.

Agentic prompts are now paired with a machine-readable runtime planner and settlement report. `scale agent plan --task "<task>" --json` and `scale ai-os plan --task "<task>" --json` both emit `agentCollaboration` with selected agent profiles, DAG edges, handoff contracts, review gates, and per-role token budget. The dashboard Prompt Studio can generate the same safe plan through `/api/agent/plan` without executing shell commands, then copy or download `agent-collaboration.json`. `scale ai-os run --mode guarded --verify "<command>" --json` adds `agentExecution` when verification passes, binding role, handoff, and review-gate settlement to runtime evidence ids. `scale ai-os status --json` exposes the same capability through the `agent-collaboration` intelligence signal and `agentCollaborationQuality` summary. Execution readiness is still decided by AI OS runtime reports, gates, review evidence, and verification status.

The optimizer uses the same deterministic local logic as:

```bash
scale prompt optimize --input "raw coding request" --json
```

It does not call an external Agent SDK or LLM provider. Its output should still go through normal SCALE workflow, verification, review, and ship gates before being treated as delivery evidence.

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
