import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { autoDetectGovernancePack, checkKnowledgeGraphAvailability, classifyProject } from '../../src/api/quickstart.js'
import type { CodeIntelligenceStatusReport } from '../../src/codegraph/CodeIntelligence.js'
import type { ToolCapabilityReport } from '../../src/tools/ToolCapabilityRegistry.js'

describe('quickstart knowledge graph detection', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('returns bootstrap guidance when knowledge tools are missing', () => {
    const report = checkKnowledgeGraphAvailability('E:/project/demo', {
      execSyncImpl: (() => 'Python 3.12.3') as typeof import('node:child_process').execSync,
      inspectToolCapabilitiesImpl: () => ({
        ok: false,
        summary: { total: 2, installed: 0, missing: 2 },
        tools: [
          { id: 'codegraph', name: 'CodeGraph', category: 'cli', command: 'codegraph', versionArgs: ['--version'], requiredFor: [], checkedPaths: ['PATH:codegraph'], installed: false, status: 'missing', missingReason: 'command not found: codegraph' },
          { id: 'graphify', name: 'Graphify', category: 'cli', command: 'graphify', versionArgs: ['--version'], requiredFor: [], checkedPaths: ['PATH:graphify'], installed: false, status: 'missing', missingReason: 'command not found: graphify' },
        ],
      } satisfies ToolCapabilityReport),
      inspectCodeIntelligenceImpl: () => ({
        projectDir: 'E:/project/demo',
        scaleDir: 'E:/project/demo/.scale',
        configPath: 'E:/project/demo/.scale/code-intelligence.json',
        configExists: true,
        projectIndexPath: 'E:/project/demo/.codegraph',
        projectIndexExists: false,
        providers: [
          { id: 'codegraph', type: 'external-cli', enabled: true, available: false, capabilities: ['context'], reason: 'command not found: codegraph' },
          { id: 'graphify', type: 'artifact', enabled: true, available: false, capabilities: ['context'], reason: 'manifest not found: graphify-out/graph.json' },
        ],
        fallback: { enabled: true, tools: ['internal-scan'], available: true, reason: 'fallback available' },
        availableProviderCount: 0,
        recommendations: [],
      } satisfies CodeIntelligenceStatusReport),
    })

    expect(report.available).toBe(false)
    expect(report.pythonVersion).toBe('Python 3.12.3')
    expect(report.instructions).toEqual(expect.arrayContaining([
      'scale setup --pack knowledge --json',
      'scale setup --pack knowledge --apply --yes',
    ]))
  })

  it('surfaces project initialization hints when tools exist but graph assets are missing', () => {
    const report = checkKnowledgeGraphAvailability('E:/project/demo', {
      execSyncImpl: (() => 'Python 3.12.3') as typeof import('node:child_process').execSync,
      inspectToolCapabilitiesImpl: () => ({
        ok: true,
        summary: { total: 2, installed: 2, missing: 0 },
        tools: [
          { id: 'codegraph', name: 'CodeGraph', category: 'cli', command: 'codegraph', versionArgs: ['--version'], requiredFor: [], checkedPaths: ['PATH:codegraph'], installed: true, status: 'installed', version: '0.9.3' },
          { id: 'graphify', name: 'Graphify', category: 'cli', command: 'graphify', versionArgs: ['--version'], requiredFor: [], checkedPaths: ['PATH:graphify'], installed: true, status: 'installed', version: '0.8.15' },
        ],
      } satisfies ToolCapabilityReport),
      inspectCodeIntelligenceImpl: () => ({
        projectDir: 'E:/project/demo',
        scaleDir: 'E:/project/demo/.scale',
        configPath: 'E:/project/demo/.scale/code-intelligence.json',
        configExists: true,
        projectIndexPath: 'E:/project/demo/.codegraph',
        projectIndexExists: false,
        providers: [
          { id: 'codegraph', type: 'external-cli', enabled: true, available: true, capabilities: ['context'], reason: 'command available: codegraph; project index missing (.codegraph/)' },
          { id: 'graphify', type: 'artifact', enabled: true, available: false, capabilities: ['context'], reason: 'manifest not found: graphify-out/graph.json' },
        ],
        fallback: { enabled: true, tools: ['internal-scan'], available: true, reason: 'fallback available' },
        availableProviderCount: 1,
        recommendations: [],
      } satisfies CodeIntelligenceStatusReport),
    })

    expect(report.available).toBe(true)
    expect(report.codegraphInstalled).toBe(true)
    expect(report.graphifyInstalled).toBe(true)
    expect(report.codegraphProjectInitialized).toBe(false)
    expect(report.graphifyArtifactPresent).toBe(false)
    expect(report.instructions).toEqual(expect.arrayContaining([
      'codegraph init -i .',
      'Generate graphify-out/graph.json before relying on graph-backed knowledge recall.',
    ]))
  })

  it('detects enterprise, desktop, and python governance packs from project structure', () => {
    const springVue = mkdtempSync(join(tmpdir(), 'scale-spring-vue-'))
    const desktop = mkdtempSync(join(tmpdir(), 'scale-desktop-'))
    const python = mkdtempSync(join(tmpdir(), 'scale-python-'))
    tempDirs.push(springVue, desktop, python)

    writeFileSync(join(springVue, 'pom.xml'), '<project />')
    writeFileSync(join(springVue, 'package.json'), JSON.stringify({ dependencies: { vue: '^3.5.0' } }))
    writeFileSync(join(desktop, 'package.json'), JSON.stringify({ dependencies: { '@tauri-apps/api': '^2.0.0' } }))
    mkdirSync(join(desktop, 'src-tauri'))
    writeFileSync(join(python, 'pyproject.toml'), '[project]\nname = "demo"\n')

    expect(autoDetectGovernancePack(springVue)).toBe('spring-vue-admin')
    expect(classifyProject(springVue).recommendedPack).toBe('spring-vue-admin')
    expect(autoDetectGovernancePack(desktop)).toBe('desktop-app')
    expect(classifyProject(desktop).recommendedPack).toBe('desktop-app')
    expect(autoDetectGovernancePack(python)).toBe('python-service')
    expect(classifyProject(python).recommendedPack).toBe('python-service')
  })

  it('detects frontend projects when package.json contains a UTF-8 BOM', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-bom-package-'))
    tempDirs.push(projectDir)

    writeFileSync(join(projectDir, 'package.json'), `\uFEFF${JSON.stringify({
      scripts: { build: 'vite build' },
      dependencies: { vue: '^3.5.0' },
    })}`)

    expect(autoDetectGovernancePack(projectDir)).toBe('frontend-app')
    expect(classifyProject(projectDir)).toMatchObject({
      language: 'node',
      framework: 'vue',
      recommendedPack: 'frontend-app',
    })
  })
})
