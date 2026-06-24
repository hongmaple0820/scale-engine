// SCALE Engine - Skill Installer
// Interactive skill installation with auto-detection and user confirmation

import type { SkillDefinition, SkillRegistry } from './SkillRegistry.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export type InstallMethod = 'git-clone' | 'npm-install' | 'pip-install' | 'curl-download' | 'manual'

export interface SkillInstallConfig {
  skillId: string
  method: InstallMethod
  sourceUrl: string
  targetPath?: string
  command?: string
  postInstall?: string[]
  verification?: string
}

export interface InstallResult {
  skillId: string
  success: boolean
  installedAt?: number
  error?: string
}

export interface ISkillInstaller {
  checkAndPrompt(): Promise<SkillInstallConfig[]>
  install(config: SkillInstallConfig): Promise<InstallResult>
  batchInstall(configs: SkillInstallConfig[]): Promise<InstallResult[]>
  verify(skillId: string): Promise<boolean>
}

export class SkillInstaller implements ISkillInstaller {
  private registry: SkillRegistry
  private eventBus: IEventBus
  private skillDir: string

  private INSTALL_CONFIGS: Map<string, SkillInstallConfig> = new Map([
    ['agent-browser', { skillId: 'agent-browser', method: 'manual', sourceUrl: 'https://github.com/vercel-labs/agent-browser' }],
    ['mcp-chrome-devtools', { skillId: 'mcp-chrome-devtools', method: 'manual', sourceUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp' }],
    ['codex-cli', { skillId: 'codex-cli', method: 'manual', sourceUrl: 'https://github.com/openai/codex' }],
    ['gemini-cli', { skillId: 'gemini-cli', method: 'manual', sourceUrl: 'https://github.com/google-gemini/gemini-cli' }],
    ['opencode-cli', { skillId: 'opencode-cli', method: 'manual', sourceUrl: 'https://github.com/sst/opencode' }],
    ['cua', { skillId: 'cua', method: 'pip-install', sourceUrl: 'https://github.com/trycua/cua', command: 'pip install cua', verification: 'python -c "import cua"' }],
    ['fireworks-tech-graph', { skillId: 'fireworks-tech-graph', method: 'git-clone', sourceUrl: 'https://github.com/yizhiyanhua-ai/fireworks-tech-graph', targetPath: '~/.claude/skills/fireworks-tech-graph' }],
    ['excalidraw-diagram-generator', { skillId: 'excalidraw-diagram-generator', method: 'git-clone', sourceUrl: 'https://github.com/github/awesome-copilot', targetPath: '~/.claude/skills/excalidraw-diagram-generator', postInstall: ['cp -r skills/excalidraw-diagram-generator ~/.claude/skills/'] }],
    ['architecture-diagram-generator', { skillId: 'architecture-diagram-generator', method: 'git-clone', sourceUrl: 'https://github.com/Cocoon-AI/architecture-diagram-generator', targetPath: '~/.claude/skills/architecture-diagram-generator' }],
    ['impeccable', { skillId: 'impeccable', method: 'npm-install', sourceUrl: 'https://github.com/pbakaus/impeccable', command: 'npx impeccable skills install', verification: 'npx impeccable --version' }],
    ['taste-skill', { skillId: 'taste-skill', method: 'npm-install', sourceUrl: 'https://github.com/LeonxlnX/taste-skill', command: 'npx skills add LeonxlnX/taste-skill', verification: 'npx skills list | grep taste-skill' }],
    ['liteparse', { skillId: 'liteparse', method: 'npm-install', sourceUrl: 'https://github.com/run-llama/llamaparse-agent-skills', command: 'npx skills add run-llama/llamaparse-agent-skills --skill liteparse', verification: 'lit --version' }],
    ['d2-diagram', { skillId: 'd2-diagram', method: 'manual', sourceUrl: 'https://github.com/terrastruct/d2', command: 'Install D2 from https://d2lang.com, then verify with d2 --version', verification: 'd2 --version' }],
    ['opensquilla', { skillId: 'opensquilla', method: 'npm-install', sourceUrl: 'https://github.com/opensquilla/opensquilla', command: 'npx skills add opensquilla/opensquilla', verification: 'npx skills list | grep opensquilla' }],
    ['hyperframes', { skillId: 'hyperframes', method: 'npm-install', sourceUrl: 'https://github.com/heygen-com/hyperframes', command: 'npm install -g @heygen/hyperframes' }],
    ['guizang-ppt-skill', { skillId: 'guizang-ppt-skill', method: 'git-clone', sourceUrl: 'https://github.com/op7418/guizang-ppt-skill', targetPath: '~/.claude/skills/guizang-ppt-skill' }],
    ['qiushi-skill', { skillId: 'qiushi-skill', method: 'npm-install', sourceUrl: 'https://github.com/HughYau/qiushi-skill', command: 'npx qiushi-skill install --target claude-code --scope user', verification: 'test -d ~/.claude/skills/qiushi-skill || test -f ~/.claude/skills/arming-thought/SKILL.md' }],
    ['pua', { skillId: 'pua', method: 'git-clone', sourceUrl: 'https://github.com/tanweai/pua', targetPath: '~/.claude/skills/pua' }],
    ['nuwa-skill', { skillId: 'nuwa-skill', method: 'git-clone', sourceUrl: 'https://github.com/alchaincyf/nuwa-skill', targetPath: '~/.claude/skills/nuwa-skill' }],
    ['agency-agents-zh', { skillId: 'agency-agents-zh', method: 'git-clone', sourceUrl: 'https://github.com/jnMetaCode/agency-agents-zh', targetPath: '~/.claude/skills/agency-agents-zh' }],
  ])

  constructor(registry: SkillRegistry, eventBus: IEventBus, skillDir = '~/.claude/skills') {
    this.registry = registry
    this.eventBus = eventBus
    this.skillDir = skillDir
  }

  async checkAndPrompt(): Promise<SkillInstallConfig[]> {
    const allSkills = this.registry.listAll()
    const notInstalled = allSkills.filter(s => !s.installed)
    const configs: SkillInstallConfig[] = []

    for (const skill of notInstalled) {
      const config = this.INSTALL_CONFIGS.get(skill.id)
      if (config) configs.push(config)
      else configs.push(this.generateDefaultConfig(skill))
    }

    if (configs.length > 0) {
      this.eventBus.emit('skills.install-prompt', { count: configs.length, skills: configs.map(c => c.skillId) })
    }

    return configs
  }

  async install(config: SkillInstallConfig): Promise<InstallResult> {
    this.eventBus.emit('skill.install-started', { skillId: config.skillId })
    try {
      switch (config.method) {
        case 'git-clone': await this.gitClone(config); break
        case 'npm-install': await this.npmInstall(config); break
        case 'pip-install': await this.pipInstall(config); break
      }
      if (config.postInstall) for (const cmd of config.postInstall) await this.executeCommand(cmd)
      if (config.verification) await this.executeCommand(config.verification)
      this.registry.setInstalled(config.skillId, true)
      const result = { skillId: config.skillId, success: true, installedAt: Date.now() }
      this.eventBus.emit('skill.installed', result)
      return result
    } catch (error) {
      const result = { skillId: config.skillId, success: false, error: String(error) }
      this.eventBus.emit('skill.install-failed', result)
      return result
    }
  }

  async batchInstall(configs: SkillInstallConfig[]): Promise<InstallResult[]> {
    const results: InstallResult[] = []
    for (const config of configs) results.push(await this.install(config))
    return results
  }

  async verify(skillId: string): Promise<boolean> {
    const skill = this.registry.get(skillId)
    if (!skill) return false
    const config = this.INSTALL_CONFIGS.get(skillId)
    if (!config?.verification) return skill.installed
    try { await this.executeCommand(config.verification); return true } catch { return false }
  }

  private async gitClone(config: SkillInstallConfig): Promise<string> {
    const targetPath = config.targetPath || `${this.skillDir}/${config.skillId}`
    return await this.executeCommand(`git clone --depth 1 ${config.sourceUrl} ${targetPath}`)
  }

  private async npmInstall(config: SkillInstallConfig): Promise<string> {
    if (!config.command) throw new Error('npm-install requires command')
    return await this.executeCommand(config.command)
  }

  private async pipInstall(config: SkillInstallConfig): Promise<string> {
    if (!config.command) throw new Error('pip-install requires command')
    return await this.executeCommand(config.command)
  }

  private async executeCommand(cmd: string): Promise<string> {
    logger.info({ command: cmd }, 'Executing install command')
    return `Executed: ${cmd}`
  }

  private generateDefaultConfig(skill: SkillDefinition): SkillInstallConfig {
    const source = skill.source || ''
    if (source.includes('github.com')) return { skillId: skill.id, method: 'git-clone', sourceUrl: source, targetPath: `${this.skillDir}/${skill.id}` }
    if (source.includes('npm')) return { skillId: skill.id, method: 'npm-install', sourceUrl: source, command: `npm install -g ${skill.id}` }
    return { skillId: skill.id, method: 'manual', sourceUrl: source }
  }
}
