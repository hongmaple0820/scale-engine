import { createHash } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import type { ShadowReplayAdapter, ShadowReplayAdapterCapabilities, ShadowReplayAdapterResult, ShadowReplayInputs, ShadowReplayPlan } from './ShadowReplayContract.js'
export const SHADOW_REPLAY_MAX_INPUT_BYTES = 10 * 1024 * 1024
const OUTPUT_LIMIT = 256 * 1024
const SETUP_TIMEOUT = 30_000
const RUNNER = '/usr/local/bin/scale-shadow-replay'
export interface DockerCommandResult { exitCode: number; stdout: string; stderr: string; timedOut?: boolean }
export type DockerCommandRunner = (args: string[], timeoutMs?: number) => Promise<DockerCommandResult>
export interface DockerShadowReplayAdapterOptions { imageRef: string; dockerPath?: string; runner?: DockerCommandRunner; now?: () => Date }
const CAPABILITIES: ShadowReplayAdapterCapabilities = Object.freeze({ sandboxKind: 'container', networkAccess: false, hostCredentials: false, sourceReadOnly: true, outputIsolated: true })
function hash(bytes: Buffer): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
function pinnedImage(value: string): string {
  const image = value.trim()
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Shadow replay Docker image must be pinned by an immutable sha256 digest')
  return image
}
function readInput(path: string, expected: string, label: string): Buffer {
  const absolute = resolve(path)
  const initial = lstatSync(absolute)
  if (initial.isSymbolicLink() || !initial.isFile()) throw new Error(`Shadow replay ${label} must be a regular non-symlink file`)
  const fd = openSync(realpathSync(absolute), 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`Shadow replay ${label} must be a regular file`)
    if (stat.size > SHADOW_REPLAY_MAX_INPUT_BYTES) throw new Error(`Shadow replay ${label} exceeds the 10 MiB input limit`)
    const bytes = readFileSync(fd)
    if (bytes.byteLength !== stat.size || hash(bytes) !== expected) throw new Error(`Shadow replay ${label} digest does not match the approved plan`)
    return bytes
  } finally { closeSync(fd) }
}
async function docker(dockerPath: string, args: string[], timeout?: number): Promise<DockerCommandResult> {
  try {
    const r = await execa(dockerPath, args, { reject: false, timeout, windowsHide: true, maxBuffer: OUTPUT_LIMIT + 1 })
    const timedOut = Boolean((r as typeof r & { timedOut?: boolean }).timedOut)
    return { exitCode: r.exitCode ?? (timedOut ? 124 : 1), stdout: r.stdout, stderr: r.stderr, timedOut }
  } catch (error) {
    const e = error as Error & { timedOut?: boolean; stdout?: string; stderr?: string; exitCode?: number }
    if (e.timedOut) return { exitCode: e.exitCode ?? 124, stdout: e.stdout ?? '', stderr: e.stderr ?? '', timedOut: true }
    throw error
  }
}
function checked(result: DockerCommandResult, operation: string): string {
  if (result.timedOut) throw new Error(`Docker ${operation} timed out`)
  if (result.exitCode !== 0) throw new Error(`Docker ${operation} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 2000)}`)
  if (Buffer.byteLength(result.stdout) > OUTPUT_LIMIT || Buffer.byteLength(result.stderr) > OUTPUT_LIMIT) throw new Error(`Docker ${operation} output exceeded 256 KiB`)
  return result.stdout.trim()
}
export class DockerShadowReplayAdapter implements ShadowReplayAdapter {
  readonly id = 'docker-container'
  readonly version = '1.0.0'
  readonly capabilities = CAPABILITIES
  private readonly imageRef: string
  private readonly dockerPath: string
  private readonly runner: DockerCommandRunner
  private readonly now: () => Date
  constructor(options: DockerShadowReplayAdapterOptions) {
    this.imageRef = pinnedImage(options.imageRef)
    this.dockerPath = options.dockerPath ?? 'docker'
    this.runner = options.runner ?? ((args, timeout) => docker(this.dockerPath, args, timeout))
    this.now = options.now ?? (() => new Date())
  }
  async execute(plan: ShadowReplayPlan, inputs: ShadowReplayInputs): Promise<ShadowReplayAdapterResult> {
    if (plan.sandboxKind !== 'container' || plan.adapterId !== this.id || plan.adapterVersion !== this.version) throw new Error('Shadow replay plan does not target this Docker adapter version')
    const scenario = readInput(inputs.scenarioSnapshotPath, plan.scenarioSnapshotDigest, 'scenario snapshot')
    const candidate = readInput(inputs.candidateBundlePath, plan.candidateBundleDigest, 'candidate bundle')
    const temp = mkdtempSync(join(tmpdir(), 'scale-shadow-replay-'))
    const scenarioPath = join(temp, 'scenario.snapshot')
    const candidatePath = join(temp, 'candidate.bundle')
    const name = `scale-shadow-replay-${plan.runId.replace(/[^a-zA-Z0-9_.-]/g, '').slice(-48)}`
    let id: string | undefined
    try {
      writeFileSync(scenarioPath, scenario, { flag: 'wx', mode: 0o444 })
      writeFileSync(candidatePath, candidate, { flag: 'wx', mode: 0o444 })
      const inspected = checked(await this.runner(['image', 'inspect', '--format={{json .RepoDigests}}', this.imageRef], SETUP_TIMEOUT), 'image inspect')
      let repoDigests: unknown
      try { repoDigests = JSON.parse(inspected) } catch { throw new Error('Docker image inspect returned invalid repository digest metadata') }
      if (!Array.isArray(repoDigests) || !repoDigests.includes(this.imageRef)) throw new Error('Pinned Shadow Replay runner image is not present locally by the exact approved digest')
      const created = checked(await this.runner([
        'create', '--pull=never', `--name=${name}`, '--network=none', '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true', '--pids-limit=64', `--memory=${plan.limits.memoryLimitMb}m`,
        `--memory-swap=${plan.limits.memoryLimitMb}m`, '--cpu-period=100000', '--cpu-quota=100000',
        '--user=65532:65532', '--workdir=/tmp', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m',
        '--ulimit=nofile=256:256', '--ulimit=nproc=64:64', '--init',
        `--mount=type=bind,src=${scenarioPath},dst=/inputs/scenario.snapshot,readonly`,
        `--mount=type=bind,src=${candidatePath},dst=/inputs/candidate.bundle,readonly`,
        `--entrypoint=${RUNNER}`, this.imageRef, '--scenario', '/inputs/scenario.snapshot', '--candidate', '/inputs/candidate.bundle',
      ], SETUP_TIMEOUT), 'container create')
      id = created
      if (!/^[a-f0-9]{12,64}$/i.test(id)) throw new Error('Docker returned an invalid container identifier')
      const startedAt = this.now().toISOString()
      // A one-core CPU quota bounds aggregate CPU use by elapsed time; enforce the stricter budget.
      const deadline = Math.min(plan.limits.timeoutMs, plan.limits.cpuTimeLimitMs)
      const execution = await this.runner(['start', '--attach', id], deadline)
      const completedAt = this.now().toISOString()
      const timedOut = Boolean(execution.timedOut)
      if (timedOut) await this.runner(['kill', id], SETUP_TIMEOUT).catch(() => undefined)
      if (Buffer.byteLength(execution.stdout) > OUTPUT_LIMIT || Buffer.byteLength(execution.stderr) > OUTPUT_LIMIT) throw new Error('Docker replay output exceeded 256 KiB')
      return { startedAt, completedAt, exitCode: timedOut ? 124 : execution.exitCode, timedOut, stdout: execution.stdout, stderr: execution.stderr }
    } finally {
      if (id) await this.runner(['rm', '--force', id], SETUP_TIMEOUT).catch(() => undefined)
      rmSync(temp, { recursive: true, force: true })
    }
  }
}
