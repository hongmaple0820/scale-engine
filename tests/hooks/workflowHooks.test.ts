import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { EventBus } from '../../src/core/eventBus.js'
import { HookGeneratorEnhanced } from '../../src/hooks/HookGeneratorEnhanced.js'
import { WorkflowHooksManager } from '../../src/hooks/WorkflowHooksManager.js'

describe('workflow hooks', () => {
  let dir: string
  let bus: EventBus

  beforeEach(() => {
    // G23 discipline: test temp dirs live under the OS tempdir, never the repo cwd
    dir = mkdtempSync(join(tmpdir(), 'scale-hooks-'))
    bus = new EventBus({ eventsDir: join(dir, 'events') })
  })

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('registers workflow hook templates', () => {
    const generator = new HookGeneratorEnhanced(bus)
    const templateIds = generator.getTemplates().map(template => template.id)

    expect(templateIds).toContain('tmpl-karpathy-k1-think')
    expect(templateIds).toContain('tmpl-karpathy-k2-simple')
    expect(templateIds).toContain('tmpl-hardcoded-secret-guard')
    expect(templateIds).toContain('tmpl-empty-catch-guard')
    expect(templateIds).toContain('tmpl-unverified-check')
    expect(templateIds).toContain('tmpl-mutation-guard')
    expect(templateIds).toContain('tmpl-ai-slop-detector')
  })

  it('generates executable workflow hook scripts', () => {
    const generator = new HookGeneratorEnhanced(bus)
    const template = generator.getTemplates().find(t => t.id === 'tmpl-hardcoded-secret-guard')

    expect(template).toBeDefined()
    const hook = generator.generateFromTemplate(template!, {}, join(dir, 'hooks'))
    expect(hook.scriptPath.endsWith('.cjs')).toBe(true)

    const allowed = spawnSync(process.execPath, [
      hook.scriptPath,
      JSON.stringify({ tool_input: { content: 'const safeValue = "public"' } })
    ])
    expect(allowed.status).toBe(0)

    const blocked = spawnSync(process.execPath, [
      hook.scriptPath,
      JSON.stringify({ tool_input: { content: 'const apiKey = "123456789012345678901234567890"' } })
    ])
    expect(blocked.status).toBe(2)
  })

  it('executes anatomy, cerebrum, and bug memory hooks', () => {
    const scaleDir = join(dir, '.scale')
    mkdirSync(scaleDir, { recursive: true })
    writeFileSync(
      join(scaleDir, 'anatomy.md'),
      [
        '# anatomy.md',
        '',
        '> Files: 1 | Total: ~10 tokens',
        '',
        '## src/',
        '',
        '- `main.ts` - Main entry (~10 tok)',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(scaleDir, 'cerebrum.md'),
      [
        '# cerebrum.md',
        '',
        '## Do Not Repeat',
        '',
        '- **never use var** - Use const or let (hits: 0)',
        '',
      ].join('\n'),
    )

    const generator = new HookGeneratorEnhanced(bus)
    const runTemplate = (id: string, input: unknown) => {
      const template = generator.getTemplates().find(t => t.id === id)
      expect(template).toBeDefined()
      const hook = generator.generateFromTemplate(template!, {}, join(dir, 'hooks'))
      return spawnSync(process.execPath, [hook.scriptPath, JSON.stringify(input)], {
        cwd: dir,
        env: { ...process.env, SCALE_DIR: scaleDir, SCALE_PROJECT_DIR: dir },
        encoding: 'utf-8',
      })
    }

    const anatomy = runTemplate('tmpl-anatomy-pre-read', {
      tool_input: { file_path: join(dir, 'src', 'main.ts') },
    })
    expect(anatomy.status).toBe(0)
    expect(anatomy.stderr).toContain('[ANATOMY] main.ts - Main entry')

    const cerebrum = runTemplate('tmpl-cerebrum-pre-write', {
      tool_input: { new_string: 'never use var in this file' },
    })
    expect(cerebrum.status).toBe(0)
    expect(cerebrum.stderr).toContain('[CEREBRUM] Do-Not-Repeat')

    const capture = runTemplate('tmpl-bug-capture', {
      tool_input: {
        file_path: join(dir, 'src', 'main.ts'),
        old_string: 'const name = user.name',
        new_string: 'const name = user?.name',
      },
    })
    expect(capture.status).toBe(0)
    expect(capture.stderr).toContain('[BUG-CAPTURE] Detected null-safety')
    expect(readFileSync(join(scaleDir, 'buglog.json'), 'utf-8')).toContain('null-safety')

    const recall = runTemplate('tmpl-bug-recall', {
      tool_input: { file_path: join(dir, 'src', 'main.ts') },
    })
    expect(recall.status).toBe(0)
    expect(recall.stderr).toContain('[BUG-RECALL] 1 past bugs')
  })

  it('deploys enabled workflow presets into settings', () => {
    const manager = new WorkflowHooksManager(bus)
    const settingsPath = join(dir, '.claude', 'settings.json')

    const result = manager.deployDefaultWorkflowHooks(join(dir, 'hooks'), settingsPath)

    expect(result.deployed).toBe(16)
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks: Record<string, Array<{ command: string; description?: string }>>
    }
    expect(settings.hooks.PreToolUse).toHaveLength(7)
    expect(settings.hooks.PostToolUse).toHaveLength(4)
    expect(settings.hooks.Stop).toHaveLength(3)
    expect(settings.hooks.PreToolUse.some(h => h.description?.includes('tmpl-hardcoded-secret-guard'))).toBe(true)
  })
})
