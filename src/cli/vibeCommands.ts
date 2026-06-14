import { defineCommand } from 'citty'
import { dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import {
  getVisualVibeTemplate,
  listVisualVibePacks,
  renderCopyablePromptCard,
  renderVisualVibeTemplateIndex,
} from '../prompts/VibeTemplateGallery.js'

type LegacyVibePhase = 'idea' | 'research' | 'prd' | 'design' | 'agents' | 'build'

const LEGACY_PHASE_TEMPLATE_MAP: Record<LegacyVibePhase, string> = {
  idea: 'product-ceo-discovery',
  research: 'product-ceo-discovery',
  prd: 'product-ceo-discovery',
  design: 'technical-architecture-plan',
  agents: 'agentic-company-operating-system',
  build: 'implementation-slice',
}

const PACKS = Object.fromEntries(listVisualVibePacks().map(pack => [pack.id, pack.templateIds]))

export const vibeCommand = defineCommand({
  meta: {
    name: 'vibe',
    description: '生成可复制的 SCALE Vibe Coding 中文提示词模板',
  },
  args: {
    template: {
      type: 'string',
      alias: 't',
      description: '模板 ID，例如 product-ceo-discovery / technical-architecture-plan',
    },
    phase: {
      type: 'string',
      alias: 'p',
      description: '兼容旧阶段: idea/research/prd/design/agents/build',
    },
    pack: {
      type: 'string',
      alias: 'k',
      description: '组合包: full-mvp/quick-prototype/developer-path/vibe-coder-path/agentic-company-flow/multi-agent-delivery/long-task-autopilot',
    },
    app: {
      type: 'string',
      alias: 'a',
      description: '项目或应用名称',
    },
    scenario: {
      type: 'string',
      alias: 's',
      description: '本次任务场景',
    },
    user: {
      type: 'string',
      alias: 'u',
      description: '用户身份或角色',
    },
    output: {
      type: 'string',
      alias: 'o',
      description: '输出文件路径；不填则输出到终端',
    },
    interactive: {
      type: 'boolean',
      alias: 'i',
      description: '显示交互式使用引导',
      default: false,
    },
  },
  run({ args }) {
    const context = {
      appName: args.app,
      scenario: args.scenario,
      userRole: args.user,
    }

    if (args.interactive) {
      writeOutput(renderInteractiveGuide(args.app), args.output)
      return
    }

    const templateId = resolveTemplateId(args.template, args.phase)
    if (templateId) {
      const markdown = renderCopyablePromptCard(templateId, context)
      if (!markdown) {
        console.error(`Unknown vibe template: ${templateId}`)
        process.exit(1)
      }
      writeOutput(markdown, args.output)
      return
    }

    if (args.pack) {
      const pack = PACKS[args.pack]
      if (!pack) {
        console.error(`Unknown vibe pack: ${args.pack}`)
        console.error(`Available packs: ${Object.keys(PACKS).join(', ')}`)
        process.exit(1)
      }
      const markdown = [
        `# SCALE Vibe Pack: ${args.pack}`,
        '',
        ...pack.map(id => renderCopyablePromptCard(id, context)),
      ].join('\n')
      writeOutput(markdown, args.output)
      return
    }

    writeOutput(renderVisualVibeTemplateIndex(context), args.output)
  },
})

export const vibeNextCommand = defineCommand({
  meta: {
    name: 'vibe-next',
    description: '基于旧阶段推荐下一步 Vibe 模板',
  },
  args: {
    current: {
      type: 'string',
      alias: 'c',
      description: '当前阶段',
      required: true,
    },
  },
  run({ args }) {
    const order: LegacyVibePhase[] = ['idea', 'research', 'prd', 'design', 'agents', 'build']
    const index = order.indexOf(args.current as LegacyVibePhase)
    const next = index >= 0 ? order[index + 1] : undefined
    if (!next) {
      console.log('所有主要阶段已完成。建议运行: scale vibe --template verification-release')
      return
    }
    const templateId = LEGACY_PHASE_TEMPLATE_MAP[next]
    const template = getVisualVibeTemplate(templateId)
    console.log([
      `下一阶段: ${next}`,
      `推荐模板: ${templateId}${template ? ` - ${template.title}` : ''}`,
      `命令: scale vibe --template ${templateId}`,
    ].join('\n'))
  },
})

export const vibeIndexCommand = defineCommand({
  meta: {
    name: 'vibe-index',
    description: '生成 SCALE Vibe Coding 可视化提示词索引',
  },
  args: {
    output: {
      type: 'string',
      alias: 'o',
      description: '输出文件路径',
      default: 'docs/VIBE-TEMPLATES.md',
    },
    app: {
      type: 'string',
      alias: 'a',
      description: '项目或应用名称',
    },
  },
  run({ args }) {
    writeOutput(renderVisualVibeTemplateIndex({ appName: args.app }), args.output)
  },
})

function resolveTemplateId(template: unknown, phase: unknown): string | undefined {
  if (typeof template === 'string' && template.trim()) return template.trim()
  if (typeof phase === 'string' && phase.trim()) {
    return LEGACY_PHASE_TEMPLATE_MAP[phase.trim() as LegacyVibePhase]
  }
  return undefined
}

function writeOutput(content: string, outputPath?: unknown): void {
  if (typeof outputPath === 'string' && outputPath.trim()) {
    const path = outputPath.trim()
    const dir = dirname(path)
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, content, 'utf-8')
    console.log(`[OK] 已生成: ${path}`)
    return
  }
  console.log(content)
}

function renderInteractiveGuide(appName?: unknown): string {
  const app = typeof appName === 'string' && appName.trim() ? appName.trim() : '你的项目'
  return [
    '# SCALE Vibe Coding 交互式引导',
    '',
    `项目: ${app}`,
    '',
    '先选择你当前最需要的入口：',
    '',
    '| 场景 | 推荐命令 | 说明 |',
    '| --- | --- | --- |',
    '| 想法还模糊 | `scale vibe --template product-ceo-discovery` | CEO 先把产品目标和闭环问清楚 |',
    '| 要做 UI/UX | `scale vibe --template ui-ux-design-direction` | UX Director 定义体验、状态和浏览器验证 |',
    '| 要做技术方案 | `scale vibe --template technical-architecture-plan` | CTO 定义架构、模块边界和验证策略 |',
    '| 已经可以开发 | `scale vibe --template implementation-slice` | Engineering Lead 拆最小切片并推动验证 |',
    '| 要公司化多 Agent 协同 | `scale vibe --pack agentic-company-flow` | 角色 SOP、编排、互审、验证和发布闭环 |',
    '| 要长任务自动推进 | `scale vibe --pack long-task-autopilot` | 预算、checkpoint、恢复、互审和 evidence 闭环 |',
    '| 准备发版 | `scale vibe --template verification-release` | QA/Release Lead 收敛证据和风险 |',
    '',
    '建议用法：',
    '',
    '1. 先复制一个模板给 Agent。',
    '2. Agent 必须主动选择相关 skills/MCP/CLI，并先做安全检查。',
    '3. M/L 级任务必须沉淀 Mini-PRD、方案、验证和资源治理证据。',
    '4. 完成后把最终事实写入长期文档，把临时报告归档或删除。',
    '',
  ].join('\n')
}
