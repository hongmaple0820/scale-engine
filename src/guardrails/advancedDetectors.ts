// SCALE Engine — 危险命令检测 + Role 权限网关 + ScopeCreep 检测
// W5 补充检测器 + 9th detector
// 设计参考：docs/01-ARCHITECTURE.md §二 L2

import type { IDetector, DetectorContext } from './Gateway.js'
import type { ToolUseInput, DetectorResult } from '../artifact/types.js'
import { GUARDRAILS_DETECTOR_VERSIONS, GUARDRAILS_POLICY_VERSION } from './versions.js'
import { normalizeShellToolName } from './verificationCommands.js'

// ============================================================================
// 6. 危险命令检测器
// ============================================================================

export class DangerousCommandDetector implements IDetector {
  name = 'dangerous-command'

  private patterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /rm\s+-rf\s+[\/~]/, description: 'rm -rf on root/home' },
    { pattern: /\b(?:remove-item|ri)\b(?=.*(?:-recurse|-r))(?=.*(?:-force|-fo))(?=.*(?:[a-z]:\\|\\\\))/i, description: 'PowerShell recursive forced delete on rooted path' },
    { pattern: /\b(?:rmdir|rd)\b(?=.*\/s)(?=.*\/q).*?\s+[a-z]:\\/i, description: 'cmd recursive quiet delete on rooted path' },
    { pattern: /\bformat(?:\.com)?\s+[a-z]:/i, description: 'format drive' },
    { pattern: /rm\s+-rf\s+\*/, description: 'rm -rf wildcard' },
    { pattern: /DROP\s+(TABLE|DATABASE|SCHEMA)/i, description: 'SQL DROP' },
    { pattern: /TRUNCATE\s+TABLE/i, description: 'SQL TRUNCATE' },
    { pattern: /DELETE\s+FROM\s+\w+\s*;/i, description: 'SQL DELETE without WHERE' },
    { pattern: /ALTER\s+TABLE\s+\w+\s+DROP/i, description: 'SQL ALTER DROP column' },
    { pattern: /curl\s+.*\|\s*(bash|sh)/i, description: 'curl pipe to shell' },
    { pattern: /chmod\s+777/, description: 'chmod 777' },
    { pattern: />\s*\/dev\/sda/, description: 'write to device' },
    { pattern: /mkfs\./, description: 'format filesystem' },
    { pattern: /:(){ :\|:& };:/, description: 'fork bomb' },
    { pattern: /dd\s+if=.*of=\/dev\//, description: 'dd to device' },
  ]

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (normalizeShellToolName(input.tool) === null) return { triggered: false }

    const command = (input.args as { command?: string }).command ?? ''

    for (const { pattern, description } of this.patterns) {
      if (pattern.test(command)) {
        ctx.eventBus.emit('tool.blocked', {
          tool: input.tool,
          detector: this.name,
          detectorVersion: GUARDRAILS_DETECTOR_VERSIONS['dangerous-command'],
          policyVersion: GUARDRAILS_POLICY_VERSION,
          reason: description,
          command,
        }, { sessionId: input.sessionId })

        return {
          triggered: true,
          severity: 'deny',
          reason: `🛑 危险命令被拦截：${description}\n命令: ${command}\n此操作需要人工确认后才能执行。`,
          suggestion: '请使用安全的替代命令，或获取人工授权。',
        }
      }
    }

    return { triggered: false }
  }
}

// ============================================================================
// 7. 密钥泄露检测器
// ============================================================================
//
// #35：旧版首条规则 /['"]?[A-Za-z0-9+\/]{40}['"]?/ 字符类含斜杠且引号可选，
// 任意 40+ 连续字母数字斜杠（路径/URL/lockfile 片段）都会命中并以 block 硬拦截编辑，
// 形成「想改配置修误报、编辑本身又被拦」的死锁。现拆为两层：
// - 高置信规则（AWS/私钥/OpenAI/GitHub PAT/带键名上下文的凭据）保持 block；
// - 泛化 40+ 字符规则仅 warn：要求被引号包裹、不含斜杠（真实 API key 极少含斜杠）、
//   不含 base64 填充 '='。
// 项目级开关：环境变量 SCALE_SECRET_LEAK_MODE = block(默认) | warn | off，
// hook 进程按调用读取，可在 .scale/hooks 环境或 agent 启动环境中降级/关闭。

export class SecretLeakDetector implements IDetector {
  name = 'secret-leak'

  private blockPatterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /AKIA[0-9A-Z]{16}/, description: 'AWS Access Key ID' },
    { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, description: 'Private key' },
    { pattern: /sk-[a-zA-Z0-9]{48}/, description: 'OpenAI API key' },
    { pattern: /ghp_[a-zA-Z0-9]{36}/, description: 'GitHub PAT' },
    // 检测对象是 JSON.stringify(input.args)，字面引号会被转义为 \"，因此两侧都容忍可选反斜杠
    { pattern: /(api[_-]?key|secret|token)\s*[:=]\s*\\?['"][A-Za-z0-9+/]{32,}\\?['"]/i, description: 'keyed credential (32+ chars)' },
    { pattern: /password\s*[:=]\s*\\?['"][^'"\\]{8,}\\?['"]/, description: 'hardcoded password' },
  ]

  private warnPatterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /\\?['"][A-Za-z0-9+]{40,}\\?['"]/, description: 'possible API key (40+ chars, quoted)' },
  ]

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool)) return { triggered: false }

    const mode = (process.env.SCALE_SECRET_LEAK_MODE ?? 'block').trim().toLowerCase()
    if (mode === 'off') return { triggered: false }

    const content = JSON.stringify(input.args)

    for (const { pattern, description } of this.blockPatterns) {
      if (pattern.test(content)) {
        ctx.eventBus.emit('tool.blocked', {
          tool: input.tool,
          detector: this.name,
          detectorVersion: GUARDRAILS_DETECTOR_VERSIONS['secret-leak'],
          policyVersion: GUARDRAILS_POLICY_VERSION,
          reason: description,
        }, { sessionId: input.sessionId })

        return {
          triggered: true,
          severity: mode === 'warn' ? 'warn' : 'block',
          reason: `🔑 检测到可能的密钥泄露：${description}\n请使用环境变量代替硬编码密钥。`,
          suggestion: '使用 process.env.XXX 或 .env 文件',
        }
      }
    }

    for (const { pattern, description } of this.warnPatterns) {
      if (pattern.test(content)) {
        ctx.eventBus.emit('tool.blocked', {
          tool: input.tool,
          detector: this.name,
          detectorVersion: GUARDRAILS_DETECTOR_VERSIONS['secret-leak'],
          policyVersion: GUARDRAILS_POLICY_VERSION,
          reason: description,
        }, { sessionId: input.sessionId })

        return {
          triggered: true,
          severity: 'warn',
          reason: `⚠️ 疑似密钥泄露（低置信）：${description}。长路径/URL/base64 数据可能误报，已降级为警告。`,
          suggestion: '确认为密钥则改用环境变量；确认误报可忽略',
        }
      }
    }

    return { triggered: false }
  }
}

// ============================================================================
// 8. Role 权限网关
// ============================================================================

export interface RoleDefinition {
  id: string
  name: string
  allowedTools: string[]
  deniedTools?: string[]
}

export const BUILT_IN_ROLES: Record<string, RoleDefinition> = {
  explorer: {
    id: 'explorer',
    name: 'Explorer',
    allowedTools: ['Read', 'Grep', 'Glob', 'WebSearch', 'Bash'],
    deniedTools: ['Edit', 'Write', 'MultiEdit'],
  },
  planner: {
    id: 'planner',
    name: 'Planner',
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    deniedTools: ['Bash'],
  },
  implementer: {
    id: 'implementer',
    name: 'Implementer',
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit', 'Bash'],
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
    deniedTools: ['Edit', 'Write', 'MultiEdit'],
  },
}

export class RoleGateDetector implements IDetector {
  name = 'role-gate'
  private currentRole: RoleDefinition = BUILT_IN_ROLES.implementer

  setRole(role: RoleDefinition): void {
    this.currentRole = role
  }

  getRole(): RoleDefinition {
    return this.currentRole
  }

  async check(input: ToolUseInput, _ctx: DetectorContext): Promise<DetectorResult> {
    const role = this.currentRole

    // Denied tools take priority
    if (role.deniedTools?.includes(input.tool)) {
      return {
        triggered: true,
        severity: 'deny',
        reason: `⛔ Role "${role.name}" 不允许使用 ${input.tool}。请先切换到合适的 Role (如 Implementer)。`,
        suggestion: `切换 Role: scale role activate implementer`,
      }
    }

    // If allowedTools is specified, tool must be in the list
    if (!role.allowedTools.includes(input.tool)) {
      return {
        triggered: true,
        severity: 'deny',
        reason: `⛔ Role "${role.name}" 不允许使用 ${input.tool}。允许的工具: [${role.allowedTools.join(', ')}]`,
        suggestion: `切换到允许 ${input.tool} 的 Role`,
      }
    }

    return { triggered: false }
  }
}

// ============================================================================
// 9. ScopeCreep 检测器
// ============================================================================

export class ScopeCreepDetector implements IDetector {
  name = 'scope-creep'

  /** Max distinct files allowed per session before warning */
  private maxFiles: number
  /** Window in ms to track file edits */
  private windowMs: number

  constructor(opts: { maxFiles?: number; windowMs?: number } = {}) {
    this.maxFiles = opts.maxFiles ?? 15
    this.windowMs = opts.windowMs ?? 10 * 60 * 1000 // 10 minutes
  }

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool)) return { triggered: false }

    const file = (input.args as { file_path?: string }).file_path
    if (!file) return { triggered: false }

    const key = `scope-creep:${input.sessionId}`
    const record = (ctx.cache.get(key) as { files: Set<string>; timestamps: number[] } | undefined)
      ?? { files: new Set<string>(), timestamps: [] }

    const now = Date.now()

    // Prune old timestamps outside window
    record.timestamps = record.timestamps.filter((t) => now - t < this.windowMs)

    // Track new file
    const isNew = !record.files.has(file)
    record.files.add(file)
    record.timestamps.push(now)

    ctx.cache.set(key, record)

    // Only warn when a NEW file is added and we exceed the threshold
    if (isNew && record.files.size > this.maxFiles) {
      ctx.eventBus.emit('tool.blocked', {
        tool: input.tool,
        detector: this.name,
        reason: `scope_creep:${record.files.size}_files`,
        file,
      }, { sessionId: input.sessionId })

      return {
        triggered: true,
        severity: 'warn',
        reason: `⚠️ 检测到「范围蔓延」：本会话已编辑 ${record.files.size} 个不同文件（阈值 ${this.maxFiles}）。请确认这些修改都在当前任务范围内，而非越界修改。`,
        suggestion: '请检查是否偏离了原始任务范围。考虑收窄修改范围或拆分为多个任务。',
      }
    }

    return { triggered: false }
  }
}

