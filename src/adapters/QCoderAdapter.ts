// SCALE Engine — QCoder (Qwen Code) Adapter
// 生成 .qwen/settings.json + QWEN.md
// Qwen Code: 阿里通义千问 CLI (https://github.com/QwenLM/qwen-code)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson } from './ClaudeCodeAdapter.js'

// ============================================================================
// QCoder Adapter
// ============================================================================

export class QCoderAdapter implements IAgentAdapter {
  readonly agentType = 'qcoder'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(this.projectDir, '.qwen', 'settings.json')
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, 'QWEN.md')
  }

  getSkillsDir(): string {
    // QCoder skills are project-level
    return join(this.projectDir, '.qwen', 'skills')
  }

  isInstalled(): boolean {
    return existsSync(join(this.projectDir, '.qwen'))
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
## SCALE Engine Integration (QCoder / Qwen Code)

This project uses SCALE Engine for AI engineering governance via Qwen Code CLI.

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

    for (const dir of ['events', 'artifacts', 'rules', 'hooks', 'checkpoints']) {
      const fullDir = join(this.scaleDir, dir)
      if (!existsSync(fullDir)) {
        mkdirSync(fullDir, { recursive: true })
        created.push(fullDir)
      } else {
        skipped.push(fullDir)
      }
    }

    const qwenDir = join(this.projectDir, '.qwen')
    mkdirSync(qwenDir, { recursive: true })

    const settingsPath = this.getSettingsPath()
    if (existsSync(settingsPath)) {
      const existing = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      const merged = this.mergeSettings(existing)
      writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8')
      skipped.push(settingsPath + ' (merged)')
    } else {
      writeFileSync(settingsPath, JSON.stringify(this.generateSettings(), null, 2), 'utf-8')
      created.push(settingsPath)
    }

    const knowledgeDocPath = this.getKnowledgeDocPath()
    if (!existsSync(knowledgeDocPath)) {
      const projectName = config.projectDir.split(/[/\\]/).pop() ?? 'Project'
      writeFileSync(knowledgeDocPath, this.generateKnowledgeDoc(projectName), 'utf-8')
      created.push(knowledgeDocPath)
    } else {
      skipped.push(knowledgeDocPath)
    }

    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `*.db\n*.db-journal\nevents/\ncheckpoints/\nevidence/\nstate/\nhooks/*.sh\n`, 'utf-8')
      created.push(gitignorePath)
    }

    logger.info({ created: created.length, skipped: skipped.length }, 'SCALE init (qcoder) completed')

    return {
      settingsPath,
      knowledgeDocPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
