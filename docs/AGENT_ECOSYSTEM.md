# Agent Ecosystem Workflow

This repository now treats common agent platforms as a routed ecosystem instead of isolated CLIs.

## ACP Collaboration

`scale agent acp-plan` creates an ACP-first collaboration plan:

```bash
scale agent acp-plan --task "refactor auth flow" --platforms codex,claude-code,gemini-cli
```

The plan separates three cases:

- ACP candidates: platforms that can be launched through a compatible local ACP provider when installed.
- SCALE adapter fallback: platforms already covered by local adapters but not declared as ACP-ready.
- External-only handoff: tools that need a custom bridge or manual handoff.

Required gates:

- ACP or adapter availability is checked before execution.
- Agent briefs are normalized before handoff.
- Handoff artifacts and verification evidence are recorded.
- External-only tools declare a fallback path.

## External Agent Catalog

`scale agent catalog` registers the external role library without changing the built-in profile set.

```bash
scale agent catalog --catalog agency-agents-zh --mode convert-to-yaml
```

The built-in catalog records:

- `agency-agents-zh`: 215 claimed agents, 18 departments, 17 tool integrations, MIT license.
- Upstream: `msitarzewski/agency-agents`.
- Default import target: `.scale/agents/external/agency-agents-zh`.

The default mode is `convert-to-yaml`: selected external roles should be converted to SCALE YAML definitions and validated by `AgentSourceLoader`. This avoids silently turning all 215 external roles into default runtime agents.

## References

- [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)
- [agency-agents upstream](https://github.com/msitarzewski/agency-agents)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [AI SDK ACP provider](https://ai-sdk.dev/providers/community-providers/agent-client-protocol)
