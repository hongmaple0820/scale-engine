// SCALE Engine — Windsurf Adapter
// 生成 .windsurf/settings.json + .windsurf/rules.md + .windsurf/skills/
// Windsurf: AI-first code editor (https://codeium.com/windsurf)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson, HookEntry } from './ClaudeCodeAdapter.js'

// ============================================================================
// Windsurf Adapter
// ============================================================================

export class WindsurfAdapter implements IAgentAdapter {
  readonly agentType = 'windsurf'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(this.projectDir, '.windsurf', 'settings.json')
  }

  getKnowledgeDocPath(): string {
    // Windsurf uses .windsurf/rules.md for AI instructions (similar to .cursorrules)
    return join(this.projectDir, '.windsurf', 'rules.md')
  }

  getSkillsDir(): string {
    return join(this.projectDir, '.windsurf', 'skills')
  }

  isInstalled(): boolean {
    return existsSync(join(this.projectDir, '.windsurf')) ||
           existsSync(join(this.projectDir, '.windsurfrc'))
  }

  generateSettings(): SettingsJson {
    return {
      hooks: {
        'pre-exec': [
          { matcher: 'Bash', command: 'scale gate pre-tool Bash --args-json "$ARGS" --session-id "$SESSION_ID"' },
          { matcher: 'Edit|Write', command: 'scale gate pre-tool Edit --args-json "$ARGS" --session-id "$SESSION_ID"' },
        ],
        'post-exec': [
          { matcher: 'Edit|Write', command: 'scale gate post-tool Edit --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
          { matcher: 'Bash', command: 'scale gate post-tool Bash --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' },
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

  generateKnowledgeDoc(projectName: string, techStack: string[] = []): string {
    const stackLine = techStack.length > 0
      ? `\n## Tech Stack\n${techStack.map((t) => `- ${t}`).join('\n')}\n`
      : ''

    return `# ${projectName}
${stackLine}
## SCALE Engine Integration (Windsurf)

This project uses SCALE Engine for AI engineering governance via Windsurf.

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

### Windsurf-Specific Notes
- Windsurf uses Cascade Flow for multi-file editing
- Use Chat mode for quick questions, Cascade for complex tasks
- This rules.md file provides AI assistant context
- SCALE hooks are defined in \`.windsurf/settings.json\`
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

    // 2. Create .windsurf/ directory + settings.json
    const windsurfDir = join(this.projectDir, '.windsurf')
    if (!existsSync(windsurfDir)) {
      mkdirSync(windsurfDir, { recursive: true })
      created.push(windsurfDir)
    } else {
      skipped.push(windsurfDir)
    }

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

    // 3. Create skills directory
    const skillsDir = this.getSkillsDir()
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true })
      created.push(skillsDir)
    } else {
      skipped.push(skillsDir)
    }

    // 4. Create .windsurf/rules.md (knowledge document)
    const knowledgeDocPath = this.getKnowledgeDocPath()
    if (!existsSync(knowledgeDocPath)) {
      const projectName = config.projectDir.split(/[/\\]/).pop() ?? 'Project'
      writeFileSync(knowledgeDocPath, this.generateKnowledgeDoc(projectName), 'utf-8')
      created.push(knowledgeDocPath)
    } else {
      skipped.push(knowledgeDocPath)
    }

    // 5. .gitignore
    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `*.db\n*.db-journal\nevents/\ncheckpoints/\nevidence/\nstate/\nhooks/*.sh\n`, 'utf-8')
      created.push(gitignorePath)
    }

    logger.info({ created: created.length, skipped: skipped.length }, 'SCALE init (windsurf) completed')

    return {
      settingsPath,
      knowledgeDocPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
