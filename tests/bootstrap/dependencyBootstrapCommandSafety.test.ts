import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  execaMock,
  execaSyncMock,
  externalCommandExistsMock,
  wrapShellCommandWithRtkMock,
  wrapCliCommandWithRtkMock,
  inspectCodeIntelligenceMock,
  writeCodeIntelligenceConfigMock,
  inspectToolCapabilitiesMock,
} = vi.hoisted(() => ({
  execaMock: vi.fn(),
  execaSyncMock: vi.fn(),
  externalCommandExistsMock: vi.fn(),
  wrapShellCommandWithRtkMock: vi.fn(() => null),
  wrapCliCommandWithRtkMock: vi.fn((command: string, args: string[]) => ({ command, args, wrapped: false })),
  inspectCodeIntelligenceMock: vi.fn(() => ({
    projectDir: 'E:/project/mock',
    scaleDir: 'E:/project/mock/.scale',
    configPath: 'E:/project/mock/.scale/code-intelligence.json',
    configExists: true,
    projectIndexPath: 'E:/project/mock/.codegraph',
    projectIndexExists: false,
    providers: [],
    fallback: {
      enabled: true,
      tools: ['rg'],
      available: true,
      reason: 'mocked fallback',
    },
    availableProviderCount: 0,
    recommendations: [],
  })),
  writeCodeIntelligenceConfigMock: vi.fn(({ scaleDir }: { scaleDir: string }) => ({
    written: true,
    path: `${scaleDir}/code-intelligence.json`,
  })),
  inspectToolCapabilitiesMock: vi.fn(() => ({
    ok: true,
    summary: { total: 0, installed: 0, missing: 0 },
    tools: [],
  })),
}))

vi.mock('execa', () => ({
  execa: execaMock,
  execaSync: execaSyncMock,
}))

vi.mock('../../src/core/ExternalCommand.js', () => ({
  externalCommandExists: externalCommandExistsMock,
}))

vi.mock('../../src/tools/RtkRuntime.js', () => ({
  wrapShellCommandWithRtk: wrapShellCommandWithRtkMock,
  wrapCliCommandWithRtk: wrapCliCommandWithRtkMock,
}))

vi.mock('../../src/codegraph/CodeIntelligence.js', () => ({
  inspectCodeIntelligence: inspectCodeIntelligenceMock,
  writeCodeIntelligenceConfig: writeCodeIntelligenceConfigMock,
}))

vi.mock('../../src/tools/ToolCapabilityRegistry.js', () => ({
  inspectToolCapabilities: inspectToolCapabilitiesMock,
}))

vi.mock('../../src/memory/MemoryProviders.js', () => ({
  inspectGbrainCliHealth: vi.fn(() => ({ ok: false })),
  inspectMemoryProviders: vi.fn(() => ({
    configExists: false,
    providers: [],
    availableProviderCount: 0,
    warnings: [],
  })),
  useMemoryProvider: vi.fn(),
  writeMemoryProvidersConfig: vi.fn(),
}))

import { bootstrapDependencies } from '../../src/bootstrap/DependencyBootstrap.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

beforeEach(() => {
  execaMock.mockReset()
  execaSyncMock.mockReset()
  externalCommandExistsMock.mockReset()
  wrapShellCommandWithRtkMock.mockClear()
  wrapCliCommandWithRtkMock.mockClear()
  inspectCodeIntelligenceMock.mockClear()
  writeCodeIntelligenceConfigMock.mockClear()
  inspectToolCapabilitiesMock.mockClear()

  execaMock.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' })
  execaSyncMock.mockReturnValue({ exitCode: 0, stdout: 'ok', stderr: '' })
  externalCommandExistsMock.mockImplementation((command: string) => ['graphify', 'codegraph'].includes(command))
})

function makeProjectDir(name: string): { projectDir: string; scaleDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'scale-bootstrap-command-safety-'))
  const projectDir = join(root, name)
  mkdirSync(projectDir, { recursive: true })
  dirs.push(root)
  return { projectDir, scaleDir: join(projectDir, '.scale') }
}

describe('dependency bootstrap command safety', () => {
  it('runs codegraph init with argv arguments even when the project path contains shell metacharacters', async () => {
    const { projectDir, scaleDir } = makeProjectDir('project-$(codegraph-init)')

    await bootstrapDependencies({
      projectDir,
      scaleDir,
      packIds: ['knowledge'],
      onlyIds: ['codegraph'],
      apply: true,
    })

    expect(wrapCliCommandWithRtkMock).toHaveBeenCalledWith('codegraph', ['init', '-i', projectDir])
    expect(execaMock).toHaveBeenCalledWith(
      'codegraph',
      ['init', '-i', projectDir],
      expect.objectContaining({ reject: false, timeout: 300_000, all: false, cwd: projectDir }),
    )
    expect(execaMock.mock.calls.some(call => typeof call[0] === 'string' && call[0].includes(projectDir))).toBe(false)
  })

  it('runs graphify graph rebuild with argv and cwd even when the project path contains shell metacharacters', async () => {
    const { projectDir, scaleDir } = makeProjectDir('project-$(graphify-update)')

    await bootstrapDependencies({
      projectDir,
      scaleDir,
      packIds: ['knowledge'],
      onlyIds: ['graphify'],
      apply: true,
    })

    expect(wrapCliCommandWithRtkMock).toHaveBeenCalledWith(
      expect.stringMatching(/^python3?$/),
      ['-c', expect.stringContaining('graphify.watch')],
    )
    expect(execaMock).toHaveBeenCalledWith(
      expect.stringMatching(/^python3?$/),
      ['-c', expect.stringContaining('_rebuild_code')],
      expect.objectContaining({ reject: false, timeout: 300_000, all: false, cwd: projectDir }),
    )
    expect(execaMock.mock.calls.some(call => typeof call[0] === 'string' && call[0].includes(projectDir))).toBe(false)
  })
})
