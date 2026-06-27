// SCALE Engine — DeepSeek TUI Adapter
// 生成 .deepseek/config.toml (project overlay) + .deepseek/instructions.md
// DeepSeek TUI: https://github.com/Hmbown/deepseek-tui
// 
// deepseek-tui 配置分层：
//   全局: ~/.deepseek/config.toml (支持 hooks)
//   项目覆盖: .deepseek/config.toml (#485, 仅顶层字段: provider/model/sandbox/approval 等)
//   hooks 不支持项目级覆盖，需用户手动加到全局配置
//
// 参考: docs/CONFIGURATION.md, config.example.toml

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { logger } from '../core/logger.js'
import { renderAgentFullWorkflowGuidance } from './AgentKnowledgeDoc.js'
import type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson } from './ClaudeCodeAdapter.js'

// ============================================================================
// DeepSeek TUI Adapter
// ============================================================================

export class DeepSeekTuiAdapter implements IAgentAdapter {
  readonly agentType = 'deepseek-tui'
  private projectDir: string = '.'
  private scaleDir: string = '.scale'

  getSettingsPath(): string {
    return join(this.projectDir, '.deepseek', 'config.toml')
  }

  getKnowledgeDocPath(): string {
    return join(this.projectDir, '.deepseek', 'instructions.md')
  }

  getSkillsDir(): string {
    // deepseek-tui skills are global (same location as Claude Code compatible)
    return join(homedir(), '.deepseek', 'skills')
  }

  isInstalled(): boolean {
    return existsSync(join(this.projectDir, '.deepseek', 'instructions.md'))
  }

  generateSettings(): SettingsJson {
    // deepseek-tui 使用 TOML 格式，SettingsJson 仅用于接口兼容
    // 实际 TOML 生成在 generateConfigToml() 中
    return {
      permissions: {
        allow: ['scale:*'],
      },
    }
  }

  /**
   * 生成 .deepseek/config.toml 项目覆盖配置
   * 仅包含 #485 项目 overlay 支持的顶层字段
   */
  generateConfigToml(scenarioMode: 'sandbox' | 'standard' | 'critical' = 'standard'): string {
    const sandboxMode = scenarioMode === 'sandbox' ? 'read-only' : 'workspace-write'
    const approvalPolicy = scenarioMode === 'critical' ? 'on-request' : 'on-request'

    let config = `# SCALE Engine — DeepSeek TUI Project Overlay (#485)
# 此文件仅覆盖全局 ~/.deepseek/config.toml 中的指定顶层字段。
# 完整配置参考: https://github.com/Hmbown/deepseek-tui/blob/main/config.example.toml

# ── SCALE 项目约束 ──
sandbox_mode = "${sandboxMode}"
approval_policy = "${approvalPolicy}"
`

    if (scenarioMode === 'critical') {
      config += `
# 严格模式：禁用 shell 工具，强制通过 scale gate 命令执行
allow_shell = false
max_subagents = 5
`
    }

    config += `
# ── SCALE Hooks 说明 ──
# deepseek-tui 的 hooks 不支持项目级覆盖，请将以下配置添加到
# 全局 ~/.deepseek/config.toml 的 [hooks] 段中:
#
# [hooks]
# enabled = true
# default_timeout_secs = 30
#
# [[hooks.hooks]]
# event = "session_start"
# command = "scale context inject --session-id $DEEPSEEK_SESSION_ID"
#
# [[hooks.hooks]]
# event = "tool_call_before"
# command = "scale gate pre-tool Bash --args-json '$TOOL_INPUT_JSON' --session-id $DEEPSEEK_SESSION_ID"
#
# [[hooks.hooks]]
# event = "tool_call_after"
# command = "scale gate post-tool Bash --exit-code '$TOOL_EXIT_CODE' --session-id $DEEPSEEK_SESSION_ID"
#
# [[hooks.hooks]]
# event = "session_end"
# command = "scale session end --session-id $DEEPSEEK_SESSION_ID"
`

    return config
  }

  mergeSettings(existing: SettingsJson): SettingsJson {
    const generated = this.generateSettings()
    const merged: SettingsJson = { ...existing }

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
## SCALE Engine Integration (DeepSeek TUI)

This project uses SCALE Engine for AI engineering governance via DeepSeek TUI.

### Phase Workflow (六阶段交付链路)

\`\`\`
define → plan → build → verify → review → ship
\`\`\`

每个阶段有明确的质量门禁，guard 失败时阻断流程而非继续。

### Commands

- \`scale define "<description>" --success-criteria "..." \` — 创建 Spec artifact
- \`scale plan <spec-id> --rollback "..."\` — 创建 Plan artifact
- \`scale build <plan-id> --description "..."\` — 创建 Task artifact
- \`scale verify <task-id>\` — 运行验证门禁 (build/lint/test/coverage)
- \`scale review <task-id>\` — 代码 review，生成持久化 review 证据
- \`scale ship <task-id> --message "feat: ..."\` — 发布（强制校验 verify + review 证据）
- \`scale ship <task-id> --no-commit\` — 仅生成交付报告，不创建 commit
- \`scale status --json\` — 查看当前 artifact 状态和 blocker
- \`scale doctor\` — 健康检查

### Workflow

1. **DEFINE** → 创建 Spec，明确成功标准和边界
2. **PLAN** → 技术方案设计，评估风险和复杂度
3. **BUILD** → 实现阶段，Task FSM 追踪状态
4. **VERIFY** → 运行测试/构建/lint，证据持久化到 .scale/
5. **REVIEW** → 确定性 review scanner 检查代码质量
6. **SHIP** → 强制校验 verify + review 证据后交付

### Safety Model

| 层级 | 作用 |
|------|------|
| FSM | 阻止非法 artifact 状态流转 |
| GateSystem | 执行 build/lint/test/coverage/security 门禁 |
| EvidenceStore | 持久化验证证据 (.scale/evidence/) |
| ReviewStore | 持久化 review 记录 (.scale/reviews/) |
| ReviewAnalyzer | 扫描 diff 中的高风险代码 |
| Detectors | OWASP Top 10 + 行为检测 (19 类) |

${renderAgentFullWorkflowGuidance()}

### Rules

- 🔴 Dangerous commands (rm -rf, DROP TABLE) are physically blocked
- 🔴 Hardcoded secrets are blocked on Edit/Write
- 🟡 3 identical retries triggers brute-retry detection
- 🟡 Claiming done without running tests is blocked (PrematureDoneDetector)
- 🟢 All tool calls are tracked in .scale/events/
`
  }

  async init(config: AdapterConfig): Promise<InitResult> {
    this.projectDir = config.projectDir
    this.scaleDir = config.scaleDir ?? join(config.projectDir, '.scale')
    const scenarioMode = config.scenarioMode ?? 'standard'
    const created: string[] = []
    const skipped: string[] = []

    // 1. Create .scale/ directory structure
    for (const dir of ['events', 'artifacts', 'rules', 'hooks', 'checkpoints', 'reviews', 'evidence']) {
      const fullDir = join(this.scaleDir, dir)
      if (!existsSync(fullDir)) {
        mkdirSync(fullDir, { recursive: true })
        created.push(fullDir)
      } else {
        skipped.push(fullDir)
      }
    }

    // 2. Create .deepseek/ directory
    const deepseekDir = join(this.projectDir, '.deepseek')
    mkdirSync(deepseekDir, { recursive: true })

    // 3. Create/overwrite .deepseek/config.toml (project overlay)
    const settingsPath = this.getSettingsPath()
    if (existsSync(settingsPath)) {
      // For TOML project overlay, we write a SCALE section comment
      // but don't overwrite existing settings — append SCALE guidance
      const existing = readFileSync(settingsPath, 'utf-8')
      if (!existing.includes('SCALE Engine')) {
        const tomlConfig = this.generateConfigToml(scenarioMode as 'sandbox' | 'standard' | 'critical')
        writeFileSync(settingsPath, existing.trimEnd() + '\n\n' + tomlConfig, 'utf-8')
        skipped.push(settingsPath + ' (SCALE section appended)')
      } else {
        skipped.push(settingsPath + ' (already configured)')
      }
    } else {
      const tomlConfig = this.generateConfigToml(scenarioMode as 'sandbox' | 'standard' | 'critical')
      writeFileSync(settingsPath, tomlConfig, 'utf-8')
      created.push(settingsPath)
    }

    // 4. Update .deepseek/instructions.md
    const knowledgeDocPath = this.getKnowledgeDocPath()
    const projectName = config.projectDir.split(/[/\\]/).pop() ?? 'Project'

    if (existsSync(knowledgeDocPath)) {
      const existing = readFileSync(knowledgeDocPath, 'utf-8')
      // Only append SCALE section if not already present
      if (!existing.includes('SCALE Engine Integration')) {
        const scaleSection = this.generateKnowledgeDoc(projectName)
        // Extract only the SCALE section (skip the project name header)
        const scaleBody = scaleSection.split('\n').slice(existing.startsWith('# ') ? 2 : 1).join('\n')
        writeFileSync(knowledgeDocPath, existing.trimEnd() + '\n\n' + scaleBody, 'utf-8')
        skipped.push(knowledgeDocPath + ' (SCALE section appended)')
      } else {
        skipped.push(knowledgeDocPath + ' (already configured)')
      }
    } else {
      writeFileSync(knowledgeDocPath, this.generateKnowledgeDoc(projectName), 'utf-8')
      created.push(knowledgeDocPath)
    }

    // 5. Create skills directory (global)
    const skillsDir = this.getSkillsDir()
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true })
      created.push(skillsDir)
    } else {
      skipped.push(skillsDir)
    }

    // 6. .gitignore for .scale/
    const gitignorePath = join(this.scaleDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `# SCALE Engine runtime data
*.db
*.db-shm
*.db-wal
events/
checkpoints/
evidence/
state/
hooks/*.sh
`, 'utf-8')
      created.push(gitignorePath)
    }

    logger.info({ created: created.length, skipped: skipped.length }, 'SCALE init (deepseek-tui) completed')

    return {
      settingsPath,
      knowledgeDocPath,
      scaleDir: this.scaleDir,
      created,
      skipped,
    }
  }
}
