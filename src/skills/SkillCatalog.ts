import type { SkillDefinition } from './SkillRegistry.js'

export type SkillTrustLevel = 'official' | 'ecosystem'
export type WorkflowSkillReadinessTier = 'required' | 'recommended' | 'optional'

export interface WorkflowSkillCatalogEntry {
  id: string
  name: string
  description: string
  source: string
  installCommand: string
  trust: SkillTrustLevel
  readiness?: WorkflowSkillReadinessTier
  definition: SkillDefinition
}

export const WORKFLOW_AGENT_SKILL_CATALOG: WorkflowSkillCatalogEntry[] = [
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    description: 'Distinctive production-grade frontend UI design',
    source: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    installCommand: 'npx skills add anthropics/skills --skill frontend-design',
    trust: 'official',
    readiness: 'recommended',
    definition: {
      id: 'frontend-design',
      name: 'Frontend Design',
      description: 'Distinctive production-grade frontend UI design',
      domain: 'planning',
      triggers: [
        { type: 'taskType', value: ['ui-design'], weight: 1.0 },
        { type: 'keyword', value: ['frontend', 'ui', 'ux', 'visual', 'responsive', 'component'], weight: 0.9 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/frontend-design/SKILL.md' } },
      priority: 94,
      installed: true,
      source: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    },
  },
  {
    id: 'webapp-testing',
    name: 'Webapp Testing',
    description: 'Playwright-based local web application testing',
    source: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing',
    installCommand: 'npx skills add anthropics/skills --skill webapp-testing',
    trust: 'official',
    readiness: 'required',
    definition: {
      id: 'webapp-testing',
      name: 'Webapp Testing',
      description: 'Playwright-based local web application testing',
      domain: 'verification',
      triggers: [
        { type: 'taskType', value: ['e2e-testing', 'ui-debugging'], weight: 1.0 },
        { type: 'phase', value: 'verify', weight: 0.8 },
        { type: 'keyword', value: ['playwright', 'browser', 'e2e', 'screenshot', 'console'], weight: 0.9 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/webapp-testing/SKILL.md' } },
      priority: 92,
      installed: true,
      source: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing',
    },
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Critical, improvement, and nitpick review workflow',
    source: 'https://github.com/google-gemini/gemini-cli/tree/main/.gemini/skills/code-reviewer',
    installCommand: 'npx skills add https://github.com/google-gemini/gemini-cli --skill code-reviewer',
    trust: 'official',
    readiness: 'required',
    definition: {
      id: 'code-reviewer',
      name: 'Code Reviewer',
      description: 'Critical, improvement, and nitpick review workflow',
      domain: 'verification',
      triggers: [
        { type: 'taskType', value: ['code-review'], weight: 1.0 },
        { type: 'phase', value: 'verify', weight: 0.7 },
        { type: 'keyword', value: ['review', 'critical', 'pull request', 'pr'], weight: 0.9 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.gemini/skills/code-reviewer/SKILL.md' } },
      priority: 93,
      installed: true,
      source: 'https://github.com/google-gemini/gemini-cli/tree/main/.gemini/skills/code-reviewer',
    },
  },
  {
    id: 'fix',
    name: 'Fix',
    description: 'Format and lint repair before committing',
    source: 'https://github.com/facebook/react/tree/main/.claude/skills/fix',
    installCommand: 'npx skills add https://github.com/facebook/react --skill fix',
    trust: 'official',
    readiness: 'recommended',
    definition: {
      id: 'fix',
      name: 'Fix',
      description: 'Format and lint repair before committing',
      domain: 'execution',
      triggers: [
        { type: 'taskType', value: ['lint-fix', 'bug-fix'], weight: 0.8 },
        { type: 'keyword', value: ['lint', 'format', 'prettier', 'eslint', 'ci'], weight: 0.9 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.claude/skills/fix/SKILL.md' } },
      priority: 82,
      installed: true,
      source: 'https://github.com/facebook/react/tree/main/.claude/skills/fix',
    },
  },
  {
    id: 'pr-creator',
    name: 'PR Creator',
    description: 'Template-aware pull request creation workflow',
    source: 'https://github.com/google-gemini/gemini-cli/tree/main/.gemini/skills/pr-creator',
    installCommand: 'npx skills add https://github.com/google-gemini/gemini-cli --skill pr-creator',
    trust: 'official',
    readiness: 'recommended',
    definition: {
      id: 'pr-creator',
      name: 'PR Creator',
      description: 'Template-aware pull request creation workflow',
      domain: 'deployment',
      triggers: [
        { type: 'taskType', value: ['pull-request', 'release'], weight: 1.0 },
        { type: 'keyword', value: ['pull request', 'pr', 'branch', 'merge'], weight: 0.9 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.gemini/skills/pr-creator/SKILL.md' } },
      priority: 84,
      installed: true,
      source: 'https://github.com/google-gemini/gemini-cli/tree/main/.gemini/skills/pr-creator',
    },
  },
  {
    id: 'update-docs',
    name: 'Update Docs',
    description: 'Documentation impact analysis and update workflow',
    source: 'https://github.com/vercel/next.js/tree/canary/.claude/skills/update-docs',
    installCommand: 'npx skills add https://github.com/vercel/next.js --skill update-docs',
    trust: 'official',
    readiness: 'recommended',
    definition: {
      id: 'update-docs',
      name: 'Update Docs',
      description: 'Documentation impact analysis and update workflow',
      domain: 'planning',
      triggers: [
        { type: 'taskType', value: ['docs-update'], weight: 1.0 },
        { type: 'keyword', value: ['docs', 'documentation', 'readme', 'api reference'], weight: 0.9 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.claude/skills/update-docs/SKILL.md' } },
      priority: 82,
      installed: true,
      source: 'https://github.com/vercel/next.js/tree/canary/.claude/skills/update-docs',
    },
  },
  {
    id: 'find-skills',
    name: 'Find Skills',
    description: 'Discover installable skills for uncovered task capabilities',
    source: 'https://github.com/vercel-labs/skills/tree/main/skills/find-skills',
    installCommand: 'npx skills add https://github.com/vercel-labs/skills --skill find-skills',
    trust: 'ecosystem',
    readiness: 'recommended',
    definition: {
      id: 'find-skills',
      name: 'Find Skills',
      description: 'Discover installable skills for uncovered task capabilities',
      domain: 'context',
      triggers: [
        { type: 'taskType', value: ['skill-discovery'], weight: 1.0 },
        { type: 'keyword', value: ['skill', 'capability', 'discover', 'install'], weight: 0.9 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/find-skills/SKILL.md' } },
      priority: 78,
      installed: true,
      source: 'https://github.com/vercel-labs/skills/tree/main/skills/find-skills',
    },
  },
  {
    id: 'fullstack-developer',
    name: 'Fullstack Developer',
    description: 'React, Node.js, database, and API prototyping workflow',
    source: 'https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/awesome_agent_skills/fullstack-developer',
    installCommand: 'npx skills add https://github.com/Shubhamsaboo/awesome-llm-apps --skill fullstack-developer',
    trust: 'ecosystem',
    readiness: 'optional',
    definition: {
      id: 'fullstack-developer',
      name: 'Fullstack Developer',
      description: 'React, Node.js, database, and API prototyping workflow',
      domain: 'execution',
      triggers: [
        { type: 'taskType', value: ['fullstack-prototype'], weight: 1.0 },
        { type: 'keyword', value: ['react', 'next.js', 'node', 'api', 'database', 'prototype'], weight: 0.8 },
      ],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/fullstack-developer/SKILL.md' } },
      priority: 70,
      installed: true,
      source: 'https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/awesome_agent_skills/fullstack-developer',
    },
  },
]

export function workflowAgentSkillDefinitions(): SkillDefinition[] {
  return WORKFLOW_AGENT_SKILL_CATALOG.map(entry => entry.definition)
}
