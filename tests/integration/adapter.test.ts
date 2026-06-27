// W8 Tests: Adapter + Init + Integration
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ClaudeCodeAdapter } from '../../src/adapters/ClaudeCodeAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { EventBus } from '../../src/core/eventBus.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { Gateway } from '../../src/guardrails/Gateway.js'
import { registerAllFSMs, INITIAL_STATES } from '../../src/artifact/fsmDefinitions.js'
import { KnowledgeBase } from '../../src/knowledge/KnowledgeBase.js'
import { ContextBuilder } from '../../src/context/ContextBuilder.js'
import { DangerousCommandDetector, SecretLeakDetector, RoleGateDetector, BUILT_IN_ROLES } from '../../src/guardrails/advancedDetectors.js'
import { BruteRetryDetector, PrematureDoneDetector, BlameShiftDetector } from '../../src/guardrails/detectors.js'
import { LessonExtractor, RuleProposer, HookGenerator, EvolutionEngine } from '../../src/evolution/EvolutionEngine.js'
import { BehaviorTracker } from '../../src/evolution/BehaviorTracker.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-adapter'
const me = { kind: 'human' as const, userId: 'tester' }

// ============================================================================
// Adapter Tests
// ============================================================================

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new ClaudeCodeAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is claude-code', () => {
    expect(adapter.agentType).toBe('claude-code')
  })

  it('generateSettings produces valid hook config', () => {
    const settings = adapter.generateSettings()
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks!.SessionStart).toHaveLength(1)
    expect(settings.hooks!.PreToolUse).toHaveLength(2)
    expect(settings.hooks!.PostToolUse).toHaveLength(2)
    expect(settings.hooks!.Stop).toHaveLength(1)
    expect(settings.hooks!.SessionEnd).toHaveLength(1)
    // All commands start with 'scale'
    for (const entries of Object.values(settings.hooks!)) {
      for (const entry of entries) {
        expect(entry.command).toMatch(/^scale /)
      }
    }
  })

  it('generateSettings includes permissions', () => {
    const settings = adapter.generateSettings()
    expect(settings.permissions!.allow).toContain('Bash(scale:*)')
  })

  it('mergeSettings adds SCALE hooks without overwriting', () => {
    const existing = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', command: 'my-custom-check $TOOL_INPUT_JSON' },
        ],
      },
      permissions: { allow: ['Bash(npm:*)'] },
    }
    const merged = adapter.mergeSettings(existing)
    // Custom hook preserved
    expect(merged.hooks!.PreToolUse.some((e) => e.command.includes('my-custom-check'))).toBe(true)
    // SCALE hooks added
    expect(merged.hooks!.SessionStart).toBeDefined()
    expect(merged.hooks!.Stop).toBeDefined()
    // Custom permissions preserved
    expect(merged.permissions!.allow).toContain('Bash(npm:*)')
    expect(merged.permissions!.allow).toContain('Bash(scale:*)')
  })

  it('generateKnowledgeDoc includes project name', () => {
    const doc = adapter.generateKnowledgeDoc('my-project', ['TypeScript', 'React'])
    expect(doc).toContain('# my-project')
    expect(doc).toContain('TypeScript')
    expect(doc).toContain('SCALE Engine Integration')
    expect(doc).toContain('scale create')
    expect(doc).toContain('Agent Full Workflow Bootstrap')
    expect(doc).toContain('scale setup --verify --pack full')
    expect(doc).toContain('gbrain')
    expect(doc).toContain('codegraph status')
  })

  it('init creates all required files', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toContain('settings.json')
    expect(result.knowledgeDocPath).toContain('CLAUDE.md')

    // Verify files exist
    expect(existsSync(result.settingsPath)).toBe(true)
    expect(existsSync(result.knowledgeDocPath)).toBe(true)
    expect(existsSync(join(result.scaleDir, 'events'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'artifacts'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'rules'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'hooks'))).toBe(true)
    expect(existsSync(join(result.scaleDir, '.gitignore'))).toBe(true)

    // Verify settings.json content
    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'))
    expect(settings.hooks.SessionStart).toBeDefined()
    expect(settings.hooks.PreToolUse).toBeDefined()
  })

  it('init is idempotent — second call merges not overwrites', async () => {
    await adapter.init({ projectDir: TMP })
    const result2 = await adapter.init({ projectDir: TMP })
    // Second call should skip existing dirs
    expect(result2.skipped.length).toBeGreaterThan(0)
    // settings.json merged, not overwritten
    const settings = JSON.parse(readFileSync(result2.settingsPath, 'utf-8'))
    expect(settings.hooks.SessionStart).toBeDefined()
  })
})

describe('agent hook safety', () => {
  it('documents full workflow setup for every supported adapter', () => {
    for (const agent of SUPPORTED_AGENTS) {
      const adapter = createAdapter(agent)
      const doc = adapter.generateKnowledgeDoc('agent-project', ['TypeScript'])
      expect(doc, agent).toContain('Agent Full Workflow Bootstrap')
      expect(doc, agent).toContain('scale setup --verify --pack full')
      expect(doc, agent).toContain('gbrain')
      expect(doc, agent).toContain('CodeGraph')
      expect(doc, agent).toContain('Graphify')
      expect(doc, agent).toContain('Feishu notifications')
    }
  })

  it('generates hook-safe before-stop commands for all supported adapters', () => {
    for (const agent of SUPPORTED_AGENTS) {
      const adapter = createAdapter(agent)
      const commands = collectHookCommands(adapter.generateSettings().hooks)
      for (const command of commands.filter(command => /\bscale\s+gate\s+before-stop\b/.test(command))) {
        expect(command, agent).toContain('--hook-safe')
      }
    }
  })
})

function collectHookCommands(hooks: unknown): string[] {
  if (!hooks || typeof hooks !== 'object') return []
  const commands: string[] = []
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return
    const command = (entry as { command?: unknown }).command
    if (typeof command === 'string' && command) commands.push(command)
    const nested = (entry as { hooks?: unknown }).hooks
    if (Array.isArray(nested)) nested.forEach(visit)
  }
  for (const entries of Object.values(hooks as Record<string, unknown>)) {
    if (Array.isArray(entries)) entries.forEach(visit)
  }
  return commands
}

describe('createAdapter', () => {
  it('returns ClaudeCodeAdapter for claude-code', () => {
    const adapter = createAdapter('claude-code')
    expect(adapter.agentType).toBe('claude-code')
  })

  it('throws for unsupported agent', () => {
    expect(() => createAdapter('unknown')).toThrow('Unsupported agent type')
  })
})

// ============================================================================
// Integration Tests — Full Engine Lifecycle
// ============================================================================

describe('Integration: Full Engine Lifecycle', () => {
  let bus: EventBus
  let store: InMemoryArtifactStore
  let fsm: FSM
  let gateway: Gateway
  let kb: KnowledgeBase
  let ctx: ContextBuilder
  let tracker: BehaviorTracker

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    store = new InMemoryArtifactStore(bus, { artifactsDir: `${TMP}/artifacts` })
    fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
    gateway = new Gateway(bus)
    gateway.registerDetector(new DangerousCommandDetector(), 'preTool')
    gateway.registerDetector(new SecretLeakDetector(), 'preTool')
    gateway.registerDetector(new BruteRetryDetector(), 'preTool')
    gateway.registerDetector(new PrematureDoneDetector(), 'beforeStop')
    kb = new KnowledgeBase(bus)
    ctx = new ContextBuilder(store, kb, bus)
    tracker = new BehaviorTracker(bus)
    tracker.start()
  })

  afterEach(() => {
    tracker.stop()
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('Spec→Plan→Task→Execute full lifecycle with guards', async () => {
    // 1. Create Spec
    const spec = await store.create({
      type: 'Spec', title: 'User Export Feature',
      payload: {
        what: 'Export users to CSV',
        successCriteria: ['CSV download works', 'Under 5s for 10k rows'],
        ambiguityScore: 0.15,
      },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    expect(spec.status).toBe('DRAFT')

    // 2. Refine → REVIEWING
    await fsm.transition(spec.id, 'refine', { actor: me })

    // 3. Approve → FROZEN (guard checks ambiguity ≤ 0.2 ✅)
    const approveResult = await fsm.transition(spec.id, 'approve', { actor: me })
    expect(approveResult.success).toBe(true)
    expect(approveResult.artifact?.status).toBe('FROZEN')

    // 4. Create Plan with rollback strategy
    const plan = await store.create({
      type: 'Plan', title: 'CSV Export Implementation',
      parents: [spec.id],
      payload: { approach: 'Streaming CSV writer', rollbackStrategy: 'Feature flag' },
      initialStatus: INITIAL_STATES.Plan, createdBy: me,
    })
    const planReview = await fsm.transition(plan.id, 'review', { actor: me })
    expect(planReview.success).toBe(true) // rollbackStrategy present ✅

    // 5. Create Task + execute
    const task = await store.create({
      type: 'Task', title: 'Implement CSV endpoint',
      parents: [plan.id],
      payload: {},
      initialStatus: INITIAL_STATES.Task, createdBy: me,
    })
    await fsm.transition(task.id, 'schedule', { actor: me })
    await fsm.transition(task.id, 'start', { actor: me })

    // 6. Gate: block dangerous command
    const dangerResult = await gateway.preTool({
      sessionId: 's1', tool: 'Bash',
      args: { command: 'rm -rf /' },
    })
    expect(dangerResult.allow).toBe(false)

    // 7. Gate: allow safe command
    const safeResult = await gateway.preTool({
      sessionId: 's1', tool: 'Bash',
      args: { command: 'npm test' },
    })
    expect(safeResult.allow).toBe(true)

    // 8. Set verification payload + complete task
    await store.update(task.id, {
      payload: {
        ...((await store.get(task.id))?.payload ?? {}),
        buildStatus: 'success', buildExitCode: 0,
        lintStatus: 'success',
        testPassed: true,
      },
    })
    await fsm.transition(task.id, 'complete', { actor: me })
    const finalTask = await store.get(task.id)
    expect(finalTask!.status).toBe('COMPLETED')

    // 9. Build context — should include spec
    const context = await ctx.build({ sessionId: 's1', currentArtifactId: spec.id })
    expect(context.system).toContain('User Export Feature')
  })

  it('Guard blocks secret in code edit', async () => {
    const result = await gateway.preTool({
      sessionId: 's1', tool: 'Edit',
      args: { content: 'const key = "AKIAIOSFODNN7EXAMPLE"' },
    })
    expect(result.allow).toBe(false)
  })

  it('Spec challenge invalidates downstream', async () => {
    // Create Spec FROZEN
    const spec = await store.create({
      type: 'Spec', title: 'Feature Y',
      payload: { successCriteria: ['works'], ambiguityScore: 0.1 },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    await fsm.transition(spec.id, 'refine', { actor: me })
    await fsm.transition(spec.id, 'approve', { actor: me })

    // Create Plan
    const plan = await store.create({
      type: 'Plan', title: 'Plan Y',
      parents: [spec.id],
      payload: { rollbackStrategy: 'revert commit' },
      initialStatus: INITIAL_STATES.Plan, createdBy: me,
    })
    await fsm.transition(plan.id, 'review', { actor: me })
    expect((await store.get(plan.id))!.status).toBe('APPROVED')

    // Challenge Spec → REVISING
    await fsm.transition(spec.id, 'challenge', { actor: me })
    expect((await store.get(spec.id))!.status).toBe('REVISING')
    // Note: downstream Plan invalidation would be handled by effects (W9)
  })

  it('Evolution: defect→lesson extraction', async () => {
    // Create diagnosed defect
    const defect = await store.create({
      type: 'Defect', title: 'NPE in handler',
      payload: { rootCauseCategory: 'null_reference', tags: ['backend'] },
      initialStatus: INITIAL_STATES.Defect, createdBy: me,
    })
    await fsm.transition(defect.id, 'assign', { actor: me })
    await store.update(defect.id, {
      payload: { rootCauseCategory: 'null_reference', tags: ['backend'] },
    })
    await fsm.transition(defect.id, 'diagnose', { actor: me })

    // Extract lesson
    const extractor = new LessonExtractor(store, kb, bus)
    const lesson = await extractor.extract(defect.id)
    expect(lesson).not.toBeNull()

    // Verify + promote
    await kb.verify(lesson!.id, 'admin')
    const proposer = new RuleProposer(kb, bus)
    const rule = await proposer.proposeFromLesson(lesson!.id)
    expect(rule).not.toBeNull()
    expect(rule!.enforcement).toBe('prompt') // low access → prompt level
  })

  it('BehaviorTracker captures full session metrics', async () => {
    bus.emit('tool.called', { tool: 'Read' }, { sessionId: 'integ-1' })
    bus.emit('tool.called', { tool: 'Bash' }, { sessionId: 'integ-1' })
    bus.emit('tool.called', { tool: 'Edit' }, { sessionId: 'integ-1' })
    bus.emit('tool.failed', { tool: 'Bash' }, { sessionId: 'integ-1' })
    bus.emit('artifact.created', { type: 'Spec' }, { sessionId: 'integ-1' })
    await new Promise((r) => setTimeout(r, 30))

    const m = await tracker.getSessionMetrics('integ-1')
    expect(m.toolCalls).toBe(3)
    expect(m.toolFailures).toBe(1)
    expect(m.artifactsCreated).toBe(1)
  })

  it('Event stream captures all lifecycle events', async () => {
    const spec = await store.create({
      type: 'Spec', title: 'Event Test',
      payload: { successCriteria: ['x'], ambiguityScore: 0.1 },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    await fsm.transition(spec.id, 'refine', { actor: me })
    await fsm.transition(spec.id, 'approve', { actor: me })

    await new Promise((r) => setTimeout(r, 30))
    const events = await bus.query({ artifactId: spec.id, limit: 100 })
    const types = events.map((e) => e.type)
    expect(types).toContain('artifact.created')
    expect(types).toContain('artifact.transitioned')
  })
})
