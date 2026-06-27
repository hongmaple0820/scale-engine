import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { DEFAULT_MODELS, LOCAL_MODELS, type ModelConfig } from '../routing/ModelRouter.js'
import { buildFeishuSendMessageCommand, type FeishuCommandPlan } from '../communication/FeishuChannelProvider.js'

export type AgentControlStatus = 'ready' | 'partial' | 'missing' | 'blocked'
export type AgentControlMode = 'dry-run' | 'interactive' | 'live-guarded'
export type AgentControlMessageStatus = 'queued' | 'claimed' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'delivered'
export type AgentControlMessageDirection = 'operator-to-agent' | 'agent-to-operator' | 'system'

export interface AgentControlProject {
  id: string
  name: string
  projectDir: string
  scaleDir: string
}

export interface AgentControlPlatformTarget {
  id: string
  name: string
  status: 'ready' | 'partial' | 'missing' | 'error'
  settingsPath?: string
  knowledgeDocPath?: string
}

export interface AgentControlFeishuRoute {
  enabled: boolean
  configured: boolean
  routeId: string
  agentPlatformId?: string
  agentSessionId?: string
  targetType: 'chat' | 'user'
  targetId: string
  targetLabel: string
  commandPrefix: string
}

export interface AgentControlSessionConfig {
  version: 1
  sessionId: string
  name: string
  platformId: string
  modelId: string
  channelProvider: 'dashboard' | 'feishu'
  channelRouteId: string
  commandPrefix: string
  mode: AgentControlMode
  autoImportKnowledge: boolean
  updatedAt: number
}

export interface AgentControlModelOption {
  id: string
  label: string
  provider: string
  tier: string
  modelId: string
  maxTokens: number
  costPerMToken: number
  modalities: string[]
}

export interface AgentControlSessionSummary extends AgentControlSessionConfig {
  status: AgentControlStatus
  platformName: string
  platformStatus: AgentControlPlatformTarget['status']
  model?: AgentControlModelOption
  channel: {
    provider: 'dashboard' | 'feishu'
    configured: boolean
    targetLabel: string
    routeId: string
  }
  messageCount: number
  pendingCount: number
  lastMessageAt?: number
  warnings: string[]
}

export interface AgentControlMessageRecord {
  id: string
  sessionId: string
  direction: AgentControlMessageDirection
  from: string
  to: string
  text: string
  status: AgentControlMessageStatus
  createdAt: number
  platformId: string
  modelId: string
  channelProvider: 'dashboard' | 'feishu'
  channelRouteId: string
  dryRun: boolean
  commandPlan?: FeishuCommandPlan
  responsePreview?: string
  claimedBy?: string
  claimedAt?: number
  completedAt?: number
  result?: 'completed' | 'failed' | 'cancelled'
  evidencePath?: string
  warnings: string[]
}

export interface AgentControlReport {
  project: AgentControlProject
  generatedAt: number
  summary: {
    sessions: number
    ready: number
    partial: number
    missing: number
    queuedMessages: number
    claimedMessages: number
    completedMessages: number
    failedMessages: number
  }
  modelOptions: AgentControlModelOption[]
  platformTargets: AgentControlPlatformTarget[]
  sessions: AgentControlSessionSummary[]
  messages: AgentControlMessageRecord[]
  commands: {
    pollInbox: string
    claimMessage: string
    completeMessage: string
    postReply: string
    sendMessage: string
    getTranscript: string
    searchTranscripts: string
    summarizeSession: string
    cliPoll: string
    cliReply: string
  }
  warnings: string[]
}

export interface AgentControlConversationSummary {
  sessionId: string
  title: string
  generatedAt: number
  messageCount: number
  operatorMessages: number
  agentMessages: number
  pendingMessages: number
  completedMessages: number
  blockedMessages: number
  firstMessageAt?: number
  lastMessageAt?: number
  latestOperatorText?: string
  latestAgentText?: string
  openItems: string[]
  decisions: string[]
  nextActions: string[]
  warnings: string[]
  markdown: string
}

export interface AgentControlTranscriptReport {
  session: AgentControlSessionSummary
  generatedAt: number
  messageCount: number
  messages: AgentControlMessageRecord[]
  summary: AgentControlConversationSummary
  storage: {
    messagesPath: string
    summaryPath: string
  }
}

export interface AgentControlTranscriptSearchHit {
  sessionId: string
  sessionName: string
  platformName: string
  message: AgentControlMessageRecord
  matchPreview: string
}

export interface AgentControlTranscriptSearchReport {
  query: string
  generatedAt: number
  total: number
  hits: AgentControlTranscriptSearchHit[]
}

export interface AgentControlSendInput {
  text?: unknown
  dryRun?: unknown
  from?: unknown
}

export interface AgentControlClaimInput {
  agentId?: unknown
  note?: unknown
}

export interface AgentControlCompleteInput extends AgentControlSendInput {
  agentId?: unknown
  status?: unknown
  evidencePath?: unknown
}

export interface AgentControlCompletionResult {
  message: AgentControlMessageRecord
  reply?: AgentControlMessageRecord
}

export interface AgentControlSessionUpdateInput {
  name?: unknown
  platformId?: unknown
  modelId?: unknown
  channelProvider?: unknown
  channelRouteId?: unknown
  commandPrefix?: unknown
  mode?: unknown
  autoImportKnowledge?: unknown
}

export interface AgentControlTranscriptQueryInput {
  query?: unknown
  sessionId?: unknown
  status?: unknown
  limit?: unknown
}

export class AgentControlPlane {
  constructor(
    private readonly project: AgentControlProject,
    private readonly platformTargets: AgentControlPlatformTarget[],
    private readonly feishuRoutes: AgentControlFeishuRoute | AgentControlFeishuRoute[],
  ) {}

  getReport(): AgentControlReport {
    const modelOptions = getAgentControlModelOptions()
    const sessions = this.readSessionConfigs().map(config => this.summarizeSession(config, modelOptions))
    const messages = sessions.flatMap(session => this.readMessages(session.sessionId)).sort((left, right) => right.createdAt - left.createdAt)
    const warnings = sessions.flatMap(session => session.warnings.map(warning => `${session.name}: ${warning}`))
    return {
      project: this.project,
      generatedAt: Date.now(),
      summary: {
        sessions: sessions.length,
        ready: sessions.filter(session => session.status === 'ready').length,
        partial: sessions.filter(session => session.status === 'partial').length,
        missing: sessions.filter(session => session.status === 'missing').length,
        queuedMessages: messages.filter(message => message.status === 'queued').length,
        claimedMessages: messages.filter(message => message.status === 'claimed').length,
        completedMessages: messages.filter(message => message.status === 'completed').length,
        failedMessages: messages.filter(message => message.status === 'failed' || message.status === 'cancelled').length,
      },
      modelOptions,
      platformTargets: this.platformTargets,
      sessions,
      messages: messages.slice(0, 80),
      commands: {
        pollInbox: 'GET /api/agent-control/sessions/<session-id>/inbox',
        claimMessage: 'POST /api/agent-control/sessions/<session-id>/messages/<message-id>/claim',
        completeMessage: 'POST /api/agent-control/sessions/<session-id>/messages/<message-id>/complete',
        postReply: 'POST /api/agent-control/sessions/<session-id>/replies',
        sendMessage: 'POST /api/agent-control/sessions/<session-id>/messages',
        getTranscript: 'GET /api/agent-control/sessions/<session-id>/transcript',
        searchTranscripts: 'GET /api/agent-control/transcripts?query=<text>&sessionId=<session-id>',
        summarizeSession: 'POST /api/agent-control/sessions/<session-id>/summary',
        cliPoll: 'scale agent-control inbox --session <session-id> --claim-first --agent-id <agent-id> --json',
        cliReply: 'scale agent-control reply --session <session-id> --message <message-id> --text "<result>" --agent-id <agent-id> --json',
      },
      warnings,
    }
  }

  saveSession(sessionId: string, input: AgentControlSessionUpdateInput): AgentControlSessionSummary {
    const existing = this.readSessionConfigs().find(session => session.sessionId === sessionId) ?? this.defaultSessionConfig()
    const draft: Record<string, unknown> = {
      ...existing,
      ...input,
      sessionId,
      updatedAt: Date.now(),
    }
    if (draft.channelProvider === 'feishu' && !input.channelRouteId) {
      const route = this.feishuRouteForPlatform(normalizeString(draft.platformId, existing.platformId))
      draft.channelRouteId = route.routeId || existing.channelRouteId
    }
    if (draft.channelProvider === 'dashboard' && !input.channelRouteId) {
      draft.channelRouteId = 'dashboard-local'
    }
    const next = normalizeAgentControlSession(draft, this.defaultSessionConfig(), {
      supportedPlatforms: this.platformTargets.map(target => target.id),
      modelIds: getAgentControlModelOptions().map(model => model.id),
      strict: true,
    })
    const sessions = this.readSessionConfigs().filter(session => session.sessionId !== sessionId)
    sessions.unshift(next)
    this.writeSessionConfigs(sessions)
    return this.summarizeSession(next, getAgentControlModelOptions())
  }

  sendMessage(sessionId: string, input: AgentControlSendInput): AgentControlMessageRecord {
    const text = String(input.text ?? '').trim()
    if (!text) throw new Error('Agent message text is required.')
    const session = this.getSessionConfig(sessionId)
    const warnings: string[] = []
    const dryRun = input.dryRun !== false || session.mode !== 'live-guarded'
    let commandPlan: FeishuCommandPlan | undefined
    let status: AgentControlMessageStatus = 'queued'
    let channelRouteId = session.channelRouteId

    if (session.channelProvider === 'feishu') {
      const route = this.feishuRouteForSession(session)
      channelRouteId = route.routeId
      if (!route.configured) {
        status = 'blocked'
        warnings.push('Feishu route target is not configured.')
      } else {
        commandPlan = buildFeishuSendMessageCommand({
          ...(route.targetType === 'user' ? { userId: route.targetId } : { chatId: route.targetId }),
          text: renderAgentControlFeishuText(session, text),
          mode: 'text',
          as: 'bot',
          dryRun,
          idempotencyKey: `scale-agent-${session.sessionId}-${Date.now()}`,
        })
      }
    }

    const record: AgentControlMessageRecord = {
      id: `ACM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      direction: 'operator-to-agent',
      from: normalizeString(input.from, 'dashboard'),
      to: session.sessionId,
      text,
      status,
      createdAt: Date.now(),
      platformId: session.platformId,
      modelId: session.modelId,
      channelProvider: session.channelProvider,
      channelRouteId,
      dryRun,
      commandPlan,
      responsePreview: status === 'queued'
        ? 'Message queued for the selected agent session. Agent runtime can poll the inbox endpoint or Feishu can carry the same command plan in dry-run mode.'
        : undefined,
      warnings,
    }
    this.appendMessage(record)
    return record
  }

  postReply(sessionId: string, input: AgentControlSendInput): AgentControlMessageRecord {
    const text = String(input.text ?? '').trim()
    if (!text) throw new Error('Agent reply text is required.')
    const session = this.getSessionConfig(sessionId)
    const route = session.channelProvider === 'feishu' ? this.feishuRouteForSession(session) : null
    const record: AgentControlMessageRecord = {
      id: `ACM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      direction: 'agent-to-operator',
      from: normalizeString(input.from, session.sessionId),
      to: 'dashboard',
      text,
      status: 'delivered',
      createdAt: Date.now(),
      platformId: session.platformId,
      modelId: session.modelId,
      channelProvider: session.channelProvider,
      channelRouteId: route?.routeId ?? session.channelRouteId,
      dryRun: false,
      warnings: [],
    }
    this.appendMessage(record)
    return record
  }

  getInbox(sessionId: string, options: { includeClaimed?: boolean } = {}): AgentControlMessageRecord[] {
    return this.readMessages(sessionId).filter(message => {
      if (message.direction !== 'operator-to-agent') return false
      if (message.status === 'queued') return true
      return options.includeClaimed === true && message.status === 'claimed'
    })
  }

  claimMessage(sessionId: string, messageId: string, input: AgentControlClaimInput = {}): AgentControlMessageRecord {
    const agentId = normalizeString(input.agentId, sessionId)
    const note = normalizeOptionalString(input.note)
    return this.updateMessage(sessionId, messageId, message => {
      if (message.direction !== 'operator-to-agent') {
        throw new Error(`Message ${messageId} is not an operator-to-agent task.`)
      }
      if (message.status !== 'queued' && message.status !== 'claimed') {
        throw new Error(`Message ${messageId} cannot be claimed from status ${message.status}.`)
      }
      return {
        ...message,
        status: 'claimed',
        claimedBy: message.claimedBy ?? agentId,
        claimedAt: message.claimedAt ?? Date.now(),
        responsePreview: note || `Claimed by ${agentId}.`,
      }
    })
  }

  completeMessage(sessionId: string, messageId: string, input: AgentControlCompleteInput = {}): AgentControlCompletionResult {
    const agentId = normalizeString(input.agentId, sessionId)
    const result = normalizeCompletionResult(input.status)
    const text = String(input.text ?? '').trim()
    const evidencePath = normalizeOptionalString(input.evidencePath)
    const message = this.updateMessage(sessionId, messageId, current => {
      if (current.direction !== 'operator-to-agent') {
        throw new Error(`Message ${messageId} is not an operator-to-agent task.`)
      }
      if (!['queued', 'claimed', 'completed', 'failed', 'cancelled'].includes(current.status)) {
        throw new Error(`Message ${messageId} cannot be completed from status ${current.status}.`)
      }
      return {
        ...current,
        status: result,
        claimedBy: current.claimedBy ?? agentId,
        claimedAt: current.claimedAt ?? Date.now(),
        completedAt: Date.now(),
        result,
        evidencePath,
        responsePreview: text || `Marked ${result} by ${agentId}.`,
        warnings: result === 'completed'
          ? current.warnings
          : uniqueStrings([...current.warnings, `Agent marked this task ${result}.`]),
      }
    })
    const reply = text
      ? this.postReply(sessionId, { text, from: agentId })
      : undefined
    return { message, reply }
  }

  getTranscript(sessionId: string, input: AgentControlTranscriptQueryInput = {}): AgentControlTranscriptReport {
    const session = this.summarizeSession(this.getSessionConfig(sessionId), getAgentControlModelOptions())
    const query = normalizeOptionalString(input.query)?.toLowerCase() ?? ''
    const status = normalizeOptionalMessageStatus(input.status)
    const limit = normalizePositiveInteger(input.limit, 200, 1000)
    const messages = this.readMessages(session.sessionId)
      .filter(message => !status || message.status === status)
      .filter(message => !query || messageSearchText(message).includes(query))
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-limit)
    return {
      session,
      generatedAt: Date.now(),
      messageCount: messages.length,
      messages,
      summary: this.buildConversationSummary(session, messages),
      storage: {
        messagesPath: this.relativeProjectPath(this.messagesPath(session.sessionId)),
        summaryPath: this.relativeProjectPath(this.summaryPath(session.sessionId)),
      },
    }
  }

  searchTranscripts(input: AgentControlTranscriptQueryInput = {}): AgentControlTranscriptSearchReport {
    const query = normalizeOptionalString(input.query)?.toLowerCase() ?? ''
    const sessionId = normalizeOptionalString(input.sessionId)
    const status = normalizeOptionalMessageStatus(input.status)
    const limit = normalizePositiveInteger(input.limit, 50, 200)
    const sessions = this.readSessionConfigs().map(config => this.summarizeSession(config, getAgentControlModelOptions()))
    const hits = sessions
      .filter(session => !sessionId || session.sessionId === safeAgentControlSegment(sessionId))
      .flatMap(session => this.readMessages(session.sessionId).map(message => ({ session, message })))
      .filter(({ message }) => !status || message.status === status)
      .filter(({ message }) => !query || messageSearchText(message).includes(query))
      .sort((left, right) => right.message.createdAt - left.message.createdAt)
      .slice(0, limit)
      .map(({ session, message }) => ({
        sessionId: session.sessionId,
        sessionName: session.name,
        platformName: session.platformName,
        message,
        matchPreview: buildMatchPreview(message, query),
      }))
    return {
      query,
      generatedAt: Date.now(),
      total: hits.length,
      hits,
    }
  }

  createSessionSummary(sessionId: string): AgentControlConversationSummary {
    const transcript = this.getTranscript(sessionId, { limit: 1000 })
    mkdirSync(dirname(this.summaryPath(transcript.session.sessionId)), { recursive: true })
    writeFileSync(this.summaryPath(transcript.session.sessionId), `${JSON.stringify(transcript.summary, null, 2)}\n`, 'utf-8')
    return transcript.summary
  }

  private getSessionConfig(sessionId: string): AgentControlSessionConfig {
    const existing = this.readSessionConfigs().find(session => session.sessionId === sessionId)
    if (existing) return existing
    const created = { ...this.defaultSessionConfig(), sessionId, name: sessionId, updatedAt: Date.now() }
    this.writeSessionConfigs([created, ...this.readSessionConfigs()])
    return created
  }

  private summarizeSession(
    session: AgentControlSessionConfig,
    modelOptions: AgentControlModelOption[],
  ): AgentControlSessionSummary {
    const platform = this.platformTargets.find(target => target.id === session.platformId)
    const model = modelOptions.find(option => option.id === session.modelId)
    const route = this.feishuRouteForSession(session)
    const messages = this.readMessages(session.sessionId)
    const warnings: string[] = []
    if (!platform) warnings.push(`Agent platform ${session.platformId} is not supported.`)
    if (platform && platform.status !== 'ready') warnings.push(`Agent platform ${platform.name} is not installed in this project.`)
    if (!model) warnings.push(`Model ${session.modelId} is not in the model catalog.`)
    if (session.channelProvider === 'feishu' && !route.configured) warnings.push(`Feishu route target is not configured for ${platform?.name ?? session.platformId}.`)
    const status: AgentControlStatus = !platform || !model
      ? 'missing'
      : platform.status !== 'ready'
        ? 'partial'
        : session.channelProvider === 'feishu' && !route.configured
          ? 'partial'
          : 'ready'
    return {
      ...session,
      status,
      platformName: platform?.name ?? session.platformId,
      platformStatus: platform?.status ?? 'missing',
      model,
      channel: {
        provider: session.channelProvider,
        configured: session.channelProvider === 'dashboard' || route.configured,
        targetLabel: session.channelProvider === 'feishu' ? route.targetLabel : 'dashboard',
        routeId: session.channelProvider === 'feishu' ? route.routeId : session.channelRouteId,
      },
      messageCount: messages.length,
      pendingCount: messages.filter(message => message.direction === 'operator-to-agent' && (message.status === 'queued' || message.status === 'claimed')).length,
      lastMessageAt: messages.length > 0 ? Math.max(...messages.map(message => message.createdAt)) : undefined,
      warnings,
    }
  }

  private defaultSessionConfig(): AgentControlSessionConfig {
    const route = this.defaultFeishuRoute()
    return {
      version: 1,
      sessionId: route.routeId || 'default',
      name: `${this.project.name} default agent`,
      platformId: route.agentPlatformId || 'codex',
      modelId: 'balanced',
      channelProvider: route.configured ? 'feishu' : 'dashboard',
      channelRouteId: route.routeId || 'dashboard-local',
      commandPrefix: route.commandPrefix || '/scale',
      mode: 'dry-run',
      autoImportKnowledge: true,
      updatedAt: Date.now(),
    }
  }

  private defaultFeishuRoute(): AgentControlFeishuRoute {
    const routes = this.normalizedFeishuRoutes()
    return routes.find(route => route.configured)
      ?? routes[0]
      ?? {
        enabled: false,
        configured: false,
        routeId: 'feishu-unconfigured',
        targetType: 'chat',
        targetId: '',
        targetLabel: 'chat:<unset>',
        commandPrefix: '/scale',
      }
  }

  private feishuRouteForPlatform(platformId: string): AgentControlFeishuRoute {
    const routes = this.normalizedFeishuRoutes()
    return routes.find(route => route.agentPlatformId === platformId)
      ?? this.defaultFeishuRoute()
  }

  private feishuRouteForSession(session: AgentControlSessionConfig): AgentControlFeishuRoute {
    const routes = this.normalizedFeishuRoutes()
    return routes.find(route => route.agentPlatformId === session.platformId)
      ?? routes.find(route => route.routeId === session.channelRouteId)
      ?? this.defaultFeishuRoute()
  }

  private normalizedFeishuRoutes(): AgentControlFeishuRoute[] {
    return Array.isArray(this.feishuRoutes) ? this.feishuRoutes : [this.feishuRoutes]
  }

  private configPath(): string {
    return join(this.project.scaleDir, 'agents', 'control-plane.json')
  }

  private messagesDir(): string {
    return join(this.project.scaleDir, 'agents', 'messages')
  }

  private summariesDir(): string {
    return join(this.project.scaleDir, 'agents', 'summaries')
  }

  private messagesPath(sessionId: string): string {
    return join(this.messagesDir(), `${safeAgentControlSegment(sessionId)}.jsonl`)
  }

  private summaryPath(sessionId: string): string {
    return join(this.summariesDir(), `${safeAgentControlSegment(sessionId)}.json`)
  }

  private relativeProjectPath(path: string): string {
    const rel = relative(this.project.projectDir, path)
    return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : path
  }

  private readSessionConfigs(): AgentControlSessionConfig[] {
    const path = this.configPath()
    if (!existsSync(path)) return [this.defaultSessionConfig()]
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as { sessions?: unknown[] }
      const fallback = this.defaultSessionConfig()
      const supportedPlatforms = this.platformTargets.map(target => target.id)
      const modelIds = getAgentControlModelOptions().map(model => model.id)
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.map(session => normalizeAgentControlSession(session, fallback, { supportedPlatforms, modelIds })).filter(Boolean)
        : []
      return sessions.length > 0 ? sessions : [fallback]
    } catch {
      return [this.defaultSessionConfig()]
    }
  }

  private writeSessionConfigs(sessions: AgentControlSessionConfig[]): void {
    const path = this.configPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`, 'utf-8')
  }

  private appendMessage(record: AgentControlMessageRecord): void {
    const path = this.messagesPath(record.sessionId)
    mkdirSync(dirname(path), { recursive: true })
    const previous = existsSync(path) ? readFileSync(path, 'utf-8').trim() : ''
    const next = `${previous ? `${previous}\n` : ''}${JSON.stringify(record)}\n`
    writeFileSync(path, next, 'utf-8')
  }

  private updateMessage(
    sessionId: string,
    messageId: string,
    updater: (message: AgentControlMessageRecord) => AgentControlMessageRecord,
  ): AgentControlMessageRecord {
    const messages = this.readMessages(sessionId)
    const index = messages.findIndex(message => message.id === messageId)
    if (index < 0) throw new Error(`Agent control message not found: ${messageId}`)
    const current = messages[index]
    if (!current) throw new Error(`Agent control message not found: ${messageId}`)
    const next = updater(current)
    messages[index] = next
    this.writeMessages(sessionId, messages)
    return next
  }

  private writeMessages(sessionId: string, messages: AgentControlMessageRecord[]): void {
    const path = this.messagesPath(sessionId)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${messages.map(message => JSON.stringify(message)).join('\n')}\n`, 'utf-8')
  }

  private readMessages(sessionId: string): AgentControlMessageRecord[] {
    const path = this.messagesPath(sessionId)
    if (!existsSync(path) || !statSync(path).isFile()) return []
    return readFileSync(path, 'utf-8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as AgentControlMessageRecord
        } catch {
          return null
        }
      })
      .filter((message): message is AgentControlMessageRecord => Boolean(message))
  }

  private buildConversationSummary(
    session: AgentControlSessionSummary,
    messages: AgentControlMessageRecord[],
  ): AgentControlConversationSummary {
    const ordered = [...messages].sort((left, right) => left.createdAt - right.createdAt)
    const operatorMessages = ordered.filter(message => message.direction === 'operator-to-agent')
    const agentMessages = ordered.filter(message => message.direction === 'agent-to-operator')
    const pendingMessages = operatorMessages.filter(message => message.status === 'queued' || message.status === 'claimed')
    const completedMessages = operatorMessages.filter(message => message.status === 'completed')
    const blockedMessages = ordered.filter(message => ['blocked', 'failed', 'cancelled'].includes(message.status))
    const latestOperator = [...operatorMessages].reverse().find(message => message.text.trim())
    const latestAgent = [...agentMessages].reverse().find(message => message.text.trim())
    const openItems = pendingMessages.map(message => trimForSummary(message.text, 120))
    const decisions = ordered
      .filter(message => message.status === 'completed' || message.direction === 'agent-to-operator')
      .slice(-5)
      .map(message => trimForSummary(message.text, 120))
      .filter(Boolean)
    const nextActions = pendingMessages.length > 0
      ? pendingMessages.slice(0, 5).map(message => `Resolve ${message.id}: ${trimForSummary(message.text, 100)}`)
      : session.warnings.length > 0
        ? session.warnings.slice(0, 5)
        : ['No open agent-control action is currently queued.']
    const warnings = uniqueStrings([
      ...session.warnings,
      ...blockedMessages.flatMap(message => message.warnings),
    ])
    const firstMessageAt = ordered[0]?.createdAt
    const lastMessageAt = ordered[ordered.length - 1]?.createdAt
    const summary: Omit<AgentControlConversationSummary, 'markdown'> = {
      sessionId: session.sessionId,
      title: `${session.name} conversation summary`,
      generatedAt: Date.now(),
      messageCount: ordered.length,
      operatorMessages: operatorMessages.length,
      agentMessages: agentMessages.length,
      pendingMessages: pendingMessages.length,
      completedMessages: completedMessages.length,
      blockedMessages: blockedMessages.length,
      firstMessageAt,
      lastMessageAt,
      latestOperatorText: latestOperator ? trimForSummary(latestOperator.text, 240) : undefined,
      latestAgentText: latestAgent ? trimForSummary(latestAgent.text, 240) : undefined,
      openItems,
      decisions,
      nextActions,
      warnings,
    }
    return {
      ...summary,
      markdown: renderConversationSummaryMarkdown(session, summary),
    }
  }
}

export function getAgentControlModelOptions(): AgentControlModelOption[] {
  const defaults = Object.values(DEFAULT_MODELS).map(model => modelOptionFromConfig(model.name === 'local-llm' ? 'local' : model.tier, model, 'default'))
  const locals = Object.entries(LOCAL_MODELS).map(([id, model]) => modelOptionFromConfig(id, model, 'local'))
  return [...defaults, ...locals]
}

function modelOptionFromConfig(id: string, model: ModelConfig, provider: string): AgentControlModelOption {
  return {
    id,
    label: `${model.name} (${model.tier})`,
    provider,
    tier: model.tier,
    modelId: model.name,
    maxTokens: model.maxTokens,
    costPerMToken: model.costPerMToken,
    modalities: model.modalities,
  }
}

function normalizeAgentControlSession(
  input: unknown,
  fallback: AgentControlSessionConfig,
  options: { supportedPlatforms: string[]; modelIds: string[]; strict?: boolean },
): AgentControlSessionConfig {
  const record = isRecord(input) ? input : {}
  const platformId = normalizeString(record.platformId, fallback.platformId)
  const modelId = normalizeString(record.modelId, fallback.modelId)
  if (options.strict && !options.supportedPlatforms.includes(platformId)) {
    throw new Error(`Unsupported agent platform: ${platformId}`)
  }
  if (options.strict && !options.modelIds.includes(modelId)) {
    throw new Error(`Unsupported model: ${modelId}`)
  }
  return {
    version: 1,
    sessionId: safeAgentControlSegment(normalizeString(record.sessionId, fallback.sessionId)),
    name: normalizeString(record.name, fallback.name),
    platformId: options.supportedPlatforms.includes(platformId) ? platformId : fallback.platformId,
    modelId: options.modelIds.includes(modelId) ? modelId : fallback.modelId,
    channelProvider: record.channelProvider === 'feishu' ? 'feishu' : record.channelProvider === 'dashboard' ? 'dashboard' : fallback.channelProvider,
    channelRouteId: normalizeString(record.channelRouteId, fallback.channelRouteId),
    commandPrefix: normalizeCommandPrefix(record.commandPrefix, fallback.commandPrefix),
    mode: normalizeMode(record.mode, fallback.mode),
    autoImportKnowledge: typeof record.autoImportKnowledge === 'boolean' ? record.autoImportKnowledge : fallback.autoImportKnowledge,
    updatedAt: Date.now(),
  }
}

function normalizeMode(value: unknown, fallback: AgentControlMode): AgentControlMode {
  return value === 'interactive' || value === 'live-guarded' || value === 'dry-run' ? value : fallback
}

function normalizeCommandPrefix(value: unknown, fallback: string): string {
  const normalized = normalizeString(value, fallback)
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim()
  return normalized || fallback
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim()
  return normalized || undefined
}

function normalizeCompletionResult(value: unknown): 'completed' | 'failed' | 'cancelled' {
  const normalized = String(value ?? 'completed').trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'failed' || normalized === 'cancelled') return normalized
  throw new Error(`Unsupported agent task result: ${String(value)}`)
}

function normalizeOptionalMessageStatus(value: unknown): AgentControlMessageStatus | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  const statuses: AgentControlMessageStatus[] = ['queued', 'claimed', 'completed', 'failed', 'cancelled', 'blocked', 'delivered']
  return statuses.find(status => status === normalized)
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(Math.max(1, Math.floor(number)), max)
}

function messageSearchText(message: AgentControlMessageRecord): string {
  return [
    message.id,
    message.sessionId,
    message.direction,
    message.from,
    message.to,
    message.text,
    message.status,
    message.platformId,
    message.modelId,
    message.channelProvider,
    message.channelRouteId,
    message.evidencePath,
    message.responsePreview,
    ...message.warnings,
  ].filter(Boolean).join(' ').toLowerCase()
}

function buildMatchPreview(message: AgentControlMessageRecord, query: string): string {
  const text = message.text || message.responsePreview || message.id
  if (!query) return trimForSummary(text, 180)
  const lower = text.toLowerCase()
  const index = lower.indexOf(query)
  if (index < 0) return trimForSummary(text, 180)
  const start = Math.max(0, index - 60)
  const end = Math.min(text.length, index + query.length + 90)
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`
}

function trimForSummary(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 3))}...`
}

function renderConversationSummaryMarkdown(
  session: AgentControlSessionSummary,
  summary: Omit<AgentControlConversationSummary, 'markdown'>,
): string {
  const lines = [
    `# ${summary.title}`,
    '',
    `- Session: ${session.sessionId}`,
    `- Platform: ${session.platformName} (${session.platformStatus})`,
    `- Model: ${session.model?.label ?? session.modelId}`,
    `- Channel: ${session.channel.provider} / ${session.channel.targetLabel}`,
    `- Messages: ${summary.messageCount} total, ${summary.pendingMessages} pending, ${summary.completedMessages} completed, ${summary.blockedMessages} blocked`,
    '',
    '## Latest Context',
    `- Operator: ${summary.latestOperatorText ?? '-'}`,
    `- Agent: ${summary.latestAgentText ?? '-'}`,
    '',
    '## Open Items',
    ...markdownBullets(summary.openItems.length ? summary.openItems : ['No open agent-control item.']),
    '',
    '## Decisions And Evidence',
    ...markdownBullets(summary.decisions.length ? summary.decisions : ['No completed decision has been recorded yet.']),
    '',
    '## Next Actions',
    ...markdownBullets(summary.nextActions),
  ]
  if (summary.warnings.length) {
    lines.push('', '## Warnings', ...markdownBullets(summary.warnings))
  }
  return `${lines.join('\n')}\n`
}

function markdownBullets(values: string[]): string[] {
  return values.map(value => `- ${value}`)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function safeAgentControlSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'default'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function renderAgentControlFeishuText(session: AgentControlSessionConfig, text: string): string {
  return [
    `SCALE Agent ${session.sessionId}`,
    `platform=${session.platformId}`,
    `model=${session.modelId}`,
    `${session.commandPrefix} message ${text}`,
  ].join('\n')
}
