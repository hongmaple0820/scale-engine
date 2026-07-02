import { describe, expect, it } from 'vitest'
import { listGovernanceTemplatePacks, resolveGovernanceTemplatePack } from '../../src/workflow/GovernanceTemplatePacks.js'

describe('governance template packs', () => {
  it('lists stable pack ids', () => {
    expect(listGovernanceTemplatePacks().map(pack => pack.id)).toEqual([
      'standard',
      'project-scaffold',
      'scale-engine-repo',
      'moe-workspace',
      'resource-governance',
      'go-service-matrix',
      'node-library',
      'frontend-app',
      'enterprise-admin',
      'spring-vue-admin',
      'microservice-platform',
      'python-service',
      'desktop-app',
      'agent-os-workbench',
      'solo-dev',
    ])
  })

  it('resolves project-scaffold with wrapper generation enabled', () => {
    const pack = resolveGovernanceTemplatePack('project-scaffold')

    expect(pack.id).toBe('project-scaffold')
    expect(pack.version).toBe(2)
    expect(pack.generatedFiles.map(file => file.path)).toContain('scripts/workflow/new-task.sh')
    expect(pack.generatedFiles.map(file => file.path)).toContain('scripts/workflow/new-task.ps1')
    expect(pack.generatedFiles.map(file => file.path)).toContain('scripts/gates/all.sh')
    expect(pack.generatedFiles.map(file => file.path)).toContain('scripts/gates/all.ps1')
  })

  it('resolves scale-engine-repo with self-hosted workflow assets', () => {
    const pack = resolveGovernanceTemplatePack('scale-engine-repo')

    expect(pack.id).toBe('scale-engine-repo')
    expect(pack.version).toBe(1)
    expect(pack.generatedFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      '.scale/workspace.json',
      '.agent/project.json',
      '.claude/settings.json',
      '.claude/workflow.json',
      '.claude/hooks/session-start-reminder.sh',
      '.claude/hooks/gate-execute-phase.sh',
      '.claude/hooks/session-end-gate.sh',
      'scripts/hooks/check-dangerous-file.sh',
      'scripts/hooks/check-explore.sh',
      'scripts/hooks/check-tdd.sh',
      'scripts/hooks/check-context.sh',
      'scripts/workflow/new-task.sh',
      'scripts/workflow/explore.sh',
      'scripts/workflow/resume.sh',
      'scripts/workflow/verify.sh',
      'scripts/gates/all.sh',
      'scripts/workflow/new-task.ps1',
      'scripts/workflow/explore.ps1',
      'scripts/workflow/resume.ps1',
      'scripts/workflow/verify.ps1',
      'scripts/gates/all.ps1',
      'AGENTS.md',
      'CLAUDE.md',
      'Makefile',
      'docs/guides/GETTING_STARTED.md',
      'docs/guides/DEVELOPMENT_WORKFLOW.md',
      'docs/workflow/README.md',
    ]))
  })

  it('resolves Go service matrix with language-aware required services and exclusions', () => {
    const pack = resolveGovernanceTemplatePack('go-service-matrix')

    expect(pack.defaultServices?.every(service => service.type === 'go')).toBe(true)
    expect(pack.defaultServices?.map(service => service.name)).toEqual(['netdisk', 'auth', 'gateway'])
    expect(pack.exclude).toEqual(expect.arrayContaining(['OpenList', 'gfast', 'mcp-zero']))
  })

  it('resolves MOE workspace governance with topology assets', () => {
    const pack = resolveGovernanceTemplatePack('moe-workspace')

    expect(pack.id).toBe('moe-workspace')
    expect(pack.generatedFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      '.scale/workspace.json',
      'docs/workflow/moe-workspace.md',
    ]))
  })

  it('resolves node-library with repo workflow entry points', () => {
    const pack = resolveGovernanceTemplatePack('node-library')

    expect(pack.id).toBe('node-library')
    expect(pack.version).toBe(2)
    expect(pack.generatedFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      'scripts/workflow/new-task.sh',
      'scripts/workflow/verify.ps1',
      'scripts/gates/all.sh',
      'scripts/preflight/all.sh',
      'scripts/preflight/all.ps1',
      '.scale/workspace.json',
      'docs/workflow/node-library.md',
      '.planning/tasks/.gitkeep',
    ]))
  })

  it('resolves enterprise admin templates with architecture standards', () => {
    const pack = resolveGovernanceTemplatePack('enterprise-admin')

    expect(pack.generatedFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      'docs/workflow/enterprise-admin.md',
      'docs/product/architecture-standard.md',
      'scripts/workflow/new-task.sh',
    ]))
  })

  it('resolves agent OS workbench templates with runtime governance docs', () => {
    const pack = resolveGovernanceTemplatePack('agent-os-workbench')

    expect(pack.generatedFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      'docs/workflow/agent-os-workbench.md',
      '.scale/workspace.json',
    ]))
  })

  it('rejects unknown packs with supported ids', () => {
    expect(() => resolveGovernanceTemplatePack('missing')).toThrow('Supported packs')
  })

  it('uses the last valid pack when a CLI parser provides repeated pack values', () => {
    const pack = resolveGovernanceTemplatePack(['standardscale', 'standard'] as unknown as string)

    expect(pack.id).toBe('standard')
  })
})
