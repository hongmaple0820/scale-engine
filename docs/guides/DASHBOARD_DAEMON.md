# Dashboard Daemon and Watchdog

SCALE dashboard should be treated as a resident Agent OS control plane, not as a one-off preview server. The dashboard daemon keeps the visual panel, Agent Control queue, Feishu/Lark routing UI, and runtime APIs reachable while agents run in the background.

## Quick Start

Build once, then start the watchdog:

```bash
npm run build
scale dashboard daemon ensure --dir . --port 3210 --json
```

Or use the project script on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dashboard-service.ps1 ensure -ProjectDir . -Port 3210 -Json
```

Open:

```text
http://127.0.0.1:3210/#agents
```

The Agent Control page shows **Dashboard service** with supervisor PID, server PID, last heartbeat, restart count, login-task installation state, and log paths.

## Commands

```bash
scale dashboard daemon status --dir . --json
scale dashboard daemon start --dir . --port 3210
scale dashboard daemon ensure --dir . --port 3210
scale dashboard daemon restart --dir . --port 3210
scale dashboard daemon stop --dir .
scale dashboard daemon logs --dir . --lines 120
```

On Windows, install or remove the login task:

```bash
scale dashboard daemon install --dir . --port 3210
scale dashboard daemon uninstall --dir .
```

`install` writes a launcher under `.scale/artifacts/dashboard-service/dashboard-service.ps1` and registers a Windows Task Scheduler task named `SCALE-Dashboard-<project>`.

## Files

The daemon is project-scoped:

```text
.scale/artifacts/dashboard-service/
  status.json
  supervisor.pid
  server.pid
  daemon.log
  server.log
  dashboard-service.ps1
```

The service does not store Feishu/Lark app secrets. Feishu/Lark credentials stay in the machine-level `lark-cli` profile/keychain.

## Scope Model

The daemon uses three explicit scopes:

| Scope | Stored in | Examples |
| --- | --- | --- |
| Machine | `lark-cli` profile/keychain, OS task scheduler | Feishu/Lark app credentials, login task |
| Project | `.scale/integrations/`, `.scale/agents/`, `.scale/artifacts/dashboard-service/` | message route, selected platform/model/channel, queue files, daemon status |
| Session | `.scale/agents/messages/*.jsonl` | queued/claimed/completed messages, agent replies, evidence links |

Use one daemon per project/port when testing multiple projects. The dashboard can still display multiple project summaries, but Agent Control writes to the selected project so remote coding queues do not bleed across workspaces.

Use one session per active agent runtime when testing multiple agent platforms. Codex, Claude Code, Hermes, OpenClaw, and other adapters can share the same visual panel while keeping separate sessions and queue ownership.

## Hook Integration

The repository registers a Claude Code `SessionStart` hook:

```text
.claude/hooks/dashboard-service-ensure.sh
```

The hook calls `scripts/dashboard-service.ps1 ensure` when PowerShell is available. It is intentionally non-blocking: failures are written to `.scale/artifacts/dashboard-service/session-start-hook.log` and do not stop the coding agent from starting.

Use hooks as a lightweight self-healing trigger. Use the daemon as the real resident service.

## Blank Page Troubleshooting

If the browser opens a blank page:

1. Check the lightweight health endpoint:

   ```bash
   curl http://127.0.0.1:3210/api/health
   ```

2. Check daemon status:

   ```bash
   scale dashboard daemon status --dir . --json
   ```

3. Restart the watchdog:

   ```bash
   scale dashboard daemon restart --dir . --port 3210
   ```

4. Read logs:

   ```bash
   scale dashboard daemon logs --dir . --lines 120
   ```

The dashboard root page uses a lightweight bootstrap so the HTML can render even when heavy capability, topology, knowledge, or metrics endpoints are slow. Those panels load asynchronously after the app starts.
