# Agent Connect Prompt

Copy this into the active coding agent when the project needs remote coding, mobile control, message channels, or cc-connect-style Bridge integration.

```text
You are responsible for connecting this project to the full SCALE Agent OS workflow.

Do not silently downgrade to a minimal setup. Verify and report these capabilities first:

1. SCALE full setup:
   - npx -y @hongmaple0820/scale-engine@latest --version
   - npx -y @hongmaple0820/scale-engine@latest setup --verify --pack full --dir . --json

2. Required third-party capabilities:
   - gbrain memory: scale memory provider status --dir . --json
   - CodeGraph: scale codegraph status --dir . --json
   - Graphify knowledge graph when knowledge workflows are used
   - rtk for command execution
   - browser/E2E tooling for UI work
   - default skills: gbrain-memory, find-skills, hookify-rules, configure-notifications, feishu-card, feishu-doc-reader

3. Resident panel:
   - scale dashboard daemon ensure --dir . --port 3210 --json
   - check http://127.0.0.1:3210/api/health
   - check http://127.0.0.1:3210/api/dashboard/service

4. Agent Connect workflow:
   - open or query http://127.0.0.1:3210/#integrations
   - GET /api/integrations must include connectorWorkflow
   - Agent Connect must define Bridge, Management API, Webhook, Cron, Heartbeat, channel matrix, Provider presets, Skill presets, and daemon hooks
   - verify runtime control APIs:
     GET /api/v1/status
     GET /api/v1/projects
     GET /api/v1/bridge/adapters
     GET /bridge/sessions
     POST /bridge/events with type=register only when testing an adapter binding
     GET /bridge/sessions/<id>/events after an adapter has registered
     POST /agent-connect/webhook only when testing an external message-channel ingress
   - use POST /api/v1/projects/<project>/send only when the user explicitly wants a remote-control test message
   - token fields must be stored only as masked/configured markers in project config

5. Message routing:
   - Feishu/Lark route must be configured per agent platform, not globally for all platforms
   - verify routes for platforms such as codex, openclaw, and hermes when they are used
   - run lark-cli doctor before claiming message-channel readiness
   - keep lark-cli send plans dry-run until the target chat/user is confirmed
   - when bridging Feishu CLI into SCALE, normalize inbound events to:
     { platform: "feishu", agentPlatformId, agentSessionId, senderId, text, dryRun }
     and post them to /agent-connect/webhook only after webhook is enabled

6. Agent Control:
   - open http://127.0.0.1:3210/#agents
   - configure project session, agent platform, model, channel, and mode
   - agent runtime should use:
     scale agent-control inbox --session <session-id> --claim-first --agent-id <agent-id> --json
     scale agent-control reply --session <session-id> --message <message-id> --text "<result>" --agent-id <agent-id> --json
   - after meaningful work, preserve and review conversation history:
     scale agent-control transcript --session <session-id> --json
     scale agent-control search --query "<keyword>" --session <session-id> --json
     scale agent-control summary --session <session-id> --json
   - import useful summary cards into the knowledge base through the Agent Control Summary tab when the panel is available

If anything is missing, mark it degraded/blocker and give the next executable command. Do not say the full workflow is complete until setup, memory, dashboard daemon, integrations, Agent Connect, Agent Control, conversation history, summary cards, and message dry-run evidence are all checked.
```

For implementation details, see [Agent Connect Workflow](../guides/AGENT_CONNECT_WORKFLOW.md).
