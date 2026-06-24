import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  ResolvedSkillRoutingPolicy,
  SkillSourcePolicy,
  SkillRoutingMode,
  SkillRoutingPolicyFile,
  SkillTaskLevel,
} from './SkillRoutingTypes.js'

const DEFAULT_ENFORCE_LEVELS: SkillTaskLevel[] = ['M', 'L', 'CRITICAL']
const DEFAULT_SKILL_SOURCES: Required<SkillSourcePolicy> = {
  primaryRoot: '.scale/skills',
  fallbackRoots: ['skills'],
  globalRoots: [
    '~/.agents/skills',
    '~/.codex/skills',
    '~/.claude/skills',
    '~/.gemini/skills',
    '~/.omx/skills',
  ],
}

export const DEFAULT_SKILL_ROUTING_POLICY: ResolvedSkillRoutingPolicy = {
  version: 1,
  warnings: [],
  policy: {
    mode: 'warn',
    enforceLevels: DEFAULT_ENFORCE_LEVELS,
    requireSkillPlan: true,
  },
  skillSources: DEFAULT_SKILL_SOURCES,
  domains: {
    ui: {
      detect: {
        files: ['src/**/*.tsx', 'src/**/*.jsx', 'app/**/*.tsx', 'pages/**/*.tsx', 'components/**/*.tsx', '**/*.css', '**/*.scss'],
        keywords: ['ui', 'ux', 'frontend', 'component', 'page', 'layout', 'responsive', 'visual', '界面', '页面', '交互', '视觉', '前端'],
      },
      requiredSkills: ['impeccable'],
      recommendedSkills: ['taste-skill', 'awesome-design-md', 'ui-ux-pro-max', 'frontend-design', 'webapp-testing', 'agent-browser', 'mcp-chrome-devtools', 'browser-testing-with-devtools', 'design-review'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'mini-prd.md', 'ui-spec.md', 'visual-review.md'],
      requiredVerification: ['design-system', 'screenshot', 'responsive-check', 'browser-run', 'visual-review'],
    },
    documentParsing: {
      detect: {
        files: ['**/*.pdf', '**/*.docx', '**/*.pptx', '**/*.xlsx', '**/*.csv', '**/*.png', '**/*.tiff'],
        keywords: ['pdf', 'document parsing', 'parse document', 'ocr', 'extract text', 'knowledge ingestion', 'liteparse', 'llamaparse'],
      },
      recommendedSkills: ['liteparse'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'docs-impact.md'],
      requiredVerification: ['parse-output', 'source-citation'],
    },
    diagramming: {
      detect: {
        files: ['**/*.d2', 'docs/architecture/**', 'docs/diagrams/**'],
        keywords: ['diagram', 'architecture diagram', 'flow chart', 'sequence diagram', 'er diagram', 'd2'],
      },
      recommendedSkills: ['d2-diagram'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'architecture-review.md'],
      requiredVerification: ['diagram-validate'],
    },
    orchestration: {
      detect: {
        files: ['src/orchestrator/**', 'src/orchestration/**', 'src/workflow/**', 'src/runtime/**'],
        keywords: ['agent orchestration', 'workflow orchestration', 'routing', 'metaskill', 'model routing', 'token cost', 'opensquilla'],
      },
      recommendedSkills: ['opensquilla'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'architecture-review.md'],
      requiredVerification: ['orchestration-review'],
    },
    webResearch: {
      detect: {
        files: ['docs/research/**', 'docs/**/research.md', '**/research.md'],
        keywords: [
          'web research',
          'search online',
          'online',
          'latest',
          'source citation',
          'source citations',
          'logged-in',
          'login',
          'dynamic web page',
          'authenticated page',
          'inspect page',
          'web-access',
          'network',
          'web fetch',
        ],
      },
      requiredSkills: ['web-access'],
      recommendedSkills: ['agent-browser', 'mcp-chrome-devtools', 'source-driven-development', 'browser-use'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'verification.md'],
      requiredVerification: ['source-citation', 'browser-evidence', 'network-console-check'],
    },
    browserAutomation: {
      detect: {
        files: ['tests/e2e/**', 'e2e/**', 'playwright.config.*', '**/*.spec.ts', '**/*.e2e.ts'],
        keywords: [
          'browser automation',
          'browser interaction',
          'browser behavior',
          'browser',
          'playwright',
          'agent-browser',
          'chrome devtools',
          'cdp',
          'screenshot',
          'console log',
          'network request',
          'e2e',
          'end-to-end',
        ],
      },
      recommendedSkills: ['webapp-testing', 'agent-browser', 'web-access', 'mcp-chrome-devtools', 'playwright', 'playwright-interactive'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'e2e-plan.md', 'verification.md'],
      requiredVerification: ['browser-run', 'screenshot', 'console-log', 'network-console-check'],
    },
    e2e: {
      detect: {
        files: ['tests/e2e/**', 'e2e/**', 'playwright.config.*'],
        keywords: ['e2e', 'browser', 'playwright', 'end-to-end', '端到端', '浏览器'],
      },
      recommendedSkills: ['webapp-testing', 'agent-browser', 'web-access', 'mcp-chrome-devtools', 'playwright', 'playwright-interactive'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'e2e-plan.md'],
      requiredVerification: ['browser-run', 'screenshot', 'console-log'],
    },
    desktopAutomation: {
      detect: {
        files: ['tests/desktop/**', 'desktop/**', 'e2e/desktop/**'],
        keywords: [
          'desktop automation',
          'desktop app',
          'computer use',
          'cua',
          'gui automation',
          'operate desktop',
          'windows desktop',
          'wps',
          'wechat',
          'weixin',
          'office app',
        ],
      },
      requiredSkills: ['turix-cua'],
      recommendedSkills: ['agent-browser', 'web-access', 'computer-use', 'opencli'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'verification.md'],
      requiredVerification: ['desktop-screenshot', 'operator-safety', 'side-effect-boundary'],
      blockLevels: ['CRITICAL'],
    },
    externalCli: {
      detect: {
        files: ['scripts/**', '.github/workflows/**'],
        keywords: [
          'external cli',
          'agent cli',
          'codex',
          'codex cli',
          'claude code',
          'gemini cli',
          'opencode',
          'aider',
          'cross-agent',
          'subagent',
          'wps cli',
          'wechat automation',
        ],
      },
      recommendedSkills: ['codex-cli', 'gemini-cli', 'opencode-cli', 'git-workflow-and-versioning', 'code-reviewer'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'verification.md'],
      requiredVerification: ['cli-version-check', 'command-output', 'dry-run-or-safe-mode', 'side-effect-boundary'],
    },
    api: {
      detect: {
        files: ['**/api/**', '**/routes/**', '**/controller/**', '**/*.api', '**/*.proto'],
        keywords: ['api', 'endpoint', 'route', 'handler', '接口', '路由'],
      },
      recommendedSkills: ['tdd-guide', 'code-review'],
      requiredArtifacts: ['skill-plan.md', 'mini-prd.md', 'api-contract.md'],
      requiredVerification: ['contract-check'],
    },
    db: {
      detect: {
        files: ['**/migration/**', '**/migrations/**', '**/*.sql', '**/schema.*', '**/model/**'],
        keywords: ['database', 'db', 'migration', 'schema', 'sql', '数据表', '数据库', '迁移'],
      },
      requiredSkills: ['security-review'],
      recommendedSkills: ['systematic-debugging'],
      requiredArtifacts: ['skill-plan.md', 'db-change-plan.md', 'security-review.md'],
      requiredVerification: ['rollback-plan', 'migration-test'],
    },
    security: {
      detect: {
        files: ['**/auth/**', '**/permission/**', '**/security/**', '**/middleware/**'],
        keywords: ['auth', 'permission', 'tenant', 'token', 'credential', 'secret', 'rbac', '鉴权', '权限', '租户', '密钥'],
      },
      requiredSkills: ['security-review'],
      recommendedSkills: ['code-review'],
      requiredArtifacts: ['skill-plan.md', 'security-review.md'],
      requiredVerification: ['threat-model', 'rollback-plan'],
      blockLevels: ['CRITICAL'],
    },
    docs: {
      detect: {
        files: ['docs/**', '**/*.md'],
        keywords: ['docs', 'documentation', 'document', 'readme', '文档'],
      },
      recommendedSkills: ['update-docs', 'workflow-guide'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'docs-impact.md'],
    },
    resourceGovernance: {
      detect: {
        files: [
          '.scale/resource-policy.json',
          '.scale/assets.json',
          'docs/modules/**',
          'docs/decisions/**',
          'docs/worklog/tasks/**',
          'test-results/**',
          'playwright-report/**',
          'coverage/**',
          'tmp/**',
          'scripts/tmp/**',
          '**/*.png',
          '**/*.jpg',
          '**/*.jpeg',
          '**/*.webp',
          '**/*.gif',
          '**/*.mp4',
          '**/*.webm',
          '**/*.mov',
          '**/*.wav',
          '**/*.mp3',
        ],
        keywords: ['asset', 'resource', 'artifact retention', 'lifecycle', 'temporary file', 'e2e report', 'screenshot', 'video', 'documentation drift', 'resource governance'],
      },
      recommendedSkills: ['documentation-and-adrs', 'git-workflow-and-versioning', 'ai-slop-cleaner'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'docs-impact.md', 'resource-impact.md'],
      requiredVerification: ['asset-scan', 'asset-doctor'],
    },
    engineeringStandards: {
      detect: {
        files: [
          '.scale/engineering-standards.json',
          '.scale/frameworks.json',
          'docs/standards/**',
          'src/**',
          'app/**',
          'packages/**',
          'services/**',
          'internal/**',
          'pkg/**',
        ],
        keywords: [
          'coding standard',
          'engineering standard',
          'logging',
          'redaction',
          'desensitization',
          'orm',
          'framework convention',
          'architecture boundary',
          'design pattern',
          'test rigor',
          'sql injection',
          'xss',
          '脱敏',
          '日志',
          '架构规范',
          '编码规范',
          '框架规范',
          '联调',
          '发版',
        ],
      },
      recommendedSkills: ['code-review-and-quality', 'security-and-hardening', 'documentation-and-adrs'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'standards-impact.md', 'architecture-review.md', 'security-review.md'],
      requiredVerification: ['standards-scan', 'standards-doctor'],
      blockLevels: ['L', 'CRITICAL'],
    },
    review: {
      detect: {
        files: ['.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md'],
        keywords: ['review', 'code review', 'pull request', 'pr', 'merge request', 'changes reviewed', '审查', '评审'],
      },
      requiredSkills: ['code-reviewer'],
      recommendedSkills: ['pr-creator'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'review.md'],
      requiredVerification: ['review-evidence'],
    },
    release: {
      detect: {
        files: ['CHANGELOG.md', 'package.json', '.github/workflows/**'],
        keywords: ['release', 'ship', 'publish', 'deploy', 'pull request', 'pr', '发版', '发布', '部署'],
      },
      requiredSkills: ['code-reviewer'],
      recommendedSkills: ['pr-creator', 'fix', 'verification', 'code-review'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'review.md', 'summary.md'],
      requiredVerification: ['preflight'],
    },
    skillDiscovery: {
      detect: {
        keywords: ['skill', 'capability', 'missing capability', 'install skill', 'find skill'],
      },
      recommendedSkills: ['find-skills'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md'],
    },
    fullstackPrototype: {
      detect: {
        keywords: ['fullstack', 'full-stack', 'mvp', 'prototype', 'next.js', 'react api', 'node api'],
      },
      recommendedSkills: ['fullstack-developer'],
      requiredArtifacts: ['skill-plan.md', 'skill-evidence.md', 'mini-prd.md', 'api-contract.md'],
      requiredVerification: ['preflight'],
    },
  },
}

export function skillRoutingPolicyPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  const root = isAbsolute(scaleDir) ? scaleDir : join(resolve(projectDir), scaleDir)
  return join(root, 'skills.json')
}

export function loadSkillRoutingPolicy(projectDir = process.cwd(), scaleDir = '.scale'): ResolvedSkillRoutingPolicy {
  const path = skillRoutingPolicyPath(projectDir, scaleDir)
  if (!existsSync(path)) {
    return {
      ...DEFAULT_SKILL_ROUTING_POLICY,
      warnings: [`No skill routing policy found at ${path}; using built-in defaults.`],
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SkillRoutingPolicyFile
    return resolveSkillRoutingPolicy(parsed)
  } catch (error) {
    return {
      ...DEFAULT_SKILL_ROUTING_POLICY,
      warnings: [`Failed to read ${path}: ${(error as Error).message}; using built-in defaults.`],
    }
  }
}

export function resolveSkillRoutingPolicy(input: SkillRoutingPolicyFile | null | undefined): ResolvedSkillRoutingPolicy {
  const warnings: string[] = []
  const mode = normalizeMode(input?.policy?.mode)
  if (input?.policy?.mode && !mode) {
    warnings.push(`Invalid skill policy mode "${String(input.policy.mode)}"; using warn.`)
  }

  return {
    version: typeof input?.version === 'number' ? input.version : 1,
    warnings,
    policy: {
      mode: mode ?? DEFAULT_SKILL_ROUTING_POLICY.policy.mode,
      enforceLevels: normalizeLevels(input?.policy?.enforceLevels),
      requireSkillPlan: input?.policy?.requireSkillPlan ?? DEFAULT_SKILL_ROUTING_POLICY.policy.requireSkillPlan,
    },
    skillSources: normalizeSkillSources(input?.skillSources),
    domains: {
      ...DEFAULT_SKILL_ROUTING_POLICY.domains,
      ...(input?.domains ?? {}),
    },
  }
}

export function skillRoutingPolicyTemplate(mode: 'minimal' | 'standard' | 'critical' = 'standard'): string {
  const policy = {
    version: 1,
    policy: {
      mode: mode === 'critical' ? 'block' : 'warn',
      enforceLevels: DEFAULT_ENFORCE_LEVELS,
      requireSkillPlan: true,
    },
    skillSources: DEFAULT_SKILL_SOURCES,
    domains: DEFAULT_SKILL_ROUTING_POLICY.domains,
  }
  return JSON.stringify(policy, null, 2) + '\n'
}

function normalizeMode(value: unknown): SkillRoutingMode | undefined {
  if (value === 'off' || value === 'warn' || value === 'block') return value
  return undefined
}

function normalizeLevels(value: unknown): SkillTaskLevel[] {
  if (!Array.isArray(value)) return DEFAULT_ENFORCE_LEVELS
  const levels = value.filter((level): level is SkillTaskLevel =>
    level === 'S' || level === 'M' || level === 'L' || level === 'CRITICAL',
  )
  return levels.length > 0 ? levels : DEFAULT_ENFORCE_LEVELS
}

function normalizeSkillSources(value: unknown): Required<SkillSourcePolicy> {
  if (!value || typeof value !== 'object') return DEFAULT_SKILL_SOURCES
  const record = value as Record<string, unknown>
  const primaryRoot = normalizeRoot(record.primaryRoot) ?? DEFAULT_SKILL_SOURCES.primaryRoot
  const fallbackRoots = normalizeRoots(record.fallbackRoots, DEFAULT_SKILL_SOURCES.fallbackRoots)
    .filter(root => root !== primaryRoot)
  const globalRoots = normalizeRoots(record.globalRoots, DEFAULT_SKILL_SOURCES.globalRoots)
  return {
    primaryRoot,
    fallbackRoots,
    globalRoots,
  }
}

function normalizeRoots(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const roots = value
    .map(normalizeRoot)
    .filter((root): root is string => Boolean(root))
  return roots.length > 0 ? [...new Set(roots)] : fallback
}

function normalizeRoot(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized || undefined
}
