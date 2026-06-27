// SCALE Engine — OpenCode Adapter
// 生成 ~/.config/opencode/hooks.json + AGENTS.md + skills/
// OpenCode: https://github.com/opencode-ai/opencode

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { logger } from '../core/logger.js'
import { renderAgentFullWorkflowGuidance } from './AgentKnowledgeDoc.js'
import type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson } from './ClaudeCodeAdapter.js'

// ============================================================================
// OpenCode Adapter
// ============================================================================

export class OpenCodeAdapter implements IAgentAdapter {
  readonly agentType = 'opencode'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(homedir(), '.config', 'opencode', 'hooks.json')
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, 'AGENTS.md')
  }

  getSkillsDir(): string {
    return join(homedir(), '.config', 'opencode', 'skills')
  }

  isInstalled(): boolean {
    return existsSync(join(homedir(), '.config', 'opencode'))
  }

  generateSettings(): SettingsJson {
    return {
      hooks: {
        'pre-exec': [
          { matcher: '', command: 'scale gate pre-tool Bash --args-json "$ARGS" --session-id "$SESSION_ID"' },
          { matcher: 'edit|write', command: 'scale gate pre-tool Edit --args-json "$ARGS" --session-id "$SESSION_ID"' },
        ],
        'post-exec': [
          { matcher: 'edit|write', command: 'scale gate post-tool Edit --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
          { matcher: '', command: 'scale gate post-tool Bash --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
        ],
        'before-stop': [
          { matcher: '', command: 'scale gate before-stop --session-id "$SESSION_ID" --hook-safe' },
        ],
      },
      permissions: {
        allow: ['scale:*'],
      },
    }
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
    if (!merged.permissions) merged.permissions = {}
    if (!merged.permissions.allow) merged.permissions.allow = []
    for (const perm of generated.permissions!.allow!) {
      if (!merged.permissions.allow.includes(perm)) {
        merged.permissions.allow.push(perm)
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
## SCALE Engine Integration (OpenCode)

This project uses SCALE Engine for AI engineering governance via OpenCode.

### Commands
- \`scale create <type> <title>\` — Create artifact
- \`scale transition <id> <action>\` — Transition artifact state
- \`scale list --type Spec\` — List artifacts
- \`scale role activate <role>\` — Switch role
- \`scale doctor\` — Health check

### Workflow
1. **Explore** → Role: explorer (Read/Grep only)
2. **Plan** → Create Spec → refine → approve (guard: ambiguity ≤ 0.2)
3. **Implement** → Role: implementer (Edit/Write/Bash unlocked)
4. **Verify** → Must run tests before claiming done
5. **Learn** → Defects → Lessons → Rules → Hooks

${renderAgentFullWorkflowGuidance()}

### Rules
- 🔴 Dangerous commands are physically blocked
- 🔴 Hardcoded secrets are blocked on Edit/Write
- 🟡 3 identical retries triggers brute-retry detection
- 🟡 Claiming done without running tests is blocked
- 🟢 All tool calls are tracked in .scale/events/
`
  }

  async init(config: AdapterConfig): Promise<InitResult> {
    this.projectDir = config.projectDir
    this.scaleDir = config.scaleDir ?? join(config.projectDir, '.scale')
    const created: string[] = []
    const skipped: string[] = []

    // 1. Create .scale/ directory structure
    for (const dir of ['events', 'artifacts', 'rules', 'hooks', 'checkpoints']) {
      const fullDir = join(this.scaleDir, dir)
      if (!existsSync(fullDir)) {
        mkdirSync(fullDir, { recursive: true })
        created.push(fullDir)
      } else {
        skipped.push(fullDir)
      }
    }

    // 2. Create ~/.config/opencode/ directory + hooks.json
    const opencodeDir = join(homedir(), '.config', 'opencode')
    mkdirSync(opencodeDir, { recursive: true })

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

    // 3. Create skills directory
    const skillsDir = this.getSkillsDir()
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true })
      created.push(skillsDir)
    } else {
      skipped.push(skillsDir)
    }

    // 4. Create AGENTS.md
    const agentsPath = this.getKnowledgeDocPath()
    if (!existsSync(agentsPath)) {
      const projectName = config.projectDir.split(/[/\\]/).pop() ?? 'Project'
      writeFileSync(agentsPath, this.generateKnowledgeDoc(projectName), 'utf-8')
      created.push(agentsPath)
    } else {
      skipped.push(agentsPath)
    }

    // 5. .gitignore
    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `*.db\n*.db-journal\nevents/\ncheckpoints/\nevidence/\nstate/\nhooks/*.sh\n`, 'utf-8')
      created.push(gitignorePath)
    }

    logger.info({ created: created.length, skipped: skipped.length }, 'SCALE init (opencode) completed')

    return {
      settingsPath: hooksPath,
      knowledgeDocPath: agentsPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
