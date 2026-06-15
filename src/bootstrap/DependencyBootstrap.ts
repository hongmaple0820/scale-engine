import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa, execaSync } from 'execa'
import { inspectCodeIntelligence, writeCodeIntelligenceConfig } from '../codegraph/CodeIntelligence.js'
import { externalCommandExists } from '../core/ExternalCommand.js'
import { inspectGbrainCliHealth, inspectMemoryProviders, useMemoryProvider, writeMemoryProvidersConfig } from '../memory/MemoryProviders.js'
import { wrapShellCommandWithRtk } from '../tools/RtkRuntime.js'
import { inspectToolCapabilities } from '../tools/ToolCapabilityRegistry.js'

export type DependencyBootstrapPackId = 'ui' | 'memory' | 'knowledge' | 'external-cli' | 'full'
export type DependencyBootstrapItemKind = 'skill' | 'cli'
export type DependencyBootstrapStatus = 'installed' | 'ready' | 'manual-review' | 'installed-now' | 'failed' | 'needs-init' | 'version-drift'

export interface DependencyBootstrapHealth {
  status: 'ok' | 'warn' | 'failed'
  bootstrapStatus?: Extract<DependencyBootstrapStatus, 'needs-init' | 'version-drift' | 'manual-review'>
  reason: string
  recoveryHint?: string
  nextCommands?: string[]
}

export interface DependencyBootstrapItemReport {
  id: string
  name: string
  kind: DependencyBootstrapItemKind
  packs: Array<Exclude<DependencyBootstrapPackId, 'full'>>
  source: string
  installed: boolean
  status: DependencyBootstrapStatus
  installCommand?: string
  installSupported: boolean
  detectedBy: string
  prerequisites: Array<{ command: string; present: boolean }>
  manualReason?: string
  health?: DependencyBootstrapHealth
  output?: string
  error?: string
}

export interface DependencyBootstrapReport {
  ok: boolean
  complete: boolean
  projectDir: string
  scaleDir: string
  packIds: DependencyBootstrapPackId[]
  includeIds: string[]
  apply: boolean
  runtimeChecks: DependencyBootstrapRuntimeCheck[]
  items: DependencyBootstrapItemReport[]
  summary: {
    total: number
    installed: number
    ready: number
    manualReview: number
    needsInit: number
    versionDrift: number
    installedNow: number
    failed: number
  }
  postActions: string[]
  postChecks: DependencyBootstrapPostCheckResult[]
  postCheckSummary: {
    total: number
    passed: number
    warned: number
    failed: number
  }
  postCheckCommands: string[]
  rollbackHints: string[]
  recommendations: string[]
}

export interface DependencyBootstrapRuntimeCheck {
  id: string
  label: string
  commands: string[]
  status: 'ok' | 'warn' | 'missing'
  requiredFor: string[]
  detectedCommand?: string
  version?: string
  reason: string
  installHint?: string
}

export interface DependencyBootstrapOptions {
  projectDir?: string
  scaleDir?: string
  packIds?: string[]
  includeIds?: string[]
  onlyIds?: string[]
  apply?: boolean
}

export interface DependencyBootstrapPostCheckResult {
  id: 'tool-capabilities' | 'memory-provider' | 'code-intelligence'
  label: string
  command: string
  status: 'passed' | 'warn' | 'failed'
  summary: string
  details?: Record<string, unknown>
}

interface DependencyBootstrapPostCheckDeps {
  inspectTools?: typeof inspectToolCapabilities
  inspectMemory?: typeof inspectMemoryProviders
  inspectCode?: typeof inspectCodeIntelligence
}

interface DependencyBootstrapPostActionDeps {
  writeMemoryConfig?: typeof writeMemoryProvidersConfig
  switchMemoryProvider?: typeof useMemoryProvider
  writeCodeConfig?: typeof writeCodeIntelligenceConfig
}

type BootstrapInstallContext = {
  projectDir: string
  homeDir: string
  commandExists: (command: string) => boolean
}

type DependencyBootstrapDefinition = {
  id: string
  name: string
  kind: DependencyBootstrapItemKind
  packs: Array<Exclude<DependencyBootstrapPackId, 'full'>>
  source: string
  detectCommand?: string
  detectSkillId?: string
  detectPaths?: (ctx: BootstrapInstallContext) => string[]
  prerequisites: string[]
  manualReason: string
  installCommand: (ctx: BootstrapInstallContext) => string | null
  install?: (ctx: BootstrapInstallContext) => Promise<{ ok: boolean; output?: string; error?: string }>
  initializeCommands?: (ctx: BootstrapInstallContext) => string[]
  healthCheck?: (ctx: BootstrapInstallContext) => DependencyBootstrapHealth
}

const UI_SKILL_INSTALLS = {
  'awesome-design-md': (ctx: BootstrapInstallContext) => {
    const skillDir = quotePath(join(ctx.homeDir, '.agents', 'skills', 'awesome-design-md'))
    const vendorDir = quotePath(join(ctx.homeDir, '.scale', 'vendor', 'awesome-design-md'))
    return `install skill adapter ${skillDir} from VoltAgent/awesome-design-md into ${vendorDir}`
  },
  'ui-ux-pro-max': (ctx: BootstrapInstallContext) => {
    const skillDir = quotePath(join(ctx.homeDir, '.agents', 'skills', 'ui-ux-pro-max'))
    const vendorDir = quotePath(join(ctx.homeDir, '.scale', 'vendor', 'ui-ux-pro-max'))
    return `install skill adapter ${skillDir} from nextlevelbuilder/ui-ux-pro-max-skill into ${vendorDir}`
  },
  'frontend-design': 'npx skills add anthropics/skills --skill frontend-design',
} as const

const RTK_INSTALL = 'cargo install --git https://github.com/rtk-ai/rtk'
const RTK_INIT = 'rtk init -g --codex'
const CODEGRAPH_INSTALL = 'npm install -g @colbymchenry/codegraph'
const GRAPHIFY_CODEX_INSTALL = 'graphify install --platform codex'
const GRAPHIFY_HOOK_INSTALL = 'graphify hook install'
const GRAPHIFY_UV_INSTALL = 'uv tool install graphify && graphify install --platform codex'
const GRAPHIFY_PIPX_INSTALL = 'pipx install graphify && graphify install --platform codex'
const GRAPHIFY_PIP_INSTALL = 'pip install graphify && graphify install --platform codex'
const GRAPHIFY_PIP3_INSTALL = 'pip3 install graphify && graphify install --platform codex'
const GRAPHIFY_PYTHON_INSTALL = 'python -m pip install graphify && graphify install --platform codex'
const GRAPHIFY_PYTHON3_INSTALL = 'python3 -m pip install graphify && graphify install --platform codex'
const GBRAIN_INSTALL = 'bun install -g github:garrytan/gbrain && gbrain init --pglite'
const GBRAIN_SOURCE = 'https://github.com/garrytan/gbrain'
const GITNEXUS_SOURCE = 'https://github.com/abhigyanpatwari/GitNexus'

const DEPENDENCY_BOOTSTRAP_DEFINITIONS: DependencyBootstrapDefinition[] = [
  {
    id: 'awesome-design-md',
    name: 'Awesome Design.md',
    kind: 'skill',
    packs: ['ui'],
    source: 'https://github.com/VoltAgent/awesome-design-md',
    detectSkillId: 'awesome-design-md',
    prerequisites: ['git|npx'],
    manualReason: 'Requires Git or npm/npx to sync the upstream DESIGN.md catalog and create a local SCALE skill adapter.',
    installCommand: ctx => requirementSatisfied('git|npx', ctx.commandExists) ? UI_SKILL_INSTALLS['awesome-design-md'](ctx) : null,
    install: ctx => installSkillAdapter(ctx, {
      id: 'awesome-design-md',
      sourceUrl: 'https://github.com/VoltAgent/awesome-design-md.git',
      repoSpecifier: 'VoltAgent/awesome-design-md',
      description: 'Brand, visual language, and DESIGN.md source skill for SCALE UI work.',
      instructions: [
        'Use this skill before UI implementation when brand direction, visual language, DESIGN.md, color, typography, layout mood, or product identity must be defined.',
        'Read the upstream vendor repository under ~/.scale/vendor/awesome-design-md, then create or update the project DESIGN.md with concrete visual decisions.',
        'Do not use it as the accessibility or responsive QA gate; route those checks to ui-ux-pro-max.',
      ],
    }),
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    kind: 'skill',
    packs: ['ui'],
    source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    detectSkillId: 'ui-ux-pro-max',
    prerequisites: ['git|npx'],
    manualReason: 'Requires Git or npm/npx to sync the upstream UX skill and create a local SCALE skill adapter.',
    installCommand: ctx => requirementSatisfied('git|npx', ctx.commandExists) ? UI_SKILL_INSTALLS['ui-ux-pro-max'](ctx) : null,
    install: ctx => installSkillAdapter(ctx, {
      id: 'ui-ux-pro-max',
      sourceUrl: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git',
      repoSpecifier: 'nextlevelbuilder/ui-ux-pro-max-skill',
      description: 'UX flow, UI state, accessibility, and responsive acceptance skill for SCALE UI work.',
      instructions: [
        'Use this skill after visual direction is selected to review UX flow, state coverage, empty/error/loading behavior, keyboard access, accessibility, and responsive acceptance.',
        'Read the upstream vendor repository under ~/.scale/vendor/ui-ux-pro-max for the current checklist and apply it as an acceptance gate.',
        'Do not replace awesome-design-md for brand or visual-language decisions.',
      ],
    }),
  },
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    kind: 'skill',
    packs: [],
    source: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    detectSkillId: 'frontend-design',
    prerequisites: ['npx'],
    manualReason: 'Optional implementation companion only; awesome-design-md and ui-ux-pro-max are the default UI stack.',
    installCommand: ctx => ctx.commandExists('npx') ? UI_SKILL_INSTALLS['frontend-design'] : null,
  },
  {
    id: 'rtk',
    name: 'RTK',
    kind: 'cli',
    packs: ['external-cli'],
    source: 'https://github.com/rtk-ai/rtk',
    detectCommand: 'rtk',
    prerequisites: ['cargo'],
    manualReason: 'RTK currently installs from the official Rust toolchain path and needs Cargo on PATH.',
    installCommand: ctx => ctx.commandExists('cargo') ? RTK_INSTALL : null,
    initializeCommands: () => [RTK_INIT],
    healthCheck: checkRtkHealth,
  },
  {
    id: 'gbrain',
    name: 'GBrain',
    kind: 'cli',
    packs: ['memory'],
    source: GBRAIN_SOURCE,
    detectCommand: 'gbrain',
    prerequisites: ['bun'],
    manualReason: 'The official standalone GBrain install needs Bun and then a configured brain (`gbrain init --pglite`) before cross-session recall is usable.',
    installCommand: ctx => buildGbrainInstallCommand(ctx),
    initializeCommands: () => ['gbrain init --pglite --no-embedding'],
    healthCheck: checkGbrainHealth,
  },
  {
    id: 'graphify',
    name: 'Graphify',
    kind: 'cli',
    packs: ['knowledge'],
    source: 'https://github.com/safishamsi/graphify',
    detectCommand: 'graphify',
    prerequisites: ['uv|pipx|pip|pip3|python|python3'],
    manualReason: 'Graphify requires Python 3.10+ and a supported installer; uv tool install is preferred to avoid polluting project virtualenvs.',
    installCommand: ctx => buildGraphifyInstallCommand(ctx),
    initializeCommands: ctx => [
      GRAPHIFY_CODEX_INSTALL,
      GRAPHIFY_HOOK_INSTALL,
      `graphify update ${quotePath(ctx.projectDir)} --no-cluster`,
    ],
    healthCheck: checkGraphifyHealth,
  },
  {
    id: 'codegraph',
    name: 'CodeGraph',
    kind: 'cli',
    packs: ['knowledge'],
    source: 'https://github.com/colbymchenry/codegraph',
    detectCommand: 'codegraph',
    prerequisites: ['npm'],
    manualReason: 'CodeGraph installs through npm and needs Node.js/npm available on PATH.',
    installCommand: ctx => ctx.commandExists('npm') ? CODEGRAPH_INSTALL : null,
    initializeCommands: ctx => [codegraphInitCommand(ctx.projectDir)],
    healthCheck: checkCodeGraphHealth,
  },
  {
    id: 'gitnexus',
    name: 'GitNexus',
    kind: 'cli',
    packs: [],
    source: GITNEXUS_SOURCE,
    detectCommand: 'gitnexus',
    prerequisites: ['npm'],
    manualReason: 'GitNexus is licensed under PolyForm-Noncommercial-1.0.0 and its npm package may run native grammar build scripts; install only after license and script review.',
    installCommand: () => null,
    initializeCommands: () => ['gitnexus analyze --index-only', 'gitnexus status'],
    healthCheck: checkGitNexusHealth,
  },
]

export async function bootstrapDependencies(options: DependencyBootstrapOptions = {}): Promise<DependencyBootstrapReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = resolveScaleRoot(projectDir, options.scaleDir)
  const homeDir = homedir()
  const packIds = normalizePackIds(options.packIds)
  const includeIds = unique((options.includeIds ?? []).map(value => value.trim()).filter(Boolean))
  const onlyIds = unique((options.onlyIds ?? []).map(value => value.trim()).filter(Boolean))
  const definitions = selectDefinitions(packIds, includeIds, onlyIds)
  const context: BootstrapInstallContext = {
    projectDir,
    homeDir,
    commandExists: externalCommandExists,
  }
  const reports = definitions.map(definition => inspectDefinition(definition, context))
  const runtimeChecks = buildRuntimeChecks(reports)

  if (options.apply) {
    for (const item of reports.filter(entry => entry.status === 'ready')) {
      if (!item.installCommand) continue
      const definition = definitions.find(entry => entry.id === item.id)
      const result = definition?.install
        ? await definition.install(context)
        : await runInstallCommand(item.installCommand, context.projectDir)
      item.output = result.output
      item.error = result.error
      const rechecked = definition ? inspectDefinition(definition, context) : item
      item.installed = rechecked.installed
      item.detectedBy = rechecked.detectedBy
      item.health = rechecked.health
      item.status = result.ok && rechecked.installed
        ? rechecked.status === 'installed' ? 'installed-now' : rechecked.status
        : 'failed'
      if (!result.ok && !item.error) item.error = `Installation command failed: ${item.installCommand}`
      if (!result.ok) item.installSupported = true
    }
    await reconcileDependencyBootstrapItems(definitions, reports, context)
  }

  const postActions = options.apply ? applyDependencyBootstrapPostActions(projectDir, scaleDir, reports) : []
  const postChecks = options.apply
    ? runDependencyBootstrapPostChecks({ projectDir, scaleDir, packIds, items: reports, homeDir })
    : []
  return buildReport(projectDir, scaleDir, packIds, includeIds, Boolean(options.apply), runtimeChecks, reports, postActions, postChecks)
}

function buildReport(
  projectDir: string,
  scaleDir: string,
  packIds: DependencyBootstrapPackId[],
  includeIds: string[],
  apply: boolean,
  runtimeChecks: DependencyBootstrapRuntimeCheck[],
  items: DependencyBootstrapItemReport[],
  postActions: string[],
  postChecks: DependencyBootstrapPostCheckResult[],
): DependencyBootstrapReport {
  const nonBlockingItems = new Set<string>()
  const summary = {
    total: items.length,
    installed: items.filter(item => item.status === 'installed').length,
    ready: items.filter(item => item.status === 'ready').length,
    manualReview: items.filter(item => item.status === 'manual-review').length,
    needsInit: items.filter(item => item.status === 'needs-init' && !nonBlockingItems.has(item.id)).length,
    versionDrift: items.filter(item => item.status === 'version-drift').length,
    installedNow: items.filter(item => item.status === 'installed-now').length,
    failed: items.filter(item => item.status === 'failed').length,
  }
  const complete = items.length > 0 && items.every(item =>
    item.status === 'installed'
    || item.status === 'installed-now'
    || nonBlockingItems.has(item.id))
  const postCheckSummary = {
    total: postChecks.length,
    passed: postChecks.filter(item => item.status === 'passed').length,
    warned: postChecks.filter(item => item.status === 'warn').length,
    failed: postChecks.filter(item => item.status === 'failed').length,
  }
  const recommendations: string[] = []
  const postCheckCommands = buildPostCheckCommands(packIds, items)
  const rollbackHints = buildRollbackHints(items)

  if (!apply && summary.ready > 0) recommendations.push('Re-run with --apply to install all ready dependencies in one pass.')
  if (runtimeChecks.some(check => check.status === 'missing')) recommendations.push('Install missing runtime dependencies before running --apply.')
  if (runtimeChecks.some(check => check.status === 'warn')) recommendations.push('Review runtime warnings; some tools may install but fail initialization or post-checks.')
  if (summary.manualReview > 0) recommendations.push('Review manual-review items for missing package managers, PATH setup, or platform-specific configuration.')
  if (summary.needsInit > 0) recommendations.push('Run the listed initialization commands before treating installed CLIs as ready for autonomous use.')
  if (summary.versionDrift > 0) recommendations.push('Resolve version-drift items before relying on their generated skills, hooks, or artifacts.')
  if (items.some(item => item.id === 'frontend-design')) recommendations.push('frontend-design is optional; keep it as an explicit companion only when implementation ideation is needed.')
  if (items.some(item => item.id === 'awesome-design-md')) recommendations.push('Use awesome-design-md as the source of DESIGN.md, brand direction, and visual-language selection.')
  if (items.some(item => item.id === 'ui-ux-pro-max')) recommendations.push('Use ui-ux-pro-max for UX flow, UI state, accessibility, and responsive acceptance checks.')
  if (items.some(item => item.id === 'gbrain')) recommendations.push('After GBrain is installed, validate remote or thin-client health with `scale memory provider status --json`.')
  if (items.some(item => item.id === 'graphify' || item.id === 'codegraph')) recommendations.push('After knowledge tools are installed, run `scale codegraph status --json` and initialize the project index or graph artifacts as needed.')
  if (items.some(item => item.id === 'gitnexus')) recommendations.push('GitNexus is optional and non-default; review its PolyForm-Noncommercial license and npm install scripts before relying on it.')
  if (postCheckSummary.failed > 0) recommendations.push('Resolve failed post-checks before treating the dependency bootstrap as production-ready.')
  if (postCheckSummary.warned > 0) recommendations.push('Review warned post-checks; they usually indicate provider initialization or project index/artifact setup is still pending.')

  return {
    ok: summary.failed === 0 && postCheckSummary.failed === 0,
    complete,
    projectDir,
    scaleDir,
    packIds,
    includeIds,
    apply,
    runtimeChecks,
    items,
    summary,
    postActions,
    postChecks,
    postCheckSummary,
    postCheckCommands,
    rollbackHints,
    recommendations,
  }
}

function buildRuntimeChecks(items: DependencyBootstrapItemReport[]): DependencyBootstrapRuntimeCheck[] {
  const ids = new Set(items.map(item => item.id))
  const requirements = new Map<string, Set<string>>()
  const requireRuntime = (runtimeId: string, requiredFor: string[]) => {
    const existing = requirements.get(runtimeId) ?? new Set<string>()
    for (const value of requiredFor) existing.add(value)
    requirements.set(runtimeId, existing)
  }

  const uiIds = ['awesome-design-md', 'ui-ux-pro-max', 'frontend-design'].filter(id => ids.has(id))
  if (uiIds.length > 0) {
    requireRuntime('node', uiIds)
    requireRuntime('npx', uiIds)
  }
  if (ids.has('rtk')) requireRuntime('cargo', ['rtk'])
  if (ids.has('gbrain')) requireRuntime('bun', ['gbrain'])
  if (ids.has('graphify')) {
    requireRuntime('python', ['graphify'])
    requireRuntime('python-installer', ['graphify'])
  }
  if (ids.has('codegraph')) {
    requireRuntime('node', ['codegraph'])
    requireRuntime('npm', ['codegraph'])
  }
  if (ids.has('gitnexus')) {
    requireRuntime('node', ['gitnexus'])
    requireRuntime('npm', ['gitnexus'])
  }

  const checks: DependencyBootstrapRuntimeCheck[] = []
  const requiredFor = (runtimeId: string) => [...(requirements.get(runtimeId) ?? [])]
  if (requirements.has('node')) checks.push(nodeRuntimeCheck(requiredFor('node')))
  if (requirements.has('npx')) checks.push(commandRuntimeCheck({
    id: 'npx',
    label: 'npx',
    candidates: [{ command: 'npx', args: ['--version'], display: 'npx' }],
    requiredFor: requiredFor('npx'),
    installHint: 'Install Node.js 20+; npm/npx are bundled with the official Node.js installer.',
  }))
  if (requirements.has('npm')) checks.push(commandRuntimeCheck({
    id: 'npm',
    label: 'npm',
    candidates: [{ command: 'npm', args: ['--version'], display: 'npm' }],
    requiredFor: requiredFor('npm'),
    installHint: 'Install Node.js 20+; npm is bundled with the official Node.js installer.',
  }))
  if (requirements.has('cargo')) checks.push(commandRuntimeCheck({
    id: 'cargo',
    label: 'Rust/Cargo',
    candidates: [{ command: 'cargo', args: ['--version'], display: 'cargo' }],
    requiredFor: requiredFor('cargo'),
    installHint: 'Install Rust with rustup, then re-open the shell so cargo is on PATH.',
  }))
  if (requirements.has('bun')) checks.push(commandRuntimeCheck({
    id: 'bun',
    label: 'Bun',
    candidates: [{ command: 'bun', args: ['--version'], display: 'bun' }],
    requiredFor: requiredFor('bun'),
    installHint: 'Install Bun from https://bun.sh and re-open the shell so bun is on PATH.',
  }))
  if (requirements.has('python')) checks.push(pythonRuntimeCheck(requiredFor('python')))
  if (requirements.has('python-installer')) checks.push(pythonInstallerRuntimeCheck(requiredFor('python-installer')))
  return checks
}

type RuntimeToolCandidate = {
  command: string
  args: string[]
  display: string
}

type RuntimeToolDetection = {
  display: string
  output: string
}

function commandRuntimeCheck(input: {
  id: string
  label: string
  candidates: RuntimeToolCandidate[]
  requiredFor: string[]
  installHint: string
}): DependencyBootstrapRuntimeCheck {
  const detected = firstAvailableRuntimeTool(input.candidates)
  if (!detected) {
    return {
      id: input.id,
      label: input.label,
      commands: input.candidates.map(candidate => candidate.display),
      status: 'missing',
      requiredFor: input.requiredFor,
      reason: `${input.label} was not detected on PATH.`,
      installHint: input.installHint,
    }
  }
  return {
    id: input.id,
    label: input.label,
    commands: input.candidates.map(candidate => candidate.display),
    status: 'ok',
    requiredFor: input.requiredFor,
    detectedCommand: detected.display,
    version: firstLine(detected.output),
    reason: `${input.label} is available via ${detected.display}.`,
    installHint: input.installHint,
  }
}

function nodeRuntimeCheck(requiredFor: string[]): DependencyBootstrapRuntimeCheck {
  const detected = firstAvailableRuntimeTool([{ command: 'node', args: ['--version'], display: 'node' }])
  const commands = ['node']
  const installHint = 'Install Node.js 20+ from https://nodejs.org.'
  if (!detected) {
    return {
      id: 'node',
      label: 'Node.js',
      commands,
      status: 'missing',
      requiredFor,
      reason: 'Node.js was not detected on PATH.',
      installHint,
    }
  }
  const version = firstLine(detected.output)
  const parsed = parseSemver(version)
  if (parsed && parsed.major < 20) {
    return {
      id: 'node',
      label: 'Node.js',
      commands,
      status: 'warn',
      requiredFor,
      detectedCommand: detected.display,
      version,
      reason: `Node.js ${version} is installed, but SCALE setup expects Node.js 20+ for current third-party installers.`,
      installHint,
    }
  }
  return {
    id: 'node',
    label: 'Node.js',
    commands,
    status: 'ok',
    requiredFor,
    detectedCommand: detected.display,
    version,
    reason: `Node.js ${version} is available.`,
    installHint,
  }
}

function pythonRuntimeCheck(requiredFor: string[]): DependencyBootstrapRuntimeCheck {
  const candidates: RuntimeToolCandidate[] = [
    { command: 'python', args: ['--version'], display: 'python' },
    { command: 'python3', args: ['--version'], display: 'python3' },
    { command: 'py', args: ['--version'], display: 'py' },
  ]
  const detected = firstAvailableRuntimeTool(candidates)
  const installHint = 'Install Python 3.10+ and prefer uv or pipx for graphify installation.'
  if (!detected) {
    return {
      id: 'python',
      label: 'Python',
      commands: candidates.map(candidate => candidate.display),
      status: 'missing',
      requiredFor,
      reason: 'Python 3.10+ was not detected on PATH.',
      installHint,
    }
  }
  const version = firstLine(detected.output)
  const parsed = parseSemver(version)
  if (!parsed || parsed.major < 3 || (parsed.major === 3 && parsed.minor < 10)) {
    return {
      id: 'python',
      label: 'Python',
      commands: candidates.map(candidate => candidate.display),
      status: 'warn',
      requiredFor,
      detectedCommand: detected.display,
      version,
      reason: `${version} is detected, but Graphify requires Python 3.10+.`,
      installHint,
    }
  }
  return {
    id: 'python',
    label: 'Python',
    commands: candidates.map(candidate => candidate.display),
    status: 'ok',
    requiredFor,
    detectedCommand: detected.display,
    version,
    reason: `${version} is available for Graphify.`,
    installHint,
  }
}

function pythonInstallerRuntimeCheck(requiredFor: string[]): DependencyBootstrapRuntimeCheck {
  const candidates: RuntimeToolCandidate[] = [
    { command: 'uv', args: ['--version'], display: 'uv' },
    { command: 'pipx', args: ['--version'], display: 'pipx' },
    { command: 'pip', args: ['--version'], display: 'pip' },
    { command: 'pip3', args: ['--version'], display: 'pip3' },
    { command: 'python', args: ['-m', 'pip', '--version'], display: 'python -m pip' },
    { command: 'python3', args: ['-m', 'pip', '--version'], display: 'python3 -m pip' },
  ]
  const detected = firstAvailableRuntimeTool(candidates)
  const installHint = 'Install uv or pipx first; pip is supported only as a fallback for graphify.'
  if (!detected) {
    return {
      id: 'python-installer',
      label: 'Python installer',
      commands: candidates.map(candidate => candidate.display),
      status: 'missing',
      requiredFor,
      reason: 'No supported Python installer was detected for graphify.',
      installHint,
    }
  }
  const version = firstLine(detected.output)
  const preferred = detected.display === 'uv' || detected.display === 'pipx'
  return {
    id: 'python-installer',
    label: 'Python installer',
    commands: candidates.map(candidate => candidate.display),
    status: preferred ? 'ok' : 'warn',
    requiredFor,
    detectedCommand: detected.display,
    version,
    reason: preferred
      ? `${detected.display} is available for isolated graphify installation.`
      : `${detected.display} is available, but uv or pipx is preferred to avoid polluting project environments.`,
    installHint,
  }
}

function firstAvailableRuntimeTool(candidates: RuntimeToolCandidate[]): RuntimeToolDetection | undefined {
  for (const candidate of candidates) {
    const result = runHealthCommand(candidate.command, candidate.args)
    if (!result.ok) continue
    return {
      display: candidate.display,
      output: `${result.stdout}\n${result.stderr}`.trim(),
    }
  }
  return undefined
}

function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3] ?? '0', 10),
  }
}

export function runDependencyBootstrapPostChecks(input: {
  projectDir: string
  scaleDir: string
  packIds: DependencyBootstrapPackId[]
  items: DependencyBootstrapItemReport[]
  homeDir?: string
}, deps: DependencyBootstrapPostCheckDeps = {}): DependencyBootstrapPostCheckResult[] {
  const inspectTools = deps.inspectTools ?? inspectToolCapabilities
  const inspectMemory = deps.inspectMemory ?? inspectMemoryProviders
  const inspectCode = deps.inspectCode ?? inspectCodeIntelligence
  const toolIds = unique(input.items.map(item => item.id).filter(id =>
    ['awesome-design-md', 'ui-ux-pro-max', 'frontend-design', 'rtk', 'gbrain', 'codegraph', 'graphify', 'gitnexus'].includes(id)))
  const results: DependencyBootstrapPostCheckResult[] = []
  const memoryReport = input.items.some(item => item.id === 'gbrain')
    ? inspectMemory({ projectDir: input.projectDir, scaleDir: input.scaleDir })
    : undefined
  const gbrain = memoryReport?.providers.find(provider => provider.id === 'gbrain')

  if (toolIds.length > 0) {
    const toolReport = inspectTools({
      projectDir: input.projectDir,
      homeDir: input.homeDir,
      toolIds,
    })
    const missing = toolReport.tools.filter(tool => !tool.installed).map(tool => tool.id)
    results.push({
      id: 'tool-capabilities',
      label: 'Tool Doctor',
      command: `scale tool doctor --tools ${toolIds.join(',')} --json`,
      status: missing.length > 0 ? 'failed' : 'passed',
      summary: [
        `${toolReport.summary.installed}/${toolReport.summary.total} selected tools are available`,
        missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
      ].filter(Boolean).join('; '),
      details: {
        toolIds,
        missing,
      },
    })
  }

  if (memoryReport) {
    const warnings = [...memoryReport.warnings]
    const status = !gbrain?.available ? 'failed' : warnings.length > 0 ? 'warn' : 'passed'
    results.push({
      id: 'memory-provider',
      label: 'Memory Provider',
      command: 'scale memory provider status --json',
      status,
      summary: gbrain
        ? `mode=${memoryReport.routing.mode}; order=${memoryReport.routing.defaultOrder.join(' -> ')}; gbrain=${gbrain.available ? 'available' : 'unavailable'}`
        : 'gbrain provider entry is missing from routing policy',
      details: {
        warnings,
        gbrainReason: gbrain?.reason,
      },
    })
  }

  if (input.items.some(item => item.id === 'codegraph' || item.id === 'graphify' || item.id === 'gitnexus')) {
    const codeReport = inspectCode({ projectDir: input.projectDir, scaleDir: input.scaleDir })
    const codegraph = codeReport.providers.find(provider => provider.id === 'codegraph')
    const graphify = codeReport.providers.find(provider => provider.id === 'graphify')
    const gitnexus = codeReport.providers.find(provider => provider.id === 'gitnexus')
    const warnings: string[] = []
    let failed = false

    if (input.items.some(item => item.id === 'codegraph')) {
      if (!codegraph?.available) failed = true
      else if (!codeReport.projectIndexExists) failed = true
    }
    if (input.items.some(item => item.id === 'graphify') && !graphify?.available) failed = true
    if (input.items.some(item => item.id === 'gitnexus') && !gitnexus?.available) failed = true

    results.push({
      id: 'code-intelligence',
      label: 'Code Intelligence',
      command: 'scale codegraph status --json',
      status: failed ? 'failed' : warnings.length > 0 ? 'warn' : 'passed',
      summary: [
        codegraph ? `codegraph=${codegraph.available ? 'available' : 'missing'}` : undefined,
        graphify ? `graphify-artifact=${graphify.available ? 'available' : 'missing'}` : undefined,
        gitnexus ? `gitnexus=${gitnexus.available ? 'available' : 'missing'}` : undefined,
        `projectIndex=${codeReport.projectIndexExists ? 'present' : 'missing'}`,
      ].filter(Boolean).join('; '),
      details: {
        warnings: [
          ...warnings,
          input.items.some(item => item.id === 'codegraph') && codegraph?.available && !codeReport.projectIndexExists
            ? 'codegraph CLI is installed but the project index (.codegraph/) is not initialized yet'
            : undefined,
          input.items.some(item => item.id === 'graphify') && !graphify?.available
            ? 'graphify CLI is installed but graphify-out/graph.json is not present yet'
            : undefined,
          input.items.some(item => item.id === 'gitnexus') && !gitnexus?.available
            ? 'gitnexus CLI is not available; install only after license and script review'
            : undefined,
        ].filter(Boolean),
      },
    })
  }

  return results
}

function inspectDefinition(definition: DependencyBootstrapDefinition, context: BootstrapInstallContext): DependencyBootstrapItemReport {
  const detectedBy = detectDefinition(definition, context.projectDir, context.homeDir)
  const installed = detectedBy !== 'missing'
  const prerequisites = definition.prerequisites.map(requirement => ({
    command: requirement,
    present: requirementSatisfied(requirement, context.commandExists),
  }))
  const health = installed && definition.healthCheck ? definition.healthCheck(context) : undefined
  const installCommand = installed ? undefined : definition.installCommand(context) ?? undefined
  const installSupported = Boolean(installCommand)
  return {
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    packs: definition.packs,
    source: definition.source,
    installed,
    status: installed
      ? health?.bootstrapStatus ?? 'installed'
      : installSupported ? 'ready' : 'manual-review',
    installCommand,
    installSupported,
    detectedBy,
    prerequisites,
    manualReason: installed ? undefined : definition.manualReason,
    health,
  }
}

function detectDefinition(definition: DependencyBootstrapDefinition, projectDir: string, homeDir: string): string {
  const context: BootstrapInstallContext = { projectDir, homeDir, commandExists: externalCommandExists }
  const detectedPath = definition.detectPaths?.(context).find(candidate => existsSync(candidate))
  if (detectedPath) return detectedPath
  if (definition.detectSkillId) {
    const path = skillCandidatePaths(projectDir, homeDir, definition.detectSkillId).find(candidate => existsSync(candidate))
    return path ?? 'missing'
  }
  if (definition.detectCommand && externalCommandExists(definition.detectCommand)) return `PATH:${definition.detectCommand}`
  return 'missing'
}

function skillCandidatePaths(projectDir: string, homeDir: string, skillId: string): string[] {
  return [
    join(projectDir, '.agents', 'skills', skillId, 'SKILL.md'),
    join(projectDir, '.codex', 'skills', skillId, 'SKILL.md'),
    join(projectDir, '.claude', 'skills', skillId, 'SKILL.md'),
    join(homeDir, '.agents', 'skills', skillId, 'SKILL.md'),
    join(homeDir, '.codex', 'skills', skillId, 'SKILL.md'),
    join(homeDir, '.claude', 'skills', skillId, 'SKILL.md'),
  ]
}

function requirementSatisfied(requirement: string, commandExists: (command: string) => boolean): boolean {
  return requirement.split('|').some(command => commandExists(command))
}

function buildGraphifyInstallCommand(context: BootstrapInstallContext): string | null {
  if (context.commandExists('uv')) return GRAPHIFY_UV_INSTALL
  if (context.commandExists('pipx')) return GRAPHIFY_PIPX_INSTALL
  if (context.commandExists('pip')) return GRAPHIFY_PIP_INSTALL
  if (context.commandExists('pip3')) return GRAPHIFY_PIP3_INSTALL
  if (context.commandExists('python')) return GRAPHIFY_PYTHON_INSTALL
  if (context.commandExists('python3')) return GRAPHIFY_PYTHON3_INSTALL
  return null
}

function buildGbrainInstallCommand(context: BootstrapInstallContext): string | null {
  if (!context.commandExists('bun')) return null
  return GBRAIN_INSTALL
}

function codegraphInitCommand(projectDir: string): string {
  const command = `codegraph init -i ${quotePath(projectDir)}`
  return process.platform === 'win32' ? `cmd /d /c ${command}` : command
}

export function hasCodexRtkInstructions(homeDir: string): boolean {
  const codexDir = join(homeDir, '.codex')
  const rtkPath = join(codexDir, 'RTK.md')
  const agentsPath = join(codexDir, 'AGENTS.md')
  if (!existsSync(rtkPath) || !existsSync(agentsPath)) return false
  try {
    const agents = readFileSync(agentsPath, 'utf-8')
    return /RTK\.md/i.test(agents)
  } catch {
    return false
  }
}

function checkRtkHealth(context: BootstrapInstallContext): DependencyBootstrapHealth {
  const gain = runHealthCommand('rtk', ['gain'])
  if (!gain.ok) {
    return {
      status: 'warn',
      bootstrapStatus: 'needs-init',
      reason: 'rtk CLI is installed but `rtk gain` did not run successfully; token-savings evidence is not available yet.',
      nextCommands: ['rtk init -g --codex', 'rtk gain'],
    }
  }
  const output = `${gain.stdout}\n${gain.stderr}`
  if (/no hook installed/i.test(output)) {
    if (hasCodexRtkInstructions(context.homeDir)) {
      return {
        status: 'ok',
        reason: 'rtk gain evidence is available; Codex mode uses RTK.md instructions instead of an automatic shell hook.',
      }
    }
    return {
      status: 'ok',
      reason: 'rtk gain evidence is available; automatic hook installation is not active, so SCALE should keep using the explicit `rtk <command>` proxy path.',
    }
  }
  return { status: 'ok', reason: 'rtk CLI and gain evidence are available.' }
}

function checkGbrainHealth(context: BootstrapInstallContext): DependencyBootstrapHealth {
  const providerReport = inspectMemoryProviders({ projectDir: context.projectDir })
  const provider = providerReport.providers.find(item => item.id === 'gbrain')
  if (provider?.available) {
    return {
      status: /optional doctor warnings/i.test(provider.reason) ? 'warn' : 'ok',
      reason: /optional doctor warnings/i.test(provider.reason)
        ? `${provider.reason}; provider can still be used for read-only recall.`
        : 'gbrain provider is available through configured memory routing.',
    }
  }

  const health = inspectGbrainCliHealth({ projectDir: context.projectDir })
  if (health.available) {
    return {
      status: health.degraded ? 'warn' : 'ok',
      reason: health.degraded
        ? `${health.reason}; provider can still be used for read-only recall.`
        : 'gbrain doctor passed; provider can be used for default memory routing.',
    }
  }
  return {
    status: 'warn',
    bootstrapStatus: 'needs-init',
    reason: /no brain configured/i.test(health.reason)
      ? 'gbrain CLI is installed but no brain is configured yet; cross-session recall will fail until initialized.'
      : health.reason,
    recoveryHint: health.recoveryHint,
    nextCommands: health.nextCommands ?? ['gbrain init --pglite --no-embedding', 'gbrain doctor --json', 'scale memory provider status --json'],
  }
}

async function reconcileDependencyBootstrapItems(
  definitions: DependencyBootstrapDefinition[],
  reports: DependencyBootstrapItemReport[],
  context: BootstrapInstallContext,
): Promise<void> {
  const definitionsById = new Map(definitions.map(definition => [definition.id, definition]))
  for (const item of reports) {
    if (item.status !== 'needs-init' && item.status !== 'version-drift') continue
    const definition = definitionsById.get(item.id)
    const commands = definition?.initializeCommands?.(context) ?? []
    if (commands.length === 0) continue

    const outputs = [item.output].filter(Boolean)
    const errors = [item.error].filter(Boolean)
    let ok = true
    for (const command of commands) {
      const result = await runInstallCommand(command, context.projectDir)
      if (result.output) outputs.push(result.output)
      if (result.error) errors.push(result.error)
      if (!result.ok) {
        ok = false
        if (!result.error) errors.push(`Initialization command failed: ${command}`)
        break
      }
    }

    item.output = outputs.join('\n') || undefined
    item.error = errors.join('\n') || undefined

    if (!ok) {
      const rechecked = definition ? inspectDefinition(definition, context) : item
      item.installed = rechecked.installed
      item.detectedBy = rechecked.detectedBy
      item.health = rechecked.health
      item.status = definition?.id === 'gbrain' && rechecked.installed ? rechecked.status : 'failed'
      continue
    }

    const rechecked = definition ? inspectDefinition(definition, context) : item
    item.installed = rechecked.installed
    item.detectedBy = rechecked.detectedBy
    item.health = rechecked.health
    item.status = rechecked.status === 'installed' ? 'installed-now' : rechecked.status
  }
}

function checkGraphifyHealth(context: BootstrapInstallContext): DependencyBootstrapHealth {
  const graphPath = join(context.projectDir, 'graphify-out', 'graph.json')
  const version = runHealthCommand('graphify', ['--version'], 5_000, context.projectDir)
  const hook = runHealthCommand('graphify', ['hook', 'status'], 10_000, context.projectDir)
  const output = `${version.stdout}\n${version.stderr}\n${hook.stdout}\n${hook.stderr}`
  if (/skill.*version|package.*version|drift|outdated/i.test(output)) {
    return {
      status: 'warn',
      bootstrapStatus: 'version-drift',
      reason: 'graphify CLI is installed but its generated skill/hook assets appear out of sync with the package.',
      nextCommands: ['graphify install --platform codex', 'graphify hook status', 'scale codegraph status --json'],
    }
  }
  if (!hook.ok || /not installed|missing/i.test(output)) {
    return {
      status: 'warn',
      bootstrapStatus: 'needs-init',
      reason: 'graphify CLI is installed but Codex hooks are not fully configured.',
      nextCommands: ['graphify install --platform codex', 'graphify hook status'],
    }
  }
  if (!existsSync(graphPath)) {
    return {
      status: 'warn',
      bootstrapStatus: 'needs-init',
      reason: 'graphify CLI is installed but graphify-out/graph.json is not present yet.',
      nextCommands: [`graphify update ${quotePath(context.projectDir)} --no-cluster`, 'scale codegraph status --json'],
    }
  }
  return { status: 'ok', reason: 'graphify CLI, hooks, and graph artifact are available.' }
}

function checkCodeGraphHealth(context: BootstrapInstallContext): DependencyBootstrapHealth {
  const indexPath = join(context.projectDir, '.codegraph')
  if (!existsSync(indexPath)) {
    return {
      status: 'warn',
      bootstrapStatus: 'needs-init',
      reason: 'codegraph CLI is installed but this project has no .codegraph index yet.',
      nextCommands: ['codegraph init -i', 'scale codegraph status --json'],
    }
  }
  const status = runHealthCommand('codegraph', ['status', context.projectDir], 10_000)
  if (!status.ok) {
    return {
      status: 'warn',
      bootstrapStatus: 'needs-init',
      reason: `codegraph index exists but status check failed: ${firstLine(`${status.stdout}\n${status.stderr}`)}`,
      nextCommands: ['codegraph init -i', 'codegraph status .'],
    }
  }
  return { status: 'ok', reason: 'codegraph CLI and project index are available.' }
}

function checkGitNexusHealth(context: BootstrapInstallContext): DependencyBootstrapHealth {
  const indexPath = join(context.projectDir, '.gitnexus')
  if (!existsSync(indexPath)) {
    return {
      status: 'warn',
      bootstrapStatus: 'needs-init',
      reason: 'gitnexus CLI is installed but this project has no .gitnexus index yet.',
      nextCommands: ['gitnexus analyze --index-only', 'gitnexus status', 'scale codegraph status --json'],
    }
  }
  const status = runHealthCommand('gitnexus', ['status'], 10_000, context.projectDir)
  if (!status.ok) {
    return {
      status: 'warn',
      bootstrapStatus: 'needs-init',
      reason: `gitnexus index exists but status check failed: ${firstLine(`${status.stdout}\n${status.stderr}`)}`,
      nextCommands: ['gitnexus analyze --index-only', 'gitnexus status'],
    }
  }
  return { status: 'ok', reason: 'gitnexus CLI and project index are available.' }
}

function runHealthCommand(command: string, args: string[], timeout = 5_000, cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const result = execaSync(command, args, {
      reject: false,
      timeout,
      cwd,
    })
    return {
      ok: (result.exitCode ?? 1) === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  } catch (error) {
    const err = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer }
    return {
      ok: false,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? err.message ?? ''),
    }
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? 'unknown error'
}

function quotePath(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`
}

async function runInstallCommand(shellCommand: string, cwd?: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  const wrapped = wrapShellCommandWithRtk(shellCommand)
  const result = wrapped
    ? await execa(wrapped.command, wrapped.args, { reject: false, timeout: 300_000, all: false, cwd })
    : await execa(shellCommand, { shell: true, reject: false, timeout: 300_000, all: false, cwd })
  return {
    ok: (result.exitCode ?? 1) === 0,
    output: result.stdout ?? '',
    error: result.stderr ?? '',
  }
}

async function installSkillAdapter(
  context: BootstrapInstallContext,
  input: {
    id: string
    sourceUrl: string
    repoSpecifier: string
    description: string
    instructions: string[]
  },
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const vendorDir = join(context.homeDir, '.scale', 'vendor', input.id)
  const skillDir = join(context.homeDir, '.agents', 'skills', input.id)
  const outputs: string[] = []
  const errors: string[] = []

  mkdirSync(join(context.homeDir, '.scale', 'vendor'), { recursive: true })
  mkdirSync(skillDir, { recursive: true })

  if (!existsSync(vendorDir) || isEmptyDirectory(vendorDir)) {
    if (context.commandExists('git')) {
      const clone = await execa('git', ['clone', '--depth', '1', input.sourceUrl, vendorDir], { reject: false })
      outputs.push(clone.stdout ?? '')
      errors.push(clone.stderr ?? '')
      if ((clone.exitCode ?? 1) !== 0) return { ok: false, output: outputs.join('\n'), error: errors.join('\n') }
    } else if (context.commandExists('npx')) {
      const degit = await execa('npx', ['degit', input.repoSpecifier, vendorDir], { reject: false })
      outputs.push(degit.stdout ?? '')
      errors.push(degit.stderr ?? '')
      if ((degit.exitCode ?? 1) !== 0) return { ok: false, output: outputs.join('\n'), error: errors.join('\n') }
    } else {
      return { ok: false, error: 'Git or npx is required to install third-party skills.' }
    }
  } else if (existsSync(join(vendorDir, '.git')) && context.commandExists('git')) {
    const pull = await execa('git', ['-C', vendorDir, 'pull', '--ff-only'], { reject: false })
    outputs.push(pull.stdout ?? '')
    errors.push(pull.stderr ?? '')
    if ((pull.exitCode ?? 1) !== 0) return { ok: false, output: outputs.join('\n'), error: errors.join('\n') }
  } else {
    outputs.push(`Reused existing vendor directory: ${vendorDir}`)
  }

  writeFileSync(join(skillDir, 'SKILL.md'), renderSkillAdapter(input, vendorDir), 'utf-8')
  outputs.push(`Wrote skill adapter: ${join(skillDir, 'SKILL.md')}`)
  return { ok: true, output: outputs.filter(Boolean).join('\n'), error: errors.filter(Boolean).join('\n') }
}

function isEmptyDirectory(path: string): boolean {
  return existsSync(path) && readdirSync(path).length === 0
}

function renderSkillAdapter(input: {
  id: string
  sourceUrl: string
  description: string
  instructions: string[]
}, vendorDir: string): string {
  const lines = [
    '---',
    `name: ${input.id}`,
    `description: ${input.description}`,
    '---',
    '',
    `# ${input.id}`,
    '',
    `Source: ${input.sourceUrl}`,
    `Vendor path: ${vendorDir}`,
    '',
    '## When To Use',
    '',
    ...input.instructions.map(item => `- ${item}`),
    '',
    '## Operating Rules',
    '',
    '- Prefer concrete project artifacts over generic advice.',
    '- If the vendor directory is missing or outdated, run `scale setup --pack ui --apply` again.',
    '- Keep generated project outputs, such as DESIGN.md, inside the target project rather than this skill directory.',
    '',
  ]
  return `${lines.join('\n')}\n`
}

export function applyDependencyBootstrapPostActions(
  projectDir: string,
  scaleDir: string,
  items: DependencyBootstrapItemReport[],
  deps: DependencyBootstrapPostActionDeps = {},
): string[] {
  const writeMemoryConfig = deps.writeMemoryConfig ?? writeMemoryProvidersConfig
  const switchMemoryProvider = deps.switchMemoryProvider ?? useMemoryProvider
  const writeCodeConfig = deps.writeCodeConfig ?? writeCodeIntelligenceConfig
  const ids = new Set(items.map(item => item.id))
  const actions: string[] = []

  if (ids.has('gbrain')) {
    const memoryConfig = writeMemoryConfig({ projectDir, scaleDir })
    actions.push(`${memoryConfig.written ? 'Wrote' : 'Reused'} ${memoryConfig.path}`)
    const provider = switchMemoryProvider({ projectDir, scaleDir, provider: 'gbrain' })
    const previousOrder = provider.previousOrder.join(' -> ')
    const nextOrder = provider.nextOrder.join(' -> ')
    actions.push(previousOrder === nextOrder
      ? `Memory provider order unchanged: ${nextOrder}`
      : `Memory provider order: ${previousOrder} => ${nextOrder}`)
  }

  if (ids.has('graphify') || ids.has('codegraph') || ids.has('gitnexus')) {
    const codeIntelligence = writeCodeConfig({ projectDir, scaleDir })
    actions.push(`${codeIntelligence.written ? 'Wrote' : 'Reused'} ${codeIntelligence.path}`)
  }
  return actions
}

function selectDefinitions(
  packIds: DependencyBootstrapPackId[],
  includeIds: string[],
  onlyIds: string[] = [],
): DependencyBootstrapDefinition[] {
  const selectedPacks = new Set(packIds.includes('full') ? ['ui', 'memory', 'knowledge', 'external-cli'] : packIds)
  const selectedIds = new Set(includeIds)
  const only = new Set(onlyIds)
  return DEPENDENCY_BOOTSTRAP_DEFINITIONS.filter(definition =>
    (only.size === 0 || only.has(definition.id)) &&
    (definition.packs.some(pack => selectedPacks.has(pack)) || selectedIds.has(definition.id)))
}

function buildPostCheckCommands(packIds: DependencyBootstrapPackId[], items: DependencyBootstrapItemReport[]): string[] {
  const commands = new Set<string>()
  const selectedPacks = new Set(packIds.includes('full') ? ['ui', 'memory', 'knowledge', 'external-cli'] : packIds)
  const ids = new Set(items.map(item => item.id))

  if (selectedPacks.has('ui')) {
    const uiToolIds = items
      .filter(item => item.kind === 'skill' && item.packs.includes('ui'))
      .map(item => item.id)
    if (uiToolIds.length > 0) commands.add(`scale tool doctor --tools ${uiToolIds.join(',')} --json`)
    commands.add('scale skill doctor --json')
  }
  if (selectedPacks.has('memory') || ids.has('gbrain')) {
    commands.add('scale memory provider status --json')
  }
  if (selectedPacks.has('knowledge') || ids.has('codegraph') || ids.has('graphify') || ids.has('gitnexus')) {
    const knowledgeToolIds = new Set<string>()
    if (selectedPacks.has('knowledge')) {
      knowledgeToolIds.add('codegraph')
      knowledgeToolIds.add('graphify')
    }
    for (const id of ['codegraph', 'graphify', 'gitnexus']) {
      if (ids.has(id)) knowledgeToolIds.add(id)
    }
    commands.add(`scale tool doctor --tools ${[...knowledgeToolIds].join(',')} --json`)
    commands.add('scale codegraph status --json')
  }
  if (selectedPacks.has('external-cli') || ids.has('rtk')) {
    commands.add('scale tool doctor --tools rtk --json')
  }
  commands.add('scale doctor')
  return [...commands]
}

function buildRollbackHints(items: DependencyBootstrapItemReport[]): string[] {
  const hints = new Set<string>()
  for (const item of items) {
    switch (item.id) {
      case 'rtk':
        hints.add('RTK rollback: cargo uninstall rtk')
        break
      case 'codegraph':
        hints.add('CodeGraph rollback: npm uninstall -g @colbymchenry/codegraph')
        break
      case 'graphify':
        hints.add('Graphify rollback: pip uninstall graphify  # or pip3/python -m pip uninstall graphify')
        break
      case 'gitnexus':
        hints.add('GitNexus rollback: npm uninstall -g gitnexus, then remove .gitnexus/ after confirming no shared index data is needed')
        break
      case 'gbrain':
        hints.add('GBrain rollback: bun unlink gbrain, then remove ~/.scale/vendor/gbrain if you want a full local cleanup')
        break
      case 'awesome-design-md':
      case 'ui-ux-pro-max':
      case 'frontend-design':
        hints.add(`Skill rollback (${item.id}): remove the installed skill directory under ~/.agents/skills/${item.id} after review`)
        break
      default:
        break
    }
  }
  return [...hints]
}

function normalizePackIds(input: string[] | undefined): DependencyBootstrapPackId[] {
  const requested = unique((input ?? ['full']).map(value => value.trim()).filter(Boolean))
  const packIds = requested
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => normalizePackId(value))
    .filter((value): value is DependencyBootstrapPackId => value !== null)
  return packIds.length > 0 ? unique(packIds) : ['full']
}

function normalizePackId(value: string): DependencyBootstrapPackId | null {
  if (value === 'ui' || value === 'memory' || value === 'knowledge' || value === 'external-cli' || value === 'full') return value
  if (value === 'external' || value === 'cli') return 'external-cli'
  return null
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function resolveScaleRoot(projectDir: string, scaleDir: string | undefined): string {
  const candidate = scaleDir ?? '.scale'
  return resolve(projectDir, candidate)
}
