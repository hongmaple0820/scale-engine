export type SkillRepositoryCategory =
  | 'planning'
  | 'memory'
  | 'ui'
  | 'browser'
  | 'desktop'
  | 'testing'
  | 'review'
  | 'docs'
  | 'document-parsing'
  | 'diagramming'
  | 'orchestration'
  | 'agent-cli'
  | 'role-library'
  | 'discovery'

export type SkillRepositoryTrust = 'official' | 'ecosystem' | 'community'
export type SkillSafetyRisk = 'low' | 'medium' | 'high' | 'blocked'

export interface SkillRepositoryEntry {
  id: string
  name: string
  category: SkillRepositoryCategory
  description: string
  sourceUrl: string
  installCommand: string
  trust: SkillRepositoryTrust
  progressiveDisclosure: {
    startup: string
    activation: string
    lazyResources: string[]
  }
  orchestration: {
    primaryUse: string
    combineWith: string[]
    requiredEvidence: string[]
  }
  safety: {
    requiresReview: boolean
    requiredChecks: string[]
  }
  attribution: {
    license: string
    copyright: string
    notice: string
    usage: 'external-reference' | 'optional-install' | 'adapted-concept' | 'vendored'
    sourceRevision?: string
    modifiedFromUpstream: boolean
  }
}

export interface SkillWorkflowRecommendationInput {
  description: string
  phase?: string
}

export interface SkillWorkflowRecommendation {
  primarySkills: string[]
  supportingSkills: string[]
  safetyRequired: boolean
  requiredEvidence: string[]
  rationale: string[]
}

export interface SkillInstallSafetyInput {
  sourceUrl?: string
  installCommand?: string
  files?: Array<{ path: string; content: string }>
}

export interface SkillSafetyFinding {
  rule: string
  severity: 'warn' | 'block'
  message: string
}

export interface SkillInstallSafetyReport {
  blocked: boolean
  risk: SkillSafetyRisk
  findings: SkillSafetyFinding[]
  requiredChecks: string[]
}

const DEFAULT_REQUIRED_CHECKS = [
  'review-skill-frontmatter',
  'inspect-scripts-directory',
  'verify-license-and-source',
  'verify-attribution-and-notice',
  'pin-source-revision',
]

export const SKILL_REPOSITORY: SkillRepositoryEntry[] = [
  skill({
    id: 'planning-with-files',
    name: 'Planning with Files',
    category: 'planning',
    description: 'File-backed planning workflow for complex multi-step tasks with task_plan, findings, progress, and plan attestation patterns.',
    sourceUrl: 'https://github.com/OthmanAdi/planning-with-files',
    installCommand: 'Review and install from https://github.com/OthmanAdi/planning-with-files; do not vendor without preserving MIT license and attribution.',
    trust: 'community',
    primaryUse: 'Use persistent planning files, progress logs, findings, active-plan selection, and plan attestation for long-running agent work.',
    combineWith: ['memory-brain', 'web-access', 'code-reviewer'],
    evidence: ['task-plan', 'findings-log', 'progress-log', 'plan-attestation'],
    attribution: {
      license: 'MIT',
      copyright: 'Copyright (c) 2026 Ahmad Adi',
      notice: 'Inspired by and compatible with OthmanAdi/planning-with-files. SCALE should not copy upstream files unless the MIT license text and attribution are included.',
      usage: 'adapted-concept',
      modifiedFromUpstream: false,
    },
  }),
  skill({
    id: 'gbrain',
    name: 'GBrain',
    category: 'memory',
    description: 'Graph-backed memory provider for AI agents with brain repos, hybrid search, entity links, MCP, and background maintenance.',
    sourceUrl: 'https://github.com/garrytan/gbrain',
    installCommand: 'Install and configure GBrain from https://github.com/garrytan/gbrain, then let SCALE route memory recall through the provider contract; do not vendor upstream source.',
    trust: 'community',
    primaryUse: 'Use as the default graph-backed memory provider for long-running project knowledge, entity relationships, and background memory maintenance.',
    combineWith: ['memory-brain', 'codegraph'],
    evidence: ['memory-provider-health', 'graph-recall-result', 'privacy-boundary', 'data-retention-policy'],
    attribution: {
      license: 'MIT',
      copyright: 'Copyright per upstream garrytan/gbrain project contributors',
      notice: 'Optional external provider only. Do not vendor GBrain code into SCALE without preserving MIT license text, source revision, and modification notices.',
      usage: 'external-reference',
      modifiedFromUpstream: false,
    },
  }),
  skill({
    id: 'impeccable',
    name: 'Impeccable',
    category: 'ui',
    description: 'Deterministic UI anti-pattern detection and design refinement workflow for AI-generated interfaces.',
    sourceUrl: 'https://github.com/pbakaus/impeccable',
    installCommand: 'npx impeccable skills install',
    trust: 'ecosystem',
    primaryUse: 'Run as the required UI quality gate for deterministic anti-pattern detection before visual acceptance.',
    combineWith: ['taste-skill', 'awesome-design-md', 'ui-ux-pro-max', 'webapp-testing'],
    evidence: ['impeccable-report', 'visual-review', 'screenshot'],
  }),
  skill({
    id: 'taste-skill',
    name: 'Taste Skill',
    category: 'ui',
    description: 'Design-language generation workflow for selecting aesthetic direction before UI implementation.',
    sourceUrl: 'https://github.com/LeonxlnX/taste-skill',
    installCommand: 'npx skills add LeonxlnX/taste-skill',
    trust: 'ecosystem',
    primaryUse: 'Choose the product visual direction and taste parameters before UI implementation starts.',
    combineWith: ['impeccable', 'frontend-design', 'awesome-design-md'],
    evidence: ['design-direction', 'taste-parameters', 'ui-spec'],
  }),
  skill({
    id: 'frontend-design',
    name: 'Frontend Design',
    category: 'ui',
    description: '用于生成有审美约束的生产级前端界面方案。',
    sourceUrl: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    installCommand: 'npx skills add anthropics/skills --skill frontend-design',
    trust: 'official',
    primaryUse: 'UI 视觉方向、布局、组件状态和前端实现约束。',
    combineWith: ['awesome-design-md', 'ui-ux-pro-max', 'webapp-testing'],
    evidence: ['ui-spec', 'visual-review'],
  }),
  skill({
    id: 'awesome-design-md',
    name: 'Awesome Design.md',
    category: 'ui',
    description: '用于沉淀 DESIGN.md、品牌、设计系统和产品体验参考。',
    sourceUrl: 'https://github.com/VoltAgent/awesome-design-md',
    installCommand: 'scale setup --pack ui --include awesome-design-md --apply',
    trust: 'ecosystem',
    primaryUse: '建立产品级设计规范和视觉语言。',
    combineWith: ['ui-ux-pro-max', 'frontend-design'],
    evidence: ['design-spec', 'design-system'],
  }),
  skill({
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    category: 'ui',
    description: '用于用户路径、交互、可访问性、响应式和审美质量检查。',
    sourceUrl: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    installCommand: 'scale setup --pack ui --include ui-ux-pro-max --apply',
    trust: 'ecosystem',
    primaryUse: '补齐体验策略、交互状态和 UI 验收维度。',
    combineWith: ['awesome-design-md', 'webapp-testing'],
    evidence: ['ui-spec', 'accessibility-review'],
  }),
  skill({
    id: 'webapp-testing',
    name: 'Webapp Testing',
    category: 'testing',
    description: '基于 Playwright 的 Web 应用交互测试和截图证据。',
    sourceUrl: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing',
    installCommand: 'npx skills add anthropics/skills --skill webapp-testing',
    trust: 'official',
    primaryUse: '验证页面点击、表单、控制台、截图和端到端行为。',
    combineWith: ['agent-browser', 'mcp-chrome-devtools'],
    evidence: ['browser-evidence', 'screenshot', 'console-log'],
  }),
  skill({
    id: 'web-access',
    name: 'Web Access',
    category: 'browser',
    description: '用于联网搜索、动态页面、登录态页面和真实浏览器取证。',
    sourceUrl: 'https://github.com/eze-is/web-access',
    installCommand: 'npx skills add https://github.com/eze-is/web-access --skill web-access',
    trust: 'ecosystem',
    primaryUse: '获取一手资料、动态页面内容、网页证据和来源引用。',
    combineWith: ['agent-browser', 'mcp-chrome-devtools'],
    evidence: ['source-citation', 'browser-evidence'],
  }),
  skill({
    id: 'agent-browser',
    name: 'Agent Browser',
    category: 'browser',
    description: '用于浏览器自动化、页面操作、截图和交互验证。',
    sourceUrl: 'https://github.com/vercel-labs/agent-browser',
    installCommand: 'Install or configure Agent Browser from https://github.com/vercel-labs/agent-browser',
    trust: 'ecosystem',
    primaryUse: '与 Web 页面真实交互，补齐手工验收证据。',
    combineWith: ['web-access', 'webapp-testing', 'mcp-chrome-devtools'],
    evidence: ['browser-evidence', 'screenshot'],
  }),
  skill({
    id: 'mcp-chrome-devtools',
    name: 'Chrome DevTools MCP',
    category: 'browser',
    description: '用于控制台、网络、性能和浏览器状态检查。',
    sourceUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    installCommand: 'Configure Chrome DevTools MCP for the active agent platform',
    trust: 'ecosystem',
    primaryUse: '调试控制台错误、网络请求、页面状态和性能问题。',
    combineWith: ['agent-browser', 'webapp-testing'],
    evidence: ['network-console-check', 'browser-evidence'],
  }),
  skill({
    id: 'cua',
    name: 'CUA',
    category: 'desktop',
    description: '用于桌面应用、GUI、WPS、微信等端侧自动化验证。',
    sourceUrl: 'https://github.com/trycua/cua',
    installCommand: 'Install or configure CUA from https://github.com/trycua/cua',
    trust: 'ecosystem',
    primaryUse: '操作桌面应用并收集端侧截图、状态和副作用边界证据。',
    combineWith: ['web-access', 'agent-browser'],
    evidence: ['desktop-screenshot', 'operator-safety', 'side-effect-boundary'],
  }),
  skill({
    id: 'liteparse',
    name: 'LiteParse',
    category: 'document-parsing',
    description: 'Agent-first document parsing workflow for PDF, Office, image, OCR, screenshots, and batch ingestion.',
    sourceUrl: 'https://github.com/run-llama/llamaparse-agent-skills',
    installCommand: 'npx skills add run-llama/llamaparse-agent-skills --skill liteparse',
    trust: 'ecosystem',
    primaryUse: 'Parse documents into structured outputs and screenshots for knowledge ingestion with source citation evidence.',
    combineWith: ['graphify', 'memory-brain', 'web-access'],
    evidence: ['parse-output', 'source-citation', 'docs-impact'],
  }),
  skill({
    id: 'd2-diagram',
    name: 'D2 Diagram',
    category: 'diagramming',
    description: 'Declarative diagram-as-code workflow for architecture, flow, sequence, and ER diagrams.',
    sourceUrl: 'https://github.com/terrastruct/d2',
    installCommand: 'Install D2 from https://d2lang.com, then verify with d2 --version',
    trust: 'ecosystem',
    primaryUse: 'Use text-first diagrams with validation and formatting for architecture planning artifacts.',
    combineWith: ['planning-with-files', 'architecture-diagram-generator'],
    evidence: ['diagram-validate', 'architecture-review'],
  }),
  skill({
    id: 'opensquilla',
    name: 'OpenSquilla Harness',
    category: 'orchestration',
    description: 'Optional agent harness reference for model routing, context loading, MetaSkill orchestration, and feedback loops.',
    sourceUrl: 'https://github.com/opensquilla/opensquilla',
    installCommand: 'npx skills add opensquilla/opensquilla',
    trust: 'ecosystem',
    primaryUse: 'Reference external routing, context, MetaSkill orchestration, and feedback-loop ideas without making them required runtime dependencies.',
    combineWith: ['gbrain', 'codegraph', 'codex-cli'],
    evidence: ['orchestration-review', 'cost-risk-note'],
  }),
  skill({
    id: 'code-reviewer',
    name: 'Code Reviewer',
    category: 'review',
    description: '用于 Critical / Improvements / Nitpicks 分级代码审查。',
    sourceUrl: 'https://github.com/google-gemini/gemini-cli/tree/main/.gemini/skills/code-reviewer',
    installCommand: 'npx skills add https://github.com/google-gemini/gemini-cli --skill code-reviewer',
    trust: 'official',
    primaryUse: '合并前分级审查缺陷、安全、可维护性和测试风险。',
    combineWith: ['security-and-hardening', 'update-docs'],
    evidence: ['review-report'],
  }),
  skill({
    id: 'fix',
    name: 'Fix',
    category: 'review',
    description: '用于提交前格式化、lint 和简单自动修复。',
    sourceUrl: 'https://github.com/facebook/react/tree/main/.claude/skills/fix',
    installCommand: 'npx skills add https://github.com/facebook/react --skill fix',
    trust: 'official',
    primaryUse: '提交前清理格式和 lint 问题。',
    combineWith: ['code-reviewer'],
    evidence: ['lint-output'],
  }),
  skill({
    id: 'pr-creator',
    name: 'PR Creator',
    category: 'review',
    description: '用于按模板生成 PR 描述并检查分支边界。',
    sourceUrl: 'https://github.com/google-gemini/gemini-cli/tree/main/.gemini/skills/pr-creator',
    installCommand: 'npx skills add https://github.com/google-gemini/gemini-cli --skill pr-creator',
    trust: 'official',
    primaryUse: '生成标准 PR 描述和合并前说明。',
    combineWith: ['code-reviewer', 'update-docs'],
    evidence: ['pr-description'],
  }),
  skill({
    id: 'update-docs',
    name: 'Update Docs',
    category: 'docs',
    description: '用于代码变更后的文档影响分析和同步更新。',
    sourceUrl: 'https://github.com/vercel/next.js/tree/canary/.claude/skills/update-docs',
    installCommand: 'npx skills add https://github.com/vercel/next.js --skill update-docs',
    trust: 'official',
    primaryUse: '发现并更新受代码变更影响的长期文档。',
    combineWith: ['documentation-and-adrs'],
    evidence: ['docs-impact'],
  }),
  skill({
    id: 'find-skills',
    name: 'Find Skills',
    category: 'discovery',
    description: '用于发现当前任务缺失的 Skill 能力。',
    sourceUrl: 'https://github.com/vercel-labs/skills/tree/main/skills/find-skills',
    installCommand: 'npx skills add https://github.com/vercel-labs/skills --skill find-skills',
    trust: 'ecosystem',
    primaryUse: '按任务意图搜索合适 Skill，再进入安全扫描。',
    combineWith: ['web-access'],
    evidence: ['skill-candidate-list'],
  }),
  skill({
    id: 'codex-cli',
    name: 'Codex CLI',
    category: 'agent-cli',
    description: '用于外部 Agent 评审、对照实现或第二意见。',
    sourceUrl: 'https://github.com/openai/codex',
    installCommand: 'Install Codex CLI and verify with: codex --version',
    trust: 'official',
    primaryUse: '外部 CLI 审查和命令级证据。',
    combineWith: ['gemini-cli', 'opencode-cli'],
    evidence: ['cli-version-check', 'command-output'],
  }),
  skill({
    id: 'gemini-cli',
    name: 'Gemini CLI',
    category: 'agent-cli',
    description: '用于外部 Agent 评审、代码审查和交叉验证。',
    sourceUrl: 'https://github.com/google-gemini/gemini-cli',
    installCommand: 'Install Gemini CLI and verify with: gemini --version',
    trust: 'official',
    primaryUse: '外部 CLI 审查和命令级证据。',
    combineWith: ['codex-cli', 'opencode-cli'],
    evidence: ['cli-version-check', 'command-output'],
  }),
  skill({
    id: 'opencode-cli',
    name: 'OpenCode CLI',
    category: 'agent-cli',
    description: '用于外部 Agent 评审或跨工具验证。',
    sourceUrl: 'https://github.com/sst/opencode',
    installCommand: 'Install OpenCode CLI and verify with: opencode --version',
    trust: 'ecosystem',
    primaryUse: '外部 CLI 审查和命令级证据。',
    combineWith: ['codex-cli', 'gemini-cli'],
    evidence: ['cli-version-check', 'command-output'],
  }),
  skill({
    id: 'agency-agents-zh',
    name: 'Agency Agents ZH',
    category: 'role-library',
    description: '中文专家角色库，可借鉴精选安装和多平台转换方式。',
    sourceUrl: 'https://github.com/jnMetaCode/agency-agents-zh',
    installCommand: 'Review and selectively install role presets from https://github.com/jnMetaCode/agency-agents-zh',
    trust: 'community',
    primaryUse: '提供 CEO、CTO、工程、设计、产品等角色预设参考。',
    combineWith: ['skill-safety-scan'],
    evidence: ['selected-role-list', 'role-trigger-policy'],
  }),
  skill({
    id: 'code-change-detection',
    name: 'Code Change Detection',
    category: 'review',
    description: 'Detect changed files and their blast radius using code-review-graph or git diff fallback. Identifies affected symbols, tests, and dependencies.',
    sourceUrl: 'https://github.com/tirth8205/code-review-graph',
    installCommand: 'pip install code-review-graph && code-review-graph build',
    trust: 'community',
    primaryUse: 'Use before code review to identify changed files, affected symbols, and test impact. Integrates with MCP scale_detect_changes tool.',
    combineWith: ['codegraph', 'memory-brain', 'webapp-testing'],
    evidence: ['change-detection-report', 'blast-radius', 'affected-tests'],
    attribution: {
      license: 'MIT',
      copyright: 'Copyright per tirth8205/code-review-graph project contributors',
      notice: 'Optional external integration. Uses code-review-graph CLI for AST-based change detection.',
      usage: 'external-reference',
      modifiedFromUpstream: false,
    },
  }),
  skill({
    id: 'code-review-context',
    name: 'Code Review Context',
    category: 'review',
    description: 'Get review context for files with blast radius analysis, affected dependencies, and token savings estimation. Uses code-review-graph for structural analysis.',
    sourceUrl: 'https://github.com/tirth8205/code-review-graph',
    installCommand: 'pip install code-review-graph && code-review-graph build',
    trust: 'community',
    primaryUse: 'Use during code review to get focused context with blast radius, reducing token usage by 10-500x vs naive diff review. Integrates with MCP scale_review_context tool.',
    combineWith: ['codegraph', 'code-change-detection', 'memory-brain'],
    evidence: ['review-context', 'token-savings', 'blast-radius'],
    attribution: {
      license: 'MIT',
      copyright: 'Copyright per tirth8205/code-review-graph project contributors',
      notice: 'Optional external integration. Uses code-review-graph CLI for structural review context.',
      usage: 'external-reference',
      modifiedFromUpstream: false,
    },
  }),
]

export function listSkillRepositoryEntries(filter?: { category?: SkillRepositoryCategory }): SkillRepositoryEntry[] {
  return SKILL_REPOSITORY.filter(entry => !filter?.category || entry.category === filter.category)
}

export function recommendSkillWorkflow(input: SkillWorkflowRecommendationInput): SkillWorkflowRecommendation {
  const text = `${input.description} ${input.phase ?? ''}`.toLowerCase()
  const primary = new Set<string>()
  const supporting = new Set<string>()
  const evidence = new Set<string>(['skill-safety-scan'])
  const rationale: string[] = []

  if (matches(text, ['ui', 'ux', 'design', 'frontend', '视觉', '审美', '交互', '前端'])) {
    add(primary, ['impeccable'])
    add(supporting, ['taste-skill', 'awesome-design-md', 'ui-ux-pro-max', 'frontend-design', 'webapp-testing', 'agent-browser', 'mcp-chrome-devtools'])
    add(evidence, ['impeccable-report', 'design-spec', 'browser-evidence'])
    rationale.push('检测到 UI/UX 或前端体验任务，需要设计 Skill 和浏览器证据组合。')
  }

  if (matches(text, ['browser', 'e2e', 'playwright', '浏览器', '自动化', '网页', '联网'])) {
    add(primary, ['web-access'])
    add(supporting, ['agent-browser', 'mcp-chrome-devtools', 'webapp-testing'])
    add(evidence, ['source-citation', 'browser-evidence', 'network-console-check'])
    rationale.push('检测到联网或浏览器自动化任务，需要来源引用和浏览器取证。')
  }

  if (matches(text, ['desktop', 'gui', 'wps', 'wechat', '微信', '桌面', '端侧', '电脑'])) {
    add(primary, ['cua'])
    add(supporting, ['web-access', 'agent-browser'])
    add(evidence, ['desktop-screenshot', 'operator-safety', 'side-effect-boundary'])
    rationale.push('检测到桌面/GUI 自动化任务，需要操作安全边界和截图证据。')
  }

  if (matches(text, ['pdf', 'docx', 'pptx', 'xlsx', 'ocr', 'document parsing', 'parse document', 'knowledge ingestion'])) {
    add(primary, ['liteparse'])
    add(supporting, ['graphify', 'memory-brain'])
    add(evidence, ['parse-output', 'source-citation'])
    rationale.push('Document parsing work needs structured extraction evidence before ingestion.')
  }

  if (matches(text, ['diagram', 'd2', 'architecture diagram', 'flow chart', 'sequence diagram', 'er diagram'])) {
    add(primary, ['d2-diagram'])
    add(supporting, ['planning-with-files'])
    add(evidence, ['diagram-validate', 'architecture-review'])
    rationale.push('Diagramming work needs source-controlled diagram validation evidence.')
  }

  if (matches(text, ['orchestration', 'metaskill', 'agent harness', 'model routing', 'token cost', 'opensquilla'])) {
    add(supporting, ['opensquilla'])
    add(evidence, ['orchestration-review'])
    rationale.push('Agent orchestration work should review external harness ideas as optional references.')
  }

  if (matches(text, ['codex', 'gemini', 'opencode', 'cli', '外部 agent'])) {
    add(supporting, ['codex-cli', 'gemini-cli', 'opencode-cli'])
    add(evidence, ['cli-version-check', 'command-output', 'dry-run-or-safe-mode'])
    rationale.push('检测到外部 Agent CLI 编排，需要记录版本和命令输出。')
  }

  if (matches(text, ['review', 'diff', 'change', 'blast', 'impact', 'code-review', '审查', '变更', '影响'])) {
    add(primary, ['code-change-detection', 'code-review-context'])
    add(supporting, ['codegraph', 'memory-brain'])
    add(evidence, ['change-detection-report', 'blast-radius', 'review-context', 'token-savings'])
    rationale.push('检测到代码审查或变更分析任务，需要变更检测和审查上下文。')
  }

  if (primary.size === 0 && supporting.size === 0) {
    add(primary, ['find-skills'])
    add(supporting, ['web-access'])
    add(evidence, ['skill-candidate-list'])
    rationale.push('未检测到明确领域，先使用 find-skills 和联网研究进行能力发现。')
  }

  return {
    primarySkills: [...primary],
    supportingSkills: [...supporting].filter(skillId => !primary.has(skillId)),
    safetyRequired: true,
    requiredEvidence: [...evidence],
    rationale,
  }
}

export function evaluateSkillInstallSafety(input: SkillInstallSafetyInput): SkillInstallSafetyReport {
  const findings: SkillSafetyFinding[] = []
  const sourceUrl = input.sourceUrl?.trim()
  const command = input.installCommand?.trim() ?? ''
  const corpus = [command, ...(input.files ?? []).map(file => `${file.path}\n${file.content}`)].join('\n')

  if (sourceUrl && !sourceUrl.startsWith('https://')) {
    findings.push({ rule: 'https-required', severity: 'block', message: 'Skill 来源必须使用 HTTPS。' })
  }
  if (/\b(curl|wget|iwr|Invoke-WebRequest)\b[\s\S]*(\|\s*(bash|sh)|\|\s*(iex|Invoke-Expression))/i.test(corpus)) {
    findings.push({ rule: 'no-pipe-to-shell', severity: 'block', message: '禁止下载脚本后直接管道执行。' })
  }
  if (/\b(Invoke-Expression|iex)\b/i.test(corpus)) {
    findings.push({ rule: 'no-download-exec', severity: 'block', message: '禁止使用 Invoke-Expression/iex 执行远程内容。' })
  }
  if (/\brm\s+-rf\s+\/(?:\s|$)|Remove-Item[\s\S]*-Recurse[\s\S]*-Force/i.test(corpus)) {
    findings.push({ rule: 'no-destructive-install', severity: 'block', message: '安装过程不得包含危险递归删除。' })
  }
  if (/\bpostinstall\b|\bpreinstall\b|\binstall\s*:/i.test(corpus)) {
    findings.push({ rule: 'review-package-lifecycle-scripts', severity: 'warn', message: '发现生命周期脚本，需要人工审查。' })
  }
  if (/\bnpx\b|\bnpm\b/i.test(command)) {
    findings.push({ rule: 'npm-supply-chain-review', severity: 'warn', message: 'npm/npx 安装需要签名、来源和 lockfile 审查。' })
  }

  const requiredChecks = new Set(DEFAULT_REQUIRED_CHECKS)
  if (/\bnpx\b|\bnpm\b/i.test(command)) requiredChecks.add('npm-audit-signatures')
  if (sourceUrl?.includes('github.com')) requiredChecks.add('review-repository-activity')
  if (input.files?.some(file => file.path.includes('scripts/'))) requiredChecks.add('review-executable-scripts')

  const blocked = findings.some(finding => finding.severity === 'block')
  return {
    blocked,
    risk: blocked ? 'blocked' : findings.some(finding => finding.severity === 'warn') ? 'medium' : 'low',
    findings,
    requiredChecks: [...requiredChecks],
  }
}

export function renderSkillRepositoryMarkdown(): string {
  const lines = [
    '# SCALE Skill 仓库',
    '',
    '这个仓库视图用于让 Agent 按任务渐进式发现、激活和编排 skills/MCP/CLI，而不是一次性把所有能力塞进上下文。',
    '',
    '## 渐进式披露',
    '',
    '1. 启动时只读取 Skill 元数据和一句话描述。',
    '2. 任务命中时才读取完整 SKILL.md。',
    '3. scripts、references、assets 只在明确需要时懒加载。',
    '',
    '## 安全安装',
    '',
    '- 安装前必须执行安全扫描，阻断 `curl | bash`、`Invoke-Expression`、危险删除和非 HTTPS 来源。',
    '- npm/npx 来源必须补充 `npm audit signatures`、来源仓库、许可证和版本/commit 固定检查。',
    '- 任何第三方 Skill 都先进入隔离审查，再写入项目或全局 skills 目录。',
    '',
    '## 供应链防护清单',
    '',
    '- review-skill-frontmatter',
    '- inspect-scripts-directory',
    '- verify-license-and-source',
    '- verify-attribution-and-notice',
    '- pin-source-revision',
    '- npm-audit-signatures',
    '',
    '## Skill 目录',
    '',
    '| ID | 类别 | 信任 | 主要用途 | 组合建议 |',
    '| --- | --- | --- | --- | --- |',
  ]

  for (const entry of SKILL_REPOSITORY) {
    lines.push(`| \`${entry.id}\` | ${entry.category} | ${entry.trust} | ${entry.orchestration.primaryUse} | ${entry.orchestration.combineWith.join(', ') || '-'} |`)
  }
  lines.push(
    '',
    '## Third-Party Attribution',
    '',
    '| ID | License | Usage | Notice |',
    '| --- | --- | --- | --- |',
  )
  for (const entry of SKILL_REPOSITORY) {
    lines.push(`| \`${entry.id}\` | ${entry.attribution.license} | ${entry.attribution.usage} | ${entry.attribution.notice} |`)
  }
  return lines.join('\n')
}

function skill(input: {
  id: string
  name: string
  category: SkillRepositoryCategory
  description: string
  sourceUrl: string
  installCommand: string
  trust: SkillRepositoryTrust
  primaryUse: string
  combineWith: string[]
  evidence: string[]
  attribution?: SkillRepositoryEntry['attribution']
}): SkillRepositoryEntry {
  return {
    id: input.id,
    name: input.name,
    category: input.category,
    description: input.description,
    sourceUrl: input.sourceUrl,
    installCommand: input.installCommand,
    trust: input.trust,
    progressiveDisclosure: {
      startup: '只读取 name、description、tags、sourceUrl 等元数据。',
      activation: '任务意图命中后读取完整 SKILL.md。',
      lazyResources: ['scripts/', 'references/', 'assets/'],
    },
    orchestration: {
      primaryUse: input.primaryUse,
      combineWith: input.combineWith,
      requiredEvidence: input.evidence,
    },
    safety: {
      requiresReview: input.trust !== 'official',
      requiredChecks: [...DEFAULT_REQUIRED_CHECKS],
    },
    attribution: input.attribution ?? {
      license: 'review-required',
      copyright: 'review-required',
      notice: 'License and attribution must be verified before installation, vendoring, or redistribution.',
      usage: 'external-reference',
      modifiedFromUpstream: false,
    },
  }
}

function matches(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()))
}

function add(target: Set<string>, values: string[]): void {
  for (const value of values) target.add(value)
}
