// SCALE Engine — Claude Code Adapter (W8)
// 生成/合并 .claude/settings.json + CLAUDE.md
// 设计参考：docs/01-ARCHITECTURE.md 原则4 Headless优先

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { logger } from '../core/logger.js'
import type { AgentPlatform } from '../artifact/types.js'
import { renderAgentFullWorkflowGuidance } from './AgentKnowledgeDoc.js'

// ============================================================================
// Types
// ============================================================================

export interface AdapterConfig {
  projectDir: string
  scaleDir?: string
  agentType?: AgentPlatform
  scenarioMode?: 'sandbox' | 'standard' | 'critical'
  thresholdsPath?: string
}

export interface HookEntry {
  matcher: string
  command: string
  timeout?: number
  type?: string
  hooks?: HookEntry[]
}

export interface SettingsJson {
  hooks?: Record<string, HookEntry[]>
  permissions?: { allow?: string[]; deny?: string[] }
  mcpServers?: Record<string, unknown>
}

// ============================================================================
// Adapter Interface
// ============================================================================

export interface IAgentAdapter {
  readonly agentType: string
  init(config: AdapterConfig): Promise<InitResult>
  getSettingsPath(): string
  getKnowledgeDocPath(): string
  getSkillsDir(): string
  generateSettings(): SettingsJson
  generateKnowledgeDoc(projectName: string, techStack?: string[]): string
  mergeSettings(existing: SettingsJson): SettingsJson
  isInstalled(): boolean
}

export interface InitResult {
  settingsPath: string
  knowledgeDocPath: string
  scaleDir: string
  created: string[]
  skipped: string[]
}

// ============================================================================
// Claude Code Adapter
// ============================================================================

export class ClaudeCodeAdapter implements IAgentAdapter {
  readonly agentType = 'claude-code'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(this.projectDir, '.claude', 'settings.json')
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, 'CLAUDE.md')
  }

  getSkillsDir(): string {
    // Claude Code skills are global (homedir)
    return join(homedir(), '.claude', 'skills')
  }

  isInstalled(): boolean {
    return existsSync(this.getSettingsPath())
  }

  generateSettings(): SettingsJson {
    return {
      hooks: {
        SessionStart: [
          { matcher: '', command: 'scale context inject --session-id $CLAUDE_SESSION_ID' },
        ],
        PreToolUse: [
          { matcher: 'Bash', command: 'scale gate pre-tool Bash --args-json $TOOL_INPUT_JSON --session-id $CLAUDE_SESSION_ID' },
          { matcher: 'Edit|Write|MultiEdit', command: 'scale gate pre-tool Edit --args-json $TOOL_INPUT_JSON --session-id $CLAUDE_SESSION_ID' },
        ],
        PostToolUse: [
          { matcher: 'Edit|Write|MultiEdit', command: 'scale gate post-tool Edit --args-json $TOOL_INPUT_JSON --output-json $TOOL_OUTPUT_JSON --session-id $CLAUDE_SESSION_ID' },
          { matcher: 'Bash', command: 'scale gate post-tool Bash --args-json $TOOL_INPUT_JSON --exit-code $TOOL_EXIT_CODE --session-id $CLAUDE_SESSION_ID' },
        ],
        Stop: [
          { matcher: '', command: 'scale gate before-stop --session-id $CLAUDE_SESSION_ID --hook-safe' },
        ],
        SessionEnd: [
          { matcher: '', command: 'scale session end --session-id $CLAUDE_SESSION_ID' },
        ],
      },
      permissions: {
        allow: ['Bash(scale:*)'],
      },
    }
  }

  mergeSettings(existing: SettingsJson): SettingsJson {
    const generated = this.generateSettings()
    const merged: SettingsJson = { ...existing }

    // Merge hooks — add SCALE hooks without overwriting existing
    if (!merged.hooks) merged.hooks = {}
    for (const [hookType, entries] of Object.entries(generated.hooks!)) {
      if (!merged.hooks[hookType]) merged.hooks[hookType] = []
      for (const entry of entries) {
        const alreadyExists = merged.hooks[hookType].some(
          (e) => e.command.includes('scale '),
        )
        if (!alreadyExists) {
          merged.hooks[hookType].push(entry)
        }
      }
    }

    // Merge permissions
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
## SCALE Engine Integration

This project uses SCALE Engine for AI engineering governance.

### Commands
- \`scale create <type> <title>\` — Create artifact (Spec/Plan/Task/...)
- \`scale transition <id> <action>\` — Transition artifact state
- \`scale list --type Spec\` — List artifacts
- \`scale role activate <role>\` — Switch role (explorer/planner/implementer/reviewer)
- \`scale stats\` — Show engine stats

### Workflow
1. **Explore** → Role: explorer (Read/Grep only)
2. **Plan** → Create Spec → refine → approve (guard: ambiguity ≤ 0.2)
3. **Implement** → Role: implementer (Edit/Write/Bash unlocked)
4. **Verify** → Must run tests before claiming done (Stop gate enforced)
5. **Learn** → Defects auto-extract to lessons → rules → hooks

${renderAgentFullWorkflowGuidance()}
### Rules
- 🔴 Dangerous commands (rm -rf, DROP TABLE) are physically blocked
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

    // 2. Create/merge .claude/settings.json
    const settingsPath = this.getSettingsPath()
    const claudeDir = join(this.projectDir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    if (existsSync(settingsPath)) {
      const existing = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      const merged = this.mergeSettings(existing)
      writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8')
      skipped.push(settingsPath + ' (merged)')
    } else {
      const settings = this.generateSettings()
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
      created.push(settingsPath)
    }

    // 3. Create CLAUDE.md if not exists
    const knowledgeDocPath = this.getKnowledgeDocPath()
    if (!existsSync(knowledgeDocPath)) {
      const projectName = config.projectDir.split(/[/\\]/).pop() ?? 'Project'
      const content = this.generateKnowledgeDoc(projectName)
      writeFileSync(knowledgeDocPath, content, 'utf-8')
      created.push(knowledgeDocPath)
    } else {
      skipped.push(knowledgeDocPath)
    }

    // 4. Create .gitignore for .scale/
    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `# SCALE Engine runtime data
*.db
*.db-journal
events/
checkpoints/
evidence/
state/
hooks/*.sh
`, 'utf-8')
      created.push(gitignorePath)
    }

    logger.info({ created: created.length, skipped: skipped.length }, 'SCALE init completed')

    return {
      settingsPath,
      knowledgeDocPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}

// ============================================================================
// Adapter Factory — moved to ./index.ts
// ============================================================================
