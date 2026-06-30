// SCALE Engine — 5 种懒惰检测器
// 设计参考：docs/03-CORE-MODULES.md §3.5

import type { IDetector, DetectorContext } from './Gateway.js'
import type { ToolUseInput, ToolResultInput, StopInput, DetectorResult } from '../artifact/types.js'
import { createHash } from 'node:crypto'
import { RuntimeEvidenceLedger, type RuntimeEvidenceRecord } from '../runtime/RuntimeEvidenceLedger.js'

const hashArgs = (args: unknown): string =>
  createHash('md5').update(JSON.stringify(args)).digest('hex').slice(0, 8)

// 1. 暴力重试检测
export class BruteRetryDetector implements IDetector {
  name = 'brute-retry'
  private windowMs = 3 * 60 * 1000
  private threshold = 3

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    const key = `${input.sessionId}:${input.tool}:${hashArgs(input.args)}`
    const history = (ctx.cache.get(key) as number[] | undefined) ?? []
    const recent = history.filter((t) => Date.now() - t < this.windowMs)
    recent.push(Date.now())
    ctx.cache.set(key, recent)
    if (recent.length >= this.threshold) {
      ctx.eventBus.emit('behavior.brute_retry', { tool: input.tool, count: recent.length }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: `检测到「暴力重试」：${input.tool} 在 ${this.windowMs / 60000} 分钟内已运行 ${recent.length} 次。请换策略，并说明你这次的新假设是什么。`,
      }
    }
    return { triggered: false }
  }
}

// 2. 工具闲置检测
export class IdleToolDetector implements IDetector {
  name = 'idle-tool'

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool)) return { triggered: false }
    const recent = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.failed', 'tool.completed'],
      limit: 10,
    })
    const failureIdx = recent.findIndex((e) => e.type === 'tool.failed')
    if (failureIdx < 0) return { triggered: false }
    const after = recent.slice(0, failureIdx)
    const investigation = ['Read', 'Grep', 'WebSearch', 'Bash']
    const hasInv = after.some((e) => investigation.includes((e.payload as { tool: string }).tool))
    if (!hasInv) {
      ctx.eventBus.emit('behavior.idle_tool', { tool: input.tool }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'warn',
        reason: '检测到「工具闲置」：上次工具失败后未读任何文件/日志就直接改代码。请先 Read 相关文件或 Bash 看错误日志。',
        suggestion: 'Read failing test output OR Grep for similar patterns',
      }
    }
    return { triggered: false }
  }
}

// 3. 忙碌假象（来回反复修改同一文件）
export class BusyLoopDetector implements IDetector {
  name = 'busy-loop'

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (input.tool !== 'Edit') return { triggered: false }
    const file = (input.args as { file_path?: string }).file_path
    if (!file) return { triggered: false }
    const edits = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => {
        const p = e.payload as { tool: string; args: { file_path?: string } }
        return p.tool === 'Edit' && p.args.file_path === file
      },
      limit: 5,
    })
    if (edits.length < 4) return { triggered: false }
    const seen = new Set<string>()
    let cycle = false
    for (const e of edits) {
      const p = e.payload as { args: { old_string?: string; new_string?: string } }
      const oldH = createHash('md5').update(p.args.old_string ?? '').digest('hex').slice(0, 8)
      const newH = createHash('md5').update(p.args.new_string ?? '').digest('hex').slice(0, 8)
      if (seen.has(`${newH}:${oldH}`)) { cycle = true; break }
      seen.add(`${oldH}:${newH}`)
    }
    if (cycle) {
      ctx.eventBus.emit('behavior.busy_loop', { file }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: `检测到「忙碌假象」：你在 ${file} 反复来回修改。停下来——这次修改是否产生新信息？没有 = 换思路。`,
      }
    }
    return { triggered: false }
  }
}

// 4. 声称完成但未验证（Harness Engineering 增强）
// 文章启发："CI 通过但测试 0/0 是无效的"
export class PrematureDoneDetector implements IDetector {
  name = 'premature-done'

  async check(input: StopInput, ctx: DetectorContext): Promise<DetectorResult> {
    const edits = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => ['Edit', 'Write', 'MultiEdit'].includes((e.payload as { tool: string }).tool),
    })
    if (edits.length === 0) return { triggered: false }
    const lastEditTimestamp = Math.max(...edits.map(event => event.timestamp))

    // Harness: 检查验证命令是否运行
    const verifications = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed', 'tool.failed', 'verification.recorded'],
      filter: (e) => {
        const p = e.payload as { tool?: string; args?: { command?: string }; command?: string }
        const command = p.args?.command ?? p.command
        return (p.tool === 'Bash' || e.type === 'verification.recorded') && isVerificationCommand(command)
      },
    })

    const latestRuntimeVerification = latestRuntimeVerificationForSession(input.sessionId, lastEditTimestamp)

    // 情况1：完全未验证
    if (verifications.length === 0 && !latestRuntimeVerification) {
      ctx.eventBus.emit('behavior.premature_done', { reason: 'no_verification' }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: '检测到「声称完成但未验证」：本会话修改了代码，但未运行任何 test/lint/build。请先运行验证命令。',
        suggestion: 'pnpm test && pnpm lint && pnpm build',
      }
    }

    // 情况2：验证在编辑之前（文章：Premature Victory Declaration）
    const latestEventVerificationTimestamp = verifications.length > 0
      ? Math.max(...verifications.map(event => event.timestamp))
      : 0
    const latestRuntimeVerificationTimestamp = latestRuntimeVerification
      ? Date.parse(latestRuntimeVerification.createdAt)
      : 0
    if (Math.max(latestEventVerificationTimestamp, latestRuntimeVerificationTimestamp) < lastEditTimestamp) {
      return {
        triggered: true,
        severity: 'block',
        reason: '修改了代码但最后一次验证是修改之前运行的。请重新运行验证。',
      }
    }

    if (latestRuntimeVerification?.status === 'failed') {
      ctx.eventBus.emit('behavior.premature_done', { reason: 'verification_failed' }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: '检测到最近一次验证失败，不能声称完成。请修复失败后重新运行验证。',
      }
    }

    // 情况3：Harness 新增 - 检查测试结果是否真正通过
    // 文章启发：Agent 可能认为 "SUCCESS" 就通过，但实际测试 0/0
    const testCmd = verifications.find(e => /test/i.test(commandFromVerificationEvent(e.payload) ?? ''))
    if (testCmd) {
      const output = (testCmd.payload as { output?: string }).output ?? ''
      // 检测测试 0/0 异常
      if (/tests?\s*(0|no\s*tests?)/i.test(output) || /passed:\s*0/i.test(output)) {
        ctx.eventBus.emit('behavior.premature_done', { reason: 'empty_tests' }, { sessionId: input.sessionId })
        return {
          triggered: true,
          severity: 'block',
          reason: '检测到「测试为空」：运行了测试命令但测试数为 0。请确保测试文件存在且被正确执行。',
          suggestion: '检查测试文件是否存在，或添加测试用例',
        }
      }
      // 检测失败测试
      if (/failed:\s*[1-9]/i.test(output) || /FAIL/i.test(output)) {
        ctx.eventBus.emit('behavior.premature_done', { reason: 'tests_failed' }, { sessionId: input.sessionId })
        return {
          triggered: true,
          severity: 'block',
          reason: '检测到「测试失败」：存在失败的测试，不能声称完成。',
          suggestion: '修复失败的测试后重新运行',
        }
      }
    }

    // 情况4：Harness 新增 - 检查编译是否通过
    const buildCmd = verifications.find(e => /build|compile|tsc/i.test(commandFromVerificationEvent(e.payload) ?? ''))
    if (buildCmd) {
      const exitCode = (buildCmd.payload as { exitCode?: number }).exitCode ?? 0
      if (exitCode !== 0) {
        ctx.eventBus.emit('behavior.premature_done', { reason: 'build_failed' }, { sessionId: input.sessionId })
        return {
          triggered: true,
          severity: 'block',
          reason: '检测到「编译失败」：build 命令返回非零退出码。',
          suggestion: '修复编译错误后重新构建',
        }
      }
    }

    return { triggered: false }
  }
}

function latestRuntimeVerificationForSession(sessionId: string, afterTimestamp: number): RuntimeEvidenceRecord | null {
  const evidence = new RuntimeEvidenceLedger({
    projectDir: process.env.SCALE_PROJECT_DIR ?? process.cwd(),
    scaleDir: process.env.SCALE_DIR ?? '.scale',
    createDirs: false,
  })

  const records = evidence.list({ sessionId, limit: 100 })
    .filter(record => record.kind === 'command')
    .filter(record => isVerificationCommand(record.command))
    .filter(record => Date.parse(record.createdAt) >= afterTimestamp)

  return records[0] ?? null
}

function commandFromVerificationEvent(payload: unknown): string | undefined {
  const event = payload as {
    args?: { command?: unknown; cmd?: unknown; script?: unknown }
    command?: unknown
    cmd?: unknown
    script?: unknown
  }
  return firstString(
    event.args?.command,
    event.args?.cmd,
    event.args?.script,
    event.command,
    event.cmd,
    event.script,
  )
}

function isVerificationCommand(command: unknown): boolean {
  return typeof command === 'string'
    && /\b(test|lint|build|typecheck|tsc|vitest|jest|playwright|preflight|verify)\b/i.test(command)
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized.length > 0) return normalized
  }
  return undefined
}

// 5. 甩锅检测
export class BlameShiftDetector implements IDetector {
  name = 'blame-shift'
  private patterns = [
    /可能是环境问题/i,
    /建议你?手动/i,
    /maybe (an?|the) (environment|version|setup)/i,
    /not sure why/i,
    /unable to (determine|figure out|resolve)/i,
  ]

  async check(input: ToolResultInput, ctx: DetectorContext): Promise<DetectorResult> {
    const text = input.output ?? ''
    if (!this.patterns.some((p) => p.test(text))) return { triggered: false }
    const verifications = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => (e.payload as { tool: string }).tool === 'Bash',
      limit: 5,
    })
    if (verifications.length < 2) {
      ctx.eventBus.emit('behavior.blame_shift', { sessionId: input.sessionId }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'warn',
        reason: '检测到「甩锅」迹象：你说"可能是环境问题"但未做足够验证。至少：\n1. 验证版本 2. 验证依赖 3. 重现问题。\n证据齐了再下结论。',
      }
    }
    return { triggered: false }
  }
}

// 6. 被动等待检测（Stop Hook专用）
// 修完表面问题就停，未泛化检查
export class PassiveWaitDetector implements IDetector {
  name = 'passive-wait'

  async check(input: StopInput, ctx: DetectorContext): Promise<DetectorResult> {
    // 检查是否有修改操作
    const edits = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => ['Edit', 'Write', 'MultiEdit'].includes((e.payload as { tool: string }).tool),
    })
    if (edits.length === 0) return { triggered: false }

    // 检查是否有泛化检查行为
    // 泛化检查包括：搜索同类问题、检查上下游、添加检查规则
    const generalizationPatterns = [
      /同类|similar|same pattern/i,
      /上下游|upstream|downstream/i,
      /检查.*规则|rule|hook/i,
      /泛化|generalize/i,
    ]

    // 检查 Read/Grep/Bash 是否包含泛化关键词
    const reads = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => ['Read', 'Grep', 'Bash'].includes((e.payload as { tool: string }).tool),
      limit: 20,
    })

    const hasGeneralization = reads.some(e => {
      const p = e.payload as { args?: { pattern?: string; command?: string; file_path?: string } }
      const content = `${p.args?.pattern ?? ''} ${p.args?.command ?? ''} ${p.args?.file_path ?? ''}`
      return generalizationPatterns.some(pat => pat.test(content))
    })

    if (!hasGeneralization) {
      ctx.eventBus.emit('behavior.passive_wait', { edits: edits.length }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: '检测到「被动等待」：修完问题后未做泛化检查。\n必须检查：\n1. 同模块有无同类问题\n2. 上下游是否受影响\n3. 能否添加检查防止复发',
        suggestion: 'Grep 类似模式 OR Read 相关模块 OR 添加检测规则',
      }
    }

    return { triggered: false }
  }
}

// 7. 同文件连续修改检测（忙碌假象增强版）
// 连续修改同一文件 >= 3次且无新信息
export class SameFileEditDetector implements IDetector {
  name = 'same-file-edit'
  private threshold = 3

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (input.tool !== 'Edit') return { triggered: false }
    const file = (input.args as { file_path?: string }).file_path
    if (!file) return { triggered: false }

    // 获取最近对该文件的编辑
    const edits = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => {
        const p = e.payload as { tool: string; args: { file_path?: string } }
        return p.tool === 'Edit' && p.args.file_path === file
      },
      limit: 10,
    })

    // 连续修改同一文件 >= 3次
    if (edits.length >= this.threshold) {
      // 检查是否有中间穿插其他操作（表示有新信息）
      const allOps = await ctx.eventBus.query({
        sessionId: input.sessionId,
        types: ['tool.completed'],
        limit: 15,
      })

      // 找出该文件编辑的时间窗口
      const editTimestamps = edits.map(e => e.timestamp).sort((a, b) => b - a)
      const startWindow = editTimestamps[editTimestamps.length - 1]
      const endWindow = editTimestamps[0]

      // 检查时间窗口内是否有 Read/Grep（表示有新信息输入）
      const hasNewInfo = allOps.some(e => {
        if (e.timestamp < startWindow || e.timestamp > endWindow) return false
        const p = e.payload as { tool: string }
        return ['Read', 'Grep', 'WebSearch', 'WebFetch'].includes(p.tool)
      })

      if (!hasNewInfo) {
        ctx.eventBus.emit('behavior.same_file_edit', { file, count: edits.length }, { sessionId: input.sessionId })
        return {
          triggered: true,
          severity: 'block',
          reason: `检测到「同文件连续修改」：${file} 已修改 ${edits.length} 次且无新信息输入。\n停下来问自己：这次修改是否产生新信息？没有 = 换思路。`,
          suggestion: 'Read 相关文件 OR Grep 类似模式 OR /clear 清空上下文',
        }
      }
    }

    return { triggered: false }
  }
}
