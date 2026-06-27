# Feishu/Lark Communication Integration

This guide defines the default SCALE integration path for Feishu/Lark as a communication, mobile-control, and online knowledge channel.

## Positioning

- Feishu/Lark is the channel provider for IM notifications, command intake, event streams, task/project surfaces, and Wiki/Docs/Base knowledge import.
- GBrain remains the default long-term memory provider. Do not treat raw chat history as durable memory.
- Reviewed Feishu summaries, decisions, and evidence links can be imported into memory or `.scale/knowledge/imports/` after privacy and retention review.

## Default Setup

`full`, `external-cli`, and `knowledge` setup packs include:

- `lark-cli`
- `lark-skills`
- critical skills: `lark-shared`, `lark-im`, `lark-event`, `lark-wiki`, `lark-doc`, `lark-base`, `lark-task`

Recommended setup:

```bash
scale setup --pack full --memory-provider gbrain --memory-mode external-first --apply --yes
lark-cli config init --new --lang zh
lark-cli auth login --recommend --no-wait
lark-cli doctor
scale setup --verify --pack full --json
```

`lark-cli config init` creates or binds the Feishu/Lark app. Keep app credentials in the CLI/keychain boundary; do not commit app secrets.

## Dashboard-First Configuration

For agent users, the easiest path is the dashboard:

```bash
npm run build
scale dashboard daemon ensure --dir . --port 3210 --json
```

Open `http://127.0.0.1:3210/#integrations`, then use **Integrations -> Feishu/Lark message channel -> Project message route** and save:

- target type: `chat` or `user`
- target id: Feishu chat `oc_xxx` or user `ou_xxx`
- agent platform: `codex`, `claude-code`, `openclaw`, `hermes`, or another installed platform
- agent session: the logical session name to route mobile commands into
- command prefix: default `/scale`

The dashboard writes project routing metadata to `.scale/integrations/feishu-channel.json`. It does not write app secrets. Feishu/Lark credentials remain machine-scoped in the `lark-cli` profile/keychain.

The route panel shows live command previews while editing. Outbound messages remain dry-run by default, and live write-capable commands stay blocked unless an explicit approval path is added.

For daily agent work, prefer the resident dashboard daemon over a one-off `scale serve`. The daemon keeps Agent Control, Feishu/Lark route editing, queue APIs, and health checks online while local or remote agents run in the background. See [Dashboard Daemon and Watchdog](DASHBOARD_DAEMON.md).

The same Integrations page now includes **Agent Connect workflow**, a cc-connect-style control layer for Bridge, Management API, Webhook, Cron, Heartbeat, channel matrix, Provider presets, Skill presets, and daemon hooks. Configure it before claiming mobile remote-control readiness. See [Agent Connect Workflow](AGENT_CONNECT_WORKFLOW.md).

## Agent Control Plane

After the route is saved, open **Agent Control** in the same dashboard. This is the product-facing control surface for agent users:

- session list: switch between project-local agent sessions without editing JSON
- platform selector: target Codex, Claude Code, Hermes, OpenClaw, or another installed adapter
- model selector: choose the default SCALE model tier or local models such as `deepseek-v3`
- channel selector: keep messages in the dashboard queue or route them through Feishu/Lark CLI
- chat console: send an instruction to the selected agent session, see queued/claimed/completed messages, claim a task, complete a task, and copy the agent runtime commands
- command preview: Feishu messages show the exact `lark-cli im +messages-send ... --dry-run` plan before any live delivery

Configuration is project-scoped under `.scale/agents/control-plane.json` and `.scale/agents/messages/*.jsonl`. CLI credentials remain machine-scoped. Agent runtimes can poll:

```http
GET /api/agent-control/sessions/<session-id>/inbox
POST /api/agent-control/sessions/<session-id>/messages/<message-id>/claim
POST /api/agent-control/sessions/<session-id>/messages/<message-id>/complete
POST /api/agent-control/sessions/<session-id>/replies
```

Local and remote runtimes can use the same contract through the CLI. Without `--url`, the command operates on the current project. With `--url`, it talks to a running remote dashboard:

```bash
scale agent-control status --dir . --json
scale agent-control inbox --session <session-id> --claim-first --agent-id codex-runtime --json
scale agent-control reply --session <session-id> --message <message-id> --agent-id codex-runtime --text "done, verification passed" --evidence .scale/evidence/runtime/check.json --json
scale agent-control inbox --url http://127.0.0.1:3210 --session <session-id> --claim-first --agent-id remote-codex --json
```

Use `live-guarded` mode only after the Feishu target is verified and the project has an explicit approval path. Until then, `dry-run` and `interactive` modes keep remote coding safe and visible.

The product model follows the same split used by modern agent control tools: the web panel owns configuration and visibility, while the CLI/runtime protocol owns execution. SCALE keeps this project-scoped so one machine can run multiple agent platforms and multiple projects without sharing Feishu app secrets.

## Channel Contract

SCALE models Feishu/Lark as a provider around these commands:

```bash
lark-cli event consume im.message.receive_v1 --as bot --timeout 30s --max-events 1 --quiet
lark-cli im +messages-send --chat-id <oc_xxx> --text "<summary>" --dry-run
```

The provider parses NDJSON event lines into `FeishuInboundMessage`, then routes them into `AgentChannel` with a payload containing:

- provider: `feishu`
- messageId
- chatId
- senderId
- text
- optional `/scale` command metadata
- raw event evidence

## Remote Commands

Initial command grammar:

```text
/scale status
/scale projects
/scale sessions
/scale plan <task>
/scale run <task-or-plan>
/scale stop <task-or-session>
/scale ship --dry-run
```

Read-only commands do not require approval. Write commands such as `plan`, `run`, `stop`, and `ship` must be confirmed through an interactive Feishu card or an equivalent explicit approval path before live execution.

## Loop Integration

SCALE treats Feishu/Lark as the default work-channel provider for the Attention Loop. The built-in loop is visible without project configuration:

```bash
scale loop list --json
scale loop status --json
scale loop run attention.permission-needed --event permission-needed --json
scale loop run attention.permission-needed --event permission-needed --feishu-chat-id <oc_xxx> --json
```

`scale loop run` is dry-run only in the MVP. It writes `.scale/evidence/loop-runs/*.json` with the planned Feishu/Desktop actions, but does not call `lark-cli` or send a live message. When `--feishu-chat-id <oc_xxx>` or `--feishu-user-id <ou_xxx>` is provided, the evidence includes a provider command plan built through `FeishuChannelProvider`, for example:

```json
{
  "command": "lark-cli",
  "args": [
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--chat-id",
    "oc_xxx",
    "--text",
    "SCALE Loop attention.permission-needed triggered by permission-needed...",
    "--dry-run"
  ],
  "requiresConfirmation": false
}
```

Enable real Feishu delivery only after the target chat/user is confirmed and the approval path is in place. Do not remove `--dry-run` from generated message-channel plans in automated loop execution.

Project teams can override or add loops with `.scale/loops.yaml`. Keep write-capable loops disabled until their approval, rollback, and evidence rules are reviewed:

```yaml
version: 1
loops:
  - id: file.inbox-organizer
    name: File inbox organizer proposal
    description: Propose rename and move operations for newly created files.
    enabled: false
    events:
      - file-created
    policy:
      riskLevel: write-capable
      dryRunDefault: true
      requiresApproval: true
      allowWrite: false
      evidenceRequired: true
    actions:
      - type: propose-file-organization
        provider: skill
        description: Draft file rename and destination suggestions.
```

## UX Rules

- Default outbound messages should use `--dry-run` until the user explicitly confirms the target chat/user.
- Mobile messages should be short: status, current blocker, next action, and a link or artifact id for detail.
- Long logs should be summarized; store full evidence in SCALE artifacts, not in chat.
- Project and session lists should be rendered as selectable cards, not free-form instructions.

## Security Rules

- Use least-privilege scopes for IM, event, Wiki/Docs/Base, and Task APIs.
- Keep credentials in the Feishu/Lark CLI profile/keychain boundary.
- Use bot identity for shared project channels; use user identity only where Feishu requires it.
- Gate live writes with confirmation, command allowlists, project allowlists, and audit logs.
- Never import private chat history into memory without review.

## Verification

Minimum checks before enabling remote coding:

```bash
lark-cli --version
lark-cli skills list --json
lark-cli doctor
scale setup --verify --pack full --json
scale memory provider status --json
```

If `lark-cli doctor` reports `config_file=not configured`, complete `lark-cli config init --new --lang zh` and login before claiming Feishu remote-control readiness.
