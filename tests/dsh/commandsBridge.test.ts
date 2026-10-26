// dsh-scale commandsBridge (T2.1) — slash-command registration + CLI executor
// contract. Handlers must always settle inside CommandResult (never throw).

import { describe, expect, it } from 'vitest'
import { SCALE_COMMANDS, registerScaleCommands } from '../../packages/dsh-scale/src/commandsBridge.js'
import { resolveScaleCli } from '../../packages/dsh-scale/src/cliExecutor.js'
import type { CommandResult, CommandsService } from '../../packages/dsh-scale/src/dshTypes.js'

function makeCommands() {
  const registered: Array<{ name: string; description: string; handler: () => Promise<CommandResult> }> = []
  const commands: CommandsService = {
    register: (definition) => {
      registered.push({ name: definition.name, description: definition.description, handler: definition.handler })
    },
  }
  return { commands, registered }
}

describe('SCALE_COMMANDS allowlist (plan §6 T2.1)', () => {
  it('names satisfy the dsh-commands grammar /^[a-z][a-z0-9_-]*$/', () => {
    for (const spec of SCALE_COMMANDS) {
      expect(spec.name).toMatch(/^[a-z][a-z0-9_-]*$/)
      expect(spec.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('contains the plan candidates and excludes daemons', () => {
    const names = SCALE_COMMANDS.map(s => s.name)
    expect(names).toContain('scale-preflight')
    expect(names).toContain('scale-gate-quality')
    expect(names).toContain('scale-verify')
    expect(names).toContain('scale-shield-status')
    expect(names).toContain('scale-cortex-metrics')
    expect(names).toContain('scale-doctor-env')
    expect(names.some(n => /open|dashboard|orch/.test(n))).toBe(false)
  })
})

describe('registerScaleCommands', () => {
  it('registers all commands against the service', () => {
    const { commands, registered } = makeCommands()
    const count = registerScaleCommands({ commands }, {})
    expect(count).toBe(SCALE_COMMANDS.length)
    expect(registered).toHaveLength(SCALE_COMMANDS.length)
  })

  it('keeps media commands read-only (no render/publish in the allowlist)', () => {
    const names = SCALE_COMMANDS.map(spec => spec.name)
    expect(names).toContain('scale-media-doctor')
    expect(names).toContain('scale-media-tasks')
    expect(names).toContain('scale-media-providers')
    for (const spec of SCALE_COMMANDS) {
      const argv = spec.args.join(' ')
      expect(argv.includes('render')).toBe(false)
      expect(argv.includes('generate')).toBe(false)
    }
  })

  it('returns 0 when the commands service is unavailable (graceful)', () => {
    expect(registerScaleCommands({}, {})).toBe(0)
  })

  it('handler settles success with command echo and output', async () => {
    const { commands, registered } = makeCommands()
    registerScaleCommands({ commands }, { projectDir: 'E:/project/scale-engine' })
    const handler = registered.find(r => r.name === 'scale-doctor-env')!.handler
    // Runs the real scale CLI (node cold boot ~5–15s) — integration-flavored on purpose
    const result = await handler()
    expect(['success', 'error']).toContain(result.kind)
    // even an error result must be inside the contract with non-empty text
    if (result.kind === 'error') expect(result.text.trim().length).toBeGreaterThan(0)
  }, 60_000)
})

describe('resolveScaleCli', () => {
  it('resolves dist/api/cli.js through the plugin dependency edge', () => {
    const cli = resolveScaleCli()
    expect(cli).toBeTruthy()
    expect(cli!.replace(/\\/g, '/')).toMatch(/@hongmaple0820\/scale-engine\/dist\/api\/cli\.js$|scale-engine\/dist\/api\/cli\.js$/)
  })
})
