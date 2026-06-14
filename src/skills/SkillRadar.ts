import { existsSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { evaluateSkillInstallSafety, listSkillRepositoryEntries, type SkillRepositoryEntry } from './SkillRepository.js'
import { inspectToolCapabilities, type ToolCapabilityEntry, type ToolCapabilityReport } from '../tools/ToolCapabilityRegistry.js'
import { loadToolPolicy, type ResolvedToolPolicy } from '../tools/ToolPolicy.js'

export type SkillRadarSafetyLevel = 'trusted' | 'review-required' | 'restricted' | 'blocked'
export type SkillRadarAction = 'may-run-with-policy' | 'recommend-with-evidence' | 'suggest-fallback' | 'blocked'

export interface SkillRadarOptions {
  projectDir?: string
  scaleDir?: string
  task: string
  phase?: string
  level?: string
  files?: string[]
  services?: string[]
}

export interface SkillRadarRecommendation {
  id: string
  name: string
  category: string
  capability: string
  confidence: number
  safetyLevel: SkillRadarSafetyLevel
  action: SkillRadarAction
  installed: boolean
  policyEnabled: boolean
  reason: string
  risk: string
  requiredEvidence: string[]
  fallback: string
  installCommand: string
  sourceUrl: string
  matchedSignals: string[]
  safetyFindings: Array<{ rule: string; severity: 'warn' | 'block'; message: string }>
}

export interface SkillRadarReport {
  ok: boolean
  projectDir: string
  generatedAt: string
  task: string
  phase?: string
  level: string
  detectedDomains: Array<{ domain: string; score: number; reasons: string[] }>
  recommendations: SkillRadarRecommendation[]
  requiredEvidence: string[]
  fallbacks: string[]
  toolSummary: ToolCapabilityReport['summary']
  policyMode: ResolvedToolPolicy['mode']
  warnings: string[]
}

export interface SkillSupplyChainDoctorReport {
  ok: boolean
  projectDir: string
  generatedAt: string
  evaluated: number
  blocked: number
  warnings: number
  entries: Array<{
    id: string
    sourceUrl: string
    installCommand: string
    trust: string
    safetyLevel: SkillRadarSafetyLevel
    risk: string
    blocked: boolean
    findings: Array<{ rule: string; severity: 'warn' | 'block'; message: string }>
    requiredChecks: string[]
  }>
}

interface DomainSignal {
  domain: string
  score: number
  reasons: string[]
}

const DOMAIN_CONFIG: Record<string, {
  keywords: string[]
  filePatterns: RegExp[]
  categories: SkillRepositoryEntry['category'][]
  evidence: string[]
  fallback: string
}> = {
  ui: {
    keywords: ['ui', 'ux', 'design', 'frontend', 'page', 'component', 'visual', 'layout', 'prototype', 'accessibility'],
    filePatterns: [/\.(tsx|jsx|vue|svelte|css|scss)$/i, /(^|\/)(pages|app|components|routes)\//i],
    categories: ['ui'],
    evidence: ['design-rationale', 'screenshot', 'visual-review'],
    fallback: 'Use a static UI checklist, code review, and manual screenshot capture.',
  },
  browserAutomation: {
    keywords: ['browser', 'e2e', 'playwright', 'chrome', 'devtools', 'web access', 'web', 'automation', 'integration'],
    filePatterns: [/\.(spec|test)\.(ts|tsx|js|jsx)$/i, /playwright/i],
    categories: ['browser', 'testing'],
    evidence: ['screenshot', 'console-summary', 'network-summary', 'scenario-result'],
    fallback: 'Run manual smoke checks and capture route, console, and network evidence.',
  },
  desktopAutomation: {
    keywords: ['desktop', 'gui', 'wps', 'wechat', 'computer', 'cua', 'client-app'],
    filePatterns: [],
    categories: ['desktop'],
    evidence: ['operator-boundary', 'desktop-screenshot', 'affected-app'],
    fallback: 'Use a manual operator checklist with screenshots and side-effect boundaries.',
  },
  externalCli: {
    keywords: ['codex', 'gemini', 'opencode', 'claude code', 'external cli', 'agent cli', 'command line'],
    filePatterns: [],
    categories: ['agent-cli'],
    evidence: ['cli-version-check', 'command', 'exit-code', 'output-summary'],
    fallback: 'Use local review or built-in verification commands instead of cross-agent CLI.',
  },
  review: {
    keywords: ['review', 'pr', 'merge', 'ship', 'release', 'quality', 'code review'],
    filePatterns: [],
    categories: ['review'],
    evidence: ['finding-list', 'severity', 'accepted-risk-or-fix'],
    fallback: 'Use built-in review and runtime evidence gates.',
  },
  docs: {
    keywords: ['docs', 'documentation', 'readme', 'adr', 'governance asset'],
    filePatterns: [/\.md$/i, /(^|\/)docs\//i],
    categories: ['docs'],
    evidence: ['changed-docs', 'source-of-truth-map'],
    fallback: 'Update canonical Markdown directly and run doc drift checks.',
  },
  planning: {
    keywords: ['plan', 'planning', 'task_plan', 'findings', 'progress', 'attestation', 'long-running', 'multi-step', 'research plan', '规划', '计划'],
    filePatterns: [/\.planning\//i, /(^|\/)(plans|worklog|tasks)\//i],
    categories: ['planning'],
    evidence: ['task-plan', 'findings-log', 'progress-log', 'plan-attestation'],
    fallback: 'Use SCALE task artifacts under .planning/tasks and record plan, progress, findings, and verification manually.',
  },
  memory: {
    keywords: ['memory', 'recall', 'remember', 'forget', 'mcp memory', 'persistent memory', 'knowledge', 'gbrain', '记忆', '知识库', '沉淀'],
    filePatterns: [/memory/i, /(^|\/)(knowledge|memories)\//i],
    categories: ['memory'],
    evidence: ['memory-provider-health', 'privacy-boundary', 'data-retention-policy', 'query-result'],
    fallback: 'Use SCALE Memory Brain or Memory Fabric locally and record memory evidence before enabling an external provider.',
  },
  discovery: {
    keywords: ['skill', 'mcp', 'tool', 'capability', 'discover', 'search'],
    filePatterns: [],
    categories: ['discovery'],
    evidence: ['candidate-list', 'safety-review'],
    fallback: 'Search docs manually and run skill safety review before install.',
  },
}

export function evaluateSkillRadar(options: SkillRadarOptions): SkillRadarReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? '.scale'
  const level = String(options.level ?? 'M').toUpperCase()
  const files = normalizeFiles(options.files)
  const detectedDomains = detectDomains({
    text: `${options.task} ${options.phase ?? ''}`,
    files,
  })
  const activeDomains = detectedDomains.length > 0
    ? detectedDomains
    : [{ domain: 'discovery', score: 1, reasons: ['fallback:no-domain-match'] }]

  const policy = loadToolPolicy(projectDir, scaleDir)
  const toolReport = inspectToolCapabilities({ projectDir })
  const recommendations = listSkillRepositoryEntries()
    .filter(entry => entryMatchesDomains(entry, activeDomains))
    .map(entry => buildRecommendation(entry, {
      projectDir,
      domains: activeDomains,
      policy,
      toolReport,
      files,
    }))
    .sort((a, b) => b.confidence - a.confidence || safetyRank(a.safetyLevel) - safetyRank(b.safetyLevel) || a.id.localeCompare(b.id))

  const requiredEvidence = unique(recommendations.flatMap(item => item.requiredEvidence))
  const fallbacks = unique(recommendations
    .filter(item => item.action === 'suggest-fallback' || item.action === 'blocked')
    .map(item => item.fallback))

  return {
    ok: recommendations.every(item => item.safetyLevel !== 'blocked'),
    projectDir,
    generatedAt: new Date().toISOString(),
    task: options.task,
    phase: options.phase,
    level,
    detectedDomains: activeDomains,
    recommendations,
    requiredEvidence,
    fallbacks,
    toolSummary: toolReport.summary,
    policyMode: policy.mode,
    warnings: [
      ...policy.warnings,
      ...recommendations
        .filter(item => item.confidence < 0.4)
        .map(item => `${item.id} confidence is below auto-run threshold; use fallback.`),
    ],
  }
}

export function inspectSkillSupplyChain(options: { projectDir?: string } = {}): SkillSupplyChainDoctorReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const entries = listSkillRepositoryEntries().map(entry => {
    const safety = evaluateSkillInstallSafety({
      sourceUrl: entry.sourceUrl,
      installCommand: entry.installCommand,
    })
    return {
      id: entry.id,
      sourceUrl: entry.sourceUrl,
      installCommand: entry.installCommand,
      trust: entry.trust,
      safetyLevel: safety.blocked ? 'blocked' as const : entry.trust === 'official' ? 'trusted' as const : 'review-required' as const,
      risk: safety.risk,
      blocked: safety.blocked,
      findings: safety.findings,
      requiredChecks: unique([...entry.safety.requiredChecks, ...safety.requiredChecks]),
    }
  })

  return {
    ok: entries.every(entry => !entry.blocked),
    projectDir,
    generatedAt: new Date().toISOString(),
    evaluated: entries.length,
    blocked: entries.filter(entry => entry.blocked).length,
    warnings: entries.reduce((count, entry) => count + entry.findings.filter(finding => finding.severity === 'warn').length, 0),
    entries,
  }
}

function buildRecommendation(
  entry: SkillRepositoryEntry,
  input: {
    projectDir: string
    domains: DomainSignal[]
    policy: ResolvedToolPolicy
    toolReport: ToolCapabilityReport
    files: string[]
  },
): SkillRadarRecommendation {
  const safety = evaluateSkillInstallSafety({ sourceUrl: entry.sourceUrl, installCommand: entry.installCommand })
  const tool = findToolForEntry(entry, input.toolReport)
  const policyId = policyIdForEntry(entry, tool)
  const policyConfig = input.policy.tools[policyId]
  const policyEnabled = policyConfig?.enabled ?? true
  const installed = tool?.installed ?? skillInstalledInProject(entry.id, input.projectDir)
  const domainHits = input.domains.filter(domain => DOMAIN_CONFIG[domain.domain]?.categories.includes(entry.category))
  const matchedSignals = unique([
    ...domainHits.flatMap(domain => domain.reasons),
    `category:${entry.category}`,
    `policy:${policyId}`,
  ])
  const safetyLevel = resolveSafetyLevel(entry, {
    blocked: safety.blocked || !policyEnabled,
    policyConfig,
  })
  const confidence = confidenceScore(entry, {
    installed,
    policyEnabled,
    safetyLevel,
    domainScore: domainHits.reduce((sum, domain) => sum + domain.score, 0),
    projectHasPackage: existsSync(join(input.projectDir, 'package.json')),
    projectHasFrontendFiles: input.files.some(file => /\.(tsx|jsx|vue|svelte|css|scss)$/i.test(file)),
    tool,
  })

  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    capability: capabilityFor(entry),
    confidence,
    safetyLevel,
    action: resolveAction(safetyLevel, confidence),
    installed,
    policyEnabled,
    reason: reasonFor(entry, { domainHits, installed, policyEnabled }),
    risk: riskFor(entry, safetyLevel, policyEnabled),
    requiredEvidence: unique([
      ...entry.orchestration.requiredEvidence,
      ...domainHits.flatMap(domain => DOMAIN_CONFIG[domain.domain]?.evidence ?? []),
      ...(policyConfig?.evidenceRequired ? ['tool-evidence-record'] : []),
    ]),
    fallback: fallbackFor(entry, domainHits),
    installCommand: entry.installCommand,
    sourceUrl: entry.sourceUrl,
    matchedSignals,
    safetyFindings: safety.findings,
  }
}

function detectDomains(input: { text: string; files: string[] }): DomainSignal[] {
  const text = input.text.toLowerCase()
  return Object.entries(DOMAIN_CONFIG)
    .map(([domain, config]) => {
      let score = 0
      const reasons: string[] = []
      for (const keyword of config.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += 3
          reasons.push(`keyword:${keyword}`)
        }
      }
      for (const file of input.files) {
        const matched = config.filePatterns.find(pattern => pattern.test(file))
        if (matched) {
          score += 4
          reasons.push(`file:${file}`)
        }
      }
      return { domain, score, reasons: unique(reasons) }
    })
    .filter(domain => domain.score > 0)
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain))
}

function entryMatchesDomains(entry: SkillRepositoryEntry, domains: DomainSignal[]): boolean {
  return domains.some(domain => DOMAIN_CONFIG[domain.domain]?.categories.includes(entry.category))
}

function findToolForEntry(entry: SkillRepositoryEntry, report: ToolCapabilityReport): ToolCapabilityEntry | undefined {
  const ids = toolIdsForEntry(entry)
  return report.tools.find(item => ids.includes(item.id) || ids.includes(item.skillId ?? ''))
}

function toolIdsForEntry(entry: SkillRepositoryEntry): string[] {
  if (entry.id === 'cua') return ['cua', 'desktop-cua']
  return [entry.id]
}

function policyIdForEntry(entry: SkillRepositoryEntry, tool?: ToolCapabilityEntry): string {
  if (tool) return tool.id
  if (entry.id === 'cua') return 'desktop-cua'
  return entry.id
}

function resolveSafetyLevel(entry: SkillRepositoryEntry, input: {
  blocked: boolean
  policyConfig?: ResolvedToolPolicy['tools'][string]
}): SkillRadarSafetyLevel {
  if (input.blocked) return 'blocked'
  if (entry.category === 'browser' || entry.category === 'desktop' || entry.category === 'agent-cli') return 'restricted'
  if (input.policyConfig?.destructiveActions === 'confirm') return 'restricted'
  if (entry.trust === 'official') return 'trusted'
  return 'review-required'
}

function confidenceScore(entry: SkillRepositoryEntry, input: {
  installed: boolean
  policyEnabled: boolean
  safetyLevel: SkillRadarSafetyLevel
  domainScore: number
  projectHasPackage: boolean
  projectHasFrontendFiles: boolean
  tool?: ToolCapabilityEntry
}): number {
  if (!input.policyEnabled || input.safetyLevel === 'blocked') return 0.2
  let score = 0.28
  score += Math.min(0.22, input.domainScore * 0.025)
  if (entry.trust === 'official') score += 0.12
  if (entry.trust === 'ecosystem') score += 0.06
  if (input.installed) score += 0.22
  if (input.tool?.installed) score += 0.08
  if (input.projectHasPackage && (entry.category === 'ui' || entry.category === 'browser' || entry.category === 'testing')) score += 0.08
  if (input.projectHasFrontendFiles && entry.category === 'ui') score += 0.08
  if (input.safetyLevel === 'review-required') score -= 0.08
  if (input.safetyLevel === 'restricted') score -= 0.05
  return roundConfidence(Math.max(0.05, Math.min(0.95, score)))
}

function resolveAction(safetyLevel: SkillRadarSafetyLevel, confidence: number): SkillRadarAction {
  if (safetyLevel === 'blocked') return 'blocked'
  if (confidence < 0.4) return 'suggest-fallback'
  if (confidence <= 0.7) return 'recommend-with-evidence'
  return 'may-run-with-policy'
}

function reasonFor(entry: SkillRepositoryEntry, input: {
  domainHits: DomainSignal[]
  installed: boolean
  policyEnabled: boolean
}): string {
  const domains = input.domainHits.map(hit => hit.domain).join(', ') || entry.category
  const install = input.installed ? 'installed' : 'not installed'
  const policy = input.policyEnabled ? 'policy enabled' : 'policy disabled'
  return `${entry.name} matches ${domains}; ${install}; ${policy}.`
}

function riskFor(entry: SkillRepositoryEntry, safetyLevel: SkillRadarSafetyLevel, policyEnabled: boolean): string {
  if (!policyEnabled) return 'Disabled by tool policy; do not run until explicitly enabled.'
  if (safetyLevel === 'blocked') return 'Install or execution safety blocked this capability.'
  if (entry.category === 'desktop') return 'Desktop automation can affect local applications and must stay inside an operator boundary.'
  if (entry.category === 'browser') return 'Browser automation may touch authenticated state and must capture console/network evidence.'
  if (entry.category === 'agent-cli') return 'External agent CLI can modify files or consume credentials; use dry-run or scoped commands.'
  if (entry.category === 'memory') return 'External memory providers can retain project data; require privacy, retention, and delete-boundary review.'
  if (entry.category === 'planning') return 'External planning workflows are low execution risk, but upstream license and attribution must be preserved.'
  if (safetyLevel === 'review-required') return 'Third-party skill requires supply-chain review before installation or promotion.'
  return 'Low operational risk, but completion still requires evidence.'
}

function fallbackFor(entry: SkillRepositoryEntry, domainHits: DomainSignal[]): string {
  const domainFallback = domainHits.map(domain => DOMAIN_CONFIG[domain.domain]?.fallback).find(Boolean)
  if (domainFallback) return domainFallback
  if (entry.category === 'review') return 'Use built-in review, lint, test, and runtime evidence commands.'
  if (entry.category === 'docs') return 'Update canonical docs manually and record changed source-of-truth files.'
  return 'Use manual verification evidence and document why the skill was skipped.'
}

function capabilityFor(entry: SkillRepositoryEntry): string {
  const map: Record<SkillRepositoryEntry['category'], string> = {
    ui: 'ui-ux-design',
    browser: 'browser-automation',
    desktop: 'desktop-automation',
    testing: 'test-automation',
    review: 'quality-review',
    docs: 'documentation',
    planning: 'file-backed-planning',
    memory: 'external-memory-provider',
    'agent-cli': 'external-agent-cli',
    'role-library': 'role-orchestration',
    discovery: 'skill-discovery',
  }
  return map[entry.category]
}

function skillInstalledInProject(skillId: string, projectDir: string): boolean {
  const candidates = [
    join(projectDir, '.agents', 'skills', skillId, 'SKILL.md'),
    join(projectDir, '.codex', 'skills', skillId, 'SKILL.md'),
    join(projectDir, '.claude', 'skills', skillId, 'SKILL.md'),
  ]
  if (candidates.some(path => existsSync(path))) return true
  return localSkillIndex(projectDir).some(id => id === skillId)
}

function localSkillIndex(projectDir: string): string[] {
  const roots = [join(projectDir, '.agents', 'skills'), join(projectDir, '.codex', 'skills'), join(projectDir, '.claude', 'skills')]
  return roots.flatMap(root => {
    try {
      return readdirSync(root).filter(name => existsSync(join(root, name, 'SKILL.md')))
    } catch {
      return []
    }
  })
}

function normalizeFiles(files: string[] | undefined): string[] {
  return (files ?? [])
    .map(file => file.replace(/\\/g, '/').trim())
    .filter(Boolean)
    .filter(file => extname(file) || file.includes('/'))
}

function safetyRank(level: SkillRadarSafetyLevel): number {
  const rank: Record<SkillRadarSafetyLevel, number> = {
    trusted: 0,
    'review-required': 1,
    restricted: 2,
    blocked: 3,
  }
  return rank[level]
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function renderSkillRadarMarkdown(report: SkillRadarReport): string {
  const lines = [
    '# Skill Radar',
    '',
    `Task: ${report.task}`,
    `Level: ${report.level}`,
    `Generated: ${report.generatedAt}`,
    '',
    '## Detected Domains',
    '',
    '| Domain | Score | Reasons |',
    '| --- | ---: | --- |',
    ...report.detectedDomains.map(domain => `| ${domain.domain} | ${domain.score} | ${domain.reasons.join(', ')} |`),
    '',
    '## Recommendations',
    '',
    '| Skill | Capability | Confidence | Safety | Action | Evidence |',
    '| --- | --- | ---: | --- | --- | --- |',
    ...report.recommendations.map(item => `| ${item.id} | ${item.capability} | ${item.confidence.toFixed(2)} | ${item.safetyLevel} | ${item.action} | ${item.requiredEvidence.join(', ')} |`),
    '',
    '## Fallbacks',
    '',
    ...(report.fallbacks.length ? report.fallbacks.map(item => `- ${item}`) : ['- none']),
  ]
  return lines.join('\n')
}
