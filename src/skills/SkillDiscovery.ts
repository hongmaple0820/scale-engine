// SCALE Engine - Agent Proactive Skill Discovery + Platform Scanner
// 让 Agent 在执行任务时主动发现缺失能力，推荐安装优秀技能
// 同时支持扫描平台已有技能目录

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { IEventBus } from '../core/eventBus.js'
import type { SkillRegistry } from './SkillRegistry.js'
import type { SkillInstallConfig, ISkillInstaller, InstallMethod } from './SkillInstaller.js'
import type { AgentPlatform, SkillRef, SkillScanResult, DevelopmentPhase } from '../artifact/types.js'
import { logger } from '../core/logger.js'
import { loadSkillRoutingPolicy } from './routing/SkillPolicy.js'

// Phase-based skill directory structure
const PHASE_DIRS: DevelopmentPhase[] = ['DEFINE', 'PLAN', 'BUILD', 'VERIFY', 'REVIEW', 'SHIP', 'ANTI-PATTERNS']

/** Phase-based skill scan result */
export interface PhaseSkillScanResult {
  phase: DevelopmentPhase
  skills: SkillRef[]
  count: number
}

// ============================================================================
// 技能来源知识库 - Agent 知道去哪里找优秀技能
// ============================================================================

const KNOWN_SKILL_SOURCES = {
  browserAutomation: [
    { id: 'web-access', source: 'https://github.com/eze-is/web-access', quality: 95, description: 'CDP browser automation for logged-in pages' },
    { id: 'agent-browser', source: 'https://github.com/vercel-labs/agent-browser', quality: 88, description: 'Browser automation CLI for AI agents' },
    { id: 'mcp-chrome-devtools', source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp', quality: 86, description: 'Chrome DevTools MCP for console and network inspection' },
    { id: 'playwright', source: 'https://github.com/microsoft/playwright', quality: 92, description: 'CLI browser automation' },
    { id: 'cua', source: 'https://github.com/trycua/cua', quality: 90, description: 'Computer use agent' },
  ],
  uiDesign: [
    { id: 'impeccable', source: 'https://github.com/pbakaus/impeccable', quality: 98, description: 'Deterministic UI anti-pattern detection and design refinement' },
    { id: 'taste-skill', source: 'https://github.com/LeonxlnX/taste-skill', quality: 93, description: 'Design-language generation and aesthetic direction setting' },
    { id: 'awesome-design-md', source: 'https://github.com/VoltAgent/awesome-design-md', quality: 88, description: 'DESIGN.md brand and product design system references' },
    { id: 'ui-ux-pro-max', source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill', quality: 85, description: 'UX guidelines database' },
  ],
  documentParsing: [
    { id: 'liteparse', source: 'https://github.com/run-llama/llamaparse-agent-skills', quality: 88, description: 'Agent-first document parsing, OCR, screenshots, and batch ingestion' },
  ],
  diagrams: [
    { id: 'd2-diagram', source: 'https://github.com/terrastruct/d2', quality: 80, description: 'Declarative diagram-as-code workflow for architecture and flow diagrams' },
    { id: 'fireworks-tech-graph', source: 'https://github.com/yizhiyanhua-ai/fireworks-tech-graph', quality: 82, description: 'Tech flow diagrams' },
    { id: 'architecture-diagram-generator', source: 'https://github.com/Cocoon-AI/architecture-diagram-generator', quality: 85, description: 'System architecture diagrams' },
  ],
  agentInfrastructure: [
    { id: 'opensquilla', source: 'https://github.com/opensquilla/opensquilla', quality: 75, description: 'Agent harness reference for routing, context management, orchestration, and feedback loops' },
  ],
  videoGeneration: [
    { id: 'hyperframes', source: 'https://github.com/heygen-com/hyperframes', quality: 75, description: 'HeyGen video generation' },
  ],
  pptGeneration: [
    { id: 'guizang-ppt-skill', source: 'https://github.com/op7418/guizang-ppt-skill', quality: 70, description: 'PPT auto generation' },
  ],
  knowledgeGraph: [
    { id: 'graphify', source: 'https://github.com/anthropics/claude-code/tree/main/skills/graphify', quality: 90, description: 'Knowledge graph generator' },
  ],
  testing: [
    { id: 'playwright-interactive', source: 'https://github.com/anthropics/claude-code/tree/main/skills/playwright-interactive', quality: 80, description: 'Persistent session UI debug' },
  ],
}

/** 发现上下文 - Agent 执行任务时的场景 */
export interface DiscoveryContext {
  taskType: string              // 'web-scraping' | 'ui-design' | ...
  missingCapabilities: string[] // ['browser', 'login'] | ['design', 'accessibility']
  phase: 'explore' | 'plan' | 'execute' | 'verify' | 'deliver'
  keywords: string[]
}

/** 发现结果 */
export interface DiscoveryResult {
  skillId: string
  sourceUrl: string
  quality: number               // 0-100
  relevance: number             // 0-1
  description: string
  alreadyInstalled: boolean
  installConfig?: SkillInstallConfig
}

/** Agent 主动技能发现接口 */
export interface ISkillDiscovery {
  discover(context: DiscoveryContext): Promise<DiscoveryResult[]>
  recommendInstall(context: DiscoveryContext): Promise<SkillInstallConfig[]>
  periodicScan(): Promise<DiscoveryResult[]>
  checkDuringExecution(taskType: string, capabilities: string[]): Promise<DiscoveryResult[]>
  scanSkills(platform: AgentPlatform): SkillScanResult
  scanPhaseSkills(projectDir?: string): Map<DevelopmentPhase, PhaseSkillScanResult>
  getSkillsForPhase(phase: DevelopmentPhase, projectDir?: string): SkillRef[]
  detectPlatform(): AgentPlatform | null
}

// ============================================================================
// Platform Skills Directory Map
// ============================================================================

/** 全局级平台：skills 目录在 homedir 下 */
const GLOBAL_PLATFORMS: AgentPlatform[] = ['claude-code', 'codex', 'opencode', 'deepseek-tui']

/** 项目级平台：skills 目录在项目目录下 */
const PROJECT_PLATFORMS: AgentPlatform[] = ['cursor', 'gemini', 'openclaw', 'hermes', 'trae', 'workbuddy', 'vsc', 'qcoder', 'qoder', 'jcode', 'aider', 'windsurf', 'kimi', 'doubao', 'kiro', 'cline', 'kilocode', 'antigravity']

const PLATFORM_SKILLS_DIRS: Record<AgentPlatform, string> = {
  // 全局级（homedir）
  'claude-code': join(homedir(), '.claude', 'skills'),
  'codex': join(homedir(), '.omx', 'skills'),
  'opencode': join(homedir(), '.config', 'opencode', 'skills'),
  // 项目级（相对路径，与适配器配置一致）
  'cursor': join('.cursor', 'skills'),
  'gemini': join('.gemini', 'skills'),
  'openclaw': join('.openclaw', 'skills'),
  'hermes': join('.hermes', 'skills'),
  'trae': join('.trae', 'skills'),
  'workbuddy': join('.workbuddy', 'skills'),
  'vsc': join('.vscode', 'skills'),
  'qcoder': join('.qwen', 'skills'),
  'qoder': join('.qoder', 'skills'),
  'jcode': join('.jcode', 'skills'),
  'aider': join('.aider', 'commands'),
  'deepseek-tui': join(homedir(), '.deepseek', 'skills'),
  'windsurf': join('.windsurf', 'skills'),
  'kimi': join('.kimi', 'skills'),
  'doubao': join('.doubao', 'skills'),
  'kiro': join('.kiro', 'skills'),
  'cline': join('.cline', 'skills'),
  'kilocode': join('.kilocode', 'skills'),
  'antigravity': join('.agents', 'skills'),
}

export class SkillDiscovery implements ISkillDiscovery {
  private registry: SkillRegistry | null
  private installer: ISkillInstaller | null
  private eventBus: IEventBus | null
  private projectDir: string

  /**
   * 构造函数支持两种模式：
   * 1. 独立模式（仅 projectDir）：用于平台检测和技能扫描
   * 2. 增强模式（完整参数）：用于 Agent 主动发现和推荐安装
   */
  constructor(
    registryOrProjectDir: SkillRegistry | string,
    installer?: ISkillInstaller,
    eventBus?: IEventBus,
    projectDir?: string
  ) {
    // 判断是独立模式还是增强模式
    if (typeof registryOrProjectDir === 'string') {
      // 独立模式
      this.registry = null
      this.installer = null
      this.eventBus = null
      this.projectDir = registryOrProjectDir
    } else {
      // 增强模式
      this.registry = registryOrProjectDir
      this.installer = installer ?? null
      this.eventBus = eventBus ?? null
      this.projectDir = projectDir ?? '.'
    }
  }

  // ========== 主动发现功能 ==========

  async discover(context: DiscoveryContext): Promise<DiscoveryResult[]> {
    // 独立模式下无法执行发现功能
    if (!this.registry) {
      logger.warn('SkillDiscovery: registry not initialized, discover disabled')
      return []
    }

    const results: DiscoveryResult[] = []
    const category = this.matchCategory(context.taskType, context.keywords)
    if (!category) return []

    const candidates = (KNOWN_SKILL_SOURCES as Record<string, Array<{ id: string; source: string; quality: number; description: string }>>)[category] || []
    for (const candidate of candidates) {
      const registered = this.registry.get(candidate.id)
      const relevance = this.calculateRelevance(context, candidate)
      results.push({
        skillId: candidate.id,
        sourceUrl: candidate.source,
        quality: candidate.quality,
        relevance,
        description: candidate.description,
        alreadyInstalled: registered?.installed ?? false,
        installConfig: !registered?.installed ? this.createInstallConfig(candidate) : undefined,
      })
    }

    results.sort((a, b) => (b.quality * b.relevance) - (a.quality * a.relevance))
    if (this.eventBus) {
      this.eventBus.emit('skill.recommended', { context, recommendations: results.filter(r => !r.alreadyInstalled) })
    }
    return results
  }

  async recommendInstall(context: DiscoveryContext): Promise<SkillInstallConfig[]> {
    if (!this.registry) return []
    const discoveries = await this.discover(context)
    return discoveries.filter(r => !r.alreadyInstalled && r.quality >= 80 && r.relevance >= 0.7 && r.installConfig)
      .map(r => r.installConfig!)
  }

  async periodicScan(): Promise<DiscoveryResult[]> {
    if (!this.registry) return []
    const allResults: DiscoveryResult[] = []
    for (const category of Object.keys(KNOWN_SKILL_SOURCES)) {
      for (const candidate of (KNOWN_SKILL_SOURCES as Record<string, Array<{ id: string; source: string; quality: number; description: string }>>)[category]) {
        if (!this.registry.get(candidate.id)) {
          allResults.push({
            skillId: candidate.id,
            sourceUrl: candidate.source,
            quality: candidate.quality,
            relevance: 1.0,
            description: candidate.description,
            alreadyInstalled: false,
            installConfig: this.createInstallConfig(candidate),
          })
        }
      }
    }
    return allResults
  }

  async checkDuringExecution(taskType: string, capabilities: string[]): Promise<DiscoveryResult[]> {
    if (!this.registry) return []
    const missing = this.detectMissingCapabilities(capabilities)
    if (missing.length === 0) return []
    return this.discover({ taskType, missingCapabilities: missing, phase: 'execute', keywords: missing })
  }

  // ========== 原有平台扫描功能 ==========

  detectPlatform(): AgentPlatform | null {
    const checks: Array<{ platform: AgentPlatform; paths: string[] }> = [
      { platform: 'claude-code', paths: [join(this.projectDir, '.claude', 'settings.json')] },
      { platform: 'codex', paths: [join(this.projectDir, '.codex', 'hooks.json')] },
      { platform: 'opencode', paths: [join(homedir(), '.config', 'opencode', 'hooks.json')] },
      { platform: 'cursor', paths: [join(this.projectDir, '.cursor', 'settings.json')] },
      { platform: 'gemini', paths: [join(this.projectDir, '.gemini', 'settings.json')] },
      { platform: 'openclaw', paths: [join(this.projectDir, '.openclaw', 'settings.json')] },
      { platform: 'hermes', paths: [join(this.projectDir, '.hermes', 'settings.json')] },
      { platform: 'trae', paths: [join(this.projectDir, '.trae', 'settings.json')] },
      { platform: 'workbuddy', paths: [join(this.projectDir, '.workbuddy', 'settings.json')] },
      { platform: 'vsc', paths: [join(this.projectDir, '.vscode', 'scale.json')] },
      { platform: 'qcoder', paths: [join(this.projectDir, '.qwen', 'settings.json')] },
      { platform: 'qoder', paths: [join(this.projectDir, '.qoder', 'settings.json')] },
      { platform: 'jcode', paths: [join(this.projectDir, '.jcode', 'settings.json')] },
      { platform: 'aider', paths: [join(this.projectDir, '.aider.conf.yml')] },
      { platform: 'deepseek-tui', paths: [join(this.projectDir, '.deepseek', 'instructions.md')] },
      { platform: 'windsurf', paths: [join(this.projectDir, '.windsurf', 'settings.json'), join(this.projectDir, '.windsurfrc')] },
      { platform: 'kimi', paths: [join(this.projectDir, '.kimi', 'settings.json')] },
      { platform: 'doubao', paths: [join(this.projectDir, '.doubao', 'settings.json')] },
      { platform: 'kiro', paths: [join(this.projectDir, '.kiro', 'settings.json')] },
      { platform: 'cline', paths: [join(this.projectDir, '.cline', 'settings.json'), join(this.projectDir, '.clinerules')] },
      { platform: 'kilocode', paths: [join(this.projectDir, '.kilocode', 'settings.json')] },
      { platform: 'antigravity', paths: [join(this.projectDir, '.agents', 'hooks.json'), join(this.projectDir, '.agents', 'rules')] },
    ]
    for (const check of checks) {
      if (check.paths.some(p => existsSync(p))) return check.platform
    }
    return null
  }

  scanSkills(platform: AgentPlatform): SkillScanResult {
    const skillsDir = PLATFORM_SKILLS_DIRS[platform]

    // 区分全局级和项目级目录解析
    const resolvedDir = GLOBAL_PLATFORMS.includes(platform)
      ? skillsDir // 全局级：直接使用绝对路径
      : join(this.projectDir, skillsDir) // 项目级：拼接项目目录

    if (!existsSync(resolvedDir)) return { platform, skillsDir: resolvedDir, skills: [], exists: false }

    const skills: SkillRef[] = []
    try {
      for (const entry of readdirSync(resolvedDir)) {
        const entryPath = join(resolvedDir, entry)
        const stat = statSync(entryPath)
        if (stat.isDirectory()) {
          skills.push({ id: `${platform}-${entry}`, name: entry, description: '', platform, path: entryPath, enabled: true })
        }
      }
    } catch (error) { logger.warn({ error }, 'Permission error scanning skills directory') }

    return { platform, skillsDir: resolvedDir, skills, exists: true }
  }

  generateSkillsMd(skills: SkillRef[]): string {
    if (skills.length === 0) return '## Available Skills\n\nNo skills discovered.\n'
    const grouped = new Map<AgentPlatform, SkillRef[]>()
    for (const skill of skills) {
      const group = grouped.get(skill.platform) ?? []
      group.push(skill)
      grouped.set(skill.platform, group)
    }
    const sections = ['## Available Skills\n']
    for (const [platform, platformSkills] of grouped) {
      sections.push(`### ${platform}\n`)
      for (const skill of platformSkills) {
        const desc = skill.description ? ` — ${skill.description}` : ''
        sections.push(`- ✅ **${skill.name}**${desc}`)
      }
      sections.push('')
    }
    return sections.join('\n')
  }

  // ========== Phase-based Skill Scanning ==========

  /**
   * Scan skills organized by development phase
   * @param projectDir - Project directory containing the configured project-local skills root
   * @returns Map of phase to skill scan results
   */
  scanPhaseSkills(projectDir?: string): Map<DevelopmentPhase, PhaseSkillScanResult> {
    const dir = projectDir ?? this.projectDir
    const result = new Map<DevelopmentPhase, PhaseSkillScanResult>()
    const roots = this.projectSkillRoots(dir)

    for (const phase of PHASE_DIRS) {
      const skills: SkillRef[] = []

      for (const root of roots) {
        const phaseDir = join(root, phase)
        if (!existsSync(phaseDir)) continue
        try {
          for (const entry of readdirSync(phaseDir)) {
            if (entry.endsWith('.md')) {
              const skillPath = join(phaseDir, entry)
              const skillName = entry.replace('.md', '')
              skills.push({
                id: `phase-${phase.toLowerCase()}-${skillName}`,
                name: skillName,
                description: this.extractSkillDescription(skillPath),
                platform: 'claude-code',
                path: skillPath,
                enabled: true,
                phase,
              })
            }
          }
        } catch (error) { logger.warn({ error }, 'Permission error scanning skills directory') }
      }

      result.set(phase, { phase, skills, count: skills.length })
    }

    return result
  }

  /**
   * Get skills available for a specific development phase
   * @param phase - Development phase (DEFINE, PLAN, BUILD, VERIFY, REVIEW, SHIP, ANTI-PATTERNS)
   * @param projectDir - Project directory
   * @returns List of skills for the phase
   */
  getSkillsForPhase(phase: DevelopmentPhase, projectDir?: string): SkillRef[] {
    const scanResult = this.scanPhaseSkills(projectDir)
    return scanResult.get(phase)?.skills ?? []
  }

  /**
   * Generate phase-based skills index markdown
   */
  generatePhaseSkillsMd(scanResult: Map<DevelopmentPhase, PhaseSkillScanResult>): string {
    const sections = ['# Phase-Based Skills Index\n\n']
    sections.push('> Skills organized by development phase for intuitive discovery.\n\n')

    const phaseDescriptions: Record<DevelopmentPhase, string> = {
      'DEFINE': 'Requirements capture, ambiguity scoring, spec generation',
      'PLAN': 'Architecture design, task breakdown, risk assessment',
      'BUILD': 'TDD implementation, code style, feature development',
      'VERIFY': 'Unit testing, integration testing, coverage analysis',
      'REVIEW': 'Code review, security audit, quality gates',
      'SHIP': 'Git commit, release management, deployment',
      'ANTI-PATTERNS': 'Common pitfalls to avoid across all phases',
    }

    for (const phase of PHASE_DIRS) {
      const result = scanResult.get(phase)
      if (result && result.count > 0) {
        sections.push(`## ${phase}\n\n${phaseDescriptions[phase]}\n\n`)
        for (const skill of result.skills) {
          const desc = skill.description ? ` — ${skill.description}` : ''
          sections.push(`- ✅ **${skill.name}**${desc}\n`)
        }
        sections.push('\n')
      }
    }

    sections.push('---\n\n')
    sections.push('*Use `scale <phase>` commands to invoke phase workflows.*\n')

    return sections.join('')
  }

  // ========== Private Methods ==========

  private projectSkillRoots(projectDir: string): string[] {
    try {
      const sources = loadSkillRoutingPolicy(projectDir).skillSources
      return [sources.primaryRoot, ...sources.fallbackRoots].map(root => join(projectDir, root))
    } catch {
      return [join(projectDir, '.scale', 'skills'), join(projectDir, 'skills')]
    }
  }

  private matchCategory(taskType: string, keywords: string[]): string | null {
    const typeToCategory: Record<string, string> = {
      'web-scraping': 'browserAutomation', 'e2e-testing': 'testing', 'ui-design': 'uiDesign',
      'diagram': 'diagrams', 'video-generation': 'videoGeneration', 'ppt-generation': 'pptGeneration',
      'knowledge-graph': 'knowledgeGraph', 'document-parsing': 'documentParsing', 'pdf-extraction': 'documentParsing',
      'agent-orchestration': 'agentInfrastructure',
    }
    if (typeToCategory[taskType]) return typeToCategory[taskType]
    for (const kw of keywords) {
      if (kw.includes('browser')) return 'browserAutomation'
      if (kw.includes('design')) return 'uiDesign'
      if (kw.includes('pdf') || kw.includes('ocr') || kw.includes('document')) return 'documentParsing'
      if (kw.includes('diagram')) return 'diagrams'
      if (kw.includes('orchestrat') || kw.includes('agent harness') || kw.includes('routing')) return 'agentInfrastructure'
      if (kw.includes('test')) return 'testing'
    }
    return null
  }

  private calculateRelevance(ctx: DiscoveryContext, candidate: { description: string }): number {
    const descLower = candidate.description.toLowerCase()
    let matchCount = 0
    for (const kw of ctx.keywords) if (descLower.includes(kw.toLowerCase())) matchCount++
    for (const cap of ctx.missingCapabilities) if (descLower.includes(cap.toLowerCase())) matchCount++
    const total = ctx.keywords.length + ctx.missingCapabilities.length
    return total > 0 ? matchCount / total : 0.5
  }

  private detectMissingCapabilities(capabilities: string[]): string[] {
    if (!this.registry) return capabilities // 无 registry 时返回全部
    const missing: string[] = []
    const allSkills = this.registry.listAll()
    for (const cap of capabilities) {
      const hasIt = allSkills.some(s => s.installed && (s.id.includes(cap) || s.description.toLowerCase().includes(cap)))
      if (!hasIt) missing.push(cap)
    }
    return missing
  }

  private createInstallConfig(candidate: { id: string; source: string; description: string }): SkillInstallConfig {
    const method: InstallMethod = candidate.source.includes('github') ? 'git-clone' : 'manual'
    const command = method === 'git-clone'
      ? `git clone ${candidate.source} ~/.claude/skills/${candidate.id}`
      : `create ~/.claude/skills/${candidate.id}/SKILL.md`
    return {
      skillId: candidate.id,
      method,
      sourceUrl: candidate.source,
      command,
      verification: `test -f ~/.claude/skills/${candidate.id}/SKILL.md`,
    }
  }

  private extractSkillDescription(skillPath: string): string {
    try {
      const content = readFileSync(skillPath, 'utf-8')
      // Try frontmatter first
      const { parseSkillFrontmatter } = require('./SkillFrontmatter.js')
      const parsed = parseSkillFrontmatter(content)
      if (parsed.frontmatter?.description) return parsed.frontmatter.description
      // Fallback to Purpose: regex
      const purposeMatch = content.match(/Purpose:\s*(.+)/)
      return purposeMatch ? purposeMatch[1].trim() : ''
    } catch {
      return ''
    }
  }

  /**
   * Scan a directory for SKILL.md files with frontmatter and register them.
   * Returns the number of new skills registered.
   */
  async scanAndRegisterFrontmatter(dir: string): Promise<number> {
    if (!this.registry) return 0
    return this.registry.loadFromFrontmatter(dir)
  }
}
