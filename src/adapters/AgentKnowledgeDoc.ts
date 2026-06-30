export function renderAgentFullWorkflowGuidance(): string {
  return `### Agent Full Workflow Bootstrap
- Treat SCALE as an agent-facing operating workflow. Do not ask the user to run a long manual checklist when you can inspect and report the exact next command.
- At session start, verify the full capability surface before coding:
  1. \`scale --version\` or \`npx -y @hongmaple0820/scale-engine@latest --version\`
  2. \`scale setup --verify --pack full --dir . --json\`
  3. \`scale memory provider status --dir . --json\`
  4. \`scale codegraph status --dir . --json\`
- If SCALE or a required third-party capability is missing, propose and, when the user allows installation, run:
  \`npx -y @hongmaple0820/scale-engine@latest setup --pack full --memory-provider hrain --memory-mode local-only --apply --yes --dir .\`
- Default third-party expectations for the full workflow are: rtk for shell execution, hrain for local memory, optional gbrain for graph memory, CodeGraph for code structure, Graphify for knowledge graph artifacts, and browser/E2E tooling when the task touches UI or web flows.
- Do not silently downgrade to a no-memory or no-knowledge workflow. If hrain, CodeGraph, or Graphify is unavailable, mark it as blocked or degraded in the plan and include the exact setup command.
- Use the governed loop for real work: define -> plan -> build -> verify -> review -> ship. Record command evidence and never claim tests, browser checks, package checks, Feishu delivery, or release verification passed without actual output.
- For Feishu notifications, generate dry-run message plans first and only send live messages after the target chat/user is confirmed.
`
}
