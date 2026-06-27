# SCALE Engine CLI Reference

> Auto-generated from source. Run `scale --help` for live output.

## Top-Level Commands

| Command | Description |
|---------|-------------|
| `scale init` | Initialize SCALE governance in a project |
| `scale setup` | Interactive setup wizard |
| `scale doctor` | Diagnose SCALE installation and configuration |
| `scale preflight` | Run pre-flight checks |
| `scale status` | Show project governance status |

## Phase Workflow

| Command | Description |
|---------|-------------|
| `scale define` | Define a new task with scope and level |
| `scale plan` | Generate implementation plan |
| `scale build` | Execute implementation with TDD |
| `scale verify` | Run verification gates |
| `scale review` | Code review and evidence check |
| `scale ship` | Prepare for release |

## Engines

### Shield (`scale shield`)

Hook-based security engine that intercepts dangerous commands.

| Command | Description |
|---------|-------------|
| `scale shield compile` | Compile YAML policies to executable hooks |
| `scale shield status` | Show shield configuration status |
| `scale shield test` | Test shield rules |

### Orchestrator (`scale orch`)

Declarative orchestration daemon with git worktree isolation.

| Command | Description |
|---------|-------------|
| `scale orch start` | Start orchestration daemon |
| `scale orch stop` | Stop orchestration daemon |
| `scale orch status` | Show orchestration status |
| `scale orch log` | View orchestration logs |

### Cortex (`scale cortex`)

Evidence-driven continuous evolution with instinct extraction.

| Command | Description |
|---------|-------------|
| `scale cortex extract` | Extract instincts from observation logs |
| `scale cortex inject` | Preview SessionStart injection content used by runtime sessions and AI OS preamble |
| `scale cortex metrics` | Show governance metrics |
| `scale cortex evolve` | Run evolution cycle |
| `scale cortex verify` | Verify cortex pipeline health |

## Memory

| Command | Description |
|---------|-------------|
| `scale memory pack` | Build memory context pack |
| `scale memory doctor` | Diagnose memory system health |
| `scale memory settle` | Settle learning candidates |
| `scale memory ingest` | Ingest evidence into memory |
| `scale memory query` | Query memory brain |
| `scale memory contradictions` | Detect memory contradictions |
| `scale memory dream` | Run memory consolidation |
| `scale memory promote` | Promote memory node to active |
| `scale memory export` | Export memory to JSONL |
| `scale memory import` | Import memory from JSONL |

### Memory Providers

| Command | Description |
|---------|-------------|
| `scale memory provider init` | Initialize memory provider config |
| `scale memory provider status` | Show provider health status |
| `scale memory provider recall` | Query providers for memories |
| `scale memory provider use` | Switch active memory provider |

## Code Intelligence

| Command | Description |
|---------|-------------|
| `scale codegraph status` | Show codegraph index status |
| `scale codegraph init` | Initialize codegraph index |
| `scale codegraph query` | Query code symbols and relationships |
| `scale codegraph impact` | Analyze change impact |
| `scale codegraph context` | Build context for code review |
| `scale codegraph roi` | Show codegraph ROI metrics |
| `scale codegraph dump` | Dump codegraph data |

## Evaluation

| Command | Description |
|---------|-------------|
| `scale eval init` | Initialize evaluation suite |
| `scale eval run` | Run evaluation suite |
| `scale eval compare` | Compare evaluation runs |
| `scale eval report` | Generate evaluation report |
| `scale eval failures` | List failure records |
| `scale eval replay` | Replay failure scenarios |
| `scale eval promote-failure` | Promote failure to learning |

## Workflow

| Command | Description |
|---------|-------------|
| `scale workflow list` | List workflow presets |
| `scale workflow effectiveness [--memory-query <query>] [--skip-memory-recall]` | Measure workflow effectiveness, including read-only memory provider recall quality |
| `scale loop init` | Write the default hook-first loop configuration to `.scale/loops.yaml` |
| `scale loop list` | List hook-first Loop Engineering presets from `.scale/loops.yaml` or built-in defaults |
| `scale loop status` | Inspect loop readiness, required providers, and safety defaults |
| `scale loop run <loop-id> --event <event> --json` | Dry-run a loop event and write `.scale/evidence/loop-runs/` evidence |
| `scale loop run attention.permission-needed --event permission-needed --feishu-chat-id <oc_xxx> --json` | Build a Feishu/Lark `lark-cli im +messages-send --dry-run` notification plan without sending it |
| `scale evidence list` | List evidence records |
| `scale evidence show` | Show evidence details |
| `scale token record` | Record token usage |
| `scale token report` | Generate token usage report |

## Runtime

| Command | Description |
|---------|-------------|
| `scale runtime start` | Start runtime session |
| `scale runtime end` | End runtime session |
| `scale runtime record` | Record runtime evidence |
| `scale runtime doctor` | Diagnose runtime health |
| `scale runtime final-check` | Run final delivery check |

## Dashboard And Agent Control

| Command | Description |
|---------|-------------|
| `scale dashboard daemon ensure --dir . --port 3210 --json` | Start or reuse the resident dashboard watchdog for Agent Control, Feishu/Lark routing, health checks, PID files, and logs |
| `scale dashboard daemon status --dir . --json` | Show supervisor/server process state, heartbeat, restart count, task installation state, and log paths |
| `scale dashboard daemon restart --dir . --port 3210` | Restart the resident dashboard watchdog and HTTP server |
| `scale dashboard daemon logs --dir . --lines 120` | Print dashboard watchdog logs |
| `scale dashboard daemon install --dir . --port 3210` | Install the dashboard watchdog as an OS login task where supported |
| `scale agent-control status --dir . --json` | Show project-scoped agent sessions, selected platform/model/channel, and queue counts |
| `scale agent-control inbox --session <session-id> --claim-first --json` | Let an agent runtime claim queued remote-coding messages from the dashboard queue |
| `scale agent-control reply --session <session-id> --message <message-id> --text "<result>" --json` | Complete a claimed message and write the agent reply/evidence back to the queue |
| `scale agent-control transcript --session <session-id> --json` | Show the full session transcript, storage paths, and deterministic summary card |
| `scale agent-control search --query "<keyword>" --session <session-id> --json` | Search project-scoped agent conversation history |
| `scale agent-control summary --session <session-id> --json` | Generate and persist `.scale/agents/summaries/<session-id>.json` |

## Skills

| Command | Description |
|---------|-------------|
| `scale skill scan` | Scan for available skills |
| `scale skill plan` | Generate skill routing plan |
| `scale skill doctor` | Diagnose skill configuration |
| `scale skill check` | Check skill installation safety |
| `scale skill repo` | Browse skill repository |
| `scale skill safety` | Evaluate skill supply chain safety |
| `scale skill radar` | Show skill radar visualization |
| `scale skill recommend` | Get skill recommendations |
| `scale skill outdated` | Check for outdated skills |

## Tools

| Command | Description |
|---------|-------------|
| `scale tool policy` | Show tool orchestration policy |
| `scale tool doctor` | Diagnose tool configuration |
| `scale tool plan` | Generate tool usage plan |
| `scale tool run` | Run tool with evidence |
| `scale tool evidence` | Show tool evidence |
| `scale tool outdated` | Check for outdated tools |

## Governance

| Command | Description |
|---------|-------------|
| `scale governance diff` | Show governance drift |
| `scale governance mode` | Set governance mode |
| `scale governance roi` | Show governance ROI |

## Configuration

| Command | Description |
|---------|-------------|
| `scale config profile` | Manage configuration profiles |

## Upgrade

| Command | Description |
|---------|-------------|
| `scale upgrade check` | Check for available upgrades |
| `scale upgrade plan` | Generate upgrade plan |
| `scale upgrade apply` | Apply upgrade plan |
| `scale upgrade rollback` | Rollback latest upgrade |

## Agents

| Command | Description |
|---------|-------------|
| `scale agent spawn` | Spawn agent instance |
| `scale agent list` | List active agents |
| `scale agent profiles` | Show agent profiles |
| `scale agent leaders` | Show leadership presets |
| `scale agent catalog` | Show external agent role catalogs and adoption gates |
| `scale agent acp-plan` | Create an ACP-first collaboration plan across agent platforms |

## Product Modules

| Command | Description |
|---------|-------------|
| `scale product modules` | List reusable product module templates |
| `scale product scaffold` | Generate product module template files, dry-run by default |
| `scale product blueprint` | Generate architecture, language, solution, design, and implementation blueprints |
| `scale product onboard-existing` | Generate planning and codebase-map artifacts for mature or legacy projects |

## Other

| Command | Description |
|---------|-------------|
| `scale diagnose plan` | Generate diagnostic plan |
| `scale hunt scan` | Background Hunter scan |
| `scale hunt report` | Generate hunt report |
| `scale hunt diagnose` | Run hunt diagnostics |
| `scale hunt ignore` | Add to ignore baseline |
| `scale dependency audit` | Audit dependencies |
| `scale tdd slice` | Create TDD slice |
| `scale quickstart` | Quick start wizard |
| `scale tui` | Terminal UI |
| `scale qa` | Quality assurance checks |
| `scale auto-fix` | Auto-fix common issues |
| `scale cost-report` | Generate cost report |
| `scale cost-optimize` | Optimize costs |
| `scale cross-review` | Cross-agent code review |

## Examples

```bash
# Initialize project
scale init

# Run setup wizard
scale setup --interactive

# Define and execute a task
scale define "Add user authentication" --level M
scale plan
scale build
scale verify
scale review
scale ship

# Memory operations
scale memory query "authentication patterns"
scale memory provider status
scale memory provider use gbrain

# Code intelligence
scale codegraph query "UserService"
scale codegraph impact src/auth/login.ts

# Skills
scale skill scan
scale skill recommend "implement OAuth"

# Agent ecosystem
scale agent acp-plan --task "multi-agent implementation review" --platforms codex,claude-code,gemini-cli
scale agent catalog --catalog agency-agents-zh --mode convert-to-yaml

# Product modules
scale product modules --template ruoyi-plus-enterprise-starter
scale product scaffold --modules auth,license,user --product DemoApp --package com.example.demo
scale product blueprint --solutions identity-auth-rbac,license-card-commerce
scale product onboard-existing --dir . --project LegacyApp --mode legacy
```
