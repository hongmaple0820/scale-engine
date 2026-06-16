import { basename, resolve } from 'node:path'
import { ProjectAnatomy, type AnatomyEntry } from '../context/ProjectAnatomy.js'
import type { ProductGeneratedFile } from './ProductModuleTemplates.js'

export type ExistingProjectOnboardingMode = 'legacy' | 'mature' | 'migration'
export type ExistingProjectRiskSeverity = 'high' | 'medium' | 'low'

export interface ExistingProjectCodebaseFile {
  path: string
  description: string
  tokens: number
}

export interface ExistingProjectCodebaseSection {
  path: string
  files: ExistingProjectCodebaseFile[]
  totalTokens: number
}

export interface ExistingProjectInventory {
  totalFiles: number
  totalTokens: number
  topLevelAreas: string[]
  packageFiles: string[]
  configFiles: string[]
  docs: string[]
  tests: string[]
  entrypoints: string[]
  moduleCandidates: Array<{ path: string; fileCount: number; reason: string }>
  legacyHotspots: string[]
  languageHints: string[]
}

export interface ExistingProjectRisk {
  id: string
  severity: ExistingProjectRiskSeverity
  signal: string
  mitigation: string
  evidence: string[]
}

export interface ExistingProjectOnboardingPhase {
  id: string
  name: string
  objective: string
  actions: string[]
  artifacts: string[]
  gates: string[]
}

export interface ExistingProjectOnboardingPlan {
  version: 'existing-project-onboarding-plan-v1'
  projectName: string
  projectDir: string
  mode: ExistingProjectOnboardingMode
  maxFiles: number
  codebaseMap: ExistingProjectCodebaseSection[]
  inventory: ExistingProjectInventory
  phases: ExistingProjectOnboardingPhase[]
  riskRegister: ExistingProjectRisk[]
  generatedFiles: ProductGeneratedFile[]
  warnings: string[]
}

const DEFAULT_MAX_FILES = 500

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'eslint.config.js',
  '.eslintrc',
  '.eslintrc.json',
  '.prettierrc',
  'pom.xml',
  'build.gradle',
  'settings.gradle',
  'gradle.properties',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile',
  'application.yml',
  'application.yaml',
])

const PACKAGE_FILE_NAMES = new Set([
  'package.json',
  'pom.xml',
  'build.gradle',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
])

const ENTRYPOINT_NAMES = new Set([
  'main.ts',
  'main.tsx',
  'main.js',
  'main.jsx',
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'app.ts',
  'app.tsx',
  'app.js',
  'server.ts',
  'server.js',
  'Application.java',
])

const MODULE_ROOT_NAMES = new Set([
  'modules',
  'features',
  'domains',
  'packages',
  'services',
  'apps',
])

const SHARED_DIR_NAMES = new Set([
  'common',
  'config',
  'configs',
  'shared',
  'utils',
  'util',
  'lib',
  'libs',
  'core',
  'types',
  'test',
  'tests',
  '__tests__',
])

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function joinSectionPath(section: string, entry: AnatomyEntry): string {
  const prefix = section === './' ? '' : section
  return normalizePath(`${prefix}${entry.file}`)
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function basenameOf(filePath: string): string {
  const parts = normalizePath(filePath).split('/')
  return parts[parts.length - 1] ?? filePath
}

function fileExtension(filePath: string): string {
  const name = basenameOf(filePath)
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index).toLowerCase()
}

function toCodebaseMap(sections: Map<string, AnatomyEntry[]>): ExistingProjectCodebaseSection[] {
  return [...sections.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, entries]) => {
      const files = entries
        .map(entry => ({
          path: joinSectionPath(path, entry),
          description: entry.description,
          tokens: entry.tokens,
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
      return {
        path,
        files,
        totalTokens: files.reduce((sum, file) => sum + file.tokens, 0),
      }
    })
}

function flattenFiles(codebaseMap: ExistingProjectCodebaseSection[]): ExistingProjectCodebaseFile[] {
  return codebaseMap.flatMap(section => section.files)
}

function inferLanguageHints(paths: string[]): string[] {
  const extensions = new Set(paths.map(fileExtension))
  const hints: string[] = []
  if (extensions.has('.ts') || extensions.has('.tsx') || extensions.has('.js') || extensions.has('.jsx')) hints.push('node-typescript-javascript')
  if (paths.some(path => basenameOf(path) === 'pom.xml' || path.endsWith('.java'))) hints.push('java-spring')
  if (paths.some(path => basenameOf(path) === 'go.mod' || path.endsWith('.go'))) hints.push('go')
  if (paths.some(path => basenameOf(path) === 'Cargo.toml' || path.endsWith('.rs'))) hints.push('rust')
  if (paths.some(path => basenameOf(path) === 'pyproject.toml' || path.endsWith('.py'))) hints.push('python')
  if (paths.some(path => path.endsWith('.vue'))) hints.push('vue')
  if (paths.some(path => path.endsWith('.sql'))) hints.push('sql')
  return hints.length > 0 ? hints : ['unknown']
}

function inferTopLevelAreas(paths: string[]): string[] {
  return sortedUnique(paths.map(path => {
    const parts = normalizePath(path).split('/')
    return parts.length > 1 ? `${parts[0]}/` : './'
  }))
}

function isTestPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  const name = basenameOf(normalized)
  return normalized.includes('/test/')
    || normalized.includes('/tests/')
    || normalized.includes('/__tests__/')
    || name.includes('.test.')
    || name.includes('.spec.')
}

function isDocPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  return normalized.startsWith('docs/') || normalized.endsWith('.md') || normalized.endsWith('.mdx')
}

function isLegacyHotspot(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  return normalized.includes('/legacy/')
    || normalized.includes('/deprecated/')
    || normalized.includes('/old/')
    || normalized.includes('/compat/')
    || normalized.includes('/migration/')
    || normalized.includes('/migrations/')
    || normalized.includes('todo')
}

function moduleCandidateFor(path: string): { path: string; reason: string } | undefined {
  const parts = normalizePath(path).split('/')
  const moduleRootIndex = parts.findIndex(part => MODULE_ROOT_NAMES.has(part))
  if (moduleRootIndex >= 0 && parts[moduleRootIndex + 1]) {
    return {
      path: `${parts.slice(0, moduleRootIndex + 2).join('/')}/`,
      reason: `${parts[moduleRootIndex]}/ child boundary`,
    }
  }

  if (parts[0] === 'src' && parts[1] && !parts[1].includes('.') && !SHARED_DIR_NAMES.has(parts[1])) {
    return { path: `src/${parts[1]}/`, reason: 'src child boundary' }
  }

  if (['backend', 'frontend', 'server', 'client'].includes(parts[0]) && parts[1] && !parts[1].includes('.')) {
    return { path: `${parts[0]}/${parts[1]}/`, reason: `${parts[0]}/ child boundary` }
  }

  return undefined
}

function inferModuleCandidates(paths: string[]): ExistingProjectInventory['moduleCandidates'] {
  const counts = new Map<string, { fileCount: number; reason: string }>()
  for (const path of paths) {
    const candidate = moduleCandidateFor(path)
    if (!candidate) continue
    const existing = counts.get(candidate.path)
    if (existing) {
      existing.fileCount += 1
    } else {
      counts.set(candidate.path, { fileCount: 1, reason: candidate.reason })
    }
  }
  return [...counts.entries()]
    .map(([path, value]) => ({ path, fileCount: value.fileCount, reason: value.reason }))
    .sort((left, right) => right.fileCount - left.fileCount || left.path.localeCompare(right.path))
    .slice(0, 20)
}

function createInventory(codebaseMap: ExistingProjectCodebaseSection[]): ExistingProjectInventory {
  const files = flattenFiles(codebaseMap)
  const paths = files.map(file => file.path)
  return {
    totalFiles: files.length,
    totalTokens: files.reduce((sum, file) => sum + file.tokens, 0),
    topLevelAreas: inferTopLevelAreas(paths),
    packageFiles: paths.filter(path => PACKAGE_FILE_NAMES.has(basenameOf(path))),
    configFiles: paths.filter(path => CONFIG_FILE_NAMES.has(basenameOf(path))),
    docs: paths.filter(isDocPath),
    tests: paths.filter(isTestPath),
    entrypoints: paths.filter(path => ENTRYPOINT_NAMES.has(basenameOf(path))),
    moduleCandidates: inferModuleCandidates(paths),
    legacyHotspots: paths.filter(isLegacyHotspot).slice(0, 30),
    languageHints: inferLanguageHints(paths),
  }
}

function createPhases(mode: ExistingProjectOnboardingMode): ExistingProjectOnboardingPhase[] {
  const modernizationName = mode === 'migration' ? 'Migration route' : 'Modernization backlog'
  return [
    {
      id: 'current-state-baseline',
      name: 'Current-state baseline',
      objective: 'Freeze what exists before changing the old project.',
      actions: [
        'Generate codebase map and project inventory.',
        'Record package managers, framework hints, entrypoints, and current documentation.',
        'Separate facts found by scan from assumptions that still need owner review.',
      ],
      artifacts: ['docs/project/codebase-map.md', 'docs/project/project-plan.md'],
      gates: ['codebase-map-generated', 'inventory-reviewed', 'unverified-assumptions-listed'],
    },
    {
      id: 'module-boundaries',
      name: 'Module and ownership boundaries',
      objective: 'Turn existing folders into explicit development boundaries.',
      actions: [
        'Mark candidate modules and shared infrastructure areas.',
        'Assign owner, purpose, dependencies, and verification command for each active module.',
        'Flag unclear cross-module access before feature work starts.',
      ],
      artifacts: ['docs/project/module-boundaries.md'],
      gates: ['module-candidates-reviewed', 'shared-code-owners-declared', 'boundary-risks-recorded'],
    },
    {
      id: 'verification-baseline',
      name: 'Verification baseline',
      objective: 'Make old-project development repeatable before larger changes.',
      actions: [
        'Identify existing unit, integration, lint, build, and smoke commands.',
        'Document missing verification and create the smallest reliable gate first.',
        'Keep release claims tied to commands that actually ran.',
      ],
      artifacts: ['docs/project/development-guide.md'],
      gates: ['baseline-command-known', 'missing-tests-tracked', 'quality-gate-repeatable'],
    },
    {
      id: 'risk-register',
      name: 'Legacy risk register',
      objective: 'Expose known maintenance and migration risks early.',
      actions: [
        'Record legacy hotspots, weak documentation, missing tests, and unclear entrypoints.',
        'Attach evidence paths so future agents can inspect the right code first.',
        'Convert high risks into backlog items before touching critical flows.',
      ],
      artifacts: ['docs/project/legacy-risk-register.md'],
      gates: ['high-risks-owned', 'mitigation-backlog-created', 'rollback-path-known'],
    },
    {
      id: 'modernization-route',
      name: modernizationName,
      objective: 'Plan improvements without mixing them into unrelated feature work.',
      actions: [
        'Prioritize module-by-module cleanup instead of broad rewrites.',
        'Prefer adapter layers and strangler slices for risky legacy surfaces.',
        'Refresh generated maps after structural changes land.',
      ],
      artifacts: ['docs/project/project-plan.md'],
      gates: ['next-slice-small-enough', 'blast-radius-known', 'refresh-map-after-change'],
    },
  ]
}

function createRiskRegister(
  inventory: ExistingProjectInventory,
  maxFiles: number,
): ExistingProjectRisk[] {
  const risks: ExistingProjectRisk[] = []

  if (inventory.tests.length === 0) {
    risks.push({
      id: 'missing-test-baseline',
      severity: 'high',
      signal: 'No test files were found in the scanned project inventory.',
      mitigation: 'Create the smallest repeatable verification baseline before modifying critical flows.',
      evidence: [],
    })
  }

  if (inventory.legacyHotspots.length > 0) {
    risks.push({
      id: 'legacy-hotspots-present',
      severity: 'high',
      signal: 'Legacy, deprecated, old, compatibility, or migration paths are present.',
      mitigation: 'Treat these paths as high-risk surfaces; add characterization tests before refactoring.',
      evidence: inventory.legacyHotspots.slice(0, 8),
    })
  }

  if (inventory.docs.length === 0) {
    risks.push({
      id: 'missing-project-docs',
      severity: 'medium',
      signal: 'No markdown or docs/ files were found.',
      mitigation: 'Add current-state README, module map, and development guide before onboarding more agents.',
      evidence: [],
    })
  }

  if (inventory.packageFiles.length === 0) {
    risks.push({
      id: 'missing-package-manifest',
      severity: 'medium',
      signal: 'No common package or build manifest was found in the scan.',
      mitigation: 'Document the real build entrypoint and bootstrap command explicitly.',
      evidence: [],
    })
  }

  if (inventory.entrypoints.length > 4) {
    risks.push({
      id: 'multiple-entrypoints',
      severity: 'medium',
      signal: 'Several application entrypoints were detected.',
      mitigation: 'Declare which entrypoints are production, test, demo, migration, or obsolete.',
      evidence: inventory.entrypoints.slice(0, 8),
    })
  }

  if (inventory.moduleCandidates.length === 0 && inventory.totalFiles > 20) {
    risks.push({
      id: 'unclear-module-boundaries',
      severity: 'medium',
      signal: 'The project has many files but no clear module candidates from common folder conventions.',
      mitigation: 'Create a module boundary map before assigning feature work.',
      evidence: inventory.topLevelAreas.slice(0, 8),
    })
  }

  if (inventory.totalFiles >= maxFiles) {
    risks.push({
      id: 'scan-limit-reached',
      severity: 'low',
      signal: `The scan reached the configured maxFiles limit (${maxFiles}).`,
      mitigation: 'Increase --max-files or narrow the project directory for a complete map.',
      evidence: [],
    })
  }

  return risks
}

function renderList(items: string[], fallback = '- none found'): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : fallback
}

function renderCodebaseMapMarkdown(plan: ExistingProjectOnboardingPlan): string {
  return [
    `# ${plan.projectName} Codebase Map`,
    '',
    `Project directory: ${plan.projectDir}`,
    `Mode: ${plan.mode}`,
    `Files scanned: ${plan.inventory.totalFiles}`,
    `Estimated tokens: ${plan.inventory.totalTokens}`,
    '',
    '## Top-Level Areas',
    '',
    renderList(plan.inventory.topLevelAreas),
    '',
    '## Sections',
    '',
    plan.codebaseMap.map(section => [
      `### ${section.path}`,
      '',
      section.files.map(file => {
        const description = file.description ? ` - ${file.description}` : ''
        return `- ${file.path}${description} (~${file.tokens} tok)`
      }).join('\n') || '- none found',
    ].join('\n')).join('\n\n'),
    '',
  ].join('\n')
}

function renderProjectPlanMarkdown(plan: ExistingProjectOnboardingPlan): string {
  return [
    `# ${plan.projectName} Project Plan`,
    '',
    `Version: ${plan.version}`,
    `Mode: ${plan.mode}`,
    '',
    '## Inventory',
    '',
    `- files scanned: ${plan.inventory.totalFiles}`,
    `- language hints: ${plan.inventory.languageHints.join(', ')}`,
    `- package files: ${plan.inventory.packageFiles.length}`,
    `- config files: ${plan.inventory.configFiles.length}`,
    `- docs: ${plan.inventory.docs.length}`,
    `- tests: ${plan.inventory.tests.length}`,
    `- entrypoints: ${plan.inventory.entrypoints.length}`,
    '',
    '## Phases',
    '',
    plan.phases.map(phase => [
      `### ${phase.name}`,
      '',
      phase.objective,
      '',
      'Actions:',
      phase.actions.map(item => `- ${item}`).join('\n'),
      '',
      'Artifacts:',
      phase.artifacts.map(item => `- ${item}`).join('\n'),
      '',
      'Gates:',
      phase.gates.map(item => `- ${item}`).join('\n'),
    ].join('\n')).join('\n\n'),
    '',
    '## Warnings',
    '',
    renderList(plan.warnings),
    '',
  ].join('\n')
}

function renderModuleBoundariesMarkdown(plan: ExistingProjectOnboardingPlan): string {
  return [
    `# ${plan.projectName} Module Boundaries`,
    '',
    '## Candidate Modules',
    '',
    plan.inventory.moduleCandidates.length > 0
      ? plan.inventory.moduleCandidates.map(candidate => [
        `### ${candidate.path}`,
        '',
        `- file count: ${candidate.fileCount}`,
        `- signal: ${candidate.reason}`,
        '- owner: TODO',
        '- purpose: TODO',
        '- dependencies: TODO',
        '- verification: TODO',
      ].join('\n')).join('\n\n')
      : '- none inferred; define module boundaries manually from product flows and ownership.',
    '',
    '## Boundary Rules',
    '',
    '- Modules should declare owner, purpose, API surface, data ownership, and verification command.',
    '- Shared code should stay framework or infrastructure oriented, not business-policy oriented.',
    '- Cross-module calls should use service interfaces, API clients, or events instead of direct storage access.',
    '- Refresh this file after large moves, extraction work, or architecture changes.',
    '',
  ].join('\n')
}

function renderRiskRegisterMarkdown(plan: ExistingProjectOnboardingPlan): string {
  return [
    `# ${plan.projectName} Legacy Risk Register`,
    '',
    plan.riskRegister.length > 0
      ? plan.riskRegister.map(risk => [
        `## ${risk.id}`,
        '',
        `- severity: ${risk.severity}`,
        `- signal: ${risk.signal}`,
        `- mitigation: ${risk.mitigation}`,
        '',
        'Evidence:',
        renderList(risk.evidence),
      ].join('\n')).join('\n\n')
      : 'No automatic risks were detected from the current scan. Keep this register updated during development.',
    '',
  ].join('\n')
}

function renderDevelopmentGuideMarkdown(plan: ExistingProjectOnboardingPlan): string {
  return [
    `# ${plan.projectName} Development Guide`,
    '',
    '## What New Agents Should Read First',
    '',
    '- docs/project/codebase-map.md',
    '- docs/project/project-plan.md',
    '- docs/project/module-boundaries.md',
    '- docs/project/legacy-risk-register.md',
    '',
    '## Detected Entrypoints',
    '',
    renderList(plan.inventory.entrypoints),
    '',
    '## Detected Config And Package Files',
    '',
    renderList(sortedUnique([...plan.inventory.packageFiles, ...plan.inventory.configFiles])),
    '',
    '## Detected Tests',
    '',
    renderList(plan.inventory.tests),
    '',
    '## Working Rules',
    '',
    '- Read the codebase map before changing old project code.',
    '- Pick the smallest module or flow that can be verified independently.',
    '- Add or update characterization tests before refactoring legacy hotspots.',
    '- Keep generated planning docs separate from source changes unless the task is a workflow update.',
    '- Record actual verification commands and results before claiming readiness.',
    '',
  ].join('\n')
}

function createGeneratedFiles(plan: ExistingProjectOnboardingPlan): ProductGeneratedFile[] {
  return [
    {
      path: 'docs/project/codebase-map.md',
      kind: 'doc',
      overwrite: false,
      content: renderCodebaseMapMarkdown(plan),
    },
    {
      path: 'docs/project/project-plan.md',
      kind: 'doc',
      overwrite: false,
      content: renderProjectPlanMarkdown(plan),
    },
    {
      path: 'docs/project/module-boundaries.md',
      kind: 'doc',
      overwrite: false,
      content: renderModuleBoundariesMarkdown(plan),
    },
    {
      path: 'docs/project/legacy-risk-register.md',
      kind: 'doc',
      overwrite: false,
      content: renderRiskRegisterMarkdown(plan),
    },
    {
      path: 'docs/project/development-guide.md',
      kind: 'doc',
      overwrite: false,
      content: renderDevelopmentGuideMarkdown(plan),
    },
  ]
}

function normalizeMode(value: string | undefined): ExistingProjectOnboardingMode {
  if (!value) return 'legacy'
  if (value === 'legacy' || value === 'mature' || value === 'migration') return value
  throw new Error(`Invalid existing project onboarding mode "${value}". Use legacy, mature, or migration.`)
}

export function createExistingProjectOnboardingPlan(options: {
  projectDir?: string
  projectName?: string
  mode?: ExistingProjectOnboardingMode | string
  maxFiles?: number
} = {}): ExistingProjectOnboardingPlan {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const projectName = options.projectName?.trim() || basename(projectDir) || 'project'
  const mode = normalizeMode(options.mode)
  const maxFiles = Number.isFinite(options.maxFiles) && Number(options.maxFiles) > 0
    ? Math.floor(Number(options.maxFiles))
    : DEFAULT_MAX_FILES
  const anatomy = new ProjectAnatomy()
  const sections = anatomy.scan(projectDir, { maxFiles })
  const codebaseMap = toCodebaseMap(sections)
  const inventory = createInventory(codebaseMap)
  const warnings = [
    'Generated onboarding artifacts are current-state planning aids, not proof that the old project is ready to ship.',
    'Review module ownership, verification commands, and release gates with maintainers before large changes.',
  ]
  if (inventory.totalFiles >= maxFiles) {
    warnings.push(`Scan reached maxFiles=${maxFiles}; increase --max-files for a broader map.`)
  }

  const plan: ExistingProjectOnboardingPlan = {
    version: 'existing-project-onboarding-plan-v1',
    projectName,
    projectDir,
    mode,
    maxFiles,
    codebaseMap,
    inventory,
    phases: createPhases(mode),
    riskRegister: createRiskRegister(inventory, maxFiles),
    generatedFiles: [],
    warnings,
  }
  plan.generatedFiles = createGeneratedFiles(plan)
  return plan
}

export function renderExistingProjectOnboardingMarkdown(plan: ExistingProjectOnboardingPlan): string {
  return [
    `# Existing Project Onboarding: ${plan.projectName}`,
    '',
    `Project directory: ${plan.projectDir}`,
    `Mode: ${plan.mode}`,
    '',
    '## Summary',
    '',
    `- files scanned: ${plan.inventory.totalFiles}`,
    `- estimated tokens: ${plan.inventory.totalTokens}`,
    `- language hints: ${plan.inventory.languageHints.join(', ')}`,
    `- module candidates: ${plan.inventory.moduleCandidates.length}`,
    `- risks: ${plan.riskRegister.length}`,
    '',
    '## Generated Artifacts',
    '',
    plan.generatedFiles.map(file => `- ${file.path}`).join('\n'),
    '',
    '## Next Phases',
    '',
    plan.phases.map(phase => `- ${phase.id}: ${phase.name}`).join('\n'),
    '',
    '## Risk Register',
    '',
    plan.riskRegister.length > 0
      ? plan.riskRegister.map(risk => `- [${risk.severity}] ${risk.id}: ${risk.signal}`).join('\n')
      : '- none detected automatically',
    '',
  ].join('\n')
}
