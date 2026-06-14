import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runSetupWizard } from '../../src/setup/SetupWizard.js'
import type { DependencyBootstrapReport } from '../../src/bootstrap/DependencyBootstrap.js'
import type { MemoryProviderUseReport } from '../../src/memory/MemoryProviders.js'

describe('setup wizard', () => {
  it('lets interactive users choose gbrain routing before install confirmation', async () => {
    const prompts: string[] = []
    const report = await runSetupWizard({
      projectDir: process.cwd(),
      scaleDir: '.scale-test',
      interactive: true,
      lang: 'en',
      input: Readable.from(['\n', '\n', '\n']),
      output: new Writable({
        write(chunk, _encoding, callback) {
          prompts.push(String(chunk))
          callback()
        },
      }),
      bootstrap: async options => makeBootstrapReport(Boolean(options.apply)),
      switchMemoryProvider: options => ({
        ok: true,
        provider: options.provider,
        mode: options.mode ?? 'auto',
        path: '.scale-test/memory-providers.json',
        previousOrder: ['gbrain'],
        nextOrder: [options.provider],
        warnings: [],
      }) as MemoryProviderUseReport,
    })

    expect(report.interactiveChoices).toMatchObject({
      memoryProvider: 'gbrain',
      memoryMode: 'external-first',
    })
    expect(report.memoryProviderSwitch).toMatchObject({
      provider: 'gbrain',
      mode: 'external-first',
    })
    expect(report.applied).toBe(false)
    expect(report.prompts).toEqual(expect.arrayContaining([
      expect.stringContaining('memory provider'),
      expect.stringContaining('gbrain routing mode'),
      expect.stringContaining('Ready to install'),
    ]))
    expect(prompts.join('')).toContain('gbrain')
  })

  it('lets interactive users choose packs and selected install items', async () => {
    const report = await runSetupWizard({
      projectDir: process.cwd(),
      scaleDir: '.scale-test',
      interactive: true,
      promptPacks: true,
      lang: 'zh',
      input: Readable.from(['4\n', '1\n']),
      output: new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      }),
      bootstrap: async options => makeUiBootstrapReport(Boolean(options.apply), options.packIds ?? [], options.onlyIds ?? []),
    })

    expect(report.interactiveChoices).toMatchObject({
      packIds: ['ui'],
      installIds: ['awesome-design-md'],
    })
    expect(report.applied).toBe(true)
    expect(report.final.items.map(item => item.id)).toEqual(['awesome-design-md'])
  })
})

function makeBootstrapReport(apply: boolean): DependencyBootstrapReport {
  return {
    ok: true,
    complete: false,
    projectDir: process.cwd(),
    scaleDir: '.scale-test',
    packIds: ['memory'],
    includeIds: [],
    apply,
    runtimeChecks: [],
    items: [
      {
        id: 'gbrain',
        name: 'gbrain',
        kind: 'cli',
        packs: ['memory'],
        source: 'https://github.com/garrytan/gbrain',
        installed: true,
        status: 'ready',
        installSupported: true,
        detectedBy: 'command:gbrain',
        prerequisites: [],
      },
    ],
    summary: {
      total: 1,
      installed: 0,
      ready: 1,
      manualReview: 0,
      needsInit: 0,
      versionDrift: 0,
      installedNow: 0,
      failed: 0,
    },
    postActions: [],
    postChecks: [],
    postCheckSummary: { total: 0, passed: 0, warned: 0, failed: 0 },
    postCheckCommands: [],
    rollbackHints: [],
    recommendations: [],
  }
}

function makeUiBootstrapReport(apply: boolean, packIds: string[], onlyIds: string[]): DependencyBootstrapReport {
  const items = [
    {
      id: 'awesome-design-md',
      name: 'awesome-design-md',
      kind: 'skill' as const,
      packs: ['ui' as const],
      source: 'https://github.com/VoltAgent/awesome-design-md',
      installed: false,
      status: apply ? 'installed-now' as const : 'ready' as const,
      installSupported: true,
      installCommand: 'install skill adapter',
      detectedBy: 'missing',
      prerequisites: [],
    },
    {
      id: 'ui-ux-pro-max',
      name: 'ui-ux-pro-max',
      kind: 'skill' as const,
      packs: ['ui' as const],
      source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
      installed: false,
      status: 'ready' as const,
      installSupported: true,
      installCommand: 'install skill adapter',
      detectedBy: 'missing',
      prerequisites: [],
    },
  ].filter(item => onlyIds.length === 0 || onlyIds.includes(item.id))
  return {
    ok: true,
    complete: apply,
    projectDir: process.cwd(),
    scaleDir: '.scale-test',
    packIds,
    includeIds: [],
    apply,
    runtimeChecks: [],
    items,
    summary: {
      total: items.length,
      installed: 0,
      ready: items.filter(item => item.status === 'ready').length,
      manualReview: 0,
      needsInit: 0,
      versionDrift: 0,
      installedNow: items.filter(item => item.status === 'installed-now').length,
      failed: 0,
    },
    postActions: [],
    postChecks: [],
    postCheckSummary: { total: 0, passed: 0, warned: 0, failed: 0 },
    postCheckCommands: [],
    rollbackHints: [],
    recommendations: [],
  }
}
