# Agent Connect Workflow

This guide describes the cc-connect-style workflow now embedded into SCALE Dashboard and Agent Control.

## Product Model

SCALE treats remote agent control as four connected layers:

1. Machine credentials: CLI profiles, keychains, API keys, and local tokens. Do not commit these.
2. Project routing: `.scale/integrations/agent-connect.json`, `.scale/integrations/feishu-channel.json`, and knowledge-provider config.
3. Agent platform routing: one message route per agent platform such as `codex`, `claude-code`, `openclaw`, or `hermes`.
4. Agent session runtime: model selection, channel selection, queued messages, claimed work, replies, and evidence links.

The visual panel is the primary configuration surface. Use `http://127.0.0.1:3210/#integrations` for Agent Connect and message/knowledge providers, then `http://127.0.0.1:3210/#agents` for sessions, models, channel routing, and chat control.

## Dashboard Setup

```bash
scale setup --pack full --memory-provider hrain --memory-mode local-only --apply --yes
scale setup --verify --pack full --json
scale open --dir .
scale smoke --dir .
```

Open `http://127.0.0.1:3210/#integrations`.

Configure **Agent Connect workflow**:

- enable the workflow;
- enable Management API when a remote panel/client should manage projects, sessions, providers, models, cron, or bridge adapters;
- enable Bridge when a custom IM adapter should connect through WebSocket;
- enable Webhook when external systems such as git hooks, CI, or file watchers should trigger agent prompts;
- enable Cron/Heartbeat when agents should continue checking work without manual prompting;
- keep tokens out of Git. The dashboard stores only masked markers in `.scale/integrations/agent-connect.json`.

## Channel Matrix

The dashboard now exposes a cc-connect-style channel matrix:

- Dashboard local chat
- Feishu/Lark
- WeCom
- DingTalk
- Slack
- Telegram
- Discord
- Matrix
- QQ OneBot
- QQ official bot
- Weixin ilink
- WPS collaboration
- MAX webhook
- Custom Bridge adapter

Only Feishu/Lark and Dashboard local chat have first-class SCALE runtime wiring today. Other channels are represented as productized configuration targets so the workflow can be expanded without changing the user-facing mental model.

## Bridge Contract

Bridge adapters are managed through REST runtime endpoints today. WebSocket streaming is the next runtime layer and keeps the same endpoint contract:

```text
ws://<host>:<port>/bridge/ws?token=<secret>
```

Session keys use:

```text
{platform}:{scope}:{user}
```

Inbound message types:

```text
register, message, card_action, preview_ack, ping
```

Outbound message types:

```text
register_ack, reply, reply_stream, preview_start, update_message, delete_message, card, buttons, typing_start, typing_stop, audio, image, file, pong, error
```

Bridge REST session endpoints:

```text
GET /bridge/sessions
POST /bridge/sessions
POST /bridge/events
GET /bridge/sessions/{id}
GET /bridge/sessions/{id}/events
DELETE /bridge/sessions/{id}
POST /bridge/sessions/switch
POST /agent-connect/webhook
```

`POST /bridge/sessions` creates a project-scoped bridge binding and mirrors the selected `agentPlatformId` / `agentSessionId` into Agent Control, so external adapters, the visual dashboard, and CLI runtimes operate on the same session queue.

`POST /bridge/events` is the adapter ingress endpoint. Send `register` to create or refresh a bridge session, `message` to enqueue a real Agent Control prompt, and `ping` for health checks. Incoming payload secrets are redacted before event evidence is stored under `.scale/agents/bridge-events.jsonl`.

`GET /bridge/sessions/{id}/events?cursor=<timestamp>` is the adapter polling endpoint. It projects Agent Control transcript records into outbound bridge events: operator prompts become `preview_start`, and agent replies become `reply`.

`POST /agent-connect/webhook` is the generic message-channel webhook ingress. Feishu CLI or other channel adapters can post normalized `{ platform, agentPlatformId, agentSessionId, senderId, text, dryRun }` payloads here after dashboard Agent Connect webhook is enabled. The endpoint creates or refreshes the matching bridge session and queues the text into Agent Control.

## Management API Contract

The management API is token-protected and intended for Web, TUI, desktop tray, mobile, or remote-control clients.

Core endpoints surfaced in the dashboard:

```text
GET /api/v1/status
POST /api/v1/reload
POST /api/v1/restart
GET /api/v1/config
GET /api/v1/projects
GET /api/v1/projects/{name}/sessions
POST /api/v1/projects/{name}/send
GET /api/v1/projects/{name}/providers
POST /api/v1/projects/{name}/model
GET /api/v1/cron
POST /api/v1/cron/{id}/exec
GET /api/v1/bridge/adapters
```

These endpoints are implemented by the dashboard service and reuse the same project state as the visual panel:

- `GET /api/v1/status` reports dashboard service health, Agent Control queue counts, Agent Connect readiness, Bridge session count, and token configuration status.
- `GET /api/v1/projects/{name}/sessions` returns Agent Control sessions for the project.
- `POST /api/v1/projects/{name}/send` queues a real Agent Control message.
- `POST /api/v1/projects/{name}/model` updates or creates a project-scoped Agent Control session.
- `GET /api/v1/projects/{name}/providers` returns integration providers, channel catalog, agent platforms, and model options.
- `GET /api/v1/cron` and `POST /api/v1/cron/{id}/exec` expose the configured loop triggers.
- `GET /api/v1/bridge/adapters` returns the allowed Bridge adapter catalog.

Token fields remain masked in project config. The local dashboard runtime can confirm that tokens are configured, but it does not persist plaintext secrets.

## Required Default Capabilities

Agents should not silently downgrade to a weak workflow. Full setup must verify:

- `gbrain-memory`: default local memory provider;
- `find-skills`: discovery and installation of missing third-party capabilities;
- `hookify-rules`: permission, completion, summary, and watchdog hooks;
- `configure-notifications`: mobile/desktop notification routing;
- `feishu-card`: rich approval and status cards;
- `feishu-doc-reader`: external document and wiki context.

Use this verification baseline:

```bash
scale setup --verify --pack full --json
scale memory provider status --json
scale dashboard daemon status --dir . --json
curl http://127.0.0.1:3210/api/integrations
curl http://127.0.0.1:3210/api/agent-control
```

## Agent Runtime Loop

Agent runtimes consume work through Agent Control:

```bash
scale agent-control inbox --session <session-id> --claim-first --agent-id <agent-id> --json
scale agent-control reply --session <session-id> --message <message-id> --text "<result>" --agent-id <agent-id> --json
```

Agent Control also keeps project-scoped conversation history, search, and summary cards:

```bash
scale agent-control transcript --session <session-id> --json
scale agent-control search --query "release risk" --session <session-id> --json
scale agent-control summary --session <session-id> --json
```

Equivalent dashboard APIs:

```text
GET /api/agent-control/sessions/<session-id>/transcript
GET /api/agent-control/transcripts?query=<text>&sessionId=<session-id>
POST /api/agent-control/sessions/<session-id>/summary
```

The visual Agent workspace at `/#agents` uses the same APIs. The left rail selects the project-scoped agent session, the center panel switches between chat, history, summary, and setup, and the right inspector controls model, platform, message channel, Feishu route health, and the resident dashboard watchdog. Summary cards are written to `.scale/agents/summaries/<session-id>.json` and can be imported into the Knowledge page so long agent conversations become searchable project memory instead of disappearing into raw chat logs.

Use Feishu/Lark only after route dry-run and target confirmation:

```bash
lark-cli doctor
lark-cli im +messages-send --chat-id <oc_xxx> --text "SCALE route probe" --dry-run
```

## Loop Defaults

The Integrations panel exposes these loop patterns:

- permission request push;
- long task completion push;
- context summary card;
- cron prompt/command loop;
- heartbeat awareness loop;
- dashboard daemon watchdog.

Write-capable loops must stay dry-run until the approval path, rollback path, and evidence path are reviewed.
