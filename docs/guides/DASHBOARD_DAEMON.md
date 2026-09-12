# Dashboard Daemon and Watchdog

SCALE dashboard should be treated as a resident Agent OS control plane, not as a one-off preview server. The dashboard daemon keeps the visual panel, Agent Control queue, Feishu/Lark routing UI, and runtime APIs reachable while agents run in the background.

## Quick Start

 For daily use, use the product-level entry:

```bash
scale open --dir .
scale smoke --dir .
```

`scale open` starts the resident watchdog and opens the Agent Control page. `scale smoke` verifies that the project is initialized, the dashboard health endpoint is reachable, and the Agent Control message loop can send, claim, complete, reply, and summarize a dry-run task.

For local development, build once before using the daemon directly:

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
scale open --dir .
scale smoke --dir .
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
   scale smoke --dir .
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

## Browser Verification

The SPA shell has no unit-test coverage, so behavioural changes to `dashboard/web/src/App.vue` must be verified in a real browser:

```bash
npm run build
node verify-dashboard-browser.mjs
```

The script starts `DashboardServer` against a throwaway project directory (so seeded messages never touch the real `.scale`), loads the SPA shell once, then drives every page through the app's own `hashchange` routing. It asserts:

- every page renders and produces no JavaScript errors;
- the Agent Control console keeps the plain message list on a small session, and switches to the windowed `n-virtual-list` above the 50-message threshold.

Two environment prerequisites are worth knowing:

- Run it with the Node version in `.nvmrc` (24). `better-sqlite3` in `node_modules` is compiled for that ABI; a mismatched runtime turns the Agent OS workbench endpoint into a slow native-module failure instead of a clean result.
- The script launches Chromium with `--no-proxy-server`. Dev boxes that export `http_proxy` would otherwise route `localhost` through the proxy and every navigation would time out.

The screenshot is written to `.agent/logs/dashboard-e2e/dashboard-overview.png`. Keep runtime artifacts out of the repository root — the `root-artifact-placement` docs-health gate fails on any image or archive left there.

### Known issue: slow first paint from capability probing

`/api/v1/workbench` is part of the bootstrap snapshot, and building it calls `inspectToolCapabilities`, which shells out to `where.exe <tool>` plus `<tool> --version` for **every** entry in the tool catalog on **every** request, with no caching. On a machine with many CLIs installed this takes roughly 25-30 seconds and blocks the root HTML response, so the first page load is slow despite the lightweight-bootstrap design above. Diagnose it with:

```bash
node --cpu-prof --cpu-prof-dir=tmp/prof -e "import('./dist/dashboard/DashboardServer.js')"
```

Profile the workbench snapshot and look for `spawnSync` self-time. Candidate fixes: drop `agent-os-workbench` from the bootstrap and let the SPA fetch it asynchronously (it already does via `refreshAll`), and/or memoize the capability probe with a TTL.
