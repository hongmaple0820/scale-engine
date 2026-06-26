// SCALE Engine — Init, Bootstrap, Setup, and Config CLI Commands
// Extracted from src/api/cli.ts for modular CLI architecture.

import { defineCommand } from 'citty'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  getEngine,
  SCALE_DIR,
  PROJECT_DIR,
  isTruthyFlag,
  ensureDir,
  resolveScaleDirForProject,
  governanceModeFromScenario,
  profileFromScenario,
  writeConfigYaml,
} from './engineBootstrap.js'
import { createAdapter, SUPPORTED_AGENTS } from '../adapters/index.js'
import { quickStart, detectPlatform, governanceNextSteps } from '../api/quickstart.js'
import { bootstrapDependencies } from '../bootstrap/DependencyBootstrap.js'
import { renderDependencyBootstrapReport } from '../bootstrap/DependencyBootstrapRenderer.js'
import { runSetupWizard } from '../setup/SetupWizard.js'
import { verifySetup } from '../setup/SetupVerification.js'
import { normalizeLanguage, resolveCliLanguage } from '../i18n/Language.js'
import {
  getBootstrapPlanForProfile,
  getProfile as getConfigProfile,
  generateConfigForProfile,
  listProfiles as listConfigProfiles,
} from '../config/profiles.js'
import { writeGovernanceTemplates, type GovernanceMode } from '../workflow/GovernanceTemplates.js'

// ============================================================================
// Helper utilities
// ============================================================================

function parseToolIds(value: unknown): string[] | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function parseCommaList(value: unknown): string[] {
  return parseToolIds(value) ?? []
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)]
}

function normalizeMemoryModeArg(value: unknown): 'auto' | 'local-only' | 'external-first' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'local-only' || normalized === 'external-first') return normalized
  return undefined
}

function normalizeMemoryWriteModeArg(value: unknown): 'disabled' | 'candidate-only' | 'enabled' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'disabled' || normalized === 'candidate-only' || normalized === 'enabled') return normalized
  return undefined
}

function resolveSetupPacks(args: Record<string, unknown>): { explicitPacks: string[]; recommendedPacks: string[] } {
  const explicitPacks = parseCommaList(args.pack)
  const recommendedPacks = args.profile
    ? getBootstrapPlanForProfile(
      String(args.profile),
      args['governance-pack'] ? String(args['governance-pack']) : undefined,
    ).packs
    : []
  return { explicitPacks, recommendedPacks }
}

function renderSetupVerifyReport(report: Awaited<ReturnType<typeof verifySetup>>, lang: 'zh' | 'en'): void {
  if (lang === 'zh') {
    console.log('\nSCALE 安装验收')
    console.log(`  项目: ${report.projectDir}`)
    console.log(`  依赖包: ${report.packIds.join(', ') || 'full'}`)
    console.log(`  结论: ${report.ok ? '通过' : '未通过'}`)
    console.log(`  阻塞项: ${report.summary.blockingIssues.length}`)
    console.log(`  受管能力: ${report.summary.installedTools}/${report.summary.totalTools}`)
    console.log(`  记忆供应商: ${report.summary.availableMemoryProviders}`)
    console.log(`  代码图谱供应商: ${report.summary.availableCodeProviders}`)
    if (report.summary.blockingIssues.length > 0) {
      console.log('  阻塞详情:')
      for (const issue of report.summary.blockingIssues) console.log(`    - ${issue}`)
    }
    if (report.warnings.length > 0) {
      console.log(`  警告${report.warnings.length > 12 ? ` (显示前 12 条，共 ${report.warnings.length} 条)` : ''}:`)
      for (const warning of report.warnings.slice(0, 12)) console.log(`    - ${warning}`)
    }
    if (report.recommendations.length > 0) {
      console.log('  下一步:')
      for (const command of report.recommendations.slice(0, 12)) console.log(`    ${command}`)
    }
    return
  }

  console.log('\nSCALE Setup Verification')
  console.log(`  Project: ${report.projectDir}`)
  console.log(`  Packs: ${report.packIds.join(', ') || 'full'}`)
  console.log(`  Result: ${report.ok ? 'passed' : 'failed'}`)
  console.log(`  Blocking issues: ${report.summary.blockingIssues.length}`)
  console.log(`  Governed capabilities: ${report.summary.installedTools}/${report.summary.totalTools}`)
  console.log(`  Memory providers: ${report.summary.availableMemoryProviders}`)
  console.log(`  Code providers: ${report.summary.availableCodeProviders}`)
  if (report.summary.blockingIssues.length > 0) {
    console.log('  Blockers:')
    for (const issue of report.summary.blockingIssues) console.log(`    - ${issue}`)
  }
  if (report.warnings.length > 0) {
    console.log(`  Warnings${report.warnings.length > 12 ? ` (showing first 12 of ${report.warnings.length})` : ''}:`)
    for (const warning of report.warnings.slice(0, 12)) console.log(`    - ${warning}`)
  }
  if (report.recommendations.length > 0) {
    console.log('  Next:')
    for (const command of report.recommendations.slice(0, 12)) console.log(`    ${command}`)
  }
}

// ============================================================================
// init command
// ============================================================================

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Initialize SCALE Engine governance in current project (use --with-deps to also install third-party skills, CLIs, memory, and knowledge providers)' },
  args: {
    agent: { type: 'string', default: '', description: `Agent type (${SUPPORTED_AGENTS.join('/')}) - auto-detected if not specified` },
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Output initialization result as JSON' },
    scenario: { type: 'string', default: 'standard', description: 'Scenario mode (sandbox/standard/critical)' },
    'governance-pack': {
      type: 'string',
      default: 'standard',
      description: 'Governance template pack (standard/project-scaffold/scale-engine-repo/moe-workspace/resource-governance/go-service-matrix/node-library/frontend-app)',
    },
    quick: { type: 'boolean', default: false, description: 'Quick start with auto-detection' },
    interactive: { type: 'boolean', default: false, description: 'Interactive configuration mode with prompts' },
    profile: { type: 'string', default: '', description: 'Configuration profile (minimal/standard/advanced). Auto-mapped from scenario if not specified' },
    'coverage-threshold': { type: 'string', default: '80', description: 'Coverage threshold (default 80%)' },
    'retry-threshold': { type: 'string', default: '3', description: 'Brute retry threshold (default 3)' },
    'block-severity': { type: 'string', default: 'CRITICAL', description: 'Block severity level (CRITICAL/HIGH/MEDIUM)' },
    'with-deps': { type: 'boolean', default: false, description: 'Also install third-party skills, CLIs, memory, and knowledge providers after governance init' },
  },
  async run({ args }) {
    // Interactive configuration mode
    if (args.interactive) {
      console.log('\n🔧 SCALE Engine Interactive Configuration\n')
      console.log('=' .repeat(50))

      // Step 1: Detect and suggest agent platform
      const detection = detectPlatform(args.dir)
      console.log('\n📋 Step 1: Agent Platform Selection')
      console.log(`   Detected suggestions: ${detection.suggestions.join(', ') || 'none'}`)

      const agentType = args.agent || detection.suggestions[0] || 'claude-code'
      console.log(`   Using: ${agentType}`)

      // Step 2: Scenario mode
      console.log('\n📋 Step 2: Scenario Mode')
      console.log('   sandbox    - No quality gates (POC/prototype)')
      console.log('   standard   - Default quality gates')
      console.log('   critical   - Hardened gates + manual approval')

      const scenarioMode = args.scenario as 'sandbox' | 'standard' | 'critical'
      console.log(`   Using: ${scenarioMode}`)

      // Step 3: Quality Gate Thresholds (quantified)
      console.log('\n📋 Step 3: Quality Gate Thresholds')
      const coverageThreshold = parseInt(args['coverage-threshold'], 10) || 80
      const retryThreshold = parseInt(args['retry-threshold'], 10) || 3
      const blockSeverity = args['block-severity'] || 'CRITICAL'

      console.log(`   Coverage threshold:   ${coverageThreshold}%`)
      console.log(`   Retry threshold:      ${retryThreshold} (brute retry block)`)
      console.log(`   Block severity:       ${blockSeverity}`)

      // Step 4: Write thresholds to .scale/thresholds.json
      const thresholdsPath = join(args.dir, '.scale', 'thresholds.json')
      ensureDir(join(args.dir, '.scale'))
      writeFileSync(thresholdsPath, JSON.stringify({
        coverage: { minimum: coverageThreshold, unit: 'percent' },
        retry: { bruteMaximum: retryThreshold, unit: 'count' },
        severity: { blockLevel: blockSeverity },
        gates: {
          G3_build: { required: scenarioMode !== 'sandbox', exitCode: 0 },
          G4_lint: { required: scenarioMode !== 'sandbox', exitCode: 0 },
          G5_tests: { required: scenarioMode !== 'sandbox', allPass: true },
          G6_coverage: { required: scenarioMode !== 'sandbox', minimum: coverageThreshold },
          G7_security: { required: scenarioMode === 'critical', noCritical: true },
        },
      }, null, 2))

      console.log(`\n   ✓ Thresholds written to: ${thresholdsPath}`)

      // Initialize with adapter
      const adapter = createAdapter(agentType)
      const result = await adapter.init({
        projectDir: args.dir,
        agentType: agentType as never,
        scenarioMode,
        thresholdsPath,
      })
      const projectName = args.dir.split(/[/\\]/).pop() || 'Project'
      const governance = writeGovernanceTemplates(args.dir, {
        mode: governanceModeFromScenario(scenarioMode),
        projectName,
        pack: args['governance-pack'],
      })
      result.created.push(...governance.created)
      result.skipped.push(...governance.skipped)

      // Generate config.yaml from profile
      const profileId = args.profile || profileFromScenario(scenarioMode)
      const configPath = writeConfigYaml(args.dir, profileId, projectName, [agentType])
      result.created.push(configPath)

      console.log(`\n✅ SCALE Engine initialized for ${agentType} (interactive mode, profile: ${profileId})`)
      console.log(`\n📁 Created:`)
      for (const f of result.created) console.log(`   + ${f}`)
      if (result.skipped.length > 0) {
        console.log(`\n⏭️  Skipped (already exist):`)
        for (const f of result.skipped) console.log(`   - ${f}`)
      }

      console.log(`\n🔧 Configuration Summary:`)
      console.log(`   Settings:      ${result.settingsPath}`)
      console.log(`   Knowledge:     ${result.knowledgeDocPath}`)
      console.log(`   Thresholds:    ${thresholdsPath}`)
      console.log(`   Config:        ${configPath}`)
      console.log(`   Data dir:      ${result.scaleDir}`)
      console.log(`   Scenario:      ${scenarioMode}`)
      console.log(`   Profile:       ${profileId}`)

      console.log(`\n📋 Next steps:`)
      for (const step of governanceNextSteps({
        profileId,
        governancePack: String(args['governance-pack']),
      })) console.log(`   → ${step}`)

      // Auto-install third-party deps if --with-deps
      if (args['with-deps']) {
        console.log(`\n🧰 Installing third-party dependencies (full pack)...`)
        const depReport = await bootstrapDependencies({
          projectDir: resolve(args.dir),
          scaleDir: join(resolve(args.dir), '.scale'),
          packIds: ['full'],
          includeIds: [],
          apply: true,
        })
        console.log(`   ✓ ${depReport.summary.installed}/${depReport.summary.total} dependencies installed`)
        if (depReport.summary.needsInit > 0) console.log(`   ⚠ ${depReport.summary.needsInit} need manual init`)
        if (depReport.summary.failed > 0) console.log(`   ✗ ${depReport.summary.failed} failed`)
      }
      return
    }

    // One-click quick start mode
    if (!args.agent) {
      const profileId = args.profile || profileFromScenario(args.scenario)
      const qsResult = await quickStart(args.dir, {
        governancePack: args['governance-pack'],
        profileId,
      })

      // Generate config.yaml from profile
      if (qsResult.success) {
        const projectName = args.dir.split(/[/\\]/).pop() || 'Project'
        const detectedAgent = qsResult.platform ? [qsResult.platform] : []
        const configPath = writeConfigYaml(args.dir, profileId, projectName, detectedAgent)
        qsResult.created.push(configPath)
      }

      if (args.json) {
        const detection = qsResult.success ? undefined : detectPlatform(args.dir)
        console.log(JSON.stringify({
          ok: qsResult.success,
          mode: qsResult.success && !qsResult.platform ? 'governance-only' : 'quick',
          platform: qsResult.platform,
          created: qsResult.created,
          skipped: qsResult.skipped,
          constraintsApplied: qsResult.constraintsApplied,
          workflowCapabilities: qsResult.workflowCapabilities,
          capabilitiesEnabled: qsResult.capabilitiesEnabled,
          knowledgeGraph: qsResult.knowledgeGraph,
          dependencyBootstrapCommand: qsResult.dependencyBootstrapCommand,
          nextSteps: qsResult.nextSteps,
          suggestions: detection?.suggestions ?? [],
        }, null, 2))
        return
      }
      if (qsResult.success) {
        if (!qsResult.platform) console.log(`\nSCALE governance templates initialized`)
        else
        console.log(`\n✅ SCALE Engine Quick Start completed for ${qsResult.platform}`)
        console.log(`\n📁 Created (${qsResult.created.length}):`)
        for (const f of qsResult.created) console.log(`   + ${f}`)
        if (qsResult.skipped.length > 0) {
          console.log(`\n⏭️  Skipped (${qsResult.skipped.length}):`)
          for (const f of qsResult.skipped) console.log(`   - ${f}`)
        }
        console.log(`\n🔒 Physical constraints applied: ${qsResult.constraintsApplied}`)
        console.log(`\n🧭 Workflow capability plan: ${qsResult.workflowCapabilities.join(', ')}`)
        console.log(`\n🧰 Dependency bootstrap: ${qsResult.dependencyBootstrapCommand}`)
        console.log(`\n📋 Next steps:`)
        for (const step of qsResult.nextSteps) console.log(`   → ${step}`)

        // Auto-install third-party deps if --with-deps
        if (args['with-deps']) {
          console.log(`\n🧰 Installing third-party dependencies (full pack)...`)
          const depReport = await bootstrapDependencies({
            projectDir: resolve(args.dir),
            scaleDir: join(resolve(args.dir), '.scale'),
            packIds: ['full'],
            includeIds: [],
            apply: true,
          })
          console.log(`   ✓ ${depReport.summary.installed}/${depReport.summary.total} dependencies installed`)
          if (depReport.summary.needsInit > 0) console.log(`   ⚠ ${depReport.summary.needsInit} need manual init`)
          if (depReport.summary.failed > 0) console.log(`   ✗ ${depReport.summary.failed} failed`)
        }
      } else {
        console.log(`\n⚠️  No agent platform detected`)
        const detection = detectPlatform(args.dir)
        console.log(`\n📋 Suggested platforms: ${detection.suggestions.join(', ')}`)
        console.log(`\n→ Run: scale init --agent <platform>`)
      }
      return
    }

    // Manual agent specification mode
    const adapter = createAdapter(args.agent)
    const result = await adapter.init({ projectDir: args.dir, agentType: args.agent as never, scenarioMode: args.scenario as 'sandbox' | 'standard' | 'critical' })
    const projectName = args.dir.split(/[/\\]/).pop() || 'Project'
    const governance = writeGovernanceTemplates(args.dir, {
      mode: governanceModeFromScenario(args.scenario),
      projectName,
      pack: args['governance-pack'],
    })
    result.created.push(...governance.created)
    result.skipped.push(...governance.skipped)

    // Generate config.yaml from profile
    const profileId = args.profile || profileFromScenario(args.scenario)
    const configPath = writeConfigYaml(args.dir, profileId, projectName, [args.agent])
    result.created.push(configPath)

    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        mode: args.quick ? 'quick-agent' : 'manual',
        agent: args.agent,
        scenario: args.scenario,
        profile: profileId,
        governancePack: args['governance-pack'],
        settingsPath: result.settingsPath,
        knowledgeDocPath: result.knowledgeDocPath,
        configPath,
        scaleDir: result.scaleDir,
        created: result.created,
        skipped: result.skipped,
        nextSteps: governanceNextSteps({
          profileId,
          governancePack: String(args['governance-pack']),
        }),
      }, null, 2))
      return
    }
    console.log(`\n✅ SCALE Engine initialized for ${args.agent} (scenario: ${args.scenario}, profile: ${profileId})`)
    console.log(`\n📁 Created:`)
    for (const f of result.created) console.log(`   + ${f}`)
    if (result.skipped.length > 0) {
      console.log(`\n⏭️  Skipped (already exist):`)
      for (const f of result.skipped) console.log(`   - ${f}`)
    }
    console.log(`\n🔧 Settings: ${result.settingsPath}`)
    console.log(`\n📖 Knowledge: ${result.knowledgeDocPath}`)
    console.log(`\n📄 Config:    ${configPath}`)
    console.log(`\n📂 Data dir:  ${result.scaleDir}`)
    console.log(`\n📋 Next steps:`)
    for (const step of governanceNextSteps({
      profileId,
      governancePack: String(args['governance-pack']),
    })) console.log(`   → ${step}`)

    // Auto-install third-party deps if --with-deps
    if (args['with-deps']) {
      console.log(`\n🧰 Installing third-party dependencies (full pack)...`)
      const depReport = await bootstrapDependencies({
        projectDir: resolve(args.dir),
        scaleDir: join(resolve(args.dir), '.scale'),
        packIds: ['full'],
        includeIds: [],
        apply: true,
      })
      console.log(`   ✓ ${depReport.summary.installed}/${depReport.summary.total} dependencies installed`)
      if (depReport.summary.needsInit > 0) console.log(`   ⚠ ${depReport.summary.needsInit} need manual init`)
      if (depReport.summary.failed > 0) console.log(`   ✗ ${depReport.summary.failed} failed`)
    }
  },
})

// ============================================================================
// bootstrap command
// ============================================================================

const bootstrapDepsCommand = defineCommand({
  meta: { name: 'deps', description: 'Plan or install third-party skills, CLI dependencies, and project post-configuration' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    pack: { type: 'string', default: '', description: 'Comma-separated packs: ui,memory,knowledge,external-cli,full. Defaults to full unless --profile is supplied.' },
    profile: { type: 'string', description: 'Resolve recommended packs from profile: minimal, standard, advanced' },
    'governance-pack': { type: 'string', description: 'Optional governance pack hint, for example frontend-app -> ui' },
    include: { type: 'string', description: 'Additional dependency ids to include explicitly' },
    only: { type: 'string', description: 'Comma-separated dependency ids to limit the selected packs to' },
    apply: { type: 'boolean', default: false, description: 'Run install commands for ready dependencies' },
    lang: { type: 'string', description: 'Output language zh/en. Defaults to zh, then SCALE_LANG, then .scale/config.yaml locale.' },
    json: { type: 'boolean', default: false, description: 'Output bootstrap plan as JSON' },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const lang = resolveCliLanguage({ lang: args.lang, projectDir, scaleDir: SCALE_DIR })
    const explicitPacks = parseCommaList(args.pack)
    const recommendedPacks = args.profile
      ? getBootstrapPlanForProfile(
        String(args.profile),
        args['governance-pack'] ? String(args['governance-pack']) : undefined,
      ).packs
      : []
    const report = await bootstrapDependencies({
      projectDir,
      scaleDir: SCALE_DIR,
      packIds: explicitPacks.length > 0 ? uniqueStrings([...recommendedPacks, ...explicitPacks]) : recommendedPacks,
      includeIds: parseCommaList(args.include),
      onlyIds: parseCommaList(args.only),
      apply: isTruthyFlag(args.apply),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (isTruthyFlag(args.apply) && !report.ok) process.exitCode = 1
      return
    }
    console.log(renderDependencyBootstrapReport(report, lang))
    if (report.apply && !report.ok) process.exitCode = 1
  },
})

export const bootstrapCommand = defineCommand({
  meta: { name: 'bootstrap', description: 'Bootstrap third-party workflow dependencies with explicit install intent' },
  subCommands: { deps: bootstrapDepsCommand },
})

// ============================================================================
// setup command
// ============================================================================

export const setupCommand = defineCommand({
  meta: { name: 'setup', description: 'Interactive SCALE setup for third-party skills, CLIs, memory, and knowledge providers' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    pack: { type: 'string', default: '', description: 'Comma-separated packs: ui,memory,knowledge,external-cli,full. Defaults to full unless --profile is supplied.' },
    profile: { type: 'string', description: 'Resolve recommended packs from profile: minimal, standard, advanced' },
    'governance-pack': { type: 'string', description: 'Optional governance pack hint, for example frontend-app -> ui' },
    include: { type: 'string', description: 'Additional dependency ids to include explicitly' },
    only: { type: 'string', description: 'Comma-separated dependency ids to limit the selected packs to' },
    apply: { type: 'boolean', default: false, description: 'Run install commands for ready dependencies' },
    yes: { type: 'boolean', default: false, description: 'Confirm installation without prompting' },
    verify: { type: 'boolean', default: false, description: 'Verify governed setup and dependency readiness instead of running the setup wizard' },
    interactive: { type: 'boolean', default: true, description: 'Prompt before installation when dependencies are ready' },
    lang: { type: 'string', description: 'Output language zh/en. Defaults to zh, then SCALE_LANG, then .scale/config.yaml locale.' },
    'memory-provider': { type: 'string', description: 'Switch memory provider during setup. Supported default: gbrain' },
    'memory-mode': { type: 'string', description: 'Memory routing mode: auto or external-first' },
    'memory-endpoint': { type: 'string', description: 'Optional endpoint to persist for the selected memory provider' },
    'memory-write-mode': { type: 'string', description: 'Memory write mode: disabled, candidate-only, enabled' },
    'allow-external-write': { type: 'boolean', default: false, description: 'Explicitly allow external memory writes in provider routing' },
    json: { type: 'boolean', default: false, description: 'Output setup report as JSON' },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const lang = resolveCliLanguage({ lang: args.lang, projectDir, scaleDir: SCALE_DIR })
    const { explicitPacks, recommendedPacks } = resolveSetupPacks(args)
    if (isTruthyFlag(args.verify)) {
      const verification = await verifySetup({
        projectDir,
        scaleDir: SCALE_DIR,
        packIds: explicitPacks.length > 0 ? uniqueStrings([...recommendedPacks, ...explicitPacks]) : recommendedPacks,
        includeIds: parseCommaList(args.include),
        onlyIds: parseCommaList(args.only),
      })
      if (args.json) {
        console.log(JSON.stringify(verification, null, 2))
      } else {
        renderSetupVerifyReport(verification, lang)
      }
      if (!verification.ok) process.exitCode = 1
      return
    }
    const report = await runSetupWizard({
      projectDir,
      scaleDir: SCALE_DIR,
      packIds: explicitPacks.length > 0 ? uniqueStrings([...recommendedPacks, ...explicitPacks]) : recommendedPacks,
      includeIds: parseCommaList(args.include),
      onlyIds: parseCommaList(args.only),
      promptPacks: explicitPacks.length === 0 && recommendedPacks.length === 0 && !args.include && !args.only,
      apply: isTruthyFlag(args.apply),
      yes: isTruthyFlag(args.yes),
      interactive: isTruthyFlag(args.interactive) && !isTruthyFlag(args.json),
      lang,
      memoryProvider: args['memory-provider'] ? String(args['memory-provider']) : undefined,
      memoryMode: normalizeMemoryModeArg(args['memory-mode']),
      memoryEndpoint: args['memory-endpoint'] ? String(args['memory-endpoint']) : undefined,
      memoryWriteMode: normalizeMemoryWriteModeArg(args['memory-write-mode']),
      allowExternalWrite: isTruthyFlag(args['allow-external-write']) ? true : undefined,
      promptLanguage: isTruthyFlag(args.interactive) && !args.lang,
    })
    if (!args.json) {
      console.log(lang === 'zh' ? '\nSCALE 交互式安装' : '\nSCALE Interactive Setup')
      console.log(lang === 'zh'
        ? `  已执行安装: ${report.applied ? '是' : '否'}`
        : `  Applied: ${report.applied}`)
      if (report.memoryProviderSwitch) {
        const switched = report.memoryProviderSwitch!
        console.log(lang === 'zh' ? '  记忆供应商:' : '  Memory provider:')
        console.log(`    provider=${switched.provider}; mode=${switched.mode}; config=${switched.path}`)
        console.log(`    order=${switched.previousOrder.join(' -> ')} => ${switched.nextOrder.join(' -> ')}`)
        if (switched.providerStatus) {
          console.log(`    status=${switched.providerStatus!.available ? 'available' : 'not-ready'}; reason=${switched.providerStatus!.reason}`)
        }
        for (const warning of switched.warnings) console.log(lang === 'zh' ? `    [警告] ${warning}` : `    [WARN] ${warning}`)
      }
      console.log(renderDependencyBootstrapReport(report.final, lang))
      if (!report.ok) process.exitCode = 1
      return
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
  },
})

// ============================================================================
// config command — Configuration profile management
// ============================================================================

const configProfile = defineCommand({
  meta: { name: 'profile', description: 'View or switch configuration profile' },
  args: {
    set: { type: 'string', default: '', description: 'Switch to profile (minimal/standard/advanced)' },
    'governance-pack': { type: 'string', description: 'Optional governance pack hint for bootstrap suggestions, for example frontend-app' },
    list: { type: 'boolean', default: false, description: 'List all available profiles' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    if (args.list) {
      const profiles = listConfigProfiles()
      if (args.json) {
        console.log(JSON.stringify(profiles, null, 2))
        return
      }
      console.log('\nAvailable profiles:\n')
      for (const p of profiles) {
        console.log(`  ${p.id.padEnd(12)} ${p.name} — ${p.description}`)
      }
      console.log(`\nUse: scale config profile --set <id>`)
      return
    }

    if (args.set) {
      const profile = getConfigProfile(args.set)
      if (profile.id !== args.set) {
        console.log(`\n⚠️  Profile "${args.set}" not found. Available: minimal, standard, advanced`)
        return
      }
      const bootstrapPlan = getBootstrapPlanForProfile(profile.id, args['governance-pack'] ? String(args['governance-pack']) : undefined)
      // Update config.yaml
      const configPath = join('.scale', 'config.yaml')
      const projectName = process.cwd().split(/[/\\]/).pop() || 'Project'
      const content = generateConfigForProfile(args.set, { name: projectName })
      ensureDir('.scale')
      writeFileSync(configPath, content, 'utf-8')
      if (args.json) {
        console.log(JSON.stringify({
          ok: true,
          profile: profile.id,
          name: profile.name,
          description: profile.description,
          sections: profile.sections,
          bootstrapPacks: bootstrapPlan.packs,
          dependencyBootstrapCommand: bootstrapPlan.inspectCommand,
          dependencyBootstrapApplyCommand: bootstrapPlan.applyCommand,
          configPath,
        }, null, 2))
        return
      }
      console.log(`\n✅ Profile switched to: ${profile.name}`)
      console.log(`   ${profile.description}`)
      console.log(`\n📄 Config updated: ${configPath}`)
      return
    }

    // Show current profile
    const configPath = join('.scale', 'config.yaml')
    if (!existsSync(configPath)) {
      console.log('\n⚠️  No config.yaml found. Run: scale init')
      return
    }
    const content = readFileSync(configPath, 'utf-8')
    const match = content.match(/^profile:\s*(.+)$/m)
    const currentProfile = match?.[1]?.trim() || 'standard'
    const profile = getConfigProfile(currentProfile)
    const bootstrapPlan = getBootstrapPlanForProfile(profile.id, args['governance-pack'] ? String(args['governance-pack']) : undefined)

    if (args.json) {
      console.log(JSON.stringify({
        profile: profile.id,
        name: profile.name,
        description: profile.description,
        sections: profile.sections,
        bootstrapPacks: bootstrapPlan.packs,
        dependencyBootstrapCommand: bootstrapPlan.inspectCommand,
        dependencyBootstrapApplyCommand: bootstrapPlan.applyCommand,
      }, null, 2))
      return
    }
    console.log(`\nCurrent profile: ${profile.name} (${profile.id})`)
    console.log(`  ${profile.description}`)
    console.log(`\nSections: ${profile.sections.join(', ')}`)
    console.log(`Bootstrap packs: ${bootstrapPlan.packs.join(', ')}`)
    console.log(`Dependency bootstrap: ${bootstrapPlan.inspectCommand}`)
    console.log(`\nUse: scale config profile --set <id> to switch`)
  },
})

export const configCommand = defineCommand({
  meta: { name: 'config', description: 'Configuration management' },
  subCommands: { profile: configProfile },
})
