import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'

export type ProductGeneratedFileKind = 'manifest' | 'doc' | 'backend-template' | 'frontend-template' | 'config'

export interface ProductGeneratedFile {
  path: string
  kind: ProductGeneratedFileKind
  content: string
  overwrite: boolean
}

export interface ProductModuleDefinition {
  id: string
  name: string
  description: string
  aliases: string[]
  features: string[]
  backendArtifacts: string[]
  frontendArtifacts: string[]
  configArtifacts: string[]
  verification: string[]
  files: ProductGeneratedFile[]
}

export interface ProductModuleTemplate {
  id: string
  name: string
  description: string
  source: 'builtin' | 'custom'
  baseArchitecture: string
  licensePolicy: {
    upstream: string
    license: string
    notice: string
  }
  supportsCustomTemplates: boolean
  customTemplateContract: {
    manifestFile: string
    templateRoot: string
    variables: string[]
  }
  modules: ProductModuleDefinition[]
  extensionPoints: string[]
  safetyGates: string[]
  references: Array<{ label: string; url: string }>
}

export interface ProductModuleScaffoldPlan {
  version: 'product-module-scaffold-plan-v1'
  template: ProductModuleTemplate
  productName: string
  packageName: string
  selectedModules: ProductModuleDefinition[]
  generatedFiles: ProductGeneratedFile[]
  safetyGates: string[]
  warnings: string[]
}

interface TemplateContext {
  productName: string
  packageName: string
  packagePath: string
  moduleId: string
  modulePackage: string
  moduleName: string
}

const BUILTIN_TEMPLATE_ID = 'ruoyi-plus-enterprise-starter'

function javaControllerTemplate(moduleName: string, description: string): string {
  return `package {{packageName}}.modules.{{modulePackage}};

/**
 * ${moduleName}
 *
 * ${description}
 *
 * Generated as a RuoYi-Plus-style module template. Review permissions,
 * validation, persistence, and audit logging before copying into production.
 */
public class {{moduleName}}ControllerTemplate {
  // TODO: Replace with the target framework controller annotations.
  // TODO: Bind service, DTO, validation, and permission checks.
}
`
}

function vuePageTemplate(moduleName: string): string {
  return `<template>
  <section class="{{moduleId}}-module">
    <h1>${moduleName}</h1>
    <!-- TODO: Replace with project UI components and generated form/table schema. -->
  </section>
</template>

<script setup lang="ts">
// Generated module shell. Connect API clients, validation, and permission state here.
</script>
`
}

function moduleManifest(module: ProductModuleDefinition): string {
  return `${JSON.stringify({
    id: module.id,
    name: module.name,
    aliases: module.aliases,
    features: module.features,
    backendArtifacts: module.backendArtifacts,
    frontendArtifacts: module.frontendArtifacts,
    configArtifacts: module.configArtifacts,
    verification: module.verification,
  }, null, 2)}\n`
}

function createBuiltinModule(input: Omit<ProductModuleDefinition, 'files'>): ProductModuleDefinition {
  return {
    ...input,
    files: [
      {
        path: 'docs/product-modules/{{moduleId}}.md',
        kind: 'doc',
        overwrite: false,
        content: [
          '# {{moduleName}}',
          '',
          input.description,
          '',
          '## Features',
          '',
          ...input.features.map(feature => `- ${feature}`),
          '',
          '## Verification',
          '',
          ...input.verification.map(item => `- ${item}`),
          '',
        ].join('\n'),
      },
      {
        path: '.scale/product-modules/{{moduleId}}.json',
        kind: 'manifest',
        overwrite: false,
        content: moduleManifest(input as ProductModuleDefinition),
      },
      {
        path: 'backend/src/main/java/{{packagePath}}/modules/{{modulePackage}}/{{moduleName}}ControllerTemplate.java',
        kind: 'backend-template',
        overwrite: false,
        content: javaControllerTemplate(input.name, input.description),
      },
      {
        path: 'frontend/src/views/{{moduleId}}/index.vue',
        kind: 'frontend-template',
        overwrite: false,
        content: vuePageTemplate(input.name),
      },
    ],
  }
}

export const RUOYI_PLUS_ENTERPRISE_STARTER: ProductModuleTemplate = {
  id: BUILTIN_TEMPLATE_ID,
  name: 'RuoYi-Plus enterprise starter',
  description: 'Built-in reusable module template for registration/login, license-key cards, and user/RBAC management.',
  source: 'builtin',
  baseArchitecture: 'RuoYi-Vue-Plus / RuoYi-Cloud-Plus style Spring Boot + Vue application architecture; no upstream source is vendored automatically.',
  licensePolicy: {
    upstream: 'dromara RuoYi-Plus family',
    license: 'MIT',
    notice: 'Generated templates are original shells. Preserve upstream license notices if a project later copies upstream code.',
  },
  supportsCustomTemplates: true,
  customTemplateContract: {
    manifestFile: 'template.yaml or template.json',
    templateRoot: '.scale/product-templates/<template-id>',
    variables: ['productName', 'packageName', 'packagePath', 'moduleId', 'modulePackage', 'moduleName'],
  },
  modules: [
    createBuiltinModule({
      id: 'auth-registration-login',
      name: 'AuthRegistrationLogin',
      description: 'Registration, login, password reset, session policy, captcha, OAuth hook, and audit trail module.',
      aliases: ['auth', 'registration', 'login'],
      features: [
        'registration and login workflow',
        'password reset and account recovery hooks',
        'session, captcha, and rate-limit extension points',
        'audit events for sensitive identity actions',
      ],
      backendArtifacts: ['controller', 'service', 'dto', 'permission-policy', 'audit-event'],
      frontendArtifacts: ['register page', 'login page', 'forgot-password page', 'session state store'],
      configArtifacts: ['captcha policy', 'session policy', 'oauth provider placeholders'],
      verification: ['registration happy path', 'login lockout path', 'password reset token expiry', 'permission gate smoke'],
    }),
    createBuiltinModule({
      id: 'license-card-system',
      name: 'LicenseCardSystem',
      description: 'License-key and card-code lifecycle module for product activation, redemption, expiry, and revocation.',
      aliases: ['license', 'card-code', 'activation'],
      features: [
        'license key generation and redemption flow',
        'activation quota, expiry, and revoke policies',
        'batch import/export hooks',
        'redemption audit and anomaly checks',
      ],
      backendArtifacts: ['license controller', 'license service', 'redeem dto', 'activation policy', 'audit-event'],
      frontendArtifacts: ['license list page', 'redeem dialog', 'batch import view'],
      configArtifacts: ['license policy', 'quota policy', 'batch import limits'],
      verification: ['redeem success', 'duplicate redeem rejection', 'expired key rejection', 'revoked key rejection'],
    }),
    createBuiltinModule({
      id: 'user-management-rbac',
      name: 'UserManagementRbac',
      description: 'User, role, department, menu permission, tenant hook, and audit management module.',
      aliases: ['user', 'rbac', 'permission'],
      features: [
        'user profile and status lifecycle',
        'role and menu permission assignment',
        'department and tenant extension hooks',
        'admin audit records for account changes',
      ],
      backendArtifacts: ['user controller', 'role controller', 'permission service', 'rbac policy', 'audit-event'],
      frontendArtifacts: ['user table', 'role table', 'permission tree', 'profile page'],
      configArtifacts: ['rbac seed manifest', 'admin audit policy'],
      verification: ['user CRUD smoke', 'role assignment', 'permission denial', 'audit trail write'],
    }),
  ],
  extensionPoints: [
    'Replace generated controller shells with project framework annotations.',
    'Attach persistence mappings from the target data model.',
    'Bind generated frontend views to the target component library.',
    'Add project-specific custom templates under .scale/product-templates.',
  ],
  safetyGates: [
    'license-notice-reviewed',
    'security-permission-review-required',
    'generated-files-no-overwrite-by-default',
    'custom-template-manifest-validated',
    'project-specific-tests-required-before-ship',
  ],
  references: [
    { label: 'RuoYi-Vue-Plus', url: 'https://github.com/dromara/RuoYi-Vue-Plus' },
    { label: 'RuoYi-Cloud-Plus', url: 'https://github.com/dromara/RuoYi-Cloud-Plus' },
  ],
}

const BUILTIN_PRODUCT_MODULE_TEMPLATES = [RUOYI_PLUS_ENTERPRISE_STARTER] as const

export function listProductModuleTemplates(extraTemplates: ProductModuleTemplate[] = []): ProductModuleTemplate[] {
  return [...BUILTIN_PRODUCT_MODULE_TEMPLATES, ...extraTemplates]
}

export function getProductModuleTemplate(id: string, extraTemplates: ProductModuleTemplate[] = []): ProductModuleTemplate | undefined {
  return listProductModuleTemplates(extraTemplates).find(template => template.id === id)
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid product template: missing ${field}.`)
  return value
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`Invalid product template: ${field} must be a string array.`)
  return [...value]
}

function assertFiles(value: unknown, field: string): ProductGeneratedFile[] {
  if (!Array.isArray(value)) throw new Error(`Invalid product template: ${field} must be an array.`)
  return value.map((item, index) => {
    const record = item as Record<string, unknown>
    return {
      path: assertString(record.path, `${field}[${index}].path`),
      kind: (record.kind ?? 'doc') as ProductGeneratedFileKind,
      content: assertString(record.content, `${field}[${index}].content`),
      overwrite: Boolean(record.overwrite),
    }
  })
}

export function loadProductModuleTemplateFromFile(filePath: string): ProductModuleTemplate {
  const absolutePath = resolve(filePath)
  const raw = readFileSync(absolutePath, 'utf-8')
  const parsed = (filePath.endsWith('.json') ? JSON.parse(raw) : loadYaml(raw)) as Record<string, unknown>
  const modulesValue = parsed.modules
  if (!Array.isArray(modulesValue)) throw new Error('Invalid product template: modules must be an array.')
  const modules = modulesValue.map((item, index) => {
    const record = item as Record<string, unknown>
    return {
      id: assertString(record.id, `modules[${index}].id`),
      name: assertString(record.name, `modules[${index}].name`),
      description: assertString(record.description, `modules[${index}].description`),
      aliases: assertStringArray(record.aliases ?? [], `modules[${index}].aliases`),
      features: assertStringArray(record.features ?? [], `modules[${index}].features`),
      backendArtifacts: assertStringArray(record.backendArtifacts ?? [], `modules[${index}].backendArtifacts`),
      frontendArtifacts: assertStringArray(record.frontendArtifacts ?? [], `modules[${index}].frontendArtifacts`),
      configArtifacts: assertStringArray(record.configArtifacts ?? [], `modules[${index}].configArtifacts`),
      verification: assertStringArray(record.verification ?? [], `modules[${index}].verification`),
      files: assertFiles(record.files ?? [], `modules[${index}].files`),
    }
  })
  return {
    id: assertString(parsed.id, 'id'),
    name: assertString(parsed.name, 'name'),
    description: assertString(parsed.description, 'description'),
    source: 'custom',
    baseArchitecture: String(parsed.baseArchitecture ?? 'custom'),
    licensePolicy: {
      upstream: String((parsed.licensePolicy as Record<string, unknown> | undefined)?.upstream ?? 'custom'),
      license: String((parsed.licensePolicy as Record<string, unknown> | undefined)?.license ?? 'project-defined'),
      notice: String((parsed.licensePolicy as Record<string, unknown> | undefined)?.notice ?? 'Review custom template licensing before generation.'),
    },
    supportsCustomTemplates: true,
    customTemplateContract: {
      manifestFile: filePath,
      templateRoot: dirname(absolutePath),
      variables: ['productName', 'packageName', 'packagePath', 'moduleId', 'modulePackage', 'moduleName'],
    },
    modules,
    extensionPoints: assertStringArray(parsed.extensionPoints ?? [], 'extensionPoints'),
    safetyGates: assertStringArray(parsed.safetyGates ?? ['custom-template-manifest-validated'], 'safetyGates'),
    references: Array.isArray(parsed.references)
      ? parsed.references.map(item => {
        const record = item as Record<string, unknown>
        return { label: assertString(record.label, 'references.label'), url: assertString(record.url, 'references.url') }
      })
      : [],
  }
}

function renderTemplate(value: string, context: TemplateContext): string {
  return value
    .replaceAll('{{productName}}', context.productName)
    .replaceAll('{{packageName}}', context.packageName)
    .replaceAll('{{packagePath}}', context.packagePath)
    .replaceAll('{{moduleId}}', context.moduleId)
    .replaceAll('{{modulePackage}}', context.modulePackage)
    .replaceAll('{{moduleName}}', context.moduleName)
}

function toJavaPackageSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .join('')
  if (!cleaned) return 'module'
  return /^[a-z]/.test(cleaned) ? cleaned : `m${cleaned}`
}

function assertJavaPackageName(value: string): string {
  const normalized = value.trim()
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/.test(normalized)) {
    throw new Error(`Invalid Java package name "${value}". Use lowercase segments such as com.example.product.`)
  }
  return normalized
}

function renderGeneratedFile(file: ProductGeneratedFile, context: TemplateContext): ProductGeneratedFile {
  return {
    ...file,
    path: renderTemplate(file.path, context),
    content: renderTemplate(file.content, context),
  }
}

export function createProductModuleScaffoldPlan(options: {
  templateId?: string
  templates?: ProductModuleTemplate[]
  modules?: string[]
  productName?: string
  packageName?: string
} = {}): ProductModuleScaffoldPlan {
  const template = getProductModuleTemplate(options.templateId ?? BUILTIN_TEMPLATE_ID, options.templates)
  if (!template) throw new Error(`Unknown product module template "${options.templateId}".`)
  const requested = new Set((options.modules ?? []).map(module => module.trim()).filter(Boolean))
  const selectedModules = requested.size > 0
    ? template.modules.filter(module => requested.has(module.id) || module.aliases.some(alias => requested.has(alias)))
    : template.modules
  const missing = [...requested].filter(item => !selectedModules.some(module => module.id === item || module.aliases.includes(item)))
  if (missing.length > 0) throw new Error(`Unknown product modules for template "${template.id}": ${missing.join(', ')}`)
  const productName = options.productName ?? 'ProductApp'
  const packageName = assertJavaPackageName(options.packageName ?? 'com.example.product')
  const packagePath = packageName.replaceAll('.', '/')
  const generatedFiles = selectedModules.flatMap(module => {
    const context: TemplateContext = {
      productName,
      packageName,
      packagePath,
      moduleId: module.id,
      modulePackage: toJavaPackageSegment(module.id),
      moduleName: module.name,
    }
    return module.files.map(file => renderGeneratedFile(file, context))
  })
  return {
    version: 'product-module-scaffold-plan-v1',
    template,
    productName,
    packageName,
    selectedModules,
    generatedFiles,
    safetyGates: template.safetyGates,
    warnings: [
      'Generated files are templates, not production-ready business code.',
      'Run project-specific security, permission, migration, and UI tests before shipping generated modules.',
    ],
  }
}

export function renderProductModuleTemplateMarkdown(template: ProductModuleTemplate = RUOYI_PLUS_ENTERPRISE_STARTER): string {
  return [
    `# ${template.name}`,
    '',
    template.description,
    '',
    `- id: ${template.id}`,
    `- source: ${template.source}`,
    `- base architecture: ${template.baseArchitecture}`,
    `- license policy: ${template.licensePolicy.license}; ${template.licensePolicy.notice}`,
    '',
    '## Modules',
    '',
    template.modules.map(module => [
      `- ${module.id}: ${module.name}`,
      `  - ${module.description}`,
      `  - features: ${module.features.join(', ')}`,
    ].join('\n')).join('\n'),
    '',
    '## Custom Template Contract',
    '',
    `- manifest: ${template.customTemplateContract.manifestFile}`,
    `- root: ${template.customTemplateContract.templateRoot}`,
    `- variables: ${template.customTemplateContract.variables.join(', ')}`,
    '',
    '## Safety Gates',
    '',
    template.safetyGates.map(gate => `- ${gate}`).join('\n'),
    '',
  ].join('\n')
}
