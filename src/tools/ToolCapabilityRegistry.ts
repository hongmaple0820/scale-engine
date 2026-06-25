import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { runExternalCommandSync } from '../core/ExternalCommand.js'
import { runGbrainCommandSync } from '../core/GbrainRuntime.js'
import { wrapCliCommandWithRtk } from './RtkRuntime.js'

export type ToolCapabilityCategory = 'skill' | 'cli' | 'mcp' | 'browser' | 'desktop'
export type ToolCapabilityStatus = 'installed' | 'missing'

export interface ToolCatalogEntry {
  id: string
  name: string
  category: ToolCapabilityCategory
  requiredFor: string[]
  recommendedFor?: string[]
  skillId?: string
  skillAliases?: string[]
  command?: string
  versionArgs?: string[]
  envFlag?: string
  source?: string
  installHint?: string
  extraPaths?: (context: { projectDir: string; homeDir: string }) => string[]
}

export interface ToolCapabilityEntry extends ToolCatalogEntry {
  installed: boolean
  status: ToolCapabilityStatus
  checkedPaths: string[]
  detectedPath?: string
  version?: string
  missingReason?: string
}

export interface ToolCapabilitySummary {
  total: number
  installed: number
  missing: number
}

export interface ToolCapabilityReport {
  ok: boolean
  summary: ToolCapabilitySummary
  tools: ToolCapabilityEntry[]
}

export interface ToolCapabilityRegistryOptions {
  projectDir?: string
  homeDir?: string
  toolIds?: string[]
  env?: Record<string, string | undefined>
  commandExists?: (command: string) => boolean
  runVersion?: (command: string, args: string[]) => { ok: boolean; stdout?: string; stderr?: string }
}

export const TOOL_CAPABILITY_CATALOG: ToolCatalogEntry[] = [
  {
    id: 'web-access',
    name: 'Web Access',
    category: 'skill',
    skillId: 'web-access',
    requiredFor: ['webResearch'],
    recommendedFor: ['browserAutomation'],
    source: 'https://github.com/eze-is/web-access',
    installHint: 'npx -y skills add https://github.com/eze-is/web-access --skill web-access --yes',
  },
  {
    id: 'impeccable',
    name: 'Impeccable',
    category: 'skill',
    skillId: 'impeccable',
    requiredFor: ['ui'],
    source: 'https://github.com/pbakaus/impeccable',
    installHint: 'npx -y impeccable skills install --yes',
  },
  {
    id: 'taste-skill',
    name: 'Taste Skill',
    category: 'skill',
    skillId: 'taste-skill',
    skillAliases: ['design-taste-frontend', 'design-taste-frontend-v1'],
    requiredFor: [],
    recommendedFor: ['ui'],
    source: 'https://github.com/LeonxlnX/taste-skill',
    installHint: 'npx -y skills add LeonxlnX/taste-skill --yes',
  },
  {
    id: 'awesome-design-md',
    name: 'Awesome Design.md',
    category: 'skill',
    skillId: 'awesome-design-md',
    requiredFor: [],
    recommendedFor: ['ui'],
    source: 'https://github.com/VoltAgent/awesome-design-md',
    installHint: 'scale setup --pack ui --include awesome-design-md --apply',
    extraPaths: ({ homeDir }) => [join(homeDir, '.scale', 'vendor', 'awesome-design-md', 'README.md')],
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    category: 'skill',
    skillId: 'ui-ux-pro-max',
    requiredFor: [],
    recommendedFor: ['ui'],
    source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    installHint: 'scale setup --pack ui --include ui-ux-pro-max --apply',
  },
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    category: 'skill',
    skillId: 'frontend-design',
    requiredFor: [],
    recommendedFor: ['ui'],
    source: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    installHint: 'npx -y skills add anthropics/skills --skill frontend-design --yes',
  },
  {
    id: 'rtk',
    name: 'RTK',
    category: 'cli',
    command: 'rtk',
    versionArgs: ['--version'],
    requiredFor: ['externalCli'],
    recommendedFor: ['review'],
    source: 'https://github.com/rtk-ai/rtk',
    installHint: 'cargo install --git https://github.com/rtk-ai/rtk && rtk init -g --codex',
  },
  {
    id: 'gbrain',
    name: 'GBrain',
    category: 'cli',
    command: 'gbrain',
    versionArgs: ['--version'],
    requiredFor: [],
    recommendedFor: ['review'],
    source: 'https://github.com/garrytan/gbrain',
    installHint: 'scale setup --pack memory --memory-provider gbrain --memory-mode external-first --apply --yes',
  },
  {
    id: 'codegraph',
    name: 'CodeGraph',
    category: 'cli',
    command: 'codegraph',
    versionArgs: ['--version'],
    requiredFor: [],
    recommendedFor: ['review'],
    source: 'https://github.com/colbymchenry/codegraph',
    installHint: 'scale setup --pack knowledge --apply --yes',
  },
  {
    id: 'graphify',
    name: 'Graphify',
    category: 'cli',
    command: 'graphify',
    versionArgs: ['--version'],
    requiredFor: [],
    recommendedFor: ['review'],
    source: 'https://github.com/safishamsi/graphify',
    installHint: 'scale setup --pack knowledge --apply --yes',
  },
  {
    id: 'gitnexus',
    name: 'GitNexus',
    category: 'cli',
    command: 'gitnexus',
    versionArgs: ['--version'],
    requiredFor: [],
    recommendedFor: ['review'],
    source: 'https://github.com/abhigyanpatwari/GitNexus',
    installHint: 'scale setup --pack knowledge --apply --yes',
  },
  {
    id: 'agent-browser',
    name: 'Agent Browser',
    category: 'browser',
    command: 'agent-browser',
    versionArgs: ['--version'],
    requiredFor: ['browserAutomation'],
    recommendedFor: ['ui', 'e2e'],
    source: 'https://github.com/vercel-labs/agent-browser',
    installHint: 'npm install -g agent-browser',
  },
  {
    id: 'playwright',
    name: 'Playwright',
    category: 'browser',
    command: 'npx',
    versionArgs: ['playwright', '--version'],
    requiredFor: ['e2e'],
    recommendedFor: ['browserAutomation', 'ui'],
    source: 'https://playwright.dev',
    installHint: 'npx -y playwright install',
  },
  {
    id: 'mcp-chrome-devtools',
    name: 'Chrome DevTools MCP',
    category: 'mcp',
    command: 'chrome-devtools-mcp',
    versionArgs: ['--version'],
    envFlag: 'SCALE_MCP_CHROME_DEVTOOLS',
    requiredFor: ['browserAutomation'],
    recommendedFor: ['ui', 'e2e'],
    source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    installHint: 'npm install -g chrome-devtools-mcp',
  },
  {
    id: 'desktop-cua',
    name: 'CUA',
    category: 'desktop',
    command: 'python',
    versionArgs: ['-c', 'import cua; print("cua python package available")'],
    requiredFor: ['desktopAutomation'],
    source: 'https://github.com/trycua/cua',
    installHint: 'scale setup --pack external-cli --apply --yes',
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    category: 'cli',
    command: 'codex',
    versionArgs: ['--version'],
    requiredFor: [],
    recommendedFor: ['externalCli', 'review'],
    source: 'https://github.com/openai/codex',
    installHint: 'npm install -g @openai/codex',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    category: 'cli',
    command: 'gemini',
    versionArgs: ['--version'],
    requiredFor: [],
    recommendedFor: ['externalCli', 'review'],
    source: 'https://github.com/google-gemini/gemini-cli',
    installHint: 'npm install -g @google/gemini-cli',
  },
  {
    id: 'opencode-cli',
    name: 'OpenCode CLI',
    category: 'cli',
    command: 'opencode',
    versionArgs: ['--version'],
    requiredFor: [],
    recommendedFor: ['externalCli', 'review'],
    source: 'https://github.com/sst/opencode',
    installHint: 'npm install -g opencode-ai',
  },
]

export function inspectToolCapabilities(options: ToolCapabilityRegistryOptions = {}): ToolCapabilityReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const homeDir = options.homeDir ?? homedir()
  const env = options.env ?? process.env
  const tools = resolveCatalogSelection(options.toolIds)
    .map(tool => inspectToolCapability(tool, {
      projectDir,
      homeDir,
      env,
      commandExists: options.commandExists ?? defaultCommandExists,
      runVersion: options.runVersion ?? defaultRunVersion,
    }))
  const installed = tools.filter(tool => tool.installed).length
  const missing = tools.length - installed
  return {
    ok: missing === 0,
    summary: {
      total: tools.length,
      installed,
      missing,
    },
    tools,
  }
}

function resolveCatalogSelection(toolIds: string[] | undefined): ToolCatalogEntry[] {
  if (!toolIds) return TOOL_CAPABILITY_CATALOG
  const catalogById = new Map(TOOL_CAPABILITY_CATALOG.map(tool => [tool.id, tool]))
  return [...new Set(toolIds)].map(toolId => catalogById.get(toolId) ?? fallbackSkillTool(toolId))
}

function fallbackSkillTool(toolId: string): ToolCatalogEntry {
  return {
    id: toolId,
    name: titleFromId(toolId),
    category: 'skill',
    skillId: toolId,
    requiredFor: [],
    source: 'project skill routing policy',
    installHint: `Install or configure skill ${toolId} in a supported skill directory.`,
  }
}

function titleFromId(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || value
}

interface InspectToolCapabilityDeps {
  projectDir: string
  homeDir: string
  env: Record<string, string | undefined>
  commandExists: (command: string) => boolean
  runVersion: (command: string, args: string[]) => { ok: boolean; stdout?: string; stderr?: string }
}

function inspectToolCapability(tool: ToolCatalogEntry, deps: InspectToolCapabilityDeps): ToolCapabilityEntry {
  if (tool.category === 'skill') return inspectSkillTool(tool, deps)
  if (tool.category === 'cli' || tool.category === 'browser' || tool.category === 'desktop') return inspectCliTool(tool, deps)
  return inspectMcpTool(tool, deps)
}

function inspectSkillTool(tool: ToolCatalogEntry, deps: InspectToolCapabilityDeps): ToolCapabilityEntry {
  const skillIds = [tool.skillId ?? tool.id, ...(tool.skillAliases ?? [])]
  const checkedPaths = [
    ...skillIds.flatMap(skillId => skillCandidatePaths(skillId, deps.projectDir, deps.homeDir)),
    ...(tool.extraPaths?.({ projectDir: deps.projectDir, homeDir: deps.homeDir }) ?? []),
  ]
  const detectedPath = checkedPaths.find(path => existsSync(path))
  return {
    ...tool,
    checkedPaths,
    detectedPath,
    installed: Boolean(detectedPath),
    status: detectedPath ? 'installed' : 'missing',
    missingReason: detectedPath ? undefined : 'SKILL.md was not found in project or user skill directories',
  }
}

function inspectCliTool(tool: ToolCatalogEntry, deps: InspectToolCapabilityDeps): ToolCapabilityEntry {
  const command = tool.command ?? tool.id
  const checkedPaths = [`PATH:${command}`]
  if (!deps.commandExists(command)) {
    return {
      ...tool,
      checkedPaths,
      installed: false,
      status: 'missing',
      missingReason: `Command not found: ${command}`,
    }
  }
  const version = deps.runVersion(command, tool.versionArgs ?? ['--version'])
  return {
    ...tool,
    checkedPaths,
    installed: version.ok,
    status: version.ok ? 'installed' : 'missing',
    version: version.ok ? (version.stdout ?? '').trim() : undefined,
    missingReason: version.ok ? undefined : version.stderr ?? 'Version command failed',
  }
}

function inspectMcpTool(tool: ToolCatalogEntry, deps: InspectToolCapabilityDeps): ToolCapabilityEntry {
  const envFlag = tool.envFlag ?? `SCALE_MCP_${tool.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  const command = tool.command
  const envInstalled = truthy(deps.env[envFlag])
  const commandInstalled = command ? deps.commandExists(command) : false
  const version = command && commandInstalled ? deps.runVersion(command, tool.versionArgs ?? ['--version']) : undefined
  const installed = envInstalled || Boolean(version?.ok)
  return {
    ...tool,
    checkedPaths: [`env:${envFlag}`, ...(command ? [`PATH:${command}`] : [])],
    installed,
    status: installed ? 'installed' : 'missing',
    version: version?.ok ? (version.stdout ?? '').trim() : undefined,
    missingReason: installed ? undefined : command
      ? `MCP availability flag is not set: ${envFlag}; command not found or version probe failed: ${command}`
      : `MCP availability flag is not set: ${envFlag}`,
  }
}

function skillCandidatePaths(skillId: string, projectDir: string, homeDir: string): string[] {
  return [
    join(projectDir, '.agents', 'skills', skillId, 'SKILL.md'),
    join(projectDir, '.codex', 'skills', skillId, 'SKILL.md'),
    join(projectDir, '.claude', 'skills', skillId, 'SKILL.md'),
    join(homeDir, '.agents', 'skills', skillId, 'SKILL.md'),
    join(homeDir, '.codex', 'skills', skillId, 'SKILL.md'),
    join(homeDir, '.claude', 'skills', skillId, 'SKILL.md'),
  ]
}

function defaultCommandExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function defaultRunVersion(command: string, args: string[]): { ok: boolean; stdout?: string; stderr?: string } {
  if (command === 'gbrain') {
    const result = runGbrainCommandSync(args, {
      timeout: 5000,
      env: process.env,
    })
    return result.exitCode === 0
      ? { ok: true, stdout: result.stdout || result.stderr }
      : { ok: false, stdout: result.stdout, stderr: result.stderr || `gbrain command failed with exit code ${result.exitCode}` }
  }
  try {
    const invocation = wrapCliCommandWithRtk(command, args, defaultCommandExists)
    const stdout = runExternalCommandSync(invocation.command, invocation.args, { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, stdout: String(stdout) }
  } catch (error) {
    return {
      ok: false,
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

function truthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.toLowerCase())
}
