// SCALE Engine — P2-A Dashboard capability overview
//
// 面板首屏「能力阶梯 + 数据源就绪」的数据底座：让用户与 agent 一眼看清
// 「装到了哪一档、每类证据面板是否已有数据」，而不是面对空图表猜原因。
// 纯函数：命令探测与文件扫描可注入，便于单测。

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveExternalCommandPath } from '../core/ExternalCommand.js'

export interface CapabilityProbe {
  commandExists: (command: string) => boolean
}

export interface CapabilityTierState {
  level: 1 | 2 | 3
  label: string
  summary: string
  upgradeCommand: string
}

export interface CapabilitySourceState {
  id: string
  label: string
  ready: boolean
  reason: string
  path: string
}

export interface CapabilityOverview {
  tier: CapabilityTierState
  sources: CapabilitySourceState[]
  generatedAt: string
  /** 就绪数据源数 / 总数。 */
  readyRatio: string
}

export interface BuildCapabilityOverviewInput {
  projectDir: string
  scaleDir: string
  probe?: CapabilityProbe
}

function dirHasFiles(dir: string, suffix?: string): boolean {
  if (!existsSync(dir)) return false
  try {
    const entries = readdirSync(dir)
    return suffix ? entries.some(e => e.endsWith(suffix)) : entries.length > 0
  } catch {
    return false
  }
}

export function resolveCapabilityTier(probe: CapabilityProbe): CapabilityTierState {
  const hasExternal = probe.commandExists('rtk') || probe.commandExists('gbrain') || probe.commandExists('graphify')
  const hasGraph = probe.commandExists('codegraph')
  if (hasExternal) {
    return {
      level: 3,
      label: 'Level 3 · extreme（全能力）',
      summary: '外部引擎（rtk/gbrain/graphify）已就绪，满配验证与记忆/知识图谱可用。',
      upgradeCommand: 'scale setup --verify --pack full --dir . --json',
    }
  }
  if (hasGraph) {
    return {
      level: 2,
      label: 'Level 2 · full（本地增强）',
      summary: '本地记忆与代码图谱已就绪；可加外部引擎升到 Level 3。',
      upgradeCommand: 'scale install --pack external-cli --dir .',
    }
  }
  return {
    level: 1,
    label: 'Level 1 · core（核心工作流）',
    summary: '门禁/证据/工作流全部可用，不依赖任何第三方 CLI。',
    upgradeCommand: 'scale install --pack memory,external-cli --dir .',
  }
}

export function buildCapabilityOverview(input: BuildCapabilityOverviewInput): CapabilityOverview {
  const probe = input.probe ?? { commandExists: (cmd: string) => Boolean(resolveExternalCommandPath(cmd)) }
  const scale = input.scaleDir
  const project = input.projectDir
  const evidence = join(scale, 'evidence')

  const sources: CapabilitySourceState[] = [
    {
      id: 'runtime-evidence',
      label: 'Runtime evidence',
      path: join(evidence, 'runtime'),
      ready: dirHasFiles(join(evidence, 'runtime'), '.json'),
      reason: '',
    },
    {
      id: 'command-runs',
      label: 'Command runs',
      path: join(evidence, 'command-runs'),
      ready: dirHasFiles(join(evidence, 'command-runs'), '.json'),
      reason: '',
    },
    {
      id: 'review-evidence',
      label: 'Review evidence (含 P1-A 隔离审查)',
      path: join(scale, 'reviews'),
      ready: dirHasFiles(join(scale, 'reviews'), '.json'),
      reason: '',
    },
    {
      id: 'model-usage',
      label: 'Token & cost',
      path: join(scale, 'model-usage', 'usage.jsonl'),
      ready: existsSync(join(scale, 'model-usage', 'usage.jsonl')),
      reason: '',
    },
    {
      id: 'memory',
      label: 'Memory (gbrain/local)',
      path: join(scale, 'memory', 'brain.sqlite'),
      ready: existsSync(join(scale, 'memory', 'brain.sqlite')),
      reason: '',
    },
    {
      id: 'knowledge',
      label: 'Knowledge base / graph',
      path: join(scale, 'knowledge'),
      ready:
        existsSync(join(project, 'graphify-out', 'graph.json'))
        || dirHasFiles(join(scale, 'knowledge'))
        || existsSync(join(scale, 'knowledge.db')),
      reason: '',
    },
    {
      id: 'golden-evals',
      label: 'Golden eval suite (P1-D)',
      path: join(project, 'evals', 'golden'),
      ready: dirHasFiles(join(project, 'evals', 'golden'), '.json'),
      reason: '',
    },
  ].map(source => ({
    ...source,
    reason: source.ready
      ? `ready: ${source.path}`
      : `no data yet at ${source.path} (produces after the corresponding workflow step runs)`,
  }))

  const readyCount = sources.filter(s => s.ready).length
  return {
    tier: resolveCapabilityTier(probe),
    sources,
    generatedAt: new Date().toISOString(),
    readyRatio: `${readyCount}/${sources.length}`,
  }
}
