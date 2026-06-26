import { describe, expect, it } from 'vitest'
import { AgentChannel } from '../../src/agents/AgentChannel.js'
import {
  buildFeishuEventConsumeCommand,
  buildFeishuSendMessageCommand,
  parseFeishuEventLine,
  parseScaleCommand,
  routeFeishuMessageToAgent,
} from '../../src/communication/FeishuChannelProvider.js'

describe('FeishuChannelProvider', () => {
  it('builds safe lark-cli send commands with dry-run enabled by default', () => {
    const plan = buildFeishuSendMessageCommand({
      chatId: 'oc_demo',
      text: 'SCALE status changed',
      idempotencyKey: 'scale-msg-1',
    })

    expect(plan).toEqual({
      command: 'lark-cli',
      args: [
        'im',
        '+messages-send',
        '--chat-id',
        'oc_demo',
        '--text',
        'SCALE status changed',
        '--idempotency-key',
        'scale-msg-1',
        '--dry-run',
      ],
      risk: 'write',
      requiresConfirmation: false,
      description: 'Send Feishu text message to chat',
    })
  })

  it('marks live writes as confirmation-required', () => {
    const plan = buildFeishuSendMessageCommand({
      userId: 'ou_demo',
      text: 'Run approved',
      mode: 'markdown',
      as: 'bot',
      dryRun: false,
    })

    expect(plan.args).toEqual([
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--user-id',
      'ou_demo',
      '--markdown',
      'Run approved',
    ])
    expect(plan.requiresConfirmation).toBe(true)
  })

  it('builds bounded event consumers for Feishu mobile and bot workflows', () => {
    const plan = buildFeishuEventConsumeCommand({
      eventKey: 'im.message.receive_v1',
      as: 'bot',
      maxEvents: 1,
      timeout: '30s',
      quiet: true,
    })

    expect(plan).toEqual({
      command: 'lark-cli',
      args: ['event', 'consume', 'im.message.receive_v1', '--as', 'bot', '--max-events', '1', '--timeout', '30s', '--quiet'],
      risk: 'read',
      requiresConfirmation: false,
      description: 'Consume Feishu event stream im.message.receive_v1',
    })
  })

  it('parses Feishu NDJSON message events and routes scale commands to AgentChannel', () => {
    const inbound = parseFeishuEventLine(JSON.stringify({
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_sender',
          },
        },
        message: {
          message_id: 'om_demo',
          chat_id: 'oc_demo',
          content: JSON.stringify({ text: '/scale run build --dry-run' }),
        },
      },
    }))

    expect(inbound).toMatchObject({
      provider: 'feishu',
      messageId: 'om_demo',
      chatId: 'oc_demo',
      senderId: 'ou_sender',
      text: '/scale run build --dry-run',
    })

    const channel = new AgentChannel()
    const routed = routeFeishuMessageToAgent(channel, inbound!, { targetAgentId: 'orchestrator' })

    expect(routed).toMatchObject({
      from: 'feishu:ou_sender',
      to: 'orchestrator',
      type: 'task-request',
    })
    expect(channel.receive('orchestrator')).toEqual([routed])
    expect(routed.payload).toMatchObject({
      provider: 'feishu',
      command: {
        verb: 'run',
        args: ['build', '--dry-run'],
        requiresConfirmation: true,
      },
    })
  })

  it('classifies read-only scale commands separately from write commands', () => {
    expect(parseScaleCommand('/scale status')).toMatchObject({
      verb: 'status',
      requiresConfirmation: false,
    })
    expect(parseScaleCommand('/scale stop TASK-1')).toMatchObject({
      verb: 'stop',
      args: ['TASK-1'],
      requiresConfirmation: true,
    })
  })
})
