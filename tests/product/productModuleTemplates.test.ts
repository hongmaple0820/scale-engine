import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createProductModuleScaffoldPlan,
  getProductModuleTemplate,
  listProductModuleTemplates,
  loadProductModuleTemplateFromFile,
  renderProductModuleTemplateMarkdown,
} from '../../src/product/index.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.length = 0
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-product-template-'))
  tempDirs.push(dir)
  return dir
}

describe('product module templates', () => {
  it('lists the built-in RuoYi-Plus-style product template', () => {
    const templates = listProductModuleTemplates()
    const template = getProductModuleTemplate('ruoyi-plus-enterprise-starter')

    expect(templates.map(item => item.id)).toContain('ruoyi-plus-enterprise-starter')
    expect(template?.licensePolicy.license).toBe('MIT')
    expect(template?.supportsCustomTemplates).toBe(true)
    expect(template?.modules.map(module => module.id)).toEqual([
      'auth-registration-login',
      'license-card-system',
      'user-management-rbac',
    ])
  })

  it('creates a scaffold plan for selected built-in modules', () => {
    const plan = createProductModuleScaffoldPlan({
      modules: ['auth', 'license'],
      productName: 'DemoApp',
      packageName: 'com.example.demo',
    })

    expect(plan.version).toBe('product-module-scaffold-plan-v1')
    expect(plan.selectedModules.map(module => module.id)).toEqual([
      'auth-registration-login',
      'license-card-system',
    ])
    expect(plan.generatedFiles.length).toBe(8)
    expect(plan.generatedFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      'backend/src/main/java/com/example/demo/modules/authregistrationlogin/AuthRegistrationLoginControllerTemplate.java',
      'frontend/src/views/license-card-system/index.vue',
    ]))
    expect(plan.generatedFiles.find(file => file.path.endsWith('AuthRegistrationLoginControllerTemplate.java'))?.content)
      .toContain('package com.example.demo.modules.authregistrationlogin;')
    expect(plan.generatedFiles[0].content).toContain('AuthRegistrationLogin')
    expect(plan.warnings[0]).toContain('templates')
  })

  it('loads a custom template manifest and generates files from it', () => {
    const dir = makeTempDir()
    const templateFile = join(dir, 'template.yaml')
    writeFileSync(templateFile, [
      'id: internal-suite',
      'name: Internal Suite',
      'description: Internal reusable modules',
      'modules:',
      '  - id: auth',
      '    name: InternalAuth',
      '    description: Internal auth module',
      '    aliases: [login]',
      '    features: [sso]',
      '    backendArtifacts: [controller]',
      '    frontendArtifacts: [page]',
      '    configArtifacts: [policy]',
      '    verification: [login smoke]',
      '    files:',
      '      - path: "modules/{{moduleId}}/{{productName}}.md"',
      '        kind: doc',
      '        content: "{{moduleName}} for {{packageName}} in {{modulePackage}}"',
      '        overwrite: false',
    ].join('\n'), 'utf-8')

    const custom = loadProductModuleTemplateFromFile(templateFile)
    const plan = createProductModuleScaffoldPlan({
      templateId: 'internal-suite',
      templates: [custom],
      modules: ['login'],
      productName: 'MyProduct',
      packageName: 'com.acme.product',
    })

    expect(custom.source).toBe('custom')
    expect(plan.generatedFiles).toEqual([
      expect.objectContaining({
        path: 'modules/auth/MyProduct.md',
        content: 'InternalAuth for com.acme.product in auth',
      }),
    ])
  })

  it('renders markdown for product template discovery', () => {
    const markdown = renderProductModuleTemplateMarkdown()

    expect(markdown).toContain('RuoYi-Plus enterprise starter')
    expect(markdown).toContain('auth-registration-login')
    expect(markdown).toContain('Custom Template Contract')
  })

  it('rejects invalid Java package names before generating backend templates', () => {
    expect(() => createProductModuleScaffoldPlan({
      packageName: 'com.example.bad-name',
    })).toThrow('Invalid Java package name')
  })
})
