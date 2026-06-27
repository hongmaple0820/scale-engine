// SCALE Engine — Aider Adapter
// 生成 .aider.conf.yml + AIDER.md
// Aider: 开源 AI 编码 CLI (https://github.com/Aider-AI/aider)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import { renderAgentFullWorkflowGuidance } from './AgentKnowledgeDoc.js'
import type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson, HookEntry } from './ClaudeCodeAdapter.js'

// ============================================================================
// Aider Adapter
// ============================================================================

export class AiderAdapter implements IAgentAdapter {
  readonly agentType = 'aider'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(this.projectDir, '.aider.conf.yml')
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, 'AIDER.md')
  }

  getSkillsDir(): string {
    // Aider uses .aider/commands/ for custom commands
    return join(this.projectDir, '.aider', 'commands')
  }

  isInstalled(): boolean {
    return existsSync(join(this.projectDir, '.aider')) ||
           existsSync(this.getSettingsPath())
  }

  /**
   * Generate settings as JSON (interface requirement)
   * Aider uses YAML, so init() will convert this to YAML format
   */
  generateSettings(): SettingsJson {
    return {
      hooks: {
        'pre-tool-use': [
          { matcher: 'Bash', command: 'scale gate pre-tool Bash --args-json "$ARGS" --session-id "$SESSION_ID"' },
          { matcher: 'Editor|ApplyFix', command: 'scale gate pre-tool Edit --args-json "$ARGS" --session-id "$SESSION_ID"' },
          { matcher: 'Create', command: 'scale gate pre-tool Write --args-json "$ARGS" --session-id "$SESSION_ID"' },
        ],
        'post-tool-use': [
          { matcher: 'Editor|ApplyFix', command: 'scale gate post-tool Edit --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
          { matcher: 'Bash', command: 'scale gate post-tool Bash --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
          { matcher: 'Create', command: 'scale gate post-tool Write --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
        ],
        'exit': [
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
        const alreadyExists = merged.hooks[hookType]!.some((e: HookEntry) => e.command.includes('scale '))
        if (!alreadyExists) {
          merged.hooks[hookType]!.push(entry)
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

  /**
   * Convert SettingsJson to YAML format for Aider
   */
  private settingsToYaml(settings: SettingsJson): string {
    const lines: string[] = [
      '# Aider Configuration with SCALE Engine Integration',
      '# https://github.com/Aider-AI/aider',
      '',
    ]

    // Write hooks section
    if (settings.hooks) {
      for (const [hookType, entries] of Object.entries(settings.hooks)) {
        lines.push(`${hookType}:`)
        for (const entry of entries) {
          lines.push(`  - command: ${entry.command}`)
          if (entry.matcher) {
            lines.push(`    tools: ["${entry.matcher.replace(/\|/g, '", "')}"]`)
          }
        }
        lines.push('')
      }
    }

    // Write permissions section
    if (settings.permissions?.allow) {
      lines.push('# Allow SCALE commands without confirmation')
      lines.push('auto-commits: false')
      lines.push('dirty-commits: true')
      lines.push('')
    }

    // Write additional Aider-specific settings
    lines.push('# Model settings (can be overridden)')
    lines.push('model: auto')
    lines.push('')
    lines.push('# Read AIDER.md for project context')
    lines.push('read: AIDER.md')

    return lines.join('\n')
  }

  generateKnowledgeDoc(projectName: string, techStack: string[] = []): string {
    const stackLine = techStack.length > 0
      ? `\n## Tech Stack\n${techStack.map((t) => `- ${t}`).join('\n')}\n`
      : ''

    return `# ${projectName}
${stackLine}
## SCALE Engine Integration (Aider)

This project uses SCALE Engine for AI engineering governance via Aider CLI.

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

### Aider-Specific Notes
- Aider uses \`/add\` and \`/drop\` to manage context files
- Use \`/run\` for shell commands (SCALE hooks apply)
- Use \`/clear\` to reset context between phases
- SCALE hooks are defined in \`.aider.conf.yml\`

### Quick Reference
\`\`\`
# Start with exploration
> /add src/
> /read AIDER.md

# Plan phase
> scale create Spec "Feature name"

# Implement
> scale role activate implementer
> (make changes)

# Verify
> /run npm test

# Complete
> scale transition <id> approve
\`\`\`
`
  }

  async init(config: AdapterConfig): Promise<InitResult> {
    this.projectDir = config.projectDir
    this.scaleDir = config.scaleDir ?? join(config.projectDir, '.scale')
    const created: string[] = []
    const skipped: string[] = []

    // Create .scale subdirectories
    for (const dir of ['events', 'artifacts', 'rules', 'hooks', 'checkpoints']) {
      const fullDir = join(this.scaleDir, dir)
      if (!existsSync(fullDir)) {
        mkdirSync(fullDir, { recursive: true })
        created.push(fullDir)
      } else {
        skipped.push(fullDir)
      }
    }

    // Create .aider directory for commands
    const aiderDir = join(this.projectDir, '.aider', 'commands')
    if (!existsSync(aiderDir)) {
      mkdirSync(aiderDir, { recursive: true })
      created.push(aiderDir)
    } else {
      skipped.push(aiderDir)
    }

    // Create/merge .aider.conf.yml
    const settingsPath = this.getSettingsPath()
    if (existsSync(settingsPath)) {
      // Parse existing YAML (simple approach: check for SCALE hooks)
      const existingYaml = readFileSync(settingsPath, 'utf-8')
      if (existingYaml.includes('scale gate')) {
        skipped.push(settingsPath + ' (already integrated)')
      } else {
        // Merge: prepend SCALE hooks
        const generated = this.generateSettings()
        const yamlContent = this.settingsToYaml(generated)
        // Insert after header comments
        const existingLines = existingYaml.split('\n')
        let insertIndex = 0
        for (let i = 0; i < existingLines.length; i++) {
          if (existingLines[i].startsWith('#') || existingLines[i].trim() === '') {
            insertIndex = i + 1
          } else {
            break
          }
        }
        const merged = existingLines.slice(0, insertIndex).join('\n') + '\n' + yamlContent + '\n' + existingLines.slice(insertIndex).join('\n')
        writeFileSync(settingsPath, merged.trimStart(), 'utf-8')
        skipped.push(settingsPath + ' (merged)')
      }
    } else {
      const generated = this.generateSettings()
      const yamlContent = this.settingsToYaml(generated)
      writeFileSync(settingsPath, yamlContent, 'utf-8')
      created.push(settingsPath)
    }

    // Create AIDER.md knowledge doc
    const knowledgeDocPath = this.getKnowledgeDocPath()
    if (!existsSync(knowledgeDocPath)) {
      const projectName = config.projectDir.split(/[/\\]/).pop() ?? 'Project'
      writeFileSync(knowledgeDocPath, this.generateKnowledgeDoc(projectName), 'utf-8')
      created.push(knowledgeDocPath)
    } else {
      skipped.push(knowledgeDocPath)
    }

    // Create .scale/.gitignore
    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `*.db\n*.db-journal\nevents/\ncheckpoints/\nevidence/\nstate/\nhooks/*.sh\n`, 'utf-8')
      created.push(gitignorePath)
    }

    logger.info({ created: created.length, skipped: skipped.length }, 'SCALE init (aider) completed')

    return {
      settingsPath,
      knowledgeDocPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
