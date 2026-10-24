import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentControlPlane } from '../../src/dashboard/AgentControlPlane.js'
import { safeRmSync } from '../helpers/fs.js'

// spawn mock：记录调用参数，返回可手动驱动的子进程桩
const spawnCalls: Array<{ command: string; args: string[]; child: ChildProcessStub }> = []

interface ChildProcessStub extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  exitCode: number | null
  kill: () => void
}

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[]) => {
      const child = new EventEmitter() as ChildProcessStub
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.exitCode = null
      child.kill = vi.fn(() => {
        child.exitCode = 143
        setImmediate(() => child.emit('close', 143))
      })
      spawnCalls.push({ command, args, child })
      return child
    }),
  }
})

const tempRoots: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of tempRoots.splice(0)) safeRmSync(root)
  spawnCalls.length = 0
})

function buildPlane(
  session: Record<string, unknown>,
  platforms: Array<{ id: string; name: string; status: string }> = [{ id: 'claude-code', name: 'Claude Code', status: 'ready' }],
): AgentControlPlane {
  const projectDir = makeTempDir('scale-agent-cli-')
  const scaleDir = join(projectDir, '.scale')
  const plane = new AgentControlPlane(
    { id: 'p1', name: 'Test', projectDir, scaleDir },
    platforms,
    [],
  )
  const configPath = join(scaleDir, 'agents', 'control-plane.json')
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    sessions: [{
      version: 1, sessionId: 's1', name: 'S1', platformId: 'claude-code', modelId: 'balanced',
      channelProvider: 'dashboard', channelRouteId: 'dashboard-local', commandPrefix: '/scale',
      mode: 'live-guarded', autoImportKnowledge: true, localExecutor: true, updatedAt: Date.now(),
      ...session,
    }],
  }), 'utf-8')
  return plane
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('AgentControl agent-cli executor', () => {
  it('dispatches the platform default CLI command with the prompt substituted', async () => {
    const plane = buildPlane({ executor: 'agent-cli' })
    const record = plane.sendMessage('s1', { text: '修复登录页的样式问题', dryRun: false })
    const claimed = await plane.executeLocallyIfEnabled('s1', record.id)

    expect(claimed).not.toBeNull()
    expect(claimed!.status).toBe('claimed')
    expect(spawnCalls).toHaveLength(1)
    // Windows 上 npm 全局 CLI 是 .cmd 垫片，会被包装成 `cmd.exe /d /c call <shim>`；
    // 断言真实不变量：调用的确是 claude CLI，且 prompt 与参数完整传递。
    const invocation = `${spawnCalls[0].command} ${spawnCalls[0].args.join(' ')}`
    expect(invocation).toContain('claude')
    expect(spawnCalls[0].args).toContain('修复登录页的样式问题')
    expect(invocation).toContain('-p')
    expect(invocation).toContain('--output-format text')

    spawnCalls[0].child.stdout.emit('data', '已完成登录页样式修复')
    spawnCalls[0].child.exitCode = 0
    spawnCalls[0].child.emit('close', 0)
    await settle()

    const messages = plane.getTranscript('s1').messages
    const final = messages.find(m => m.id === record.id)
    expect(final!.status).toBe('completed')
    const reply = messages.find(m => m.direction === 'agent-to-operator')
    expect(reply).toBeDefined()
    expect(reply!.text).toContain('[agent-cli]')
    expect(reply!.text).toContain('已完成登录页样式修复')
  })

  it('honors a custom agentCommand template with {prompt}', async () => {
    const plane = buildPlane({ executor: 'agent-cli', agentCommand: 'cdx run {prompt} --json' })
    const record = plane.sendMessage('s1', { text: 'do work', dryRun: false })
    await plane.executeLocallyIfEnabled('s1', record.id)
    expect(spawnCalls[0].command).toBe('cdx')
    expect(spawnCalls[0].args).toEqual(['run', 'do work', '--json'])
    spawnCalls[0].child.emit('close', 0)
    await settle()
  })

  it('marks failed with stderr when the CLI exits non-zero', async () => {
    const plane = buildPlane({ executor: 'agent-cli' })
    const record = plane.sendMessage('s1', { text: 'x', dryRun: false })
    await plane.executeLocallyIfEnabled('s1', record.id)
    spawnCalls[0].child.stderr.emit('data', 'not authenticated: run claude login')
    spawnCalls[0].child.exitCode = 1
    spawnCalls[0].child.emit('close', 1)
    await settle()

    const final = plane.getTranscript('s1').messages.find(m => m.id === record.id)
    expect(final!.status).toBe('failed')
    const reply = plane.getTranscript('s1').messages.find(m => m.direction === 'agent-to-operator')
    expect(reply!.text).toContain('执行失败')
    expect(reply!.text).toContain('not authenticated')
  })

  it('fails fast when the platform has no CLI mapping and no template', async () => {
    // cursor 在 supportedPlatforms 里（不会被归一化回退），但不在 AGENT_CLI_COMMANDS 映射表里
    const plane = buildPlane(
      { executor: 'agent-cli', platformId: 'cursor' },
      [{ id: 'cursor', name: 'Cursor', status: 'ready' }],
    )
    const record = plane.sendMessage('s1', { text: 'x', dryRun: false })
    await plane.executeLocallyIfEnabled('s1', record.id)
    await settle()
    expect(spawnCalls).toHaveLength(0)
    const final = plane.getTranscript('s1').messages.find(m => m.id === record.id)
    expect(final!.status).toBe('failed')
    expect(plane.getTranscript('s1').messages.find(m => m.direction === 'agent-to-operator')!.text).toContain('没有可用的 CLI 命令映射')
  })

  it('rejects a second message while an agent is already running in the session', async () => {
    const plane = buildPlane({ executor: 'agent-cli' })
    const first = plane.sendMessage('s1', { text: 'first', dryRun: false })
    await plane.executeLocallyIfEnabled('s1', first.id)
    const second = plane.sendMessage('s1', { text: 'second', dryRun: false })
    await plane.executeLocallyIfEnabled('s1', second.id)
    await settle()

    expect(spawnCalls).toHaveLength(1)
    const secondFinal = plane.getTranscript('s1').messages.find(m => m.id === second.id)
    expect(secondFinal!.status).toBe('failed')
    spawnCalls[0].child.emit('close', 0)
    await settle()
  })

  it('kills the child and reports failure when the CLI times out', async () => {
    const plane = buildPlane({ executor: 'agent-cli' })
    // 缩短超时窗口：不依赖 10 分钟真实等待，也避开假定时器与 child_process mock 的干扰
    const timeoutHolder = plane.constructor as unknown as { AGENT_CLI_TIMEOUT_MS: number }
    const originalTimeout = timeoutHolder.AGENT_CLI_TIMEOUT_MS
    timeoutHolder.AGENT_CLI_TIMEOUT_MS = 60
    try {
      const record = plane.sendMessage('s1', { text: 'slow', dryRun: false })
      await plane.executeLocallyIfEnabled('s1', record.id)
      expect(spawnCalls[0].child.kill).not.toHaveBeenCalled()
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(spawnCalls[0].child.kill).toHaveBeenCalled()
      await settle()
      const messages = plane.getTranscript('s1').messages
      expect(messages.find(m => m.id === record.id)!.status).toBe('failed')
      expect(messages.find(m => m.direction === 'agent-to-operator')!.text).toContain('超时')
    } finally {
      timeoutHolder.AGENT_CLI_TIMEOUT_MS = originalTimeout
    }
  })

  it('adds session-continuity flags on the second run in the same session', async () => {
    const plane = buildPlane({ executor: 'agent-cli' })
    const first = plane.sendMessage('s1', { text: 'first task', dryRun: false })
    await plane.executeLocallyIfEnabled('s1', first.id)
    const firstInvocation = `${spawnCalls[0].command} ${spawnCalls[0].args.join(' ')}`
    expect(firstInvocation).not.toContain('--continue')

    spawnCalls[0].child.stdout.emit('data', 'done first')
    spawnCalls[0].child.exitCode = 0
    spawnCalls[0].child.emit('close', 0)
    await settle()

    // 第二条消息：claude 模板应注入 --continue 保持对话上下文
    const second = plane.sendMessage('s1', { text: 'continue it', dryRun: false })
    await plane.executeLocallyIfEnabled('s1', second.id)
    const secondInvocation = `${spawnCalls[1].command} ${spawnCalls[1].args.join(' ')}`
    expect(secondInvocation).toContain('--continue')
    expect(secondInvocation).toContain('continue it')
    spawnCalls[1].child.emit('close', 0)
    await settle()
  })

  it('keeps the governed executor as the default when executor is not agent-cli', async () => {
    const plane = buildPlane({})
    const record = plane.sendMessage('s1', { text: 'x', dryRun: false })
    const final = await plane.executeLocallyIfEnabled('s1', record.id)
    expect(spawnCalls).toHaveLength(0)
    expect(final).not.toBeNull()
    expect(final!.status).toBe('completed')
    expect(final!.claimedBy).toBe('local-executor')
  })
})
