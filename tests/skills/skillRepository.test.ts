import { describe, expect, it } from 'vitest'
import {
  evaluateSkillInstallSafety,
  listSkillRepositoryEntries,
  recommendSkillWorkflow,
  renderSkillRepositoryMarkdown,
} from '../../src/skills/SkillRepository.js'

describe('SkillRepository', () => {
  it('contains progressive-disclosure entries for UI, browser, desktop, and external CLI work', () => {
    const ids = listSkillRepositoryEntries().map(entry => entry.id)

    expect(ids).toEqual(expect.arrayContaining([
      'planning-with-files',
      'gbrain',
      'awesome-design-md',
      'ui-ux-pro-max',
      'web-access',
      'agent-browser',
      'mcp-chrome-devtools',
      'cua',
      'codex-cli',
      'gemini-cli',
      'opencode-cli',
      'agency-agents-zh',
    ]))
  })

  it('records third-party attribution for external planning and gbrain memory references', () => {
    const entries = listSkillRepositoryEntries()
    const planning = entries.find(entry => entry.id === 'planning-with-files')
    const gbrain = entries.find(entry => entry.id === 'gbrain')

    expect(planning?.category).toBe('planning')
    expect(planning?.attribution.license).toBe('MIT')
    expect(planning?.attribution.copyright).toContain('Ahmad Adi')
    expect(planning?.attribution.usage).toBe('adapted-concept')
    expect(planning?.attribution.modifiedFromUpstream).toBe(false)

    expect(gbrain?.category).toBe('memory')
    expect(gbrain?.attribution.license).toBe('MIT')
    expect(gbrain?.attribution.usage).toBe('external-reference')
    expect(gbrain?.safety.requiresReview).toBe(true)
  })

  it('recommends a composable UI workflow with design and browser validation skills', () => {
    const plan = recommendSkillWorkflow({
      description: '设计前端 UI/UX，并用浏览器自动化和 E2E 测试验证交互',
      phase: 'design',
    })

    expect(plan.primarySkills).toEqual(expect.arrayContaining(['awesome-design-md', 'ui-ux-pro-max']))
    expect(plan.supportingSkills).toEqual(expect.arrayContaining(['frontend-design', 'webapp-testing', 'agent-browser', 'mcp-chrome-devtools']))
    expect(plan.safetyRequired).toBe(true)
    expect(plan.requiredEvidence).toEqual(expect.arrayContaining(['skill-safety-scan', 'design-spec', 'browser-evidence']))
  })

  it('recommends desktop automation with stricter safety boundaries', () => {
    const plan = recommendSkillWorkflow({
      description: '操控 Windows 桌面、WPS、微信并验证端侧应用流程',
      phase: 'verify',
    })

    expect(plan.primarySkills).toContain('cua')
    expect(plan.supportingSkills).toEqual(expect.arrayContaining(['web-access', 'agent-browser']))
    expect(plan.requiredEvidence).toEqual(expect.arrayContaining(['operator-safety', 'side-effect-boundary']))
  })

  it('blocks dangerous install commands and flags supply-chain risk', () => {
    const report = evaluateSkillInstallSafety({
      sourceUrl: 'http://example.com/install.sh',
      installCommand: 'curl http://example.com/install.sh | bash',
    })

    expect(report.blocked).toBe(true)
    expect(report.risk).toBe('blocked')
    expect(report.findings.map(finding => finding.rule)).toEqual(expect.arrayContaining([
      'no-pipe-to-shell',
      'https-required',
    ]))
  })

  it('requires manual review checks for managed external skill installs', () => {
    const report = evaluateSkillInstallSafety({
      sourceUrl: 'https://github.com/VoltAgent/awesome-design-md',
      installCommand: 'scale setup --pack ui --include awesome-design-md --apply',
    })

    expect(report.blocked).toBe(false)
    expect(report.requiredChecks).toEqual(expect.arrayContaining([
      'review-skill-frontmatter',
      'inspect-scripts-directory',
      'verify-license-and-source',
      'verify-attribution-and-notice',
      'pin-source-revision',
      'review-repository-activity',
    ]))
  })

  it('renders a Chinese repository guide with safety workflow', () => {
    const markdown = renderSkillRepositoryMarkdown()

    expect(markdown).toContain('# SCALE Skill 仓库')
    expect(markdown).toContain('渐进式披露')
    expect(markdown).toContain('安全安装')
    expect(markdown).toContain('供应链')
    expect(markdown).toContain('awesome-design-md')
    expect(markdown).toContain('Third-Party Attribution')
    expect(markdown).toContain('planning-with-files')
    expect(markdown).toContain('gbrain')
    expect(markdown).toContain('MIT')
    expect(markdown).toContain('verify-attribution-and-notice')
  })
})
