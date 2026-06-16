import type { AgentPlatform } from '../artifact/types.js'

export type ExternalAgentImportMode = 'reference-only' | 'convert-to-yaml' | 'install-to-adapter'

export type ExternalAgentToolStatus = 'mapped' | 'external-only'

export interface ExternalAgentToolSupport {
  toolId: string
  localAdapter?: AgentPlatform
  status: ExternalAgentToolStatus
  notes: string
}

export interface ExternalAgentCatalog {
  id: string
  name: string
  description: string
  sourceUrl: string
  upstreamUrl: string
  license: 'MIT'
  claimedAgentCount: number
  claimedDepartmentCount: number
  claimedToolCount: number
  departments: string[]
  toolSupport: ExternalAgentToolSupport[]
  importModes: ExternalAgentImportMode[]
  recommendedMode: ExternalAgentImportMode
  defaultTargetDir: string
  adoptionRules: string[]
}

export interface ExternalAgentCatalogPlan {
  version: 'external-agent-catalog-plan-v1'
  catalog: ExternalAgentCatalog
  mode: ExternalAgentImportMode
  targetDir: string
  mappedTools: ExternalAgentToolSupport[]
  externalOnlyTools: ExternalAgentToolSupport[]
  steps: string[]
  gates: string[]
  warnings: string[]
}

const AGENCY_AGENTS_ZH_DEPARTMENTS = [
  'academic',
  'design',
  'engineering',
  'finance',
  'game-development',
  'hr',
  'legal',
  'marketing',
  'paid-media',
  'product',
  'project-management',
  'sales',
  'spatial-computing',
  'specialized',
  'strategy',
  'supply-chain',
  'support',
  'testing',
] as const

const toolAdapterAliases: Record<string, AgentPlatform> = {
  'claude-code': 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  kiro: 'kiro',
  trae: 'trae',
  opencode: 'opencode',
  aider: 'aider',
  windsurf: 'windsurf',
  antigravity: 'antigravity',
  'gemini-cli': 'gemini',
  openclaw: 'openclaw',
  workbuddy: 'workbuddy',
  hermes: 'hermes',
  qoder: 'qoder',
}

function createToolSupport(toolId: string): ExternalAgentToolSupport {
  const localAdapter = toolAdapterAliases[toolId]
  if (localAdapter) {
    return {
      toolId,
      localAdapter,
      status: 'mapped',
      notes: `Can be routed through the local ${localAdapter} adapter surface.`,
    }
  }
  return {
    toolId,
    status: 'external-only',
    notes: 'No local SCALE adapter is declared yet; keep this as a reference or custom bridge.',
  }
}

export const AGENCY_AGENTS_ZH_CATALOG: ExternalAgentCatalog = {
  id: 'agency-agents-zh',
  name: 'Agency Agents Chinese Expert Team',
  description: 'External catalog for 215 specialist agents across 18 departments, adapted from agency-agents.',
  sourceUrl: 'https://github.com/jnMetaCode/agency-agents-zh',
  upstreamUrl: 'https://github.com/msitarzewski/agency-agents',
  license: 'MIT',
  claimedAgentCount: 215,
  claimedDepartmentCount: 18,
  claimedToolCount: 17,
  departments: [...AGENCY_AGENTS_ZH_DEPARTMENTS],
  toolSupport: [
    'openclaw',
    'claude-code',
    'copilot',
    'cursor',
    'kiro',
    'trae',
    'opencode',
    'aider',
    'windsurf',
    'antigravity',
    'gemini-cli',
    'qwen',
    'codex',
    'deerflow',
    'workbuddy',
    'hermes',
    'qoder',
  ].map(createToolSupport),
  importModes: ['reference-only', 'convert-to-yaml', 'install-to-adapter'],
  recommendedMode: 'convert-to-yaml',
  defaultTargetDir: '.scale/agents/external/agency-agents-zh',
  adoptionRules: [
    'Pin the external repository revision before converting role definitions.',
    'Preserve MIT attribution when generated roles or prompts are copied into a project.',
    'Do not add all external agents to PROFESSIONAL_AGENTS; keep them in an external catalog to avoid changing default runtime behavior.',
    'Convert selected agents to SCALE YAML definitions before registering them with AgentSourceLoader.',
    'Route execution through an explicit adapter or ACP bridge plan; never assume every upstream tool is installed locally.',
  ],
}

const EXTERNAL_AGENT_CATALOGS = [AGENCY_AGENTS_ZH_CATALOG] as const

export function listExternalAgentCatalogs(): ExternalAgentCatalog[] {
  return EXTERNAL_AGENT_CATALOGS.map(catalog => ({ ...catalog, departments: [...catalog.departments], toolSupport: [...catalog.toolSupport], importModes: [...catalog.importModes], adoptionRules: [...catalog.adoptionRules] }))
}

export function getExternalAgentCatalog(id: string): ExternalAgentCatalog | undefined {
  return listExternalAgentCatalogs().find(catalog => catalog.id === id)
}

export function createExternalAgentCatalogPlan(options: {
  catalogId?: string
  mode?: ExternalAgentImportMode
  targetDir?: string
  tools?: string[]
} = {}): ExternalAgentCatalogPlan {
  const catalog = getExternalAgentCatalog(options.catalogId ?? AGENCY_AGENTS_ZH_CATALOG.id)
  if (!catalog) {
    throw new Error(`Unknown external agent catalog "${options.catalogId}".`)
  }
  const mode = options.mode ?? catalog.recommendedMode
  if (!catalog.importModes.includes(mode)) {
    throw new Error(`Unsupported import mode "${mode}" for catalog "${catalog.id}".`)
  }
  const selectedTools = new Set((options.tools ?? []).map(tool => tool.trim()).filter(Boolean))
  const toolSupport = selectedTools.size > 0
    ? catalog.toolSupport.filter(tool => selectedTools.has(tool.toolId) || (tool.localAdapter && selectedTools.has(tool.localAdapter)))
    : catalog.toolSupport

  const mappedTools = toolSupport.filter(tool => tool.status === 'mapped')
  const externalOnlyTools = toolSupport.filter(tool => tool.status === 'external-only')
  return {
    version: 'external-agent-catalog-plan-v1',
    catalog,
    mode,
    targetDir: options.targetDir ?? catalog.defaultTargetDir,
    mappedTools,
    externalOnlyTools,
    steps: [
      'Record source URL, upstream URL, license, counts, and pinned revision in the workspace catalog.',
      'Select departments and agent files needed for the current workflow instead of importing all roles blindly.',
      'Convert selected role files into SCALE YAML agent definitions and validate them with AgentSourceLoader.',
      'Register converted agents under the external target directory and keep built-in PROFESSIONAL_AGENTS unchanged.',
      'Create an ACP or adapter execution plan for every selected platform before invoking the agent.',
    ],
    gates: [
      'license-attribution-present',
      'source-revision-pinned',
      'selected-agents-validated',
      'adapter-or-acp-bridge-declared',
      'no-default-profile-count-change',
    ],
    warnings: externalOnlyTools.length > 0
      ? [`External-only tools need custom bridge work: ${externalOnlyTools.map(tool => tool.toolId).join(', ')}`]
      : [],
  }
}

export function renderExternalAgentCatalogMarkdown(catalog: ExternalAgentCatalog = AGENCY_AGENTS_ZH_CATALOG): string {
  const mapped = catalog.toolSupport.filter(tool => tool.status === 'mapped')
  const externalOnly = catalog.toolSupport.filter(tool => tool.status === 'external-only')
  return [
    `# ${catalog.name}`,
    '',
    catalog.description,
    '',
    `- Source: ${catalog.sourceUrl}`,
    `- Upstream: ${catalog.upstreamUrl}`,
    `- License: ${catalog.license}`,
    `- Claimed scale: ${catalog.claimedAgentCount} agents, ${catalog.claimedDepartmentCount} departments, ${catalog.claimedToolCount} tools`,
    `- Recommended import mode: ${catalog.recommendedMode}`,
    `- Default target: ${catalog.defaultTargetDir}`,
    '',
    '## Departments',
    '',
    catalog.departments.map(department => `- ${department}`).join('\n'),
    '',
    '## Tool Mapping',
    '',
    mapped.map(tool => `- ${tool.toolId} -> ${tool.localAdapter}`).join('\n'),
    externalOnly.length > 0 ? '' : undefined,
    externalOnly.length > 0 ? '## External-only Tools' : undefined,
    externalOnly.length > 0 ? '' : undefined,
    externalOnly.length > 0 ? externalOnly.map(tool => `- ${tool.toolId}`).join('\n') : undefined,
    '',
    '## Adoption Rules',
    '',
    catalog.adoptionRules.map(rule => `- ${rule}`).join('\n'),
    '',
  ].filter((line): line is string => line !== undefined).join('\n')
}
