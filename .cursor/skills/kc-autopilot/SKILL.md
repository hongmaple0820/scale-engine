---
name: kc-autopilot
description: KC-Chat group autopilot autonomous mode full protocol. Read ONLY when user says "start autopilot/autonomous mode", or about to call `autopilot_start` / `autopilot_pause` / `autopilot_stop` / `autopilot_status`, or on receiving `[AUTOPILOT_TICK]` / `[AUTOPILOT_PAUSED]` / `[AUTOPILOT_BUDGET_EXHAUSTED]` system messages. Covers: startup flow, Leader LOOP, Worker behavior, shared memory schema, cooldown compatibility, autonomy contract (autonomyLevel/budget), Watchdog fallback, `[AUTOPILOT_TICK]` forced action rules, safety constraints.
---

# KC-Chat Autopilot Mode (Skill)

> Read this skill when user explicitly requests "start autopilot/autonomous mode" or when about to call `autopilot_*` tools. Works with `kc-chat.mdc` base rules.

## 1. Mode overview

In autopilot mode, group agents work in **automatic cycles** under Leader coordination, without per-task user instructions.

- **Leader**: Dispatch center — manages taskboard, collects results, assigns next round
- **Worker**: Executes scan/fix/review tasks, reports on completion, waits for next round

## 2. Startup flow

Autopilot can be started via **three methods**:

**A. User right-clicks in KC Chat group panel** — plugin calls `AutopilotService.updateState`, writes shared memory and delivers prompt to Leader.

**B. User tells Leader "start autopilot"** — Leader executes initialization commands below.

**C. LLM calls MCP tools directly** (no extra toggle needed; plugin accepts directly):
```
autopilot_start({ groupId, sessionId, autoFix:false, focus:"full", maxFilesPerRound:5 })
// Returns OK/FAILED within 5s
// LLM can periodically call autopilot_status({ groupId }) to monitor
// Pause/stop: autopilot_pause / autopilot_stop
```

Leader receives first-round prompt and executes:
```
1. memory_write(key:"autopilot-status", content:"active", category:"context", scope:"group:<groupId>")
2. memory_write(key:"autopilot-taskboard", content:JSON.stringify({
     tasks: [], findings: [], completed: [], round: 0
   }), category:"task", scope:"group:<groupId>")
3. publish_event(type:"info", summary:"Autopilot started")
4. Dispatch first-round tasks to Workers (see §4 task templates)
5. Enter auto-loop (see §3)
```

## 2.1 Cooldown compatibility (with kc-chat.mdc §6.1)

During autopilot, if group enters cooldown (`silentUntil` not expired):
- Leader pauses next-round dispatch
- `autopilot-status` stays `active`, taskboard unchanged
- Auto-resumes after cooldown expires
- `[AUTOPILOT_TICK]` suppressed during cooldown (TickScheduler skips cooled groups)
- Worker follows kc-chat.mdc §2.1 silent ack for `[COOLDOWN]` messages

## 2.2 KC Flow protocol coordination (see kc-chat.mdc §4 + §10.5)

On autopilot start / each round dispatch / each Worker completion, Leader **MUST** sync KC Flow so users see project progress in UI instead of scrolling chat:

- **On start**: `flow_step_create({ title:'Start autopilot', kind:'auto', owner:'all', ownerName:'Leader' })`
- **Each round dispatch**: Create a step per Worker task (owner=Worker channelId)
- **Worker starts**: Immediately `flow_step_update_status(seq, 'in_progress')`
- **Worker completes**: `flow_step_update_status(seq, 'done', result:{summary:'Fixed 3 issues'})`
- **Decision points**: Create `kind:'decision'` step, user selects in UI

**Time fields are written by mcp-server only — LLM must never pass time values.** See kc-chat.mdc §4.
**Brevity**: title ≤ 12 chars, result.summary ≤ 200 chars.

## 2.3 Autonomy contract (P6+)

autopilot_start now supports five **optional new fields** for bounded autonomy without user interruption:

```
autopilot_start({
  groupId, sessionId,
  autoFix:false, focus:'full', maxFilesPerRound:5,
  // ---- P6 new fields (all optional; defaults = legacy behavior) ----
  goal: 'Find and fix all P0 security vulnerabilities',
  successCriteria: ['P0 vulnerability count = 0', 'File coverage ≥ 80%'],
  budget: {
    maxRounds: 10,
    maxWallClockMs: 3600000,           // 60 min
    maxAutoFixesNoConfirm: 3,
    maxFilesPerSession: 50,
  },
  autonomyLevel: 'auto-bounded',       // 'ask'(default) / 'auto-bounded'(recommended) / 'auto'(high risk)
  degradedPolicy: 'pause',             // 'pause'(default) / 'stop' / 'notify'
})
```

### autonomyLevel tiers

| Level | Meaning | Use case |
|-------|---------|----------|
| `ask` (default) | Confirm with user on every file deletion / exceeding limit / core config change | User is actively monitoring |
| `auto-bounded` (recommended) | Decide freely within budget (including autoFix, file writes); only pause on budget exhaustion | User leaves overnight for agents to run |
| `auto` (high risk) | Never ask except on crash/MCP errors | User has done a full dry-run verification |

### Leader per-round self-check loop (mandatory for auto-bounded/auto, recommended for ask)

After each round, before writing autopilot-taskboard:

1. **successCriteria check**: If all met → `autopilot_stop({ reason:'goal-achieved' })` + `publish_event` + brief report to user
2. **budget check**:
   - `round > maxRounds` → `autopilot_pause` + notify user
   - `(now - startedAt) > maxWallClockMs` → same + `summary:'budget-exhausted: wallClock'`
   - autoFix count > maxAutoFixesNoConfirm → switch to `autonomyLevel='ask'`
3. **convergence check**: No new findings for 2 consecutive rounds → `autopilot_stop({ reason:'converged' })`
4. None triggered → proceed to next round dispatch

### Watchdog (extension-side AutopilotTickScheduler) auto-fallback

Even if Leader LLM forgets self-check, extension Watchdog catches it: scans every 30s, checks `taskboard.round > maxRounds` / time limits, triggers action per `degradedPolicy`.

### degradedPolicy options

- `pause` (default): Write `autopilot-status='paused'`, set degraded=true, push message to Leader
- `stop`: Write `autopilot-status='stopped'` + same message
- `notify`: Push message only, don't change status

**Key rule**: In auto-bounded/auto mode, Leader **must never wait_message for user approval each round**. Only reply_message + wait_message on budget exhaustion / goal achieved / degraded.

## 3. Leader auto-loop (core)

Leader MUST follow this loop in autopilot mode, **never self-stop**:

```
LOOP:
  1. Dispatch round tasks:
     For each Worker, choose dispatch method:
     (a) group_broadcast — visible to all, auditable
     (b) send_to_session — direct 1:1 dispatch
     Recommend: group_broadcast for context, then send_to_session for specific tasks

  2. Wait for results:
     wait_message({ sessionId: leaderId })
     → Workers reply via send_to_session(messageType:"result")
     Repeat wait_message until expected members respond or timeout

  3. Analyze results:
     - memory_read("autopilot-taskboard") to get current board
     - Write new findings to findings[]
     - Move completed tasks to completed[]

  4. Decision:
     - New bugs → decide: immediate fix or backlog
     - Fix completed → assign reviewer
     - Review completed → mark closed
     - No new findings → switch scan direction or deeper inspection

  5. Update taskboard:
     memory_write(key:"autopilot-taskboard", content:updated board)
     publish_event(type:"info", summary:"Round N complete, found X issues")

  6. Check interrupt conditions:
     - memory_read("autopilot-status") → if "paused"/"stopped", exit loop
     - User message takes priority: pause auto-loop to handle user request

  GOTO LOOP
```

## 4. Task templates

Leader assigns tasks based on Worker roles:

### Bug scan / issue detection
```
Scan project code, focusing on:
- Unhandled exceptions and errors
- Null/undefined risks
- Logic flaws and boundary conditions
- Resource leaks (unclosed connections, streams)

Requirements:
1. List findings (file path + line number + description + severity)
2. Provide fix suggestions for each
3. Use share_context to share files being checked
4. Use publish_event to record important findings
5. Reply to Leader via send_to_session when done
```

### Code review
```
Review the following code changes/files: [specific files]

Check for: code quality, naming conventions, duplication, performance, security.

Requirements:
1. Give review verdict (pass/needs changes/reject)
2. List specific issues and suggestions
3. Reply to Leader via send_to_session when done
```

### Refactoring
```
Analyze project code for optimization opportunities:
- Functions > 50 lines
- Duplicate code blocks
- Unreasonable dependencies
- Extractable common modules
- Performance hotspots

Requirements:
1. List suggestions (priority-ordered)
2. Assess benefit and risk of each
3. Reply to Leader via send_to_session when done
```

## 5. Worker behavior rules

Worker in autopilot mode:

1. **Receive task** → execute immediately, use `share_context` to share working state
2. **Find issues** → use `publish_event(type:"error/info")` to record
3. **Complete task** → `send_to_session(messageType:"result", targetSessionId:leaderId)` to report
4. **Wait for next round** → `wait_message` to keep channel; Leader dispatches via `group_broadcast` or `send_to_session`
5. **Judgment calls**:
   - Critical bugs (crash/security) → report and recommend immediate fix
   - Normal issues → report and wait for Leader decision
   - Optimization suggestions → write to shared memory, low priority

## 6. Shared memory schema

| Key | Purpose | Updated by |
|-----|---------|------------|
| `autopilot-status` | Mode: active/paused/stopped | Leader/user |
| `autopilot-taskboard` | Taskboard JSON | Leader |
| `autopilot-config` | Config (scan depth, auto-fix toggle) | User/Leader |
| `autopilot-findings-{round}` | Per-round findings summary | Leader |
| `known-issues` | Known issues list (avoid duplicates) | Leader |

### Taskboard format
```json
{
  "round": 5,
  "mode": "scanning",
  "tasks": [
    { "id": "task-001", "assignee": "kc-mcp-agent-3-xxx", "type": "scan", "target": "mcp-server/src/index.ts", "status": "in_progress" }
  ],
  "findings": [
    { "id": "find-001", "severity": "high", "file": "src/index.ts", "line": 42, "description": "Unhandled exception", "suggestedFix": "...", "reportedBy": "agent-3", "status": "pending_review", "round": 3 }
  ],
  "completed": []
}
```

## 7. Stop / Pause

- User says "stop autopilot/pause" → Leader updates `autopilot-status` to stopped
- Leader notifies all Workers to pause, generates final summary
- Summary: files scanned, issues found, fixed, pending

## 8. User interruption handling

When user sends a message during autopilot:
1. Leader pauses auto-loop
2. Handles user request
3. After completion, asks whether to resume autopilot
4. If yes, resume loop; otherwise stop

## 9. Safety constraints

- Auto-fix **off by default**, requires explicit user authorization
- File deletion **never auto-executed**
- Core config file changes need Leader confirmation
- Max 5 files modified per round; pause if exceeded

## 10. `[AUTOPILOT_TICK]` forced action rules

During autopilot, extension-side **AutopilotTickScheduler** (scans every 30s) detects stuck Leader/Workers and **injects `[AUTOPILOT_TICK]` messages** into Leader's session:

1. **Leader stale**: Leader's `status.json` mtime > 90s without update
2. **Round stale**: `autopilot-taskboard.updatedAt` > 120s without progress
3. **Worker timeout**: Worker hasn't replied > 120s

### Handling `[AUTOPILOT_TICK]`

**Leader receiving `[AUTOPILOT_TICK]` is completely different from `[POLL_TICK]`**:

- ❌ `[POLL_TICK]`: Silently re-call `wait_message`, no output
- ✅ `[AUTOPILOT_TICK]`: **MUST act immediately**, cannot ignore

### Message format

```
[AUTOPILOT_TICK][REASON:<idle-timeout|round-stale|worker-timeout>][TICK:<n>/<max>] <action prompt>
```

### Leader required actions (by REASON)

**REASON: idle-timeout**: Read autopilot-status + taskboard → dispatch next round or settle current

**REASON: round-stale**: Collect Worker replies → summarize completed → handle non-responders → update taskboard

**REASON: worker-timeout**: Retry/reassign/skip timed-out Workers → update taskboard → proceed

### Degradation mechanism

- Leader has **no action for 2 consecutive ticks** → TickScheduler writes `autopilot-status=blocked`, UI shows red alert banner
- User can one-click "resume" or "stop"; Leader MUST actively restart round dispatch on resume

### Leader iron rule

**Seeing `[AUTOPILOT_TICK]` is equivalent to user banging the table saying "move!"**. Forbidden:
- ❌ Ignoring tick and continuing wait_message
- ❌ Only replying "tick received" without action
- ❌ Asking "what should I do?" (tick message already tells you)

**Correct behavior**: Immediately execute the actions specified in tick message, `reply_message` brief progress, then `wait_message` back to loop.
