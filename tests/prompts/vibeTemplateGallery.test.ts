import { describe, expect, it } from 'vitest'
import {
  getVisualVibeTemplate,
  listVisualVibeTemplates,
  renderCopyablePromptCard,
  renderVisualVibeTemplateIndex,
} from '../../src/prompts/VibeTemplateGallery.js'

describe('VibeTemplateGallery', () => {
  it('provides visual copyable prompt templates aligned with SCALE workflow', () => {
    const templates = listVisualVibeTemplates()

    expect(templates.length).toBeGreaterThanOrEqual(9)
    expect(templates.map(template => template.id)).toEqual(expect.arrayContaining([
      'product-ceo-discovery',
      'ui-ux-design-direction',
      'technical-architecture-plan',
      'agentic-company-operating-system',
      'multi-agent-governed-delivery',
      'mutual-review-red-team-loop',
      'budget-aware-long-task-autopilot',
      'implementation-slice',
      'verification-release',
    ]))
    for (const template of templates) {
      expect(template.copyPrompt).toContain('成功标准')
      expect(template.copyPrompt).toContain('安全边界')
      expect(template.copyPrompt).toContain('主动使用 skills/MCP/CLI')
      expect(template.scaleWorkflow).toEqual(expect.arrayContaining(['explore', 'plan', 'verify']))
    }
  })

  it('includes research-backed agentic workflow templates with budget and supervision controls', () => {
    const company = getVisualVibeTemplate('agentic-company-operating-system')
    const delivery = getVisualVibeTemplate('multi-agent-governed-delivery')
    const review = getVisualVibeTemplate('mutual-review-red-team-loop')
    const longTask = getVisualVibeTemplate('budget-aware-long-task-autopilot')

    expect(company?.copyPrompt).toContain('agent presets')
    expect(company?.copyPrompt).toContain('gbrain')
    expect(company?.copyPrompt).toContain('知识库')
    expect(company?.methodologyReferences).toEqual(expect.arrayContaining([
      expect.stringContaining('MetaGPT'),
      expect.stringContaining('AutoGen'),
      expect.stringContaining('ReAct'),
    ]))
    expect(delivery?.copyPrompt).toContain('DAG')
    expect(delivery?.copyPrompt).toContain('runtime evidence')
    expect(review?.methodologyReferences).toEqual(expect.arrayContaining([
      expect.stringContaining('Self-Refine'),
      expect.stringContaining('Reflexion'),
    ]))
    expect(longTask?.copyPrompt).toContain('token budget')
    expect(longTask?.copyPrompt).toContain('checkpoint')
    expect(longTask?.methodologyReferences).toEqual(expect.arrayContaining([
      expect.stringContaining('FrugalGPT'),
    ]))
  })

  it('renders a markdown index that users can view and copy from', () => {
    const markdown = renderVisualVibeTemplateIndex({ appName: 'Amdox Workbench' })

    expect(markdown).toContain('# SCALE Vibe Coding 可视化提示词模板')
    expect(markdown).toContain('复制使用')
    expect(markdown).toContain('product-ceo-discovery')
    expect(markdown).toContain('agentic-company-operating-system')
    expect(markdown).toContain('方法论依据')
    expect(markdown).toContain('Amdox Workbench')
    expect(markdown).toContain('scale vibe --template')
  })

  it('renders one copyable prompt card with interpolated context', () => {
    const card = renderCopyablePromptCard('technical-architecture-plan', {
      appName: 'Scale Engine',
      scenario: '升级 Skill 安全安装流程',
    })

    expect(card).toContain('Scale Engine')
    expect(card).toContain('升级 Skill 安全安装流程')
    expect(card).toContain('```text')
    expect(card).toContain('请作为 CTO')
    expect(card).toContain('工具与 Skill 编排')
  })

  it('returns undefined for unknown template ids', () => {
    expect(getVisualVibeTemplate('missing-template')).toBeUndefined()
  })
})
