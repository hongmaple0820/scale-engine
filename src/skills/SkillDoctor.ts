import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { externalCommandExists, resolveExternalCommandPath } from '../core/ExternalCommand.js'
import { WORKFLOW_AGENT_SKILL_CATALOG } from './SkillCatalog.js'
import type { WorkflowSkillCatalogEntry, WorkflowSkillReadinessTier } from './SkillCatalog.js'
import { loadSkillRoutingPolicy } from './routing/SkillPolicy.js'
import type { SkillSourcePolicy } from './routing/SkillRoutingTypes.js'

const TOOL_ORCHESTRATION_SKILL_CATALOG: WorkflowSkillCatalogEntry[] = [
  {
    id: 'web-access',
    name: 'Web Access',
    description: 'CDP browser automation for web research, logged-in pages, and dynamic browser tasks',
    source: 'https://github.com/eze-is/web-access',
    installCommand: 'npx skills add https://github.com/eze-is/web-access --skill web-access',
    trust: 'ecosystem',
    readiness: 'required',
    definition: {
      id: 'web-access',
      name: 'Web Access',
      description: 'CDP browser automation for web research, logged-in pages, and dynamic browser tasks',
      domain: 'execution',
      triggers: [],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/web-access/SKILL.md' } },
      priority: 90,
      installed: true,
      source: 'https://github.com/eze-is/web-access',
    },
  },
  {
    id: 'awesome-design-md',
    name: 'Awesome Design.md',
    description: 'DESIGN.md brand and product design system references',
    source: 'https://github.com/VoltAgent/awesome-design-md',
    installCommand: 'scale setup --pack ui --include awesome-design-md --apply',
    trust: 'ecosystem',
    readiness: 'required',
    definition: {
      id: 'awesome-design-md',
      name: 'Awesome Design.md',
      description: 'DESIGN.md brand and product design system references',
      domain: 'planning',
      triggers: [],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/awesome-design-md/SKILL.md' } },
      priority: 88,
      installed: true,
      source: 'https://github.com/VoltAgent/awesome-design-md',
    },
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    description: 'UX guidelines and design intelligence database',
    source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    installCommand: 'scale setup --pack ui --include ui-ux-pro-max --apply',
    trust: 'ecosystem',
    readiness: 'required',
    definition: {
      id: 'ui-ux-pro-max',
      name: 'UI/UX Pro Max',
      description: 'UX guidelines and design intelligence database',
      domain: 'planning',
      triggers: [],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/ui-ux-pro-max/SKILL.md' } },
      priority: 89,
      installed: true,
      source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    },
  },
  {
    id: 'agent-browser',
    name: 'Agent Browser',
    description: 'Browser automation CLI for AI agents',
    source: 'https://github.com/vercel-labs/agent-browser',
    installCommand: 'Install or configure Agent Browser from https://github.com/vercel-labs/agent-browser',
    trust: 'ecosystem',
    readiness: 'recommended',
    definition: {
      id: 'agent-browser',
      name: 'Agent Browser',
      description: 'Browser automation CLI for AI agents',
      domain: 'execution',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'agent-browser --version' } },
      priority: 86,
      installed: false,
      source: 'https://github.com/vercel-labs/agent-browser',
    },
  },
  {
    id: 'mcp-chrome-devtools',
    name: 'Chrome DevTools MCP',
    description: 'Chrome DevTools MCP for browser inspection, console, and network evidence',
    source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    installCommand: 'Configure Chrome DevTools MCP for the active agent platform',
    trust: 'ecosystem',
    readiness: 'recommended',
    definition: {
      id: 'mcp-chrome-devtools',
      name: 'Chrome DevTools MCP',
      description: 'Chrome DevTools MCP for browser inspection, console, and network evidence',
      domain: 'verification',
      triggers: [],
      execution: { type: 'mcp-tool', config: { toolName: 'chrome-devtools' } },
      priority: 88,
      installed: false,
      source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    },
  },
  {
    id: 'cua',
    name: 'CUA',
    description: 'Computer use agent for desktop automation and GUI testing',
    source: 'https://github.com/trycua/cua',
    installCommand: 'Install or configure CUA from https://github.com/trycua/cua',
    trust: 'ecosystem',
    readiness: 'optional',
    definition: {
      id: 'cua',
      name: 'CUA',
      description: 'Computer use agent for desktop automation and GUI testing',
      domain: 'execution',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'cua --version' } },
      priority: 90,
      installed: false,
      source: 'https://github.com/trycua/cua',
    },
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    description: 'External Codex CLI reviewer or worker',
    source: 'https://github.com/openai/codex',
    installCommand: 'Install Codex CLI and verify with: codex --version',
    trust: 'ecosystem',
    readiness: 'recommended',
    definition: {
      id: 'codex-cli',
      name: 'Codex CLI',
      description: 'External Codex CLI reviewer or worker',
      domain: 'verification',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'codex --version' } },
      priority: 76,
      installed: false,
    },
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'External Gemini CLI reviewer or worker',
    source: 'https://github.com/google-gemini/gemini-cli',
    installCommand: 'Install Gemini CLI and verify with: gemini --version',
    trust: 'ecosystem',
    readiness: 'recommended',
    definition: {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      description: 'External Gemini CLI reviewer or worker',
      domain: 'verification',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'gemini --version' } },
      priority: 74,
      installed: false,
    },
  },
  {
    id: 'opencode-cli',
    name: 'OpenCode CLI',
    description: 'External OpenCode CLI reviewer or worker',
    source: 'https://github.com/sst/opencode',
    installCommand: 'Install OpenCode CLI and verify with: opencode --version',
    trust: 'ecosystem',
    readiness: 'recommended',
    definition: {
      id: 'opencode-cli',
      name: 'OpenCode CLI',
      description: 'External OpenCode CLI reviewer or worker',
      domain: 'verification',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'opencode --version' } },
      priority: 74,
      installed: false,
    },
  },
]

export interface SkillDoctorOptions {
  projectDir?: string
  scaleDir?: string
  homeDir?: string
  env?: Record<string, string | undefined>
  commandExists?: (command: string) => boolean
  resolveCommandPath?: (command: string) => string | null
  waivers?: WorkflowSkillWaiver[]
}

export interface WorkflowSkillWaiver {
  id: string
  reason: string
  expiresAt?: string
}

export interface SkillDoctorEntry {
  id: string
  name: string
  description: string
  source: string
  installCommand: string
  trust: WorkflowSkillCatalogEntry['trust']
  readiness: WorkflowSkillReadinessTier
  executionType: string
  declaredPath?: string
  checkedPaths: string[]
  installed: boolean
  detectedPath?: string
  status: 'installed' | 'missing' | 'waived'
  missingReason?: string
  waiverReason?: string
  waiverExpiresAt?: string
}

export interface SkillDoctorReport {
  ok: boolean
  total: number
  installed: number
  missing: number
  waived: number
  sourceRoots: Required<SkillSourcePolicy>
  missingByReadiness: Record<WorkflowSkillReadinessTier, string[]>
  installedByReadiness: Record<WorkflowSkillReadinessTier, string[]>
  waivedByReadiness: Record<WorkflowSkillReadinessTier, string[]>
  skills: SkillDoctorEntry[]
}

export interface RequiredSkillInstallationReport {
  ok: boolean
  required: string[]
  installed: string[]
  missing: string[]
  unknown: string[]
  skills: SkillDoctorEntry[]
}

export function inspectWorkflowSkills(options: SkillDoctorOptions = {}): SkillDoctorReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = resolveScaleDir(projectDir, options.scaleDir)
  const homeDir = options.homeDir ?? homedir()
  const waivers = loadWorkflowSkillWaivers({ projectDir, scaleDir, waivers: options.waivers })
  const sourceRoots = loadWorkflowSkillSourceRoots({ projectDir, scaleDir })
  const skills = workflowSkillCatalog().map(entry => inspectWorkflowSkill(entry, {
    projectDir,
    homeDir,
    sourceRoots,
    env: options.env ?? process.env,
    commandExists: options.commandExists ?? externalCommandExists,
    resolveCommandPath: options.resolveCommandPath ?? resolveExternalCommandPath,
  }, waivers.get(entry.id)))
  const installed = skills.filter(skill => skill.installed).length
  const missing = skills.filter(skill => skill.status === 'missing').length
  const waived = skills.filter(skill => skill.status === 'waived').length
  const missingByReadiness = readinessBuckets(skills.filter(skill => skill.status === 'missing'))
  const installedByReadiness = readinessBuckets(skills.filter(skill => skill.installed))
  const waivedByReadiness = readinessBuckets(skills.filter(skill => skill.status === 'waived'))
  return {
    ok: missingByReadiness.required.length === 0 && missingByReadiness.recommended.length === 0,
    total: skills.length,
    installed,
    missing,
    waived,
    sourceRoots,
    missingByReadiness,
    installedByReadiness,
    waivedByReadiness,
    skills,
  }
}

export function inspectRequiredWorkflowSkills(requiredSkills: string[], options: SkillDoctorOptions = {}): RequiredSkillInstallationReport {
  const required = unique(requiredSkills.map(skill => skill.trim()).filter(Boolean))
  const report = inspectWorkflowSkills(options)
  const byId = new Map(report.skills.map(skill => [skill.id, skill]))
  const installed: string[] = []
  const missing: string[] = []
  const unknown: string[] = []
  const skills: SkillDoctorEntry[] = []

  for (const id of required) {
    const skill = byId.get(id)
    if (!skill) {
      unknown.push(id)
      missing.push(id)
      continue
    }
    skills.push(skill)
    if (skill.installed) installed.push(id)
    else missing.push(id)
  }

  return {
    ok: missing.length === 0,
    required,
    installed,
    missing,
    unknown,
    skills,
  }
}

interface InspectWorkflowSkillContext {
  projectDir: string
  homeDir: string
  sourceRoots: Required<SkillSourcePolicy>
  env: Record<string, string | undefined>
  commandExists: (command: string) => boolean
  resolveCommandPath: (command: string) => string | null
}

function inspectWorkflowSkill(
  entry: WorkflowSkillCatalogEntry,
  context: InspectWorkflowSkillContext,
  waiver?: WorkflowSkillWaiver,
): SkillDoctorEntry {
  const inspected = entry.definition.execution.type === 'cli-command'
    ? inspectCliWorkflowSkill(entry, context)
    : entry.definition.execution.type === 'mcp-tool'
      ? inspectMcpWorkflowSkill(entry, context)
      : inspectSkillFileWorkflowSkill(entry, context)
  return applyRecommendedWaiver(inspected, waiver)
}

function inspectSkillFileWorkflowSkill(entry: WorkflowSkillCatalogEntry, context: InspectWorkflowSkillContext): SkillDoctorEntry {
  const declaredPath = entry.definition.execution.config.skillPath
  const projectRoots = [context.sourceRoots.primaryRoot, ...context.sourceRoots.fallbackRoots]
    .map(root => resolveSkillRoot(root, context.projectDir, context.homeDir))
  const globalRoots = context.sourceRoots.globalRoots
    .map(root => resolveSkillRoot(root, context.projectDir, context.homeDir))
  const checkedPaths = unique([
    ...projectRoots.map(root => join(root, entry.id, 'SKILL.md')),
    declaredPath ? resolveSkillPath(declaredPath, context.projectDir, context.homeDir) : undefined,
    ...globalRoots.map(root => join(root, entry.id, 'SKILL.md')),
  ].filter((path): path is string => Boolean(path)))

  const detectedPath = checkedPaths.find(path => existsSync(path))
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: entry.source,
    installCommand: entry.installCommand,
    trust: entry.trust,
    readiness: entry.readiness ?? 'recommended',
    executionType: entry.definition.execution.type,
    declaredPath,
    checkedPaths,
    installed: Boolean(detectedPath),
    detectedPath,
    status: detectedPath ? 'installed' : 'missing',
    missingReason: detectedPath ? undefined : 'Skill file not found in declared or fallback paths.',
  }
}

function inspectCliWorkflowSkill(entry: WorkflowSkillCatalogEntry, context: InspectWorkflowSkillContext): SkillDoctorEntry {
  const command = firstCommandToken(entry.definition.execution.config.command ?? entry.id)
  const checkedPaths = [`PATH:${command}`]
  const detectedPath = context.resolveCommandPath(command) ?? undefined
  const installed = Boolean(detectedPath) || context.commandExists(command)
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: entry.source,
    installCommand: entry.installCommand,
    trust: entry.trust,
    readiness: entry.readiness ?? 'recommended',
    executionType: entry.definition.execution.type,
    checkedPaths,
    installed,
    detectedPath,
    status: installed ? 'installed' : 'missing',
    missingReason: installed ? undefined : `Command not found on PATH: ${command}`,
  }
}

function inspectMcpWorkflowSkill(entry: WorkflowSkillCatalogEntry, context: InspectWorkflowSkillContext): SkillDoctorEntry {
  const toolName = entry.definition.execution.config.toolName ?? entry.id
  const envFlag = `SCALE_MCP_${toolName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  const checkedPaths = [`env:${envFlag}`]
  const installed = truthy(context.env[envFlag])
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: entry.source,
    installCommand: entry.installCommand,
    trust: entry.trust,
    readiness: entry.readiness ?? 'recommended',
    executionType: entry.definition.execution.type,
    checkedPaths,
    detectedPath: installed ? checkedPaths[0] : undefined,
    installed,
    status: installed ? 'installed' : 'missing',
    missingReason: installed ? undefined : `MCP availability flag is not set: ${envFlag}`,
  }
}

function firstCommandToken(command: string): string {
  const trimmed = command.trim()
  const quoted = /^"([^"]+)"/.exec(trimmed) ?? /^'([^']+)'/.exec(trimmed)
  if (quoted) return quoted[1]
  return trimmed.split(/\s+/)[0] || command
}

function truthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.toLowerCase())
}

function applyRecommendedWaiver(entry: SkillDoctorEntry, waiver: WorkflowSkillWaiver | undefined): SkillDoctorEntry {
  if (!waiver || entry.installed || entry.readiness !== 'recommended') return entry
  return {
    ...entry,
    status: 'waived',
    missingReason: undefined,
    waiverReason: waiver.reason,
    waiverExpiresAt: waiver.expiresAt,
  }
}

function workflowSkillCatalog(): WorkflowSkillCatalogEntry[] {
  const entries = [...WORKFLOW_AGENT_SKILL_CATALOG, ...TOOL_ORCHESTRATION_SKILL_CATALOG]
  const byId = new Map<string, WorkflowSkillCatalogEntry>()
  for (const entry of entries) byId.set(entry.id, entry)
  return [...byId.values()]
}

function readinessBuckets(skills: SkillDoctorEntry[]): Record<WorkflowSkillReadinessTier, string[]> {
  return {
    required: skills.filter(skill => skill.readiness === 'required').map(skill => skill.id),
    recommended: skills.filter(skill => skill.readiness === 'recommended').map(skill => skill.id),
    optional: skills.filter(skill => skill.readiness === 'optional').map(skill => skill.id),
  }
}

function resolveSkillPath(path: string, projectDir: string, homeDir: string): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homeDir, path.slice(2))
  if (isAbsolute(path)) return path
  return resolve(projectDir, path)
}

function resolveSkillRoot(root: string, projectDir: string, homeDir: string): string {
  return resolveSkillPath(root, projectDir, homeDir)
}

function resolveScaleDir(projectDir: string, scaleDir = '.scale'): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}

function loadWorkflowSkillWaivers(options: {
  projectDir: string
  scaleDir: string
  waivers?: WorkflowSkillWaiver[]
}): Map<string, WorkflowSkillWaiver> {
  const waiverMap = new Map<string, WorkflowSkillWaiver>()
  for (const waiver of options.waivers ?? []) {
    if (waiver.id && waiver.reason) waiverMap.set(waiver.id, waiver)
  }

  const policyPath = join(options.scaleDir, 'skills.json')
  if (!existsSync(policyPath)) return waiverMap
  try {
    const parsed = JSON.parse(readFileSync(policyPath, 'utf-8')) as {
      policy?: {
        waivedRecommendedSkills?: unknown
      }
    }
    for (const waiver of normalizeWorkflowSkillWaivers(parsed.policy?.waivedRecommendedSkills)) {
      if (!waiverMap.has(waiver.id)) waiverMap.set(waiver.id, waiver)
    }
  } catch {
    return waiverMap
  }
  return waiverMap
}

function loadWorkflowSkillSourceRoots(options: {
  projectDir: string
  scaleDir: string
}): Required<SkillSourcePolicy> {
  return loadSkillRoutingPolicy(options.projectDir, options.scaleDir).skillSources
}

function normalizeWorkflowSkillWaivers(value: unknown): WorkflowSkillWaiver[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item === 'string') {
        const id = item.trim()
        return id ? { id, reason: 'Waived by repo skill policy.' } : null
      }
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
      const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt.trim() : undefined
      return id && reason ? { id, reason, expiresAt } : null
    })
    .filter((item): item is WorkflowSkillWaiver => Boolean(item))
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
