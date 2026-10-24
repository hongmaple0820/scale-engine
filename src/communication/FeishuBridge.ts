// SCALE Engine — Feishu Bridge（cc-connect 模式）
// 常驻循环：消费飞书事件流 → 解析入站消息 → 派给 AgentControlPlane 执行 → 把回复发回飞书
// 与 cc-connect 的差异：执行仍然受 SCALE 治理约束（会话必须 live-guarded 且开启本地执行器才真正执行）。

import { spawn, type ChildProcess } from 'node:child_process'
import { runExternalCommandSync, buildSpawnInvocation } from '../core/ExternalCommand.js'
import type { EventBus } from '../core/eventBus.js'
import type { AgentControlPlane, AgentControlMessageRecord } from '../dashboard/AgentControlPlane.js'
import {
  buildFeishuEventConsumeCommand,
  buildFeishuSendMessageCommand,
  parseFeishuEventLine,
} from './FeishuChannelProvider.js'

export interface FeishuBridgeCounters {
  received: number
  routed: number
  executed: number
  replied: number
  skipped: number
  failed: number
}

export interface FeishuBridgeStatus {
  running: boolean
  sessionId: string
  eventKey: string
  command?: string
  startedAt?: number
  lastEventAt?: number
  lastReplyAt?: number
  lastError?: string
  restarts: number
  counters: FeishuBridgeCounters
}

export interface FeishuBridgeDeps {
  projectDir: string
  sessionId: string
  /** 惰性获取执行面（DashboardServer 每次请求新建 plane，因此用 provider 函数） */
  plane: () => AgentControlPlane
  bus: EventBus
  eventKey?: string
  asIdentity?: 'bot' | 'user' | 'auto'
  pollTimeout?: string
  replyMaxChars?: number
  /** 测试注入：替换 lark-cli 的消费命令（例如输出事件 JSON 行的桩进程） */
  consumeCommandOverride?: { command: string; args: string[] }
}

const DEFAULT_EVENT_KEY = 'im.message.receive_v1'
const RESTART_DELAY_MS = 3000
const MAX_REPLY_CHARS = 4000

export class FeishuBridge {
  private child: ChildProcess | null = null
  private stdoutBuffer = ''
  private restartTimer: NodeJS.Timeout | null = null
  private subscription: { unsubscribe?: () => void } | null = null
  private readonly seenMessageIds = new Set<string>()
  private readonly sentReplyKeys = new Set<string>()
  private counters: FeishuBridgeCounters = { received: 0, routed: 0, executed: 0, replied: 0, skipped: 0, failed: 0 }
  private startedAt?: number
  private lastEventAt?: number
  private lastReplyAt?: number
  private lastError?: string
  private restarts = 0
  private stopped = false

  constructor(private readonly deps: FeishuBridgeDeps) {}

  get eventKey(): string {
    return this.deps.eventKey ?? DEFAULT_EVENT_KEY
  }

  status(): FeishuBridgeStatus {
    return {
      running: this.child !== null,
      sessionId: this.deps.sessionId,
      eventKey: this.eventKey,
      command: this.buildConsumePlan().command + ' ' + this.buildConsumePlan().args.join(' '),
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      lastReplyAt: this.lastReplyAt,
      lastError: this.lastError,
      restarts: this.restarts,
      counters: { ...this.counters },
    }
  }

  /** 启动常驻桥接：订阅执行完成事件 + 拉起事件消费子进程 */
  start(): FeishuBridgeStatus {
    if (this.child) return this.status()
    this.stopped = false
    this.startedAt = Date.now()
    this.lastError = undefined
    this.subscription = this.deps.bus.on('agent-control.message', (event) => {
      void this.handleAgentControlEvent(event as { sessionId?: string; messageId?: string; phase?: string })
    })
    this.spawnConsumeLoop()
    return this.status()
  }

  stop(): FeishuBridgeStatus {
    this.stopped = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.subscription?.unsubscribe?.()
    this.subscription = null
    this.child?.kill()
    this.child = null
    this.stdoutBuffer = ''
    return this.status()
  }

  // ------------------------------------------------------------------
  // 入站：消费事件流
  // ------------------------------------------------------------------

  private buildConsumePlan(): { command: string; args: string[] } {
    if (this.deps.consumeCommandOverride) return this.deps.consumeCommandOverride
    const plan = buildFeishuEventConsumeCommand({
      eventKey: this.eventKey,
      as: this.deps.asIdentity ?? 'bot',
      timeout: this.deps.pollTimeout ?? '30s',
      quiet: true,
    })
    return { command: plan.command, args: plan.args }
  }

  private spawnConsumeLoop(): void {
    if (this.stopped) return
    const plan = this.buildConsumePlan()
    let child: ChildProcess
    try {
      const invocation = buildSpawnInvocation(plan.command, plan.args)
      child = spawn(invocation.executable, invocation.args, { cwd: this.deps.projectDir, windowsHide: true })
    } catch (error) {
      this.recordFailure(`bridge spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      this.scheduleRestart()
      return
    }
    this.child = child
    child.stdout?.on('data', chunk => this.consumeStdout(chunk.toString('utf8')))
    child.stderr?.on('data', chunk => {
      const text = chunk.toString('utf8').trim()
      if (text) this.lastError = text.slice(0, 400)
    })
    child.on('error', error => {
      this.recordFailure(`bridge process error: ${error.message}`)
      this.child = null
      this.scheduleRestart()
    })
    child.on('close', code => {
      this.child = null
      if (this.stopped) return
      // 长轮询消费正常会周期性退出，静默重启即是常驻
      this.restarts += 1
      if (code !== 0 && code !== null) this.lastError = `consume exited with code ${code}`
      this.scheduleRestart()
    })
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnConsumeLoop()
    }, RESTART_DELAY_MS)
    this.restartTimer.unref?.()
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) this.handleEventLine(line)
  }

  /** 单行事件处理：解析 → 去重 → 前缀门槛 → 送入执行器。导出供测试直接驱动。 */
  handleEventLine(line: string): void {
    const inbound = parseFeishuEventLine(line)
    if (!inbound) return
    if (inbound.messageId && this.seenMessageIds.has(inbound.messageId)) {
      this.counters.skipped += 1
      return
    }
    if (inbound.messageId) this.seenMessageIds.add(inbound.messageId)
    // 回环保护：自己在聊天里发出的内容不会再被当作指令执行
    if (inbound.text.startsWith('[agent-cli]') || inbound.text.startsWith('[local-executor]')) {
      this.counters.skipped += 1
      return
    }
    this.counters.received += 1
    this.lastEventAt = Date.now()
    // 记录入站会话的 chat_id：回复要发回同一个聊天
    if (inbound.chatId) this.lastInboundChatId = inbound.chatId

    try {
      const plane = this.deps.plane()
      // 消息门槛：只有以会话命令前缀（默认 /scale）开头的消息才派发，群聊闲聊不触发 agent
      const prefix = (plane.getTranscript(this.deps.sessionId).session?.commandPrefix || '/scale').trim()
      const text = inbound.text.trim()
      if (!text.startsWith(`${prefix} `)) {
        this.counters.skipped += 1
        return
      }
      const prompt = text.slice(prefix.length).trim()
      if (!prompt) {
        this.counters.skipped += 1
        return
      }
      const message = plane.sendMessage(this.deps.sessionId, {
        text: prompt,
        dryRun: false,
        from: `feishu:${inbound.senderId ?? inbound.chatId ?? 'unknown'}`,
      })
      // 精确路由：记住这条消息来自哪个聊天，完成事件按消息找聊天，避免多群交错时回错地方
      if (inbound.chatId) this.chatIdByMessageId.set(message.id, inbound.chatId)
      this.counters.routed += 1
      void plane.executeLocallyIfEnabled(this.deps.sessionId, message.id)
        .then(executed => {
          if (executed) this.counters.executed += 1
        })
        .catch(error => this.recordFailure(`execute failed: ${error instanceof Error ? error.message : String(error)}`))
    } catch (error) {
      this.recordFailure(`route failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ------------------------------------------------------------------
  // 出站：把 agent 回复发回飞书
  // ------------------------------------------------------------------

  private async handleAgentControlEvent(event: { sessionId?: string; messageId?: string; phase?: string }): Promise<void> {
    if (event.phase !== 'completed' || event.sessionId !== this.deps.sessionId) return
    try {
      const plane = this.deps.plane()
      const messages = plane.getTranscript(this.deps.sessionId, { limit: 200 }).messages
      // 取最新的一条 agent 回复，且尚未发送过
      const reply = [...messages].reverse().find(candidate => candidate.direction === 'agent-to-operator')
      if (!reply) return
      // 优先按触发消息定位来源聊天；多群交错时 lastInboundChatId 可能已指向别处
      const chatId = (event.messageId ? this.chatIdByMessageId.get(event.messageId) : undefined) ?? this.lastInboundChatId
      if (!chatId) {
        this.counters.skipped += 1
        this.lastError = 'no Feishu chat target yet; inbound message did not carry chat_id'
        return
      }
      const replyKey = `${chatId}:${reply.id}`
      if (this.sentReplyKeys.has(replyKey)) return
      const result = this.sendToFeishu(chatId, reply.text)
      if (result.ok) {
        this.sentReplyKeys.add(replyKey)
        if (event.messageId) this.chatIdByMessageId.delete(event.messageId)
      }
    } catch (error) {
      this.recordFailure(`reply dispatch failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private lastInboundChatId?: string
  private readonly chatIdByMessageId = new Map<string, string>()

  /**
   * 发送回复到飞书聊天；超长内容按换行边界分片逐条发送（不再截断丢内容）；runner 可注入供测试断言。
   */
  sendToFeishu(
    chatId: string,
    text: string,
    runner: (command: string, args: string[], options: Record<string, unknown>) => unknown = runExternalCommandSync as never,
  ): { ok: boolean; chunks: number; error?: string } {
    const maxChars = this.deps.replyMaxChars ?? MAX_REPLY_CHARS
    const chunks: string[] = []
    let remaining = text.trim()
    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        chunks.push(remaining)
        break
      }
      let cut = remaining.lastIndexOf('\n', maxChars)
      if (cut < maxChars * 0.5) cut = maxChars
      chunks.push(remaining.slice(0, cut))
      remaining = remaining.slice(cut).trim()
    }
    if (chunks.length === 0) chunks.push('（无输出）')

    try {
      chunks.forEach((chunk, index) => {
        const body = chunks.length > 1 ? `【${index + 1}/${chunks.length}】\n${chunk}` : chunk
        const plan = buildFeishuSendMessageCommand({ chatId, text: body, as: 'bot', dryRun: false })
        runner(plan.command, plan.args, {
          cwd: this.deps.projectDir,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 20000,
          windowsHide: true,
        })
      })
      this.counters.replied += 1
      this.lastReplyAt = Date.now()
      return { ok: true, chunks: chunks.length }
    } catch (error) {
      this.recordFailure(`feishu send failed: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, chunks: 0, error: this.lastError }
    }
  }

  private recordFailure(message: string): void {
    this.counters.failed += 1
    this.lastError = message.slice(0, 400)
  }
}

/** 供 UI/状态展示：当前会话是否具备飞书入站执行能力 */
export function describeFeishuBridgeReadiness(input: {
  bridgeRunning: boolean
  sessionMode: string
  localExecutor: boolean
  commandAvailable: boolean
  routeConfigured: boolean
}): { ready: boolean; blockers: string[] } {
  const blockers: string[] = []
  if (!input.commandAvailable) blockers.push('lark-cli 不可用')
  if (!input.routeConfigured) blockers.push('飞书路由目标未配置')
  if (input.sessionMode !== 'live-guarded') blockers.push('会话未处于 live-guarded 模式')
  if (!input.localExecutor) blockers.push('未开启本地执行器')
  if (!input.bridgeRunning) blockers.push('桥接未启动')
  return { ready: blockers.length === 0, blockers }
}
