// SCALE Engine - Generic project-level agent adapter
// Used for platforms that accept project-local rule files and optional JSON settings.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger } from '../core/logger.js'
import type { AgentPlatform } from '../artifact/types.js'
import type { AdapterConfig, HookEntry, IAgentAdapter, InitResult, SettingsJson } from './ClaudeCodeAdapter.js'

export type SettingsShape = 'scale-hooks' | 'qoder-hooks'

export interface GenericProjectAgentOptions {
  agentType: AgentPlatform
  displayName: string
  settingsPath: string
  knowledgeDocPath: string
  skillsDir: string
  installedPaths?: string[]
  extraDirs?: string[]
  settingsShape?: SettingsShape
  notes?: string[]
}

function hasScaleCommand(entry: HookEntry): boolean {
  if (entry.command?.includes('scale ')) return true
  return entry.hooks?.some(hasScaleCommand) ?? false
}

export class GenericProjectAgentAdapter implements IAgentAdapter {
  readonly agentType: AgentPlatform
  protected projectDir: string = '.'
  protected scaleDir: string = '.scale'
  protected readonly options: GenericProjectAgentOptions

  constructor(options: GenericProjectAgentOptions) {
    this.options = options
    this.agentType = options.agentType
  }

  getSettingsPath(): string {
    return join(this.projectDir, this.options.settingsPath)
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, this.options.knowledgeDocPath)
  }

  getSkillsDir(): string {
    return join(this.projectDir, this.options.skillsDir)
  }

  isInstalled(): boolean {
    const paths = this.options.installedPaths ?? [this.options.settingsPath]
    return paths.some(path => existsSync(join(this.projectDir, path)))
  }

  generateSettings(): SettingsJson {
    if (this.options.settingsShape === 'qoder-hooks') {
      return {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              command: '',
              hooks: [{ matcher: '', type: 'command', command: 'scale gate pre-tool Bash --args-json "$ARGS" --session-id "$SESSION_ID"' }],
            },
            {
              matcher: 'Edit|Write',
              command: '',
              hooks: [{ matcher: '', type: 'command', command: 'scale gate pre-tool Edit --args-json "$ARGS" --session-id "$SESSION_ID"' }],
            },
          ],
          PostToolUse: [
            {
              matcher: 'Edit|Write',
              command: '',
              hooks: [{ matcher: '', type: 'command', command: 'scale gate post-tool Edit --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' }],
            },
            {
              matcher: 'Bash',
              command: '',
              hooks: [{ matcher: '', type: 'command', command: 'scale gate post-tool Bash --args-json "$ARGS" --exit-code "$EXIT_CODE" --session-id "$SESSION_ID"' }],
            },
          ],
          Stop: [
            {
              matcher: '',
              command: '',
              hooks: [{ matcher: '', type: 'command', command: 'scale gate before-stop --session-id "$SESSION_ID" --hook-safe' }],
            },
          ],
        },
        permissions: { allow: ['scale:*'] },
      }
    }

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
      permissions: { allow: ['scale:*'] },
    }
  }

  mergeSettings(existing: SettingsJson): SettingsJson {
    const generated = this.generateSettings()
    const merged: SettingsJson = { ...existing }

    if (!merged.hooks) merged.hooks = {}
    for (const [hookType, entries] of Object.entries(generated.hooks ?? {})) {
      if (!merged.hooks[hookType]) merged.hooks[hookType] = []
      const alreadyExists = merged.hooks[hookType].some(hasScaleCommand)
      if (!alreadyExists) merged.hooks[hookType].push(...entries)
    }

    if (!merged.permissions) merged.permissions = {}
    if (!merged.permissions.allow) merged.permissions.allow = []
    for (const permission of generated.permissions?.allow ?? []) {
      if (!merged.permissions.allow.includes(permission)) merged.permissions.allow.push(permission)
    }

    return merged
  }

  generateKnowledgeDoc(projectName: string, techStack: string[] = []): string {
    const stackLine = techStack.length > 0
      ? `\n## Tech Stack\n${techStack.map(t => `- ${t}`).join('\n')}\n`
      : ''
    const notes = this.options.notes?.length
      ? `\n### ${this.options.displayName}-Specific Notes\n${this.options.notes.map(note => `- ${note}`).join('\n')}\n`
      : ''

    return `# ${projectName}
${stackLine}
## SCALE Engine Integration (${this.options.displayName})

This project uses SCALE Engine for AI engineering governance via ${this.options.displayName}.

### Commands
- \`scale create <type> <title>\` - Create artifact
- \`scale transition <id> <action>\` - Transition artifact state
- \`scale list --type Spec\` - List artifacts
- \`scale role activate <role>\` - Switch role
- \`scale doctor\` - Health check

### Workflow
1. Explore - Role: explorer (Read/Grep only)
2. Plan - Create Spec, refine, approve
3. Implement - Role: implementer
4. Verify - Must run tests before claiming done
5. Learn - Defects become lessons, rules, and hooks

### Rules
- Dangerous commands are blocked through SCALE gates where the platform supports executable hooks.
- Hardcoded secrets must be rejected before edits are committed.
- Repeated retries should be treated as diagnostic evidence, not brute force.
- Claims of completion require verification evidence.
- Runtime evidence is tracked under .scale/.
${notes}`
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

    const settingsPath = this.getSettingsPath()
    mkdirSync(dirname(settingsPath), { recursive: true })
    if (existsSync(settingsPath)) {
      const existing = JSON.parse(readFileSync(settingsPath, 'utf-8')) as SettingsJson
      writeFileSync(settingsPath, JSON.stringify(this.mergeSettings(existing), null, 2), 'utf-8')
      skipped.push(`${settingsPath} (merged)`)
    } else {
      writeFileSync(settingsPath, JSON.stringify(this.generateSettings(), null, 2), 'utf-8')
      created.push(settingsPath)
    }

    for (const dir of [this.getSkillsDir(), ...(this.options.extraDirs ?? []).map(dir => join(this.projectDir, dir))]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
        created.push(dir)
      } else {
        skipped.push(dir)
      }
    }

    const knowledgeDocPath = this.getKnowledgeDocPath()
    mkdirSync(dirname(knowledgeDocPath), { recursive: true })
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

    logger.info({ created: created.length, skipped: skipped.length }, `SCALE init (${this.agentType}) completed`)

    return {
      settingsPath,
      knowledgeDocPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
