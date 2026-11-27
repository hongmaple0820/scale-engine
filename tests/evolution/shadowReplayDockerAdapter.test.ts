import { createHash } from 'node:crypto'
import { execa } from 'execa'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockerShadowReplayAdapter, type DockerCommandRunner } from '../../src/evolution/ShadowReplayDockerAdapter.js'
import { executeShadowReplay, type ShadowReplayPlan } from '../../src/evolution/ShadowReplayContract.js'
const IMAGE = `ghcr.io/example/scale-shadow-runner@sha256:${'c'.repeat(64)}`
const dirs: string[] = []
function digest(value: string): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function inputs() {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-replay-test-')); dirs.push(dir)
  const scenarioSnapshotPath = join(dir, 'scenario.json'); const candidateBundlePath = join(dir, 'candidate.bundle')
  writeFileSync(scenarioSnapshotPath, '{"case":"failure-1"}'); writeFileSync(candidateBundlePath, 'reviewed-candidate-bundle')
  return { scenarioSnapshotPath, candidateBundlePath, scenarioDigest: digest('{"case":"failure-1"}'), candidateDigest: digest('reviewed-candidate-bundle') }
}
function plan(data: ReturnType<typeof inputs>): ShadowReplayPlan {
  return { contractVersion: 1, runId: 'SHADOW-REPLAY-12345678', candidateId: 'IMPROVE-1', failureId: 'FAIL-1',
    sourceCommitSha: 'a'.repeat(40), scenarioSnapshotDigest: data.scenarioDigest, candidateBundleDigest: data.candidateDigest,
    adapterId: 'docker-container', adapterVersion: '1.0.0', sandboxKind: 'container',
    limits: { timeoutMs: 10_000, memoryLimitMb: 512, cpuTimeLimitMs: 10_000 }, createdAt: '2026-11-26T00:00:00.000Z' }
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
describe('DockerShadowReplayAdapter', () => {
  it('requires a digest-pinned runner image', () => { expect(() => new DockerShadowReplayAdapter({ imageRef: 'latest' })).toThrow('pinned by an immutable sha256 digest') })
  it('verifies inputs before invoking Docker', async () => {
    const data = inputs(); const runner = vi.fn<DockerCommandRunner>()
    const adapter = new DockerShadowReplayAdapter({ imageRef: IMAGE, runner })
    await expect(adapter.execute({ ...plan(data), scenarioSnapshotDigest: digest('wrong') }, data)).rejects.toThrow('scenario snapshot digest')
    expect(runner).not.toHaveBeenCalled()
  })
  it('creates a constrained container from the exact local image digest and removes it', async () => {
    const data = inputs(); const calls: string[][] = []
    const runner: DockerCommandRunner = vi.fn(async args => {
      calls.push(args)
      if (args[0] === 'image') return { exitCode: 0, stdout: JSON.stringify([IMAGE]), stderr: '' }
      if (args[0] === 'create') return { exitCode: 0, stdout: 'abcdef123456', stderr: '' }
      if (args[0] === 'start') return { exitCode: 0, stdout: 'replay-ok', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const result = await executeShadowReplay(plan(data), new DockerShadowReplayAdapter({ imageRef: IMAGE, runner }), data)
    expect(result).toMatchObject({ status: 'passed', stdoutSummary: 'replay-ok', productionPolicyChanged: false, hooksChanged: false })
    const create = calls.find(args => args[0] === 'create')!
    for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=64', '--memory=512m', '--memory-swap=512m', '--user=65532:65532', '--pull=never']) expect(create).toContain(flag)
    expect(create.some(arg => arg.startsWith('--mount=') && arg.endsWith(',readonly'))).toBe(true)
    expect(create).not.toContain('/var/run/docker.sock')
    expect(calls.some(args => args[0] === 'rm' && args[1] === '--force')).toBe(true)
  })
  it('uses the stricter CPU-time budget as the execution deadline', async () => {
    const data = inputs(); const deadlines: number[] = []
    const runner: DockerCommandRunner = vi.fn(async (args, timeout) => {
      if (args[0] === 'image') return { exitCode: 0, stdout: JSON.stringify([IMAGE]), stderr: '' }
      if (args[0] === 'create') return { exitCode: 0, stdout: 'abcdef123456', stderr: '' }
      if (args[0] === 'start') deadlines.push(timeout ?? 0)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await new DockerShadowReplayAdapter({ imageRef: IMAGE, runner }).execute({ ...plan(data), limits: { timeoutMs: 10_000, memoryLimitMb: 512, cpuTimeLimitMs: 1_000 } }, data)
    expect(deadlines).toEqual([1_000])
  })
  it('kills and removes a container after timeout', async () => {
    const data = inputs(); const calls: string[][] = []
    const runner: DockerCommandRunner = vi.fn(async args => {
      calls.push(args)
      if (args[0] === 'image') return { exitCode: 0, stdout: JSON.stringify([IMAGE]), stderr: '' }
      if (args[0] === 'create') return { exitCode: 0, stdout: 'abcdef123456', stderr: '' }
      if (args[0] === 'start') return { exitCode: 124, stdout: '', stderr: 'deadline', timedOut: true }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const result = await executeShadowReplay(plan(data), new DockerShadowReplayAdapter({ imageRef: IMAGE, runner }), data)
    expect(result.status).toBe('timed-out')
    expect(calls.some(args => args[0] === 'kill')).toBe(true)
    expect(calls.some(args => args[0] === 'rm' && args[1] === '--force')).toBe(true)
  })

  it.runIf(Boolean(process.env.SCALE_SHADOW_REPLAY_DOCKER_IMAGE))('executes the reviewed runner against a real Docker daemon and verifies effective isolation settings', async () => {
    const imageRef = process.env.SCALE_SHADOW_REPLAY_DOCKER_IMAGE!
    const dir = mkdtempSync(join(tmpdir(), 'shadow-replay-docker-e2e-')); dirs.push(dir)
    const scenarioText = JSON.stringify({
      protocolVersion: 1, kind: 'scale-shadow-replay-scenario', scenarioId: 'docker-e2e',
      sourceCommitSha: 'a'.repeat(40),
      events: [{ id: 'event-1', tool: 'fs.write', input: 'write /private/token', expectedDecision: 'block' }],
    })
    const candidateText = JSON.stringify({
      protocolVersion: 1, kind: 'scale-shadow-replay-candidate', candidateId: 'IMPROVE-1',
      failureId: 'FAIL-1', defaultDecision: 'allow',
      rules: [{ id: 'block-write', priority: 10, tool: 'fs.write', contains: 'write', decision: 'block' }],
    })
    const scenarioSnapshotPath = join(dir, 'scenario.json')
    const candidateBundlePath = join(dir, 'candidate.json')
    writeFileSync(scenarioSnapshotPath, scenarioText)
    writeFileSync(candidateBundlePath, candidateText)
    const data = { scenarioSnapshotPath, candidateBundlePath,
      scenarioDigest: digest(scenarioText), candidateDigest: digest(candidateText) }
    let containerId = ''
    let inspected: Record<string, any> | undefined
    const runner: DockerCommandRunner = async (args, timeoutMs) => {
      const result = await execa('docker', args, { reject: false, timeout: timeoutMs ?? 30_000, windowsHide: true })
      if (args[0] === 'create' && result.exitCode === 0) {
        containerId = result.stdout.trim()
        const inspect = await execa('docker', ['inspect', containerId], { reject: false, windowsHide: true })
        if (inspect.exitCode !== 0) throw new Error(inspect.stderr)
        inspected = JSON.parse(inspect.stdout)[0] as Record<string, any>
      }
      return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr,
        timedOut: Boolean((result as typeof result & { timedOut?: boolean }).timedOut) }
    }
    const adapter = new DockerShadowReplayAdapter({ imageRef, runner })
    const result = await executeShadowReplay(plan(data), adapter, data)
    expect(result).toMatchObject({ status: 'passed', exitCode: 0, productionPolicyChanged: false, hooksChanged: false })
    expect(result.stdoutSummary).toContain('"passed":true')
    expect(result.stdoutSummary).not.toContain('/private/token')
    expect(inspected).toBeDefined()
    expect(inspected!.Config.User).toBe('65532:65532')
    expect(inspected!.HostConfig.NetworkMode).toBe('none')
    expect(inspected!.HostConfig.ReadonlyRootfs).toBe(true)
    expect(inspected!.HostConfig.CapDrop).toContain('ALL')
    expect(inspected!.HostConfig.SecurityOpt).toContain('no-new-privileges:true')
    expect(inspected!.HostConfig.PidsLimit).toBe(64)
    expect(inspected!.HostConfig.Memory).toBe(512 * 1024 * 1024)
    expect(inspected!.HostConfig.MemorySwap).toBe(512 * 1024 * 1024)
    expect(inspected!.HostConfig.CpuPeriod).toBe(100000)
    expect(inspected!.HostConfig.CpuQuota).toBe(100000)
    expect(inspected!.HostConfig.Tmpfs).toHaveProperty('/tmp')
    const inputMounts = inspected!.Mounts.filter((mount: { Destination: string }) =>
      ['/inputs/scenario.snapshot', '/inputs/candidate.bundle'].includes(mount.Destination)
    )
    expect(inputMounts).toHaveLength(2)
    expect(inputMounts.every((mount: { RW: boolean }) => mount.RW === false)).toBe(true)
    const after = await execa('docker', ['inspect', containerId], { reject: false, windowsHide: true })
    expect(after.exitCode).not.toBe(0)
  })
  it('fails closed if the exact pinned image digest is not local', async () => {
    const data = inputs()
    const runner: DockerCommandRunner = vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify(['ghcr.io/example/other@sha256:' + 'd'.repeat(64)]), stderr: '' }))
    await expect(new DockerShadowReplayAdapter({ imageRef: IMAGE, runner }).execute(plan(data), data)).rejects.toThrow('not present locally')
  })
})
