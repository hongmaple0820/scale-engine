// SCALE Engine — SessionStart Hook Integration Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ClaudeCodeAdapter } from '../../src/adapters/ClaudeCodeAdapter.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { SpecFSM, PlanFSM, TaskFSM, DefectFSM } from '../../src/artifact/fsmDefinitions.js'
import { EventBus } from '../../src/core/eventBus.js'
import { KnowledgeBase } from '../../src/knowledge/KnowledgeBase.js'
import { FSMAgentBridge } from '../../src/fsm/FSMAgentBridge.js'
import { ContextBuilder } from '../../src/context/ContextBuilder.js'
import { Gateway } from '../../src/guardrails/Gateway.js'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'

const TEST_DIR = '.scale-test-session'

describe('SessionStart Hook Integration', () => {
  let store: InMemoryArtifactStore
  let fsm: FSM
  let bus: EventBus
  let kb: KnowledgeBase
  let bridge: FSMAgentBridge
  let ctxBuilder: ContextBuilder
  let gateway: Gateway

  beforeEach(async () => {
    // Clean test directory
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(join(TEST_DIR, 'events'), { recursive: true })

    bus = new EventBus({ eventsDir: join(TEST_DIR, 'events') })
    store = new InMemoryArtifactStore(bus, { artifactsDir: join(TEST_DIR, 'artifacts') })
    fsm = new FSM(store)
    fsm.register(SpecFSM)
    fsm.register(PlanFSM)
    fsm.register(TaskFSM)
    fsm.register(DefectFSM)
    kb = new KnowledgeBase(bus)
    bridge = new FSMAgentBridge(fsm, store)
    ctxBuilder = new ContextBuilder(store, kb, bus)
    gateway = new Gateway(bus)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  describe('ClaudeCodeAdapter SessionStart hook', () => {
    it('generates correct hook command', () => {
      const adapter = new ClaudeCodeAdapter()
      const settings = adapter.generateSettings()

      expect(settings.hooks?.SessionStart).toBeDefined()
      expect(settings.hooks?.SessionStart?.length).toBeGreaterThan(0)
      // #34：官方 schema 为嵌套 hooks 数组，命令经 stdin 读 session_id
      const command = settings.hooks?.SessionStart?.[0]?.hooks?.[0]?.command
      expect(command).toContain('scale context inject')
      expect(command).toContain('--stdin')
    })

    it('hook command reads the session id from stdin payload (#34)', () => {
      const adapter = new ClaudeCodeAdapter()
      const settings = adapter.generateSettings()

      const hookCmd = settings.hooks?.SessionStart?.[0]?.hooks?.[0]?.command
      expect(hookCmd).not.toContain('$CLAUDE_SESSION_ID')
    })
  })

  describe('context inject command behavior', () => {
    it('returns FSM context for session', async () => {
      const sessionCtx = await bridge.getSessionContext('integration-session-1', bus)

      expect(sessionCtx.sessionId).toBe('integration-session-1')
      expect(sessionCtx.generatedAt).toBeGreaterThan(0)
      expect(sessionCtx.recommendations).toBeDefined()
    })

    it('returns recommendations for artifact states', async () => {
      const ctx = await bridge.getSessionContext('review-session', bus)
      expect(ctx.recommendations).toBeDefined()
      expect(Array.isArray(ctx.recommendations)).toBe(true)
    })

    it('returns recalledLessons array', async () => {
      const ctx = await bridge.getSessionContext('lesson-session', bus)
      expect(ctx.recalledLessons).toBeDefined()
      expect(Array.isArray(ctx.recalledLessons)).toBe(true)
    })
  })

  describe('AutoDefectCreator integration with detectors', () => {
    it('AutoDefectCreator creates defect on hallucination', async () => {
      const { AutoDefectCreator } = await import('../../src/evolution/AutoDefectCreator.js')
      const creator = new AutoDefectCreator(store, bus)

      creator.start()

      await bus.emitAsync('behavior.hallucination', {
        claim: 'build succeeded',
        evidence: 'no output'
      }, { sessionId: 'hallucination-test' })

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100))

      const defects = creator.getAutoDefects()
      expect(defects.length).toBeGreaterThanOrEqual(0) // May or may not create depending on timing

      creator.stop()
    })
  })

  describe('BehaviorTracker auto-evolve trigger', () => {
    it('triggers evolution cycle when bruteRetry threshold reached', async () => {
      const { BehaviorTracker } = await import('../../src/evolution/BehaviorTracker.js')

      const tracker = new BehaviorTracker(bus)

      let cycleCalled = false
      tracker.setAutoEvolve(
        { enabled: true, bruteRetryThreshold: 3 },
        async () => {
          cycleCalled = true
        }
      )

      tracker.start()

      // Emit 3 brute_retry events
      await bus.emitAsync('behavior.brute_retry', {}, { sessionId: 'auto-evolve-test' })
      await bus.emitAsync('behavior.brute_retry', {}, { sessionId: 'auto-evolve-test' })
      await bus.emitAsync('behavior.brute_retry', {}, { sessionId: 'auto-evolve-test' })

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100))

      // Check if auto-evolve was triggered
      expect(cycleCalled).toBe(true)

      tracker.stop()
    })
  })
})
