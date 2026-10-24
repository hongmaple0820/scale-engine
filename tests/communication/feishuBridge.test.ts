// FeishuBridge 测试：入站事件 → 执行器 → 回复回流飞书
// 用真实子进程桩替换 lark-cli 的消费命令，runner 注入捕获出站命令。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EventBus } from '../../src/core/eventBus.js'
import { FeishuBridge } from '../../src/communication/FeishuBridge.js'
import { AgentControlPlane } from '../../src/dashboard/AgentControlPlane.js'
import { safeRmSync } from '../helpers/fs.js'

const tempRoots: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of tempRoots.splice(0)) safeRmSync(root)
})

function buildPlane(projectDir: string, session: Record<string, unknown> = {}): AgentControlPlane {
  const scaleDir = join(projectDir, '.scale')
  // 飞书会话要求路由已配置，否则 sendMessage 会按治理规则标记 blocked
  const plane = new AgentControlPlane(
    { id: 'p1', name: 'Test', projectDir, scaleDir },
    [{ id: 'claude-code', name: 'Claude Code', status: 'ready' }],
    [{
      enabled: true,
      configured: true,
      routeId: 'feishu-route',
      agentPlatformId: 'claude-code',
      targetType: 'chat' as const,
      targetId: 'oc_chat_1',
      targetLabel: 'Test chat',
      commandPrefix: '/scale',
    }],
  )
  // 桩脚本绝对路径：子进程 cwd 是项目目录，相对路径会找不到
  const stubPath = join(process.cwd(), 'tmp', 'agent-stub.js')
  const configPath = join(scaleDir, 'agents', 'control-plane.json')
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    sessions: [{
      version: 1, sessionId: 's1', name: 'S1', platformId: 'claude-code', modelId: 'balanced',
      channelProvider: 'feishu', channelRouteId: 'feishu-route', commandPrefix: '/scale',
      mode: 'live-guarded', autoImportKnowledge: true, localExecutor: true, executor: 'agent-cli',
      agentCommand: `node ${stubPath} {prompt}`, updatedAt: Date.now(),
      ...session,
    }],
  }), 'utf-8')
  return plane
}

function feishuEventLine(chatId: string, text: string, messageId: string): string {
  return JSON.stringify({
    event: {
      message: { message_id: messageId, chat_id: chatId, content: JSON.stringify({ text }) },
      sender: { sender_id: { open_id: 'ou_user_a' } },
    },
  })
}

describe('FeishuBridge', () => {
  it('routes an inbound event to the executor and sends the agent reply back to Feishu', async () => {
    const dir = makeTempDir('scale-feishu-bridge-')
    const plane = buildPlane(dir)
    const bus = new EventBus({ eventsDir: join(dir, '.scale', 'events') })
    const bridge = new FeishuBridge({
      projectDir: dir,
      sessionId: 's1',
      plane: () => plane,
      bus,
    })
    const outbound: Array<{ command: string; args: string[] }> = []
    const runner = (command: string, args: string[]) => { outbound.push({ command, args }) }

    // 命令前缀门槛：只有 /scale 开头的消息才派发
    bridge.handleEventLine(feishuEventLine('oc_chat_1', '今天天气怎么样', 'om_0'))
    expect(bridge.status().counters.routed).toBe(0)

    bridge.handleEventLine(feishuEventLine('oc_chat_1', '/scale 修复登录页', 'om_1'))
    // 桩进程（node tmp/agent-stub.js）是异步执行的，等待其完成 + 事件回流
    await new Promise(resolve => setTimeout(resolve, 1500))

    const messages = plane.getTranscript('s1', { limit: 10 }).messages
    const inbound = messages.find(m => m.direction === 'operator-to-agent')
    expect(inbound!.text).toBe('修复登录页')
    expect(inbound!.channelProvider).toBe('feishu')
    const reply = messages.find(m => m.direction === 'agent-to-operator')
    if (!reply) {
      throw new Error(`no reply yet; transcript=${JSON.stringify(messages.map(m => ({ d: m.direction, s: m.status, t: m.text.slice(0, 80) })))}`)
    }
    expect(reply.text).toContain('agent-stub received prompt')

    // 出站：把回复发回原聊天
    bridge.sendToFeishu('oc_chat_1', reply!.text, runner)
    expect(outbound).toHaveLength(1)
    expect(outbound[0].command).toBe('lark-cli')
    expect(outbound[0].args).toContain('--chat-id')
    expect(outbound[0].args).toContain('oc_chat_1')
    expect(outbound[0].args).toContain('--text')
    expect(outbound[0].args.some(arg => arg.includes('agent-stub received prompt'))).toBe(true)
    // 真实发送必须去掉 dry-run
    expect(outbound[0].args).not.toContain('--dry-run')
  })

  it('ignores duplicate events for the same message id', () => {
    const dir = makeTempDir('scale-feishu-bridge-dedupe-')
    const plane = buildPlane(dir)
    const bus = new EventBus({ eventsDir: join(dir, '.scale', 'events') })
    const bridge = new FeishuBridge({ projectDir: dir, sessionId: 's1', plane: () => plane, bus })
    const line = feishuEventLine('oc_chat_2', '/scale 重复消息', 'om_dup')
    bridge.handleEventLine(line)
    bridge.handleEventLine(line)
    const status = bridge.status()
    expect(status.counters.received).toBe(1)
    // 第二次被 message_id 去重跳过
    expect(status.counters.skipped).toBe(1)
  })

  it('skips its own replies to avoid an echo loop', () => {
    const dir = makeTempDir('scale-feishu-bridge-echo-')
    const plane = buildPlane(dir)
    const bus = new EventBus({ eventsDir: join(dir, '.scale', 'events') })
    const bridge = new FeishuBridge({ projectDir: dir, sessionId: 's1', plane: () => plane, bus })
    // 回环保护在 received 计数之前生效，无需加前缀也应被跳过
    bridge.handleEventLine(feishuEventLine('oc_chat_3', '[agent-cli] 已完成（exit 0，1s）', 'om_echo'))
    expect(bridge.status().counters.received).toBe(0)
    expect(bridge.status().counters.skipped).toBe(1)
  })

  it('ignores non-JSON and unrelated lines from the event stream', () => {
    const dir = makeTempDir('scale-feishu-bridge-noise-')
    const plane = buildPlane(dir)
    const bus = new EventBus({ eventsDir: join(dir, '.scale', 'events') })
    const bridge = new FeishuBridge({ projectDir: dir, sessionId: 's1', plane: () => plane, bus })
    bridge.handleEventLine('connecting to feishu...')
    bridge.handleEventLine('{"event":{"message":{"message_id":"x"}}}')
    expect(bridge.status().counters.received).toBe(0)
    expect(bridge.status().counters.failed).toBe(0)
  })

  it('chunks long replies at newline boundaries instead of truncating', () => {
    const dir = makeTempDir('scale-feishu-bridge-chunk-')
    const plane = buildPlane(dir)
    const bus = new EventBus({ eventsDir: join(dir, '.scale', 'events') })
    const bridge = new FeishuBridge({ projectDir: dir, sessionId: 's1', plane: () => plane, bus, replyMaxChars: 40 })
    const outbound: Array<{ command: string; args: string[] }> = []
    const runner = (command: string, args: string[]) => { outbound.push({ command, args }) }

    const longText = ['第一行：分析开始并读取文件', '第二行：修改了文件 A 和文件 B', '第三行：修改了文件 C 和文件 D', '第四行：全部验证通过并完成收尾'].join('\n')
    const result = bridge.sendToFeishu('oc_chunk', longText, runner)
    expect(result.ok).toBe(true)
    expect(result.chunks).toBeGreaterThan(1)
    expect(outbound.length).toBe(result.chunks)
    // 每片都带序号标记，且内容没有丢失（拼接后能找回首尾行的关键词）
    const joined = outbound.map(call => call.args.join(' ')).join(' ')
    expect(joined).toContain('【1/')
    expect(joined).toContain('第一行')
    expect(joined).toContain('第四行')
    expect(joined).not.toContain('已截断')
  })

  it('reports readiness blockers instead of pretending the bridge can work', () => {
    const dir = makeTempDir('scale-feishu-bridge-ready-')
    const plane = buildPlane(dir, { mode: 'dry-run', localExecutor: false })
    const bus = new EventBus({ eventsDir: join(dir, '.scale', 'events') })
    const bridge = new FeishuBridge({ projectDir: dir, sessionId: 's1', plane: () => plane, bus })
    const status = bridge.status()
    expect(status.running).toBe(false)
    // 未启动时消费循环不跑，状态里暴露 running:false 供 UI 提示
    expect(status.counters.received).toBe(0)
    expect(status.sessionId).toBe('s1')
  })
})
