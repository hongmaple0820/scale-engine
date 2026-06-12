// SCALE Engine — Predefined Agent Profiles (v0.8.0)
// 12 个专业 Agent Profile 定义

import type { AgentProfile, AgentDomain } from './types.js'
import { EVIDENCE_DISCIPLINE_PROMPT } from './evidenceDiscipline.js'

// ============================================================================
// 12 个预定义 Professional Agent Profiles
// ============================================================================

const BASE_PROFESSIONAL_AGENTS: AgentProfile[] = [
  {
    id: 'frontend-agent',
    name: 'Frontend Developer',
    domain: 'frontend',
    inheritsRole: 'Implementer',
    capabilities: ['react', 'vue', 'css', 'animation', 'accessibility', 'typescript'],
    preferredModel: 'balanced',
    outputFormat: { fileTypes: ['.tsx', '.css', '.html'], style: 'component-based' },
    collaboration: { reportsTo: 'backend-agent', sharesWith: ['ui-design-agent', 'test-agent'] },
    description: 'UI/UX implementation, React/Vue components, CSS styling'
  },
  {
    id: 'backend-agent',
    name: 'Backend Developer',
    domain: 'backend',
    inheritsRole: 'Implementer',
    capabilities: ['api', 'database', 'auth', 'performance', 'caching', 'sql'],
    preferredModel: 'balanced',
    outputFormat: { fileTypes: ['.ts', '.sql', '.json'], style: 'layered-architecture' },
    collaboration: { reportsTo: 'frontend-agent', sharesWith: ['test-agent', 'ops-agent'] },
    description: 'API design, database operations, authentication, performance optimization'
  },
  {
    id: 'test-agent',
    name: 'Test Engineer',
    domain: 'testing',
    inheritsRole: 'Verifier',
    capabilities: ['tdd', 'e2e', 'mocking', 'coverage', 'playwright', 'vitest'],
    preferredModel: 'fast',
    outputFormat: { fileTypes: ['.test.ts', '.spec.ts'], style: 'aaa-pattern' },
    collaboration: { sharesWith: ['frontend-agent', 'backend-agent'] },
    description: 'TDD workflow, E2E testing, test coverage, mocking strategies'
  },
  {
    id: 'ui-design-agent',
    name: 'UI/UX Designer',
    domain: 'ui-design',
    inheritsRole: 'SpecWriter',
    capabilities: ['visual-design', 'accessibility', 'ux', 'responsive', 'animation', 'figma'],
    preferredModel: 'powerful',
    outputFormat: { fileTypes: ['.md', '.css'], style: 'design-spec' },
    collaboration: { reportsTo: 'frontend-agent', sharesWith: ['product-agent'] },
    description: 'Visual design, accessibility compliance, UX patterns, responsive layouts'
  },
  {
    id: 'ops-agent',
    name: 'DevOps Engineer',
    domain: 'operations',
    inheritsRole: 'Releaser',
    capabilities: ['deploy', 'cicd', 'monitoring', 'docker', 'k8s', 'terraform'],
    preferredModel: 'fast',
    outputFormat: { fileTypes: ['.yaml', '.sh', '.dockerfile', '.tf'], style: 'automation' },
    collaboration: { reportsTo: 'backend-agent', sharesWith: ['security-agent'] },
    description: 'Deployment, CI/CD pipelines, monitoring, Docker/Kubernetes'
  },
  {
    id: 'product-agent',
    name: 'Product Manager',
    domain: 'product',
    inheritsRole: 'SpecWriter',
    capabilities: ['requirements', 'user-story', 'analytics', 'roadmap', 'prioritization'],
    preferredModel: 'powerful',
    outputFormat: { fileTypes: ['.md'], style: 'user-centric' },
    collaboration: { sharesWith: ['ui-design-agent', 'architect-agent'] },
    description: 'Requirements gathering, user stories, analytics, roadmap planning'
  },
  {
    id: 'code-review-agent',
    name: 'Code Reviewer',
    domain: 'code-review',
    inheritsRole: 'Verifier',
    capabilities: ['quality', 'security', 'patterns', 'best-practices', 'clean-code'],
    preferredModel: 'powerful',
    outputFormat: { fileTypes: ['.md'], style: 'review-report' },
    collaboration: { sharesWith: ['test-agent', 'security-agent'] },
    description: 'Code quality review, security analysis, pattern enforcement'
  },
  {
    id: 'security-agent',
    name: 'Security Specialist',
    domain: 'security',
    inheritsRole: 'Verifier',
    capabilities: ['owasp', 'auth', 'crypto', 'compliance', 'audit', 'penetration-testing'],
    preferredModel: 'powerful',
    outputFormat: { fileTypes: ['.md', '.yaml'], style: 'security-report' },
    collaboration: { sharesWith: ['code-review-agent', 'ops-agent'] },
    description: 'OWASP compliance, authentication, cryptography, security audit'
  },
  // ===== 新增 4 个 Agent =====
  {
    id: 'database-agent',
    name: 'Database Specialist',
    domain: 'database',
    inheritsRole: 'Implementer',
    capabilities: ['migration', 'schema-design', 'sql-optimization', 'indexing', 'backup-recovery'],
    preferredModel: 'balanced',
    outputFormat: { fileTypes: ['.sql', '.ts'], style: 'migration-script' },
    collaboration: { reportsTo: 'backend-agent', sharesWith: ['ops-agent'] },
    description: 'Database migrations, schema design, query optimization'
  },
  {
    id: 'performance-agent',
    name: 'Performance Engineer',
    domain: 'performance',
    inheritsRole: 'Verifier',
    capabilities: ['profiling', 'benchmarking', 'optimization', 'caching', 'load-testing'],
    preferredModel: 'powerful',
    outputFormat: { fileTypes: ['.md', '.ts'], style: 'performance-report' },
    collaboration: { sharesWith: ['frontend-agent', 'backend-agent', 'database-agent'] },
    description: 'Performance profiling, benchmarking, optimization strategies'
  },
  {
    id: 'docs-agent',
    name: 'Documentation Specialist',
    domain: 'documentation',
    inheritsRole: 'SpecWriter',
    capabilities: ['api-docs', 'user-guide', 'technical-writing', 'diagrams', 'examples'],
    preferredModel: 'fast',
    outputFormat: { fileTypes: ['.md', '.mdx'], style: 'documentation' },
    collaboration: { sharesWith: ['product-agent', 'architect-agent'] },
    description: 'API documentation, user guides, technical writing'
  },
  {
    id: 'architect-agent',
    name: 'Software Architect',
    domain: 'architecture',
    inheritsRole: 'Planner',
    capabilities: ['system-design', 'microservices', 'patterns', 'scalability', 'trade-offs'],
    preferredModel: 'powerful',
    outputFormat: { fileTypes: ['.md', '.yaml'], style: 'architecture-spec' },
    collaboration: { sharesWith: ['product-agent', 'backend-agent', 'frontend-agent'] },
    description: 'System architecture design, scalability planning, pattern selection'
  }
]

// 12 个 profile 默认继承共享的证据纪律段（单一事实源在 EVIDENCE_DISCIPLINE_PROMPT）；
// 个别 profile 若显式设置 systemPromptAddendum 则覆盖默认值。
export const PROFESSIONAL_AGENTS: AgentProfile[] = BASE_PROFESSIONAL_AGENTS.map(p => ({
  systemPromptAddendum: EVIDENCE_DISCIPLINE_PROMPT,
  ...p,
}))

// ============================================================================
// Profile Registry
// ============================================================================

export class AgentProfileRegistry {
  private profiles = new Map<string, AgentProfile>()

  constructor() {
    // 注册预定义 Profiles
    for (const profile of PROFESSIONAL_AGENTS) {
      this.profiles.set(profile.id, profile)
    }
  }

  /** 获取 Profile */
  get(id: string): AgentProfile | undefined {
    return this.profiles.get(id)
  }

  /** 获取所有 Profiles */
  listAll(): AgentProfile[] {
    return Array.from(this.profiles.values())
  }

  /** 按 Domain 筛选 */
  findByDomain(domain: string): AgentProfile[] {
    return this.listAll().filter(p => p.domain === domain)
  }

  /** 按能力标签筛选 */
  findByCapability(capability: string): AgentProfile[] {
    return this.listAll().filter(p => p.capabilities.includes(capability))
  }

  /** 注册自定义 Profile */
  register(profile: AgentProfile): void {
    if (this.profiles.has(profile.id)) {
      throw new Error(`Profile already registered: ${profile.id}`)
    }
    this.profiles.set(profile.id, profile)
  }
}

/** 默认 Registry 实例 */
export const defaultProfileRegistry = new AgentProfileRegistry()

// ============================================================================
// Helper Functions（测试需要）
// ============================================================================

/** 获取单个 Profile */
export function getProfile(id: string): AgentProfile | undefined {
  return defaultProfileRegistry.get(id)
}

/** 按 Domain 获取 Profiles */
export function getProfilesByDomain(domain: string): AgentProfile[] {
  return defaultProfileRegistry.findByDomain(domain)
}

/** 按 Role 获取 Profiles */
export function getProfilesByRole(role: string): AgentProfile[] {
  return PROFESSIONAL_AGENTS.filter(p => p.inheritsRole === role)
}

/** 列出所有 Profile IDs */
export function listProfiles(): string[] {
  return PROFESSIONAL_AGENTS.map(p => p.id)
}
