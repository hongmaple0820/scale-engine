import { defineCommand } from 'citty'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import {
  createProductProjectBlueprintPlan,
  createExistingProjectOnboardingPlan,
  createProductModuleScaffoldPlan,
  listProductModuleTemplates,
  loadProductModuleTemplateFromFile,
  renderExistingProjectOnboardingMarkdown,
  renderProductProjectBlueprintPlanMarkdown,
  renderProductModuleTemplateMarkdown,
  type ProductGeneratedFile,
  type ProductModuleTemplate,
} from '../product/index.js'

function parseCommaList(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function loadExtraTemplate(templateFile: unknown): ProductModuleTemplate[] {
  const file = String(templateFile ?? '').trim()
  return file ? [loadProductModuleTemplateFromFile(file)] : []
}

function assertInsideRoot(root: string, target: string) {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`Refusing to write outside output directory: ${target}`)
  }
}

function writeGeneratedFiles(outputDir: string, files: ProductGeneratedFile[], force: boolean): string[] {
  const root = resolve(outputDir)
  const written: string[] = []
  for (const file of files) {
    const target = resolve(root, file.path)
    assertInsideRoot(root, target)
    if (existsSync(target) && !force && !file.overwrite) {
      throw new Error(`Refusing to overwrite existing file without --force: ${target}`)
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content, 'utf-8')
    written.push(target)
  }
  return written
}

const productModules = defineCommand({
  meta: { name: 'modules', description: 'List product module templates and reusable module packs' },
  args: {
    template: { type: 'string', default: 'ruoyi-plus-enterprise-starter', description: 'Template id' },
    'template-file': { type: 'string', description: 'Custom template manifest file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const extraTemplates = loadExtraTemplate(args['template-file'])
    const templates = listProductModuleTemplates(extraTemplates)
    const template = templates.find(item => item.id === String(args.template ?? 'ruoyi-plus-enterprise-starter'))
    if (!template) throw new Error(`Unknown product module template "${String(args.template)}".`)
    if (args.json) {
      console.log(JSON.stringify({ templates, selected: template }, null, 2))
      return
    }
    console.log(renderProductModuleTemplateMarkdown(template))
  },
})

const productScaffold = defineCommand({
  meta: { name: 'scaffold', description: 'Generate reusable product module template files' },
  args: {
    template: { type: 'string', default: 'ruoyi-plus-enterprise-starter', description: 'Template id' },
    'template-file': { type: 'string', description: 'Custom template manifest file' },
    modules: { type: 'string', description: 'Comma-separated module ids or aliases' },
    product: { type: 'string', default: 'ProductApp', description: 'Product name used in generated templates' },
    package: { type: 'string', default: 'com.example.product', description: 'Java package name used in generated templates' },
    output: { type: 'string', default: '.scale/generated/product-modules', description: 'Output directory' },
    write: { type: 'boolean', default: false, description: 'Write generated files to --output' },
    force: { type: 'boolean', default: false, description: 'Allow overwriting existing generated files' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const extraTemplates = loadExtraTemplate(args['template-file'])
    const plan = createProductModuleScaffoldPlan({
      templateId: String(args.template ?? 'ruoyi-plus-enterprise-starter'),
      templates: extraTemplates,
      modules: parseCommaList(args.modules),
      productName: String(args.product ?? 'ProductApp'),
      packageName: String(args.package ?? 'com.example.product'),
    })
    const outputDir = resolve(String(args.output ?? '.scale/generated/product-modules'))
    const written = args.write ? writeGeneratedFiles(outputDir, plan.generatedFiles, Boolean(args.force)) : []
    if (args.json) {
      console.log(JSON.stringify({ ...plan, outputDir, written }, null, 2))
      return
    }
    console.log('SCALE Product Module Scaffold')
    console.log(`  Template: ${plan.template.id}`)
    console.log(`  Product: ${plan.productName}`)
    console.log(`  Package: ${plan.packageName}`)
    console.log(`  Modules: ${plan.selectedModules.map(module => module.id).join(', ')}`)
    console.log(`  Files: ${plan.generatedFiles.length}`)
    console.log(`  Output: ${outputDir}`)
    if (written.length > 0) {
      for (const file of written) console.log(`  written: ${file}`)
    } else {
      console.log('  Dry-run: pass --write to generate files')
      for (const file of plan.generatedFiles) console.log(`  file: ${file.path}`)
    }
    for (const warning of plan.warnings) console.log(`  warning: ${warning}`)
  },
})

const productBlueprint = defineCommand({
  meta: { name: 'blueprint', description: 'Generate product architecture, language, solution, design, and implementation blueprints' },
  args: {
    solutions: { type: 'string', description: 'Comma-separated solution blueprint ids' },
    output: { type: 'string', default: '.scale/generated/product-blueprint', description: 'Output directory' },
    write: { type: 'boolean', default: false, description: 'Write generated blueprint docs to --output' },
    force: { type: 'boolean', default: false, description: 'Allow overwriting existing generated files' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const plan = createProductProjectBlueprintPlan({
      solutions: parseCommaList(args.solutions),
    })
    const outputDir = resolve(String(args.output ?? '.scale/generated/product-blueprint'))
    const written = args.write ? writeGeneratedFiles(outputDir, plan.generatedFiles, Boolean(args.force)) : []
    if (args.json) {
      console.log(JSON.stringify({ ...plan, outputDir, written }, null, 2))
      return
    }
    console.log('SCALE Product Blueprint')
    console.log(`  Architecture: ${plan.architecture.id}`)
    console.log(`  Language standards: ${plan.languageStandards.map(standard => standard.id).join(', ')}`)
    console.log(`  Solutions: ${plan.selectedSolutions.map(solution => solution.id).join(', ')}`)
    console.log(`  Files: ${plan.generatedFiles.length}`)
    console.log(`  Output: ${outputDir}`)
    if (written.length > 0) {
      for (const file of written) console.log(`  written: ${file}`)
    } else {
      console.log('  Dry-run: pass --write to generate blueprint docs')
      for (const file of plan.generatedFiles) console.log(`  file: ${file.path}`)
    }
    for (const warning of plan.warnings) console.log(`  warning: ${warning}`)
    console.log('')
    console.log(renderProductProjectBlueprintPlanMarkdown(plan))
  },
})

const productOnboardExisting = defineCommand({
  meta: { name: 'onboard-existing', description: 'Generate planning and codebase-map artifacts for mature or legacy projects' },
  args: {
    dir: { type: 'string', default: '.', description: 'Existing project directory to scan' },
    project: { type: 'string', description: 'Project name used in generated docs' },
    mode: { type: 'string', default: 'legacy', description: 'Onboarding mode: legacy, mature, or migration' },
    'max-files': { type: 'string', default: '500', description: 'Maximum files to scan' },
    output: { type: 'string', default: '.scale/generated/existing-project', description: 'Output directory' },
    write: { type: 'boolean', default: false, description: 'Write generated onboarding docs to --output' },
    force: { type: 'boolean', default: false, description: 'Allow overwriting existing generated files' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const maxFiles = Number.parseInt(String(args['max-files'] ?? '500'), 10)
    if (!Number.isFinite(maxFiles) || maxFiles <= 0) throw new Error('--max-files must be a positive integer.')
    const plan = createExistingProjectOnboardingPlan({
      projectDir: String(args.dir ?? '.'),
      projectName: args.project ? String(args.project) : undefined,
      mode: String(args.mode ?? 'legacy'),
      maxFiles,
    })
    const outputDir = resolve(String(args.output ?? '.scale/generated/existing-project'))
    const written = args.write ? writeGeneratedFiles(outputDir, plan.generatedFiles, Boolean(args.force)) : []
    if (args.json) {
      console.log(JSON.stringify({ ...plan, outputDir, written }, null, 2))
      return
    }
    console.log('SCALE Existing Project Onboarding')
    console.log(`  Project: ${plan.projectName}`)
    console.log(`  Directory: ${plan.projectDir}`)
    console.log(`  Mode: ${plan.mode}`)
    console.log(`  Files scanned: ${plan.inventory.totalFiles}`)
    console.log(`  Module candidates: ${plan.inventory.moduleCandidates.length}`)
    console.log(`  Risks: ${plan.riskRegister.length}`)
    console.log(`  Output: ${outputDir}`)
    if (written.length > 0) {
      for (const file of written) console.log(`  written: ${file}`)
    } else {
      console.log('  Dry-run: pass --write to generate onboarding docs')
      for (const file of plan.generatedFiles) console.log(`  file: ${file.path}`)
    }
    for (const warning of plan.warnings) console.log(`  warning: ${warning}`)
    console.log('')
    console.log(renderExistingProjectOnboardingMarkdown(plan))
  },
})

export const productCommand = defineCommand({
  meta: { name: 'product', description: 'Reusable product module templates and scaffold generation' },
  subCommands: {
    modules: productModules,
    scaffold: productScaffold,
    blueprint: productBlueprint,
    'onboard-existing': productOnboardExisting,
  },
})
