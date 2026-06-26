import type { AgentMessage, MessageType } from '../agents/types.js'
import type { IAgentChannel } from '../agents/AgentChannel.js'

export type FeishuIdentity = 'bot' | 'user' | 'auto'
export type FeishuSendMode = 'text' | 'markdown'

export interface FeishuCommandPlan {
  command: 'lark-cli'
  args: string[]
  risk: 'read' | 'write'
  requiresConfirmation: boolean
  description: string
}

export interface FeishuSendMessageInput {
  chatId?: string
  userId?: string
  text: string
  mode?: FeishuSendMode
  as?: Exclude<FeishuIdentity, 'auto'>
  dryRun?: boolean
  idempotencyKey?: string
}

export interface FeishuEventConsumeInput {
  eventKey: string
  as?: FeishuIdentity
  maxEvents?: number
  timeout?: string
  quiet?: boolean
}

export interface FeishuInboundMessage {
  provider: 'feishu'
  messageId?: string
  chatId?: string
  senderId?: string
  text: string
  raw: unknown
}

export interface FeishuAgentRouteOptions {
  targetAgentId?: string
  fromPrefix?: string
}

export interface FeishuAgentPayload {
  provider: 'feishu'
  messageId?: string
  chatId?: string
  senderId?: string
  text: string
  command?: FeishuScaleCommand
  raw: unknown
}

export interface FeishuScaleCommand {
  raw: string
  verb: string
  args: string[]
  requiresConfirmation: boolean
}

const READ_ONLY_SCALE_COMMANDS = new Set(['status', 'projects', 'sessions', 'help'])
const WRITE_SCALE_COMMANDS = new Set(['plan', 'run', 'stop', 'ship'])

export function buildFeishuSendMessageCommand(input: FeishuSendMessageInput): FeishuCommandPlan {
  assertExactlyOneTarget(input)
  if (!input.text.trim()) throw new Error('Feishu message text must not be empty')

  const mode = input.mode ?? 'text'
  const args = ['im', '+messages-send']
  if (input.as) args.push('--as', input.as)
  if (input.chatId) args.push('--chat-id', input.chatId)
  if (input.userId) args.push('--user-id', input.userId)
  args.push(mode === 'markdown' ? '--markdown' : '--text', input.text)
  if (input.idempotencyKey) args.push('--idempotency-key', input.idempotencyKey)
  if (input.dryRun !== false) args.push('--dry-run')

  return {
    command: 'lark-cli',
    args,
    risk: 'write',
    requiresConfirmation: input.dryRun === false,
    description: `Send Feishu ${mode} message to ${input.chatId ? 'chat' : 'user'}`,
  }
}

export function buildFeishuEventConsumeCommand(input: FeishuEventConsumeInput): FeishuCommandPlan {
  if (!input.eventKey.trim()) throw new Error('Feishu event key must not be empty')
  const args = ['event', 'consume', input.eventKey]
  if (input.as) args.push('--as', input.as)
  if (typeof input.maxEvents === 'number') args.push('--max-events', String(input.maxEvents))
  if (input.timeout) args.push('--timeout', input.timeout)
  if (input.quiet) args.push('--quiet')
  return {
    command: 'lark-cli',
    args,
    risk: 'read',
    requiresConfirmation: false,
    description: `Consume Feishu event stream ${input.eventKey}`,
  }
}

export function parseFeishuEventLine(line: string): FeishuInboundMessage | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }

  const root = asRecord(parsed)
  if (!root) return null
  const event = asRecord(root.event) ?? asRecord(asRecord(root.data)?.event) ?? root
  const message = asRecord(event.message) ?? event
  const text = extractMessageText(message)
  if (!text) return null

  return {
    provider: 'feishu',
    messageId: stringValue(message.message_id) ?? stringValue(message.messageId),
    chatId: stringValue(message.chat_id) ?? stringValue(message.chatId),
    senderId: extractSenderId(event),
    text,
    raw: parsed,
  }
}

export function routeFeishuMessageToAgent(
  channel: IAgentChannel,
  message: FeishuInboundMessage,
  options: FeishuAgentRouteOptions = {},
): AgentMessage {
  const command = parseScaleCommand(message.text)
  const payload: FeishuAgentPayload = {
    provider: 'feishu',
    messageId: message.messageId,
    chatId: message.chatId,
    senderId: message.senderId,
    text: message.text,
    command,
    raw: message.raw,
  }
  return channel.send(
    `${options.fromPrefix ?? 'feishu'}:${message.senderId ?? message.chatId ?? 'unknown'}`,
    options.targetAgentId ?? 'planner',
    command ? commandMessageType(command) : 'task-request',
    payload,
  )
}

export function parseScaleCommand(text: string): FeishuScaleCommand | undefined {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts[0] !== '/scale' || !parts[1]) return undefined
  const verb = parts[1].toLowerCase()
  const requiresConfirmation = WRITE_SCALE_COMMANDS.has(verb)
  return {
    raw: text,
    verb,
    args: parts.slice(2),
    requiresConfirmation,
  }
}

function commandMessageType(command: FeishuScaleCommand): MessageType {
  if (READ_ONLY_SCALE_COMMANDS.has(command.verb)) return 'status-update'
  return 'task-request'
}

function assertExactlyOneTarget(input: FeishuSendMessageInput): void {
  if (Boolean(input.chatId) === Boolean(input.userId)) {
    throw new Error('Exactly one of chatId or userId is required')
  }
}

function extractMessageText(message: Record<string, unknown>): string | undefined {
  const content = stringValue(message.content) ?? stringValue(message.text)
  if (!content) return undefined
  const parsedContent = parseJsonRecord(content)
  return stringValue(parsedContent?.text)
    ?? stringValue(parsedContent?.content)
    ?? content
}

function extractSenderId(event: Record<string, unknown>): string | undefined {
  const sender = asRecord(event.sender)
  const senderId = asRecord(sender?.sender_id) ?? asRecord(event.sender_id)
  return stringValue(senderId?.open_id)
    ?? stringValue(senderId?.user_id)
    ?? stringValue(sender?.open_id)
    ?? stringValue(event.open_id)
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
