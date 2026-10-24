// SCALE Engine — ZCode Adapter
// 生成/合并 .zcode/config.json（hooks.events 嵌套结构）+ AGENTS.md（幂等 merge）
// ZCode 配置面（官方配置文档确认）：
// - workspace 配置：<repo>/.zcode/config.json → hooks 键；配置文件 hook 必须 hooks.enabled: true 才会执行
// - hook 事件共 7 个：SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop
//   （无 SessionEnd；PermissionRequest/PostToolUseFailure/UserPromptSubmit 为 P3 增强）
// - hook 入参走 stdin（tool_name/tool_input/session_id）；exit 0=放行，2=拦截
// - 知识文件是通用标准文件 AGENTS.md，目标项目通常已存在，必须幂等 merge 而非跳过

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import { renderAgentFullWorkflowGuidance } from './AgentKnowledgeDoc.js'
import type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson } from './ClaudeCodeAdapter.js'

// ============================================================================
// ZCode 专属 settings 类型
// ZCode 的 hooks 与 Claude 扁平结构不同：多一层 events 嵌套。
// IAgentAdapter 以 Claude 的 SettingsJson 为接口基准，本适配器在边界处收敛。
// ============================================================================

export interface ZCodeHookEntry {
  type: 'command'
  command: string
  timeoutMs?: number
  shell?: string
  statusMessage?: string
}

export interface ZCodeHookGroup {
  matcher?: string
  hooks: ZCodeHookEntry[]
}

export interface ZCodeSettings {
  hooks: {
    enabled: boolean
    events: Record<string, ZCodeHookGroup[]>
  }
  permissions?: { allow?: string[]; deny?: string[] }
}

/** SCALE 注入的 hook 命令指纹，用于 merge 判重（含 zcode 专属 gate 入口）。 */
const SCALE_COMMAND_FINGERPRINT = /scale gate|scale context|scale session|zcode-gate/

const MARKER_BEGIN = '<!-- SCALE:BEGIN -->'
const MARKER_END = '<!-- SCALE:END -->'

// ============================================================================
// ZCode Adapter
// ============================================================================

export class ZCodeAdapter implements IAgentAdapter {
  readonly agentType = 'zcode'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(this.projectDir, '.zcode', 'config.json')
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, 'AGENTS.md')
  }

  getSkillsDir(): string {
    // ZCode skills 是项目级（workspace scope），可随仓库提交共享
    return join(this.projectDir, '.zcode', 'skills')
  }

  isInstalled(): boolean {
    return existsSync(this.getSettingsPath())
  }

  buildZCodeSettings(): ZCodeSettings {
    return {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [
            { matcher: 'startup|resume', hooks: [
              { type: 'command', command: 'scale context inject --session-id "$CLAUDE_SESSION_ID"' },
            ] },
          ],
          PreToolUse: [
            { matcher: '^Bash$', hooks: [
              { type: 'command', command: 'scale gate pre-tool Bash --stdin --session-id "$CLAUDE_SESSION_ID"', timeoutMs: 10000 },
            ] },
            { matcher: '^(Edit|Write|MultiEdit|ApplyPatch)$', hooks: [
              { type: 'command', command: 'scale gate pre-tool Edit --stdin --session-id "$CLAUDE_SESSION_ID"', timeoutMs: 10000 },
            ] },
          ],
          PostToolUse: [
            { matcher: '^(Edit|Write|MultiEdit|ApplyPatch)$', hooks: [
              { type: 'command', command: 'scale gate post-tool Edit --stdin --session-id "$CLAUDE_SESSION_ID"', timeoutMs: 10000 },
            ] },
            { matcher: '^Bash$', hooks: [
              { type: 'command', command: 'scale gate post-tool Bash --stdin --session-id "$CLAUDE_SESSION_ID"', timeoutMs: 10000 },
            ] },
          ],
          // ZCode 独有事件：PermissionRequest 支持 exit 0=放行 / 2=拒绝（纯退出码语义，不依赖 JSON schema）
          PermissionRequest: [
            { matcher: '^Bash$', hooks: [
              { type: 'command', command: 'scale gate pre-tool --stdin --session-id "$CLAUDE_SESSION_ID"', timeoutMs: 10000 },
            ] },
            { matcher: '^(Edit|Write|MultiEdit|ApplyPatch)$', hooks: [
              { type: 'command', command: 'scale gate pre-tool --stdin --session-id "$CLAUDE_SESSION_ID"', timeoutMs: 10000 },
            ] },
          ],
          // ZCode 独有事件：工具失败入 .scale/events/，喂 brute-retry 检测（非阻塞）
          PostToolUseFailure: [
            { matcher: '', hooks: [
              { type: 'command', command: 'scale gate post-tool --stdin --exit-code 1 --session-id "$CLAUDE_SESSION_ID"', timeoutMs: 10000 },
            ] },
          ],
          Stop: [
            { matcher: '', hooks: [
              { type: 'command', command: 'scale gate before-stop --session-id "$CLAUDE_SESSION_ID" --hook-safe' },
            ] },
          ],
        },
      },
      permissions: { allow: ['scale:*'] },
    }
  }

  generateSettings(): SettingsJson {
    return this.buildZCodeSettings() as unknown as SettingsJson
  }

  mergeSettings(existing: SettingsJson): SettingsJson {
    const generated = this.buildZCodeSettings()
    const source = (existing ?? {}) as unknown as Partial<ZCodeSettings>
    // 深拷贝 hooks 子树：merge 不得污染调用方对象（init 依赖合并前后的差异比较）
    const sourceHooks = source.hooks && typeof source.hooks === 'object'
      ? source.hooks
      : { enabled: true, events: {} as Record<string, ZCodeHookGroup[]> }
    const mergedHooks = JSON.parse(JSON.stringify(sourceHooks)) as ZCodeSettings['hooks']
    if (!mergedHooks.events || typeof mergedHooks.events !== 'object') {
      mergedHooks.events = {}
    }
    const merged = { ...source, hooks: mergedHooks } as ZCodeSettings

    for (const [event, groups] of Object.entries(generated.hooks.events)) {
      const existingGroups = Array.isArray(merged.hooks.events[event])
        ? merged.hooks.events[event]!
        : []
      for (const group of groups) {
        const target = existingGroups.find(
          (g) => (g?.matcher ?? '') === (group.matcher ?? ''),
        )
        if (target && Array.isArray(target.hooks)) {
          for (const hook of group.hooks) {
            const alreadyExists = target.hooks.some(
              (h) => typeof h?.command === 'string' && SCALE_COMMAND_FINGERPRINT.test(h.command),
            )
            if (!alreadyExists) target.hooks.push(hook)
          }
        } else {
          existingGroups.push(group)
        }
      }
      merged.hooks.events[event] = existingGroups
    }

    // 配置文件 hook 默认关闭且静默不执行；SCALE 接入必须显式启用
    merged.hooks.enabled = true

    const generatedAllow = generated.permissions?.allow ?? []
    if (generatedAllow.length > 0) {
      const existingPermissions = merged.permissions && typeof merged.permissions === 'object'
        ? merged.permissions
        : { allow: [] as string[] }
      const allow = Array.isArray(existingPermissions.allow) ? [...existingPermissions.allow] : []
      for (const perm of generatedAllow) {
        if (!allow.includes(perm)) allow.push(perm)
      }
      merged.permissions = { ...existingPermissions, allow }
    }

    return merged as unknown as SettingsJson
  }

  generateKnowledgeDoc(projectName: string, techStack: string[] = []): string {
    const stackLine = techStack.length > 0
      ? `\n## Tech Stack\n${techStack.map((t) => `- ${t}`).join('\n')}\n`
      : ''

    return `${MARKER_BEGIN}
# ${projectName} — SCALE Engine Integration (ZCode)
${stackLine}
This project uses SCALE Engine for AI engineering governance via ZCode.

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
${MARKER_END}`
  }

  /**
   * AGENTS.md 幂等 merge：有标记段落则原位替换；无标记则追加到文件末尾。
   * 不做头部插入，避免破坏 YAML frontmatter 或拆散用户现有章节。
   */
  mergeKnowledgeDocContent(existing: string, section: string): string {
    const beginIndex = existing.indexOf(MARKER_BEGIN)
    const endIndex = existing.indexOf(MARKER_END)
    if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
      return existing.slice(0, beginIndex) + section + existing.slice(endIndex + MARKER_END.length)
    }
    const separator = existing.endsWith('\n') ? '\n' : '\n\n'
    return existing + separator + section + '\n'
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

    const zcodeDir = join(this.projectDir, '.zcode')
    mkdirSync(zcodeDir, { recursive: true })

    const skillsDir = this.getSkillsDir()
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true })
      created.push(skillsDir)
    } else {
      skipped.push(skillsDir)
    }

    const settingsPath = this.getSettingsPath()
    if (existsSync(settingsPath)) {
      let existing: SettingsJson
      try {
        existing = JSON.parse(readFileSync(settingsPath, 'utf-8')) as SettingsJson
      } catch {
        existing = {} as SettingsJson
      }
      const merged = this.mergeSettings(existing)
      const serialized = JSON.stringify(merged, null, 2)
      // 以归一化后的原文件为比较基准（mergeSettings 已不再污染调用方对象）
      const existingNormalized = JSON.stringify(existing, null, 2)
      if (serialized !== existingNormalized) {
        writeFileSync(settingsPath, serialized, 'utf-8')
        skipped.push(settingsPath + ' (merged)')
      } else {
        skipped.push(settingsPath)
      }
    } else {
      writeFileSync(settingsPath, JSON.stringify(this.buildZCodeSettings(), null, 2), 'utf-8')
      created.push(settingsPath)
    }

    const knowledgeDocPath = this.getKnowledgeDocPath()
    const section = this.generateKnowledgeDoc(
      config.projectDir.split(/[/\\]/).pop() ?? 'Project',
    )
    if (existsSync(knowledgeDocPath)) {
      const existingContent = readFileSync(knowledgeDocPath, 'utf-8')
      const mergedContent = this.mergeKnowledgeDocContent(existingContent, section)
      if (mergedContent !== existingContent) {
        writeFileSync(knowledgeDocPath, mergedContent, 'utf-8')
        skipped.push(knowledgeDocPath + ' (merged)')
      } else {
        skipped.push(knowledgeDocPath)
      }
    } else {
      writeFileSync(knowledgeDocPath, section + '\n', 'utf-8')
      created.push(knowledgeDocPath)
    }

    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `*.db\n*.db-journal\nevents/\ncheckpoints/\nevidence/\nstate/\nhooks/*.sh\n`, 'utf-8')
      created.push(gitignorePath)
    }

    logger.info({ created: created.length, skipped: skipped.length }, 'SCALE init (zcode) completed')

    return {
      settingsPath,
      knowledgeDocPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
