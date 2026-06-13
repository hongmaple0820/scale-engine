import { verifySetup, type SetupVerificationReport } from '../setup/SetupVerification.js'
import { inspectWorkflowSkills, type SkillDoctorReport } from '../skills/SkillDoctor.js'
import type { VerificationPolicy } from './VerificationProfile.js'

export type EcosystemReadinessGateMode = 'off' | 'warn' | 'block'
export type EcosystemReadinessSkillScope = 'required' | 'recommended' | 'all'

export interface EcosystemReadinessGateReport {
  mode: EcosystemReadinessGateMode
  checked: boolean
  ok: boolean
  blocked: boolean
  packIds: string[]
  summary: {
    blockingIssues: string[]
    warningCount: number
    installedTools: number
    totalTools: number
    missingTools: string[]
    installedWorkflowSkills: number
    totalWorkflowSkills: number
    missingWorkflowSkills: string[]
    missingRequiredWorkflowSkills: string[]
    missingRecommendedWorkflowSkills: string[]
    missingOptionalWorkflowSkills: string[]
    blockingMissingWorkflowSkills: string[]
    skillScope: EcosystemReadinessSkillScope
  }
  setup?: SetupVerificationReport
  skillDoctor?: SkillDoctorReport
  warnings: string[]
  recommendations: string[]
}

export interface EcosystemReadinessGateOptions {
  projectDir: string
  scaleDir: string
  policy: VerificationPolicy
  checked?: boolean
  skipReason?: string
  deps?: {
    verifySetup?: typeof verifySetup
    inspectWorkflowSkills?: typeof inspectWorkflowSkills
  }
}

const DEFAULT_ECOSYSTEM_PACKS = ['full']
const VALID_ECOSYSTEM_PACKS = new Set(['ui', 'memory', 'knowledge', 'external-cli', 'full'])

export async function evaluateEcosystemReadinessGate(
  options: EcosystemReadinessGateOptions,
): Promise<EcosystemReadinessGateReport> {
  const mode = normalizeEcosystemReadinessGateMode(options.policy.ecosystemReadinessGate)
  const packIds = normalizeEcosystemReadinessPacks(options.policy.ecosystemReadinessPacks)
  const skillScope = normalizeEcosystemReadinessSkillScope(options.policy.ecosystemReadinessSkillScope)
  if (mode === 'off' || options.checked === false) {
    const reason = options.skipReason ?? (mode === 'off' ? 'ecosystem readiness gate is disabled by policy' : 'ecosystem readiness gate skipped for this preflight profile')
    return {
      mode,
      checked: false,
      ok: true,
      blocked: false,
      packIds,
      summary: {
        blockingIssues: [],
        warningCount: 0,
        installedTools: 0,
        totalTools: 0,
        missingTools: [],
        installedWorkflowSkills: 0,
        totalWorkflowSkills: 0,
        missingWorkflowSkills: [],
        missingRequiredWorkflowSkills: [],
        missingRecommendedWorkflowSkills: [],
        missingOptionalWorkflowSkills: [],
        blockingMissingWorkflowSkills: [],
        skillScope,
      },
      warnings: [reason],
      recommendations: [],
    }
  }

  const setup = await (options.deps?.verifySetup ?? verifySetup)({
    projectDir: options.projectDir,
    scaleDir: options.scaleDir,
    packIds,
  })
  const skillDoctor = (options.deps?.inspectWorkflowSkills ?? inspectWorkflowSkills)({
    projectDir: options.projectDir,
    scaleDir: options.scaleDir,
  })
  const missingTools = setup.toolCapabilities.tools
    .filter(tool => !tool.installed)
    .map(tool => tool.id)
  const missingWorkflowSkills = skillDoctor.skills
    .filter(skill => skill.status === 'missing')
    .map(skill => skill.id)
  const missingRequiredWorkflowSkills = skillDoctor.missingByReadiness.required
  const missingRecommendedWorkflowSkills = skillDoctor.missingByReadiness.recommended
  const missingOptionalWorkflowSkills = skillDoctor.missingByReadiness.optional
  const blockingMissingWorkflowSkills = missingWorkflowSkillsForScope(skillDoctor, skillScope)
  const workflowSkillsReadyForScope = blockingMissingWorkflowSkills.length === 0
  const blockingMissingWorkflowSkillSet = new Set(blockingMissingWorkflowSkills)
  const nonBlockingMissingWorkflowSkills = missingWorkflowSkills
    .filter(skill => !blockingMissingWorkflowSkillSet.has(skill))
  const blockingIssues = [
    ...setup.summary.blockingIssues,
    ...(workflowSkillsReadyForScope ? [] : [`Missing ${skillScope} workflow skills: ${blockingMissingWorkflowSkills.join(', ')}`]),
  ]
  const ok = setup.ok && workflowSkillsReadyForScope
  const warnings = [
    ...setup.warnings,
    ...(setup.ok ? [] : [`Setup readiness is not OK for pack(s): ${packIds.join(', ')}`]),
    ...(workflowSkillsReadyForScope ? [] : [`Workflow skill readiness is not OK for ${skillScope} scope: ${blockingMissingWorkflowSkills.join(', ')}`]),
    ...(nonBlockingMissingWorkflowSkills.length === 0 ? [] : [`Non-blocking workflow skills missing: ${nonBlockingMissingWorkflowSkills.join(', ')}`]),
  ]

  return {
    mode,
    checked: true,
    ok,
    blocked: mode === 'block' && (!setup.ok || !workflowSkillsReadyForScope),
    packIds,
    summary: {
      blockingIssues,
      warningCount: warnings.length,
      installedTools: setup.summary.installedTools,
      totalTools: setup.summary.totalTools,
      missingTools,
      installedWorkflowSkills: skillDoctor.installed,
      totalWorkflowSkills: skillDoctor.total,
      missingWorkflowSkills,
      missingRequiredWorkflowSkills,
      missingRecommendedWorkflowSkills,
      missingOptionalWorkflowSkills,
      blockingMissingWorkflowSkills,
      skillScope,
    },
    setup,
    skillDoctor,
    warnings,
    recommendations: setup.recommendations,
  }
}

export function normalizeEcosystemReadinessGateMode(value: unknown): EcosystemReadinessGateMode {
  if (value === 'off' || value === 'warn' || value === 'block') return value
  return 'warn'
}

export function normalizeEcosystemReadinessPacks(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ECOSYSTEM_PACKS]
  const packs = value
    .map(item => String(item).trim())
    .filter(item => VALID_ECOSYSTEM_PACKS.has(item))
  return packs.length > 0 ? [...new Set(packs)] : [...DEFAULT_ECOSYSTEM_PACKS]
}

export function normalizeEcosystemReadinessSkillScope(value: unknown): EcosystemReadinessSkillScope {
  if (value === 'required' || value === 'recommended' || value === 'all') return value
  return 'required'
}

function missingWorkflowSkillsForScope(
  skillDoctor: SkillDoctorReport,
  scope: EcosystemReadinessSkillScope,
): string[] {
  if (scope === 'all') return skillDoctor.skills.filter(skill => skill.status === 'missing').map(skill => skill.id)
  if (scope === 'recommended') {
    return [
      ...skillDoctor.missingByReadiness.required,
      ...skillDoctor.missingByReadiness.recommended,
    ]
  }
  return skillDoctor.missingByReadiness.required
}
