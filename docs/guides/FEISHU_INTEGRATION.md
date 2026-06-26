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
