// SCALE Engine — Codex CLI Adapter (W11)
// 生成 .codex/config.toml + .codex/hooks.json + AGENTS.md

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson } from './ClaudeCodeAdapter.js'
import { renderAgentFullWorkflowGuidance } from './AgentKnowledgeDoc.js'

// ============================================================================
// Codex CLI Adapter
// ============================================================================

export class CodexAdapter implements IAgentAdapter {
  readonly agentType = 'codex'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(this.projectDir, '.codex', 'hooks.json')
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, 'AGENTS.md')
  }

  getSkillsDir(): string {
    // Codex skills are global (homedir)
    return join(homedir(), '.omx', 'skills')
  }

  isInstalled(): boolean {
    return existsSync(this.getSettingsPath())
  }

  generateSettings(): SettingsJson {
    // Codex hooks.json format
    return {
      hooks: {
        'pre-exec': [
          { matcher: '', command: 'scale gate pre-tool Bash --args-json "$ARGS" --session-id "$SESSION_ID"' },
        ],
        'post-exec': [
          { matcher: '', command: 'scale gate post-tool Bash --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
        ],
      },
    }
  }

  generateCodexConfig(): string {
    return `# SCALE Engine — Codex CLI config
# See: https://github.com/openai/codex

[model]
default = "o4-mini"

[approval]
# SCALE hooks handle safety gates
auto_approve = ["scale *"]

[environment]
SCALE_AGENT = "codex"
`
  }

  mergeSettings(existing: SettingsJson): SettingsJson {
    const generated = this.generateSettings()
    const merged: SettingsJson = { ...existing }
    if (!merged.hooks) merged.hooks = {}

    for (const [hookType, entries] of Object.entries(generated.hooks!)) {
      if (!merged.hooks[hookType]) merged.hooks[hookType] = []
      for (const entry of entries) {
        const alreadyExists = merged.hooks[hookType].some((e) => e.command.includes('scale '))
        if (!alreadyExists) {
          merged.hooks[hookType].push(entry)
        }
      }
    }
    return merged
  }

  generateKnowledgeDoc(projectName: string, techStack: string[] = []): string {
    const stackLine = techStack.length > 0
      ? `\n## Tech Stack\n${techStack.map((t) => `- ${t}`).join('\n')}\n`
      : ''

    return `# ${projectName}
${stackLine}
## SCALE Engine Integration

This project uses SCALE Engine for AI engineering governance.

### Workflow
1. Explore → Plan → Implement → Verify → Learn
2. All tool calls pass through SCALE gates
3. Dangerous commands are physically blocked
4. Tests must pass before completion

${renderAgentFullWorkflowGuidance()}
### Commands
- \`scale create <type> <title>\` — Create artifact
- \`scale transition <id> <action>\` — State transition
- \`scale doctor\` — Health check
`
  }

  async init(config: AdapterConfig): Promise<InitResult> {
    this.projectDir = config.projectDir
    this.scaleDir = config.scaleDir ?? join(config.projectDir, '.scale')
    const created: string[] = []
    const skipped: string[] = []

    // 1. Create .scale/ structure
    for (const dir of ['events', 'artifacts', 'rules', 'hooks', 'checkpoints']) {
      const fullDir = join(this.scaleDir, dir)
      if (!existsSync(fullDir)) {
        mkdirSync(fullDir, { recursive: true })
        created.push(fullDir)
      } else {
        skipped.push(fullDir)
      }
    }

    // 2. Create .codex/ directory
    const codexDir = join(this.projectDir, '.codex')
    mkdirSync(codexDir, { recursive: true })

    // 3. Create/merge hooks.json
    const hooksPath = this.getSettingsPath()
    if (existsSync(hooksPath)) {
      const existing = JSON.parse(readFileSync(hooksPath, 'utf-8'))
      const merged = this.mergeSettings(existing)
      writeFileSync(hooksPath, JSON.stringify(merged, null, 2), 'utf-8')
      skipped.push(hooksPath + ' (merged)')
    } else {
      writeFileSync(hooksPath, JSON.stringify(this.generateSettings(), null, 2), 'utf-8')
      created.push(hooksPath)
    }

    // 4. Create config.toml
    const configPath = join(codexDir, 'config.toml')
    if (!existsSync(configPath)) {
      writeFileSync(configPath, this.generateCodexConfig(), 'utf-8')
      created.push(configPath)
    } else {
      skipped.push(configPath)
    }

    // 5. Create AGENTS.md
    const agentsPath = this.getKnowledgeDocPath()
    if (!existsSync(agentsPath)) {
      const projectName = config.projectDir.split(/[/\\]/).pop() ?? 'Project'
      writeFileSync(agentsPath, this.generateKnowledgeDoc(projectName), 'utf-8')
      created.push(agentsPath)
    } else {
      skipped.push(agentsPath)
    }

    // 6. .gitignore
    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `*.db\n*.db-journal\nevents/\ncheckpoints/\nevidence/\nstate/\nhooks/*.sh\n`, 'utf-8')
      created.push(gitignorePath)
    }

    return {
      settingsPath: hooksPath,
      knowledgeDocPath: agentsPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
