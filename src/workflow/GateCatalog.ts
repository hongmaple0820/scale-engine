import { isAbsolute, resolve } from 'node:path'
import type { GateStage } from './types.js'
import {
  resolveVerificationTargets,
  type VerificationEngineeringStandardsGateMode,
  type VerificationPolicy,
} from './VerificationProfile.js'

export type GateFamily = 'core' | 'meta' | 'extension'
export type GateActivation = 'default' | 'profile' | 'optional' | 'policy'

export interface GateCatalogEntry {
  id: string
  stage?: GateStage
  family: GateFamily
  activation: GateActivation
  name: string
  description: string
  requiredLevel: 'S' | 'M' | 'L' | 'CRITICAL' | 'ALWAYS' | 'profile'
  blocking: boolean
}

export interface GateProfileStatus {
  id: string
  name: string
  description: string
  stages: GateStage[]
  gates: GateCatalogEntry[]
}

export interface GateExtensionStatus {
  id: string
  name: string
  mode: VerificationEngineeringStandardsGateMode | 'evidence-required' | 'advisory'
  active: boolean
  blocking: boolean
  description: string
}

export interface GateStatusReport {
  projectDir: string
  scaleDir: string
  generatedAt: string
  summary: {
    catalogEntries: number
    coreStages: number
    metaStages: number
    extensionGates: number
    blockingExtensions: number
    enhancedGates: number
  }
  verificationProfile: string
  policy: VerificationPolicy
  catalog: GateCatalogEntry[]
  profiles: GateProfileStatus[]
  extensions: GateExtensionStatus[]
  warnings: string[]
}

export const PREFLIGHT_QUICK_GATES: GateStage[] = ['G3', 'G0', 'G4', 'G5']
export const PREFLIGHT_FAST_LANE_GATES: GateStage[] = ['G3', 'G0', 'G4', 'G5']
export const PREFLIGHT_FULL_GATES: GateStage[] = ['G3', 'G0', 'G4', 'G5', 'G6', 'G7']
export const WORKFLOW_VERIFY_GATES: GateStage[] = ['G3', 'G0', 'G4', 'G5', 'G6', 'G7']
export const PRODUCT_SMOKE_GATES: GateStage[] = ['G8']
export const META_GOVERNANCE_GATE_STAGES: GateStage[] = ['G9', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15']
export const ENHANCED_GATE_STAGES: GateStage[] = ['G16', 'G17', 'G18', 'G19', 'G20', 'G21', 'G22', 'G23']

export const CORE_GATE_CATALOG: GateCatalogEntry[] = [
  {
    id: 'tdd',
    stage: 'G3',
    family: 'core',
    activation: 'default',
    name: 'TDD / behavior change evidence',
    description: 'Behavior-changing source edits must be backed by test evidence.',
    requiredLevel: 'M',
    blocking: true,
  },
  {
    id: 'build',
    stage: 'G0',
    family: 'core',
    activation: 'default',
    name: 'Build',
    description: 'Build command or configured verification command must pass.',
    requiredLevel: 'ALWAYS',
    blocking: true,
  },
  {
    id: 'exploration',
    stage: 'G1',
    family: 'core',
    activation: 'default',
    name: 'Exploration',
    description: 'Exploration must record source files and the main contradiction.',
    requiredLevel: 'M',
    blocking: false,
  },
  {
    id: 'planning',
    stage: 'G2',
    family: 'core',
    activation: 'default',
    name: 'Planning',
    description: 'Plan must cover boundaries, exceptions, rollback, and verification.',
    requiredLevel: 'M',
    blocking: false,
  },
  {
    id: 'lint',
    stage: 'G4',
    family: 'core',
    activation: 'default',
    name: 'Lint',
    description: 'Lint command must pass when configured.',
    requiredLevel: 'ALWAYS',
    blocking: true,
  },
  {
    id: 'tests',
    stage: 'G5',
    family: 'core',
    activation: 'default',
    name: 'Tests',
    description: 'Test command must pass when configured.',
    requiredLevel: 'ALWAYS',
    blocking: true,
  },
  {
    id: 'coverage-and-evidence',
    stage: 'G6',
    family: 'core',
    activation: 'profile',
    name: 'Coverage and evidence',
    description: 'Coverage, task evidence, and diff hygiene must meet the active profile.',
    requiredLevel: 'profile',
    blocking: true,
  },
  {
    id: 'security',
    stage: 'G7',
    family: 'core',
    activation: 'profile',
    name: 'Security',
    description: 'Security and dependency risk checks must pass for stronger profiles.',
    requiredLevel: 'profile',
    blocking: true,
  },
  {
    id: 'product-smoke',
    stage: 'G8',
    family: 'core',
    activation: 'profile',
    name: 'Product smoke',
    description: 'Configured product smoke command must pass for product-smoke profiles.',
    requiredLevel: 'profile',
    blocking: true,
  },
  {
    id: 'commit-discipline',
    stage: 'G16',
    family: 'core',
    activation: 'default',
    name: 'Commit Discipline',
    description: 'Uncommitted changes must be within thresholds; no large files staged.',
    requiredLevel: 'M',
    blocking: true,
  },
  {
    id: 'doc-hygiene',
    stage: 'G17',
    family: 'core',
    activation: 'default',
    name: 'Documentation Hygiene',
    description: 'Changed docs must have valid links and up-to-date references.',
    requiredLevel: 'M',
    blocking: true,
  },
  {
    id: 'runtime-evidence',
    stage: 'G18',
    family: 'core',
    activation: 'default',
    name: 'Runtime Evidence',
    description: 'Task must have recorded runtime evidence with matching exit codes.',
    requiredLevel: 'M',
    blocking: true,
  },
  {
    id: 'code-review',
    stage: 'G19',
    family: 'core',
    activation: 'profile',
    name: 'Code Review',
    description: 'L/CRITICAL tasks require reviewed changes with resolved findings.',
    requiredLevel: 'L',
    blocking: true,
  },
  {
    id: 'supply-chain',
    stage: 'G20',
    family: 'core',
    activation: 'default',
    name: 'Supply Chain',
    description: 'No CRITICAL/HIGH vulnerabilities; lock file must be consistent.',
    requiredLevel: 'ALWAYS',
    blocking: true,
  },
  {
    id: 'test-integrity',
    stage: 'G23',
    family: 'core',
    activation: 'profile',
    name: 'Test Integrity',
    description: 'Test diffs must not weaken assertions, add skip/only, or inflate timeouts (PR-D1: advisory).',
    requiredLevel: 'M',
    blocking: false,
  },
]

export const META_GATE_CATALOG: GateCatalogEntry[] = [
  ['G9', 'Knowledge Utilization', 'Checks whether knowledge base and recall capabilities were used.'],
  ['G10', 'Evolution Effectiveness', 'Checks whether improvement candidates are backed by evidence.'],
  ['G11', 'Guardrail Effectiveness', 'Checks whether guardrail outcomes are visible and actionable.'],
  ['G12', 'Workflow Thoroughness', 'Checks whether workflow phases and artifacts are complete.'],
  ['G13', 'Multi-Agent Coordination', 'Checks whether multi-agent work has coordination evidence.'],
  ['G14', 'Skill Utilization', 'Checks whether required skills were selected and verified.'],
  ['G15', 'Self-Improvement', 'Checks whether lessons can safely enter the learning loop.'],
  ['G21', 'Context Budget', 'Task context must be within token budget; no redundant loading.'],
  ['G22', 'Session Health', 'No leaked worktrees; session state is consistent.'],
].map(([stage, name, description]) => ({
  id: String(stage).toLowerCase(),
  stage: stage as GateStage,
  family: 'meta' as const,
  activation: 'default' as const,
  name: String(name),
  description: String(description),
  requiredLevel: 'M' as const,
  blocking: stage === 'G13',
}))

export function preflightGateStages(profile: 'quick' | 'full' | 'ci' | 'fast-lane'): GateStage[] {
  if (profile === 'fast-lane') return [...PREFLIGHT_FAST_LANE_GATES]
  return profile === 'quick' ? [...PREFLIGHT_QUICK_GATES] : [...PREFLIGHT_FULL_GATES]
}

export function createGateStatusReport(options: {
  projectDir?: string
  scaleDir?: string
  profile?: string
  service?: string
} = {}): GateStatusReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = resolveScaleRoot(projectDir, options.scaleDir)
  const resolved = resolveVerificationTargets({
    projectDir,
    scaleDir,
    profile: options.profile,
    service: options.service,
  })
  const policy = resolved.policy
  const catalog = [...CORE_GATE_CATALOG, ...META_GATE_CATALOG]
  const enhancedGates = [...CORE_GATE_CATALOG, ...META_GATE_CATALOG].filter(g => g.stage !== undefined && ENHANCED_GATE_STAGES.includes(g.stage))
  const extensions = extensionStatuses(policy)
  const profiles = [
    profileStatus('workflow:verify', 'Workflow verify', 'Default task verification gates.', WORKFLOW_VERIFY_GATES),
    profileStatus('preflight:quick', 'Preflight quick', 'Fast preflight without coverage or security.', PREFLIGHT_QUICK_GATES),
    profileStatus('preflight:fast-lane', 'Preflight fast-lane', 'S-level fast-lane: build + TDD + lint + tests only. Skips exploration, planning, coverage, security, and meta governance.', PREFLIGHT_FAST_LANE_GATES),
    profileStatus('preflight:full', 'Preflight full', 'Full preflight including coverage and security.', PREFLIGHT_FULL_GATES),
    profileStatus('preflight:ci', 'Preflight CI', 'CI-equivalent preflight gate set.', PREFLIGHT_FULL_GATES),
    profileStatus('product-smoke', 'Product smoke', 'Product smoke profile gate set.', PRODUCT_SMOKE_GATES),
    profileStatus('meta-governance', 'Meta governance', 'Optional G9-G15 governance effectiveness gates.', META_GOVERNANCE_GATE_STAGES),
    profileStatus('enhanced', 'Enhanced gates', 'G16-G23 commit discipline, doc hygiene, runtime evidence, code review, supply chain, context budget, session health, test integrity.', ENHANCED_GATE_STAGES),
  ]
  const warnings = [...resolved.warnings]
  warnings.push('VisualGate also defaults to G9 when explicitly registered; keep visual and meta gate profiles separate until stage ids are made capability-based.')
  if (policy.engineeringStandardsGate !== 'block') {
    warnings.push('Engineering standards gate is not blocking; architecture conformance can be bypassed unless profile policy sets engineeringStandardsGate=block.')
  }

  return {
    projectDir,
    scaleDir,
    generatedAt: new Date().toISOString(),
    summary: {
      catalogEntries: catalog.length,
      coreStages: CORE_GATE_CATALOG.length,
      metaStages: META_GATE_CATALOG.length,
      extensionGates: extensions.length,
      blockingExtensions: extensions.filter(gate => gate.blocking).length,
      enhancedGates: enhancedGates.length,
    },
    verificationProfile: resolved.profileName,
    policy,
    catalog,
    profiles,
    extensions,
    warnings,
  }
}

function resolveScaleRoot(projectDir: string, scaleDir = '.scale'): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}

function profileStatus(id: string, name: string, description: string, stages: GateStage[]): GateProfileStatus {
  return {
    id,
    name,
    description,
    stages: [...stages],
    gates: stages
      .map(stage => findGate(stage))
      .filter((gate): gate is GateCatalogEntry => Boolean(gate)),
  }
}

function findGate(stage: GateStage): GateCatalogEntry | undefined {
  return [...CORE_GATE_CATALOG, ...META_GATE_CATALOG].find(gate => gate.stage === stage)
}

function extensionStatuses(policy: VerificationPolicy): GateExtensionStatus[] {
  const standardsMode = policy.engineeringStandardsGate ?? 'warn'
  const productSmokeMode = policy.productSmokeGate ?? 'warn'
  return [
    {
      id: 'engineering-standards',
      name: 'Architecture and engineering standards',
      mode: standardsMode,
      active: standardsMode !== 'off',
      blocking: standardsMode === 'block',
      description: 'Runs deterministic standards checks from .scale/engineering-standards.json and .scale/frameworks.json.',
    },
    {
      id: 'product-smoke-policy',
      name: 'Product smoke policy',
      mode: productSmokeMode,
      active: productSmokeMode !== 'off',
      blocking: productSmokeMode === 'block',
      description: 'Controls whether configured product smoke evidence is advisory or blocking.',
    },
    {
      id: 'tool-evidence',
      name: 'Governed tool capability evidence',
      mode: 'evidence-required',
      active: true,
      blocking: false,
      description: 'ToolEvidenceGate can require RTK/tool execution evidence for M/L/CRITICAL tasks when policy or CLI flags demand it.',
    },
  ]
}
