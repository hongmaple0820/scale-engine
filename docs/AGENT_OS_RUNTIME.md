# Agent OS Runtime

Status: implemented Agent OS V2 runtime
Date: 2026-06-28

SCALE Agent OS Runtime turns workflow tasks into durable, resumable agent work units. It is the execution contract under the human workflow.

## Runtime Contract

The Agent OS runtime provides:

- durable task manifests under `.scale/tasks/<task-id>/task.json`
- durable run manifests under `.scale/tasks/<task-id>/runs/<run-id>.json`
- checkpoint/resume records under `.scale/tasks/<task-id>/checkpoints/`
- explicit completion records under `.scale/tasks/<task-id>/completions/`
- execution events in `.scale/ledger/events.jsonl`
- final completion evidence in `.scale/evidence/runtime/`
- capability descriptors for skills, MCP, CLI, browser, desktop, providers, and connectors
- project capability registry under `.scale/capabilities.json`
- bridge registry under `.scale/bridges.json` with token hashes, scopes, heartbeat, and ledger events
- workbench snapshots that combine tasks, timeline, approvals, evidence, capability, bridge, git, shell, delegation, and Cortex promotion state
- governed Smart Shell history under `.scale/shell/runs.json` plus command-run evidence under `.scale/evidence/command-runs/`
- multi-agent delegation assignments under `.scale/agents/assignments.json`
- Cortex shadow-promotion records under `.scale/cortex/promotions.json`
- dashboard/HTTP management endpoints under `/api/v1/*`
- MCP agent tools for task lifecycle, capability discovery, bridges, shell supervision, delegation, and Cortex promotion

The central rule is:

```text
An agent is not done because it stopped talking.
An agent is done when it records an explicit task completion.
```

## Task Commands

```bash
scale task create "Implement provider registry" --task-id TASK-123 --level M
scale task start TASK-123 --run-id RUN-123 --agent codex
scale task checkpoint TASK-123 --summary "registry schema drafted" --completed schema --remaining tests,docs
scale task resume TASK-123
scale task complete TASK-123 --summary "registry landed" --validation "npm run typecheck" --changed-files src/os/AgentOsTaskStore.ts
scale task status TASK-123 --json
```

Completion outcomes:

| Outcome | Task status | Meaning |
| --- | --- | --- |
| `complete` | `completed` | Work is done and evidence is linked |
| `partial` | `partially_completed` | Useful work landed, with remaining scope recorded |
| `blocked` | `blocked` | Work cannot continue without an external change |
| `cancelled` | `cancelled` | Work intentionally stopped |

`scale task complete` records final-report runtime evidence automatically.

## Capability Commands

```bash
scale capability list
scale capability doctor --capabilities rtk,playwright
scale capability map --task "Design upload UI and verify browser flow" --files src/pages/upload.tsx
scale capability register im-bridge --kind connector --side-effects read,write,network
scale capability trust im-bridge trusted
scale capability disable im-bridge --reason "token rotated"
```

Capability descriptors add OS-level metadata over existing tool checks:

- kind: `skill`, `mcp`, `cli`, `provider`, `connector`, `browser`, `desktop`
- status: `available`, `missing`, `disabled`, `blocked`, `degraded`
- trust: `trusted`, `review-required`, `restricted`, `blocked`
- side effects
- approval policy
- required evidence
- fallback path
- health check
- action parity entries for CLI/API/agent tools

## Bridge Commands

```bash
scale bridge register "IM Bridge" --bridge-id BRIDGE-IM --kind im --token "<token>" --capabilities im-bridge
scale bridge heartbeat BRIDGE-IM --token "<token>"
scale bridge list --json
```

Bridge tokens are returned once on registration. Only token hashes are persisted.

## Smart Shell Commands

```bash
scale shell plan "git reset --hard HEAD" --json
scale shell run "npm run typecheck" --task-id TASK-123 --session-id RUN-123 --json
scale shell list --json
```

Smart Shell classifies commands as `read`, `write`, `network`, `credential`, or `destructive`. Destructive and credential-risk commands are blocked unless explicitly approved. Successful runs write command evidence and `shell.planned` / `shell.executed` events.

## Multi-Agent Delegation Commands

```bash
scale delegation delegate "Implement dashboard API security tests" --task-id TASK-123 --level L --files src/dashboard/DashboardServer.ts --services dashboard --json
scale delegation review <delegation-id> --profile-id security-agent --status accepted --reason "threat model reviewed"
scale delegation list --json
```

Delegation uses the existing AI OS collaboration planner, then persists role assignments, handoffs, review gates, and review decisions under the Agent OS ledger.

## Cortex Promotion Commands

```bash
scale cortex-promotion propose "Require validation before completion" --pattern "complete without validation" --rollback "disable hook" --evidence RTE-123 --json
scale cortex-promotion hit <proposal-id> --evidence RTE-SHADOW-1
scale cortex-promotion approve <proposal-id> --reviewer reviewer-id
scale cortex-promotion list --json
```

Cortex promotions stay in shadow mode until maturity thresholds are met. Blocking approval requires shadow-hit evidence, defect evidence, rollback information, and explicit reviewer approval.

## HTTP API

The dashboard Hono server exposes the same kernel state for workbenches and agent bridges:

```text
GET  /api/v1/tasks
POST /api/v1/tasks
GET  /api/v1/tasks/:taskId
GET  /api/v1/tasks/:taskId/workbench
POST /api/v1/tasks/:taskId/start
POST /api/v1/tasks/:taskId/checkpoints
POST /api/v1/tasks/:taskId/resume
POST /api/v1/tasks/:taskId/complete
GET  /api/v1/workbench
GET  /api/v1/capabilities
POST /api/v1/capabilities/map
GET  /api/v1/events
GET  /api/v1/events/stream
GET  /api/v1/bridges
POST /api/v1/bridges/register
POST /api/v1/bridges/:bridgeId/heartbeat
```

`POST /api/v1/tasks/:taskId/complete` records the same final-report runtime evidence as `scale task complete`.

## MCP Agent Tools

The MCP server exposes agent-native tool names over the same kernel:

```text
task_create
task_start
task_status
task_checkpoint
task_resume
complete_task
capability_list
capability_map
bridge_register
bridge_heartbeat
shell_plan
shell_run
delegation_delegate
delegation_review
cortex_promotion_propose
cortex_promotion_hit
cortex_promotion_approve
```

`complete_task` writes final-report runtime evidence with source `mcp-tool`.

## Agent-Native Guarantees

The implemented runtime enforces these agent-native constraints:

- explicit `complete_task` equivalent through `scale task complete`
- partial completion and blocked states are first-class
- checkpoints include a resume prompt and remaining steps
- users and agents share the same `.scale/tasks` workspace
- task state changes are ledger events
- capability discovery is dynamic and policy-aware
- bridge registration and heartbeat are ledger-backed
- governed shell execution records command evidence and blocks high-risk commands
- multi-agent delegation and reviews are durable, auditable state
- Cortex rule promotion is shadow-first and reversible
- CLI, HTTP API, dashboard, and MCP agent tools share the same task, capability, bridge, shell, delegation, and promotion contracts

## Boundaries

Still intentionally out of scope:

- autonomous source mutation
- automatic PR creation
- multi-user hosted auth for bridge connectors
- editor-owned desktop shell replacement

Those features depend on the durable task, bridge, approval, and evidence contracts defined here.
