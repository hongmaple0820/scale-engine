// SCALE Engine — Meta-Governance Gates (G9-G15)
// 检查治理能力是否被有效使用，而非仅检查代码质量

import type { GateResult, GateStage, GateEvidence } from '../types.js'
import type { IGate } from './GateSystem.js'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

type RequiredLevel = 'S' | 'M' | 'L' | 'ALWAYS' | 'CRITICAL'

function createEvidence(input: Omit<GateEvidence, 'id'>): GateEvidence {
  return {
    id: `EVID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  }
}

function textEvidence(items: GateEvidence[]): string {
  return items.map(item => `${item.label}: ${item.detail}`).join('\n')
}

function existingPaths(paths: string[]): string[] {
  return paths.filter(path => existsSync(path))
}

function directoryHasFiles(path: string): boolean {
  try {
    return existsSync(path) && readdirSync(path).length > 0
  } catch {
    return false
  }
}

function listFiles(dir: string, recursive = false): string[] {
  if (!existsSync(dir)) return []
  try {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (recursive) files.push(...listFiles(path, true))
      } else if (entry.isFile()) {
        files.push(path)
      }
    }
    return files
  } catch {
    return []
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function countJsonlRecords(path: string, predicate: (record: Record<string, unknown>) => boolean): number {
  if (!existsSync(path)) return 0
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .reduce((count, line) => {
        try {
          const parsed = JSON.parse(line) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && predicate(parsed as Record<string, unknown>)) {
            return count + 1
          }
        } catch {
          return count
        }
        return count
      }, 0)
  } catch {
    return 0
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function hasOpenStatus(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return (value as { status?: unknown }).status === 'open'
}

function evaluateCurrentKnowledgeUtilization(scaleDir: string): GateResult | null {
  const evidenceItems: GateEvidence[] = []
  let passed = true
  const knowledgeStores = existingPaths([
    join(scaleDir, 'knowledge.db'),
    join(scaleDir, 'memory', 'brain.sqlite'),
    join(scaleDir, 'memory', 'brain-manifest.json'),
  ])
  if (knowledgeStores.length === 0) {
    evidenceItems.push(createEvidence({ kind: 'manual', label: 'Knowledge Base', passed: false, detail: 'No knowledge or memory store found.' }))
    passed = false
  } else {
    evidenceItems.push(createEvidence({
      kind: 'manual',
      label: 'Knowledge Base',
      passed: true,
      detail: `Knowledge store(s): ${knowledgeStores.join(', ')}`,
    }))
  }

  const artifactsDir = join(scaleDir, 'artifacts')
  let legacyLessons = 0
  let legacyDefects = 0
  for (const path of listFiles(artifactsDir).filter(file => file.endsWith('.json'))) {
    const content = readJsonObject(path)
    if (content?.type === 'Lesson') legacyLessons++
    if (content?.type === 'Defect') legacyDefects++
  }
  const instinctFiles = listFiles(join(scaleDir, 'instincts'), true)
    .filter(path => !path.endsWith('.audit.jsonl') && /\.(ya?ml|json)$/i.test(path))
  const appliedInstincts = countJsonlRecords(join(scaleDir, 'instincts', '.audit.jsonl'), record => record.op === 'apply')
  const learningSignals = legacyLessons + instinctFiles.length + appliedInstincts
  if (learningSignals === 0) {
    evidenceItems.push(createEvidence({ kind: 'manual', label: 'Lesson Extraction', passed: false, detail: 'No Lesson artifacts, instincts, or applied learning audit records found.' }))
    passed = false
  } else {
    evidenceItems.push(createEvidence({
      kind: 'manual',
      label: 'Lesson Extraction',
      passed: true,
      detail: `${learningSignals} learning signal(s): legacyLessons=${legacyLessons}, instincts=${instinctFiles.length}, appliedInstincts=${appliedInstincts}`,
    }))
  }

  if (legacyDefects > 0) {
    const hasLearning = learningSignals > 0
    evidenceItems.push(createEvidence({
      kind: 'manual',
      label: 'Defect-Lesson Ratio',
      passed: hasLearning,
      detail: hasLearning
        ? `${legacyDefects} Defect artifact(s) have learning signal coverage.`
        : `${legacyDefects} Defect artifact(s) without Lesson or learning signal coverage.`,
    }))
    if (!hasLearning) passed = false
  }

  return {
    gate: 'G9',
    status: passed ? 'PASSED' : 'FAILED',
    passed,
    evidence: textEvidence(evidenceItems),
    evidenceItems,
    blockers: passed ? [] : ['知识库未有效使用，经验未沉淀'],
    durationMs: 0,
  }
}

// ============================================================================
// G9: Knowledge Utilization — 知识库是否被有效使用
// ============================================================================
interface WorkflowPhaseEvidence {
  passed: boolean
  detail: string
}

function evaluateCurrentWorkflowThoroughness(scaleDir: string): GateResult | null {
  const evidenceItems: GateEvidence[] = []
  let passed = true
  const state = readJsonObject(join(scaleDir, 'state', 'current.json')) ?? {}
  const artifactsDirValue = typeof state.artifactsDir === 'string' ? state.artifactsDir : undefined
  const taskArtifactsDir = artifactsDirValue ? join(scaleDir, '..', artifactsDirValue) : undefined
  const completedGates = stringArray(state.completedGates)
  const filesModified = stringArray(state.filesModified)
  const phaseEvidence: Record<string, WorkflowPhaseEvidence> = {
    explore: hasAny([
      join(scaleDir, 'phases', '.phase-explore'),
      join(scaleDir, 'state', 'explore.json'),
      taskArtifactsDir ? join(taskArtifactsDir, 'explore.md') : '',
    ]),
    plan: hasAny([
      join(scaleDir, 'phases', '.phase-plan'),
      taskArtifactsDir ? join(taskArtifactsDir, 'plan.md') : '',
    ], [
      listFiles(join(scaleDir, 'plans')).filter(file => file.endsWith('.md')).length,
      listFiles(join(scaleDir, 'state')).filter(file => /plan-.*\.json$/.test(file)).length,
      typeof state.lastPlanId === 'string' ? 1 : 0,
    ]),
    verify: hasAny([
      join(scaleDir, 'phases', '.phase-verify'),
      taskArtifactsDir ? join(taskArtifactsDir, 'verification.md') : '',
    ], [
      listFiles(join(scaleDir, 'evidence')).filter(file => file.endsWith('.json')).length,
      completedGates.length,
    ]),
    review: hasAny([
      join(scaleDir, 'phases', '.phase-review'),
      taskArtifactsDir ? join(taskArtifactsDir, 'review.md') : '',
    ], [
      listFiles(join(scaleDir, 'reviews')).filter(file => file.endsWith('.json')).length,
    ]),
  }

  for (const [phase, evidence] of Object.entries(phaseEvidence)) {
    evidenceItems.push(createEvidence({
      kind: 'manual',
      label: `Phase: ${phase}`,
      passed: evidence.passed,
      detail: evidence.detail,
    }))
    if (!evidence.passed) passed = false
  }

  const artifactCoverage: Record<string, boolean> = {
    Need: Boolean(taskArtifactsDir && existsSync(join(taskArtifactsDir, 'mini-prd.md'))),
    Spec: listFiles(join(scaleDir, 'specs')).some(file => file.endsWith('.md')) || typeof state.lastSpecId === 'string',
    Plan: listFiles(join(scaleDir, 'plans')).some(file => file.endsWith('.md')) || typeof state.lastPlanId === 'string',
    Task: typeof state.lastTaskId === 'string' || listFiles(join(scaleDir, 'metrics')).some(file => file.endsWith('tasks.jsonl')),
    Change: filesModified.length > 0,
    Evidence: listFiles(join(scaleDir, 'evidence')).some(file => file.endsWith('.json')),
  }
  const missingTypes = Object.entries(artifactCoverage)
    .filter(([, present]) => !present)
    .map(([type]) => type)
  if (missingTypes.length > 0) {
    evidenceItems.push(createEvidence({
      kind: 'manual',
      label: 'Artifact Coverage',
      passed: false,
      detail: `Missing artifact evidence types: ${missingTypes.join(', ')}`,
    }))
    passed = false
  } else {
    evidenceItems.push(createEvidence({
      kind: 'manual',
      label: 'Artifact Coverage',
      passed: true,
      detail: 'Need, Spec, Plan, Task, Change, and Evidence are covered by current workflow evidence.',
    }))
  }

  return {
    gate: 'G12',
    status: passed ? 'PASSED' : 'FAILED',
    passed,
    evidence: textEvidence(evidenceItems),
    evidenceItems,
    blockers: passed ? [] : ['工作流执行不完整'],
    durationMs: 0,
  }
}

function hasAny(paths: string[], counts: number[] = []): WorkflowPhaseEvidence {
  const existing = existingPaths(paths.filter(Boolean))
  const count = counts.reduce((sum, value) => sum + value, 0)
  if (existing.length > 0 || count > 0) {
    return {
      passed: true,
      detail: [...existing, ...(count > 0 ? [`${count} counted evidence item(s)`] : [])].join(', '),
    }
  }
  return { passed: false, detail: 'No current workflow evidence found.' }
}

export class KnowledgeUtilizationGate implements IGate {
  stage = 'G9' as GateStage
  name = 'Knowledge Utilization'
  description = 'Checks whether the knowledge base is actively used and lessons are extracted'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    let passed = true
    const currentEvidenceResult = evaluateCurrentKnowledgeUtilization(this.scaleDir)
    if (currentEvidenceResult) return currentEvidenceResult

    // 检查1: 知识库是否存在
    const kbPath = join(this.scaleDir, 'knowledge.db')
    if (!existsSync(kbPath)) {
      evidenceItems.push(createEvidence({ kind: 'manual', label: 'Knowledge Base', passed: false, detail: '知识库不存在，无法沉淀经验' }))
      passed = false
    } else {
      evidenceItems.push(createEvidence({ kind: 'manual', label: 'Knowledge Base', passed: true, detail: '知识库已创建' }))
    }

    // 检查2: 是否有 Lesson 产出
    const artifactsDir = join(this.scaleDir, 'artifacts')
    if (existsSync(artifactsDir)) {
      const files = readdirSync(artifactsDir).filter(f => f.endsWith('.json'))
      const lessons = files.filter(f => {
        try {
          const content = JSON.parse(readFileSync(join(artifactsDir, f), 'utf-8'))
          return content.type === 'Lesson'
        } catch { return false }
      })

      if (lessons.length === 0) {
        evidenceItems.push(createEvidence({ kind: 'manual', label: 'Lesson Extraction', passed: false, detail: '未提取任何 Lesson，经验未沉淀' }))
        passed = false
      } else {
        evidenceItems.push(createEvidence({ kind: 'manual', label: 'Lesson Extraction', passed: true, detail: `已提取 ${lessons.length} 个 Lesson` }))
      }

      // 检查3: Defect 是否有对应的 Lesson
      const defects = files.filter(f => {
        try {
          const content = JSON.parse(readFileSync(join(artifactsDir, f), 'utf-8'))
          return content.type === 'Defect'
        } catch { return false }
      })

      if (defects.length > 0 && lessons.length === 0) {
        evidenceItems.push(createEvidence({ kind: 'manual', label: 'Defect-Lesson Ratio', passed: false, detail: `有 ${defects.length} 个 Defect 但无 Lesson，未从错误中学习` }))
        passed = false
      }
    }

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: passed ? [] : ['知识库未有效使用，经验未沉淀'],
      durationMs: 0
    }
  }
}

// ============================================================================
// G10: Evolution Effectiveness — 进化机制是否生效
// ============================================================================
export class EvolutionEffectivenessGate implements IGate {
  stage = 'G10' as GateStage
  name = 'Evolution Effectiveness'
  description = 'Checks whether repeated defects trigger rule proposals and hook generation'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    let passed = true

    // 检查1: 是否有重复 Defect（应触发 Lesson 提取）
    const artifactsDir = join(this.scaleDir, 'artifacts')
    if (existsSync(artifactsDir)) {
      const files = readdirSync(artifactsDir).filter(f => f.endsWith('.json'))
      const defects: Record<string, number> = {}

      for (const f of files) {
        try {
          const content = JSON.parse(readFileSync(join(artifactsDir, f), 'utf-8'))
          if (content.type === 'Defect' && content.payload?.rootCauseCategory) {
            const cause = content.payload.rootCauseCategory
            defects[cause] = (defects[cause] || 0) + 1
          }
        } catch {
          continue
        }
      }

      // 检查2: 重复 Defect 是否触发了规则提议
      const repeatedCauses = Object.entries(defects).filter(([_, count]) => count >= 3)
      if (repeatedCauses.length > 0) {
        evidenceItems.push(createEvidence({
          kind: 'manual',
          label: 'Repeated Defects',
          passed: false,
          detail: `发现 ${repeatedCauses.length} 类重复 Defect (≥3次)，应触发 Rule 提议`
        }))
        passed = false
      }

      // 检查3: 是否有 Rule 产出
      const rulesPath = join(this.scaleDir, 'rules')
      if (existsSync(rulesPath)) {
        const rules = readdirSync(rulesPath).filter(f => f.endsWith('.json'))
        if (rules.length === 0 && repeatedCauses.length > 0) {
          evidenceItems.push(createEvidence({ kind: 'manual', label: 'Rule Generation', passed: false, detail: '有重复 Defect 但未生成 Rule' }))
          passed = false
        } else if (rules.length > 0) {
          evidenceItems.push(createEvidence({ kind: 'manual', label: 'Rule Generation', passed: true, detail: `已生成 ${rules.length} 个 Rule` }))
        }
      }
    }

    // 检查4: 是否有 Hook 从 Rule 生成
    const hooksDir = join(this.scaleDir, 'hooks')
    if (existsSync(hooksDir)) {
      const hooks = readdirSync(hooksDir).filter(f => f.endsWith('.js') || f.endsWith('.sh'))
      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Hook Generation',
        passed: hooks.length > 0,
        detail: hooks.length > 0 ? `已生成 ${hooks.length} 个 Hook` : '未生成任何 Hook'
      }))
    }

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: passed ? [] : ['进化机制未生效，未从重复错误中学习'],
      durationMs: 0
    }
  }
}

// ============================================================================
// G11: Guardrail Effectiveness — 护栏是否有效运行
// ============================================================================
export class GuardrailEffectivenessGate implements IGate {
  stage = 'G11' as GateStage
  name = 'Guardrail Effectiveness'
  description = 'Checks whether detectors are configured, triggered, and blocking invalid transitions'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    let passed = true

    // Check 1: guardrail configuration is installed on one of the supported surfaces.
    const configPaths = existingPaths([
      join(this.scaleDir, 'settings.json'),
      join(this.scaleDir, 'policy.yaml'),
      join(this.scaleDir, 'config.yaml'),
      join(this.scaleDir, '..', '.claude', 'settings.json'),
    ])
    const hookDirs = [
      join(this.scaleDir, 'hooks'),
      join(this.scaleDir, '..', '.claude', 'hooks'),
      join(this.scaleDir, '..', 'scripts', 'hooks'),
    ].filter(directoryHasFiles)
    if (configPaths.length === 0 && hookDirs.length === 0) {
      evidenceItems.push(createEvidence({ kind: 'manual', label: 'Detector Config', passed: false, detail: 'No guardrail config or hook directory found' }))
      passed = false
    } else {
      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Detector Config',
        passed: true,
        detail: [...configPaths, ...hookDirs].join(', '),
      }))
    }

    // 检查2: 是否有检测器触发记录
    const eventsDir = join(this.scaleDir, 'events')
    if (existsSync(eventsDir)) {
      const eventFiles = readdirSync(eventsDir).filter(f => f.endsWith('.jsonl'))
      let detectorTriggers = 0

      for (const f of eventFiles) {
        try {
          const content = readFileSync(join(eventsDir, f), 'utf-8')
          const lines = content.split('\n').filter(l => l.trim())
          for (const line of lines) {
            const event = JSON.parse(line)
            if (event.type?.includes('detector') || event.type?.includes('guard')) {
              detectorTriggers++
            }
          }
        } catch {
          continue
        }
      }

      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Detector Activity',
        passed: true,
        detail: `检测器触发 ${detectorTriggers} 次`
      }))

      // 检查3: 是否有被阻断的转换
      let blockedTransitions = 0
      for (const f of readdirSync(eventsDir).filter(f => f.endsWith('.jsonl'))) {
        try {
          const content = readFileSync(join(eventsDir, f), 'utf-8')
          const lines = content.split('\n').filter(l => l.trim())
          for (const line of lines) {
            const event = JSON.parse(line)
            if (event.type === 'artifact.transitioned' && event.payload?.blockedBy) {
              blockedTransitions++
            }
          }
        } catch {
          continue
        }
      }

      if (blockedTransitions > 0) {
        evidenceItems.push(createEvidence({
          kind: 'manual',
          label: 'Blocked Transitions',
          passed: true,
          detail: `有 ${blockedTransitions} 次转换被护栏阻断`
        }))
      }
    }

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: passed ? [] : ['护栏配置不完整'],
      durationMs: 0
    }
  }
}

// ============================================================================
// G12: Workflow Thoroughness — 工作流是否完整执行
// ============================================================================
export class WorkflowThoroughnessGate implements IGate {
  stage = 'G12' as GateStage
  name = 'Workflow Thoroughness'
  description = 'Checks whether all workflow phases are completed and artifacts produced'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    let passed = true
    const currentEvidenceResult = evaluateCurrentWorkflowThoroughness(this.scaleDir)
    if (currentEvidenceResult) return currentEvidenceResult

    // 检查1: 各阶段是否有产出物
    const phases = ['explore', 'plan', 'verify', 'review']
    const phaseDir = join(this.scaleDir, 'phases')

    for (const phase of phases) {
      const phaseFile = join(phaseDir, `.phase-${phase}`)
      const exists = existsSync(phaseFile)
      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: `Phase: ${phase}`,
        passed: exists,
        detail: exists ? '已完成' : '未完成'
      }))
      if (!exists) passed = false
    }

    // 检查2: 是否有 Artifact 产出
    const artifactsDir = join(this.scaleDir, 'artifacts')
    if (existsSync(artifactsDir)) {
      const artifacts = readdirSync(artifactsDir).filter(f => f.endsWith('.json'))
      const types = new Set<string>()
      for (const f of artifacts) {
        try {
          const content = JSON.parse(readFileSync(join(artifactsDir, f), 'utf-8'))
          types.add(content.type)
        } catch {
          continue
        }
      }

      const expectedTypes = ['Need', 'Spec', 'Plan', 'Task', 'Change', 'Evidence']
      const missingTypes = expectedTypes.filter(t => !types.has(t))

      if (missingTypes.length > 0) {
        evidenceItems.push(createEvidence({
          kind: 'manual',
          label: 'Artifact Coverage',
          passed: false,
          detail: `缺少以下 Artifact 类型: ${missingTypes.join(', ')}`
        }))
        passed = false
      } else {
        evidenceItems.push(createEvidence({
          kind: 'manual',
          label: 'Artifact Coverage',
          passed: true,
          detail: '所有核心 Artifact 类型已覆盖'
        }))
      }
    }

    // 检查3: 是否有验证证据
    const evidenceDir = join(this.scaleDir, 'evidence')
    if (existsSync(evidenceDir)) {
      const evidenceFiles = readdirSync(evidenceDir).filter(f => f.endsWith('.json'))
      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Verification Evidence',
        passed: evidenceFiles.length > 0,
        detail: evidenceFiles.length > 0 ? `有 ${evidenceFiles.length} 份验证证据` : '无验证证据'
      }))
    }

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: passed ? [] : ['工作流执行不完整'],
      durationMs: 0
    }
  }
}

// ============================================================================
// G13: Multi-Agent Coordination — 多 Agent 协同是否有效
// ============================================================================
export class MultiAgentCoordinationGate implements IGate {
  stage = 'G13' as GateStage
  name = 'Multi-Agent Coordination'
  description = 'Checks whether multi-agent configuration, communication, and task assignment are effective'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    const blockers: string[] = []

    // 检查1: Agent 配置是否存在
    const agentsDir = join(this.scaleDir, 'agents')
    if (!existsSync(agentsDir)) {
      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Agent Config',
        passed: false,
        detail: '未配置多 Agent，无法协同'
      }))
      // 单 Agent 项目可以跳过
      return {
        gate: this.stage,
        status: 'PASSED',
        passed: true,
        evidence: '单 Agent 模式，跳过协同检查',
        evidenceItems,
        blockers: [],
        durationMs: 0
      }
    }

    // 检查2: Coordinator state (SessionCoordinator integration)
    const coordinatorPath = join(this.scaleDir, 'coordinator', 'state.json')
    if (existsSync(coordinatorPath)) {
      try {
        const state = JSON.parse(readFileSync(coordinatorPath, 'utf-8'))
        const activeSessions = state.activeSessions?.length ?? 0
        const overlaps = state.overlaps?.length ?? 0
        const conflicts = Array.isArray(state.conflicts) ? state.conflicts : []
        const openConflicts = conflicts.filter(hasOpenStatus).length

        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Coordinator State',
          passed: openConflicts === 0,
          detail: `Sessions: ${activeSessions}, Overlaps: ${overlaps}, Open conflicts: ${openConflicts}`,
        }))

        if (openConflicts > 0) {
          blockers.push(`${openConflicts} open conflict(s) in session coordinator`)
        }
      } catch {
        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Coordinator State',
          passed: false,
          detail: 'Could not parse coordinator state',
        }))
      }
    } else {
      evidenceItems.push(createEvidence({
        kind: 'file',
        label: 'Coordinator State',
        passed: false,
        detail: 'No coordinator state — multi-agent without coordination evidence',
      }))
      blockers.push('Multi-agent mode active but no SessionCoordinator state found')
    }

    // 检查3: Agent 间通信记录
    const eventsDir = join(this.scaleDir, 'events')
    if (existsSync(eventsDir)) {
      let agentEvents = 0
      for (const f of readdirSync(eventsDir).filter(f => f.endsWith('.jsonl'))) {
        try {
          const content = readFileSync(join(eventsDir, f), 'utf-8')
          const lines = content.split('\n').filter(l => l.trim())
          for (const line of lines) {
            const event = JSON.parse(line)
            if (event.type?.includes('agent') || event.payload?.agent) {
              agentEvents++
            }
          }
        } catch {
          continue
        }
      }

      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Agent Communication',
        passed: agentEvents > 0,
        detail: agentEvents > 0 ? `有 ${agentEvents} 次 Agent 间交互` : '无 Agent 间交互记录'
      }))
    }

    // 检查4: 任务是否被合理分配
    const artifactsDir = join(this.scaleDir, 'artifacts')
    if (existsSync(artifactsDir)) {
      const tasks = readdirSync(artifactsDir).filter(f => f.endsWith('.json')).filter(f => {
        try {
          const content = JSON.parse(readFileSync(join(artifactsDir, f), 'utf-8'))
          return content.type === 'Task'
        } catch { return false }
      })

      if (tasks.length > 0) {
        let assignedCount = 0
        for (const f of tasks) {
          try {
            const content = JSON.parse(readFileSync(join(artifactsDir, f), 'utf-8'))
            if (content.payload?.assignedTo) assignedCount++
          } catch {
            continue
          }
        }

        evidenceItems.push(createEvidence({
          kind: 'manual',
          label: 'Task Assignment',
          passed: assignedCount > 0,
          detail: assignedCount > 0 ? `${assignedCount}/${tasks.length} 任务已分配` : '任务未分配给具体 Agent'
        }))
      }
    }

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0
    }
  }
}

// ============================================================================
// G14: Skill Utilization — 技能是否被合理使用
// ============================================================================
export class SkillUtilizationGate implements IGate {
  stage = 'G14' as GateStage
  name = 'Skill Utilization'
  description = 'Checks whether skill routing is configured and skills are being executed'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    let passed = true

    // 检查1: 技能路由策略是否存在
    const skillsPath = join(this.scaleDir, 'skills.json')
    if (!existsSync(skillsPath)) {
      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Skill Routing',
        passed: false,
        detail: '未配置技能路由策略'
      }))
      passed = false
    } else {
      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Skill Routing',
        passed: true,
        detail: '技能路由策略已配置'
      }))
    }

    // 检查2: 是否有技能执行记录
    const eventsDir = join(this.scaleDir, 'events')
    if (existsSync(eventsDir)) {
      let skillEvents = 0
      for (const f of readdirSync(eventsDir).filter(f => f.endsWith('.jsonl'))) {
        try {
          const content = readFileSync(join(eventsDir, f), 'utf-8')
          const lines = content.split('\n').filter(l => l.trim())
          for (const line of lines) {
            const event = JSON.parse(line)
            if (event.type?.includes('skill')) {
              skillEvents++
            }
          }
        } catch {
          continue
        }
      }

      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Skill Execution',
        passed: skillEvents > 0,
        detail: skillEvents > 0 ? `技能执行 ${skillEvents} 次` : '无技能执行记录'
      }))
    }

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: passed ? [] : ['技能系统未有效使用'],
      durationMs: 0
    }
  }
}

// ============================================================================
// G15: Self-Improvement — 系统是否在自我改进
// ============================================================================
export class SelfImprovementGate implements IGate {
  stage = 'G15' as GateStage
  name = 'Self-Improvement'
  description = 'Checks defect trends, lesson conversion rate, and active rules'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    let passed = true

    // 检查1: 是否有重复错误被修复
    const artifactsDir = join(this.scaleDir, 'artifacts')
    if (existsSync(artifactsDir)) {
      const files = readdirSync(artifactsDir).filter(f => f.endsWith('.json'))

      // 统计 Defect 趋势
      const defectsByTime: number[] = []
      const lessonsByTime: number[] = []

      for (const f of files) {
        try {
          const content = JSON.parse(readFileSync(join(artifactsDir, f), 'utf-8'))
          if (content.type === 'Defect') {
            defectsByTime.push(content.createdAt || 0)
          }
          if (content.type === 'Lesson') {
            lessonsByTime.push(content.createdAt || 0)
          }
        } catch {
          continue
        }
      }

      // 检查2: Defect 是否在减少
      if (defectsByTime.length >= 4) {
        const mid = Math.floor(defectsByTime.length / 2)
        const firstHalf = defectsByTime.slice(0, mid).length
        const secondHalf = defectsByTime.slice(mid).length

        if (secondHalf > firstHalf) {
          evidenceItems.push(createEvidence({
            kind: 'manual',
            label: 'Defect Trend',
            passed: false,
            detail: `Defect 数量在增加 (${firstHalf} → ${secondHalf})，未有效改进`
          }))
          passed = false
        } else {
          evidenceItems.push(createEvidence({
            kind: 'manual',
            label: 'Defect Trend',
            passed: true,
            detail: `Defect 数量在减少 (${firstHalf} → ${secondHalf})`
          }))
        }
      }

      // 检查3: Lesson 转化率
      if (defectsByTime.length > 0) {
        const conversionRate = lessonsByTime.length / defectsByTime.length
        evidenceItems.push(createEvidence({
          kind: 'manual',
          label: 'Lesson Conversion',
          passed: conversionRate >= 0.3,
          detail: `Defect → Lesson 转化率: ${(conversionRate * 100).toFixed(0)}% (目标: ≥30%)`
        }))
        if (conversionRate < 0.3) passed = false
      }
    }

    // 检查4: 是否有 Rule 被验证生效
    const rulesDir = join(this.scaleDir, 'rules')
    if (existsSync(rulesDir)) {
      const rules = readdirSync(rulesDir).filter(f => f.endsWith('.json'))
      let activeRules = 0
      for (const f of rules) {
        try {
          const content = JSON.parse(readFileSync(join(rulesDir, f), 'utf-8'))
          if (content.status === 'active' || content.verified) activeRules++
        } catch {
          continue
        }
      }

      evidenceItems.push(createEvidence({
        kind: 'manual',
        label: 'Active Rules',
        passed: activeRules > 0,
        detail: activeRules > 0 ? `有 ${activeRules} 个活跃 Rule` : '无活跃 Rule'
      }))
    }

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: passed ? [] : ['系统未有效自我改进'],
      durationMs: 0
    }
  }
}

// ============================================================================
// 注册所有元治理门禁
// ============================================================================
export function registerMetaGovernanceGates(gateSystem: { registerGate(gate: IGate): void }, scaleDir: string = '.scale'): void {
  gateSystem.registerGate(new KnowledgeUtilizationGate(scaleDir))
  gateSystem.registerGate(new EvolutionEffectivenessGate(scaleDir))
  gateSystem.registerGate(new GuardrailEffectivenessGate(scaleDir))
  gateSystem.registerGate(new WorkflowThoroughnessGate(scaleDir))
  gateSystem.registerGate(new MultiAgentCoordinationGate(scaleDir))
  gateSystem.registerGate(new SkillUtilizationGate(scaleDir))
  gateSystem.registerGate(new SelfImprovementGate(scaleDir))
}
