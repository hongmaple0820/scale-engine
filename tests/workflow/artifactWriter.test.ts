import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WorkflowArtifactWriter,
  type ExploreArtifact,
  type PlanArtifact,
  type TDDEvidence,
  type CheckpointData
} from '../../src/workflow/WorkflowArtifactWriter.js'

describe('WorkflowArtifactWriter', () => {
  let dir: string
  let writer: WorkflowArtifactWriter

  beforeEach(() => {
    dir = join(tmpdir(), `scale-artifact-${Date.now()}`)
    writer = new WorkflowArtifactWriter(dir)
  })

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  // ─────────────────────────────────────────────────────────────
  // Explore Artifact
  // ─────────────────────────────────────────────────────────────

  describe('current workflow state', () => {
    it('normalizes legacy or partial state when reading current.json', () => {
      mkdirSync(join(dir, 'state'), { recursive: true })
      writeFileSync(join(dir, 'state', 'current.json'), JSON.stringify({
        taskId: 'legacy-task',
        level: 'M',
        phase: 'plan',
        exploredFiles: null,
        openTasks: null,
        filesModified: null
      }), 'utf-8')

      const state = writer.readCurrentState()

      expect(state).toMatchObject({
        taskId: 'legacy-task',
        exploredFiles: [],
        openTasks: [],
        filesModified: []
      })
    })
  })

  describe('explore artifact', () => {
    it('writes and reads explore result', () => {
      const artifact: ExploreArtifact = {
        timestamp: '2025-01-01T00:00:00Z',
        files: ['src/main.ts', 'src/utils.ts'],
        fileCount: 2,
        mainContradiction: 'ambiguous requirement',
        ambiguityScore: 35,
        socraticCompleted: true
      }

      writer.writeExploreResult(artifact)
      const result = writer.readExploreResult()

      expect(result).toEqual(artifact)
    })

    it('returns null when no explore result exists', () => {
      expect(writer.readExploreResult()).toBeNull()
    })

    it('validates explore result correctly', () => {
      // Invalid: fileCount < 3
      writer.writeExploreResult({
        timestamp: '2025-01-01T00:00:00Z',
        files: [],
        fileCount: 1,
        mainContradiction: '',
        ambiguityScore: 0,
        socraticCompleted: false
      })
      expect(writer.hasValidExploreResult()).toBe(false)

      // Valid: fileCount >= 3 and mainContradiction non-empty
      writer.writeExploreResult({
        timestamp: '2025-01-01T00:00:00Z',
        files: ['a.ts', 'b.ts', 'c.ts'],
        fileCount: 3,
        mainContradiction: 'ambiguity found',
        ambiguityScore: 25,
        socraticCompleted: true
      })
      expect(writer.hasValidExploreResult()).toBe(true)
    })

    it('respects custom minFiles threshold', () => {
      writer.writeExploreResult({
        timestamp: '2025-01-01T00:00:00Z',
        files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        fileCount: 4,
        mainContradiction: 'issue found',
        ambiguityScore: 20,
        socraticCompleted: true
      })
      expect(writer.hasValidExploreResult(5)).toBe(false)
      expect(writer.hasValidExploreResult(4)).toBe(true)
    })

    it('updates current workflow state from explore result', () => {
      writer.writeExploreResult({
        timestamp: '2025-01-01T00:00:00Z',
        files: ['a.ts', 'b.ts', 'c.ts'],
        fileCount: 3,
        mainContradiction: 'state contract mismatch',
        ambiguityScore: 20,
        socraticCompleted: true
      })

      const state = writer.readCurrentState()
      expect(state).toMatchObject({
        schemaVersion: 1,
        level: 'M',
        phase: 'explore',
        exploredFiles: ['a.ts', 'b.ts', 'c.ts'],
        fileCount: 3,
        mainContradiction: 'state contract mismatch',
      })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Plan Artifact
  // ─────────────────────────────────────────────────────────────

  describe('plan artifact', () => {
    it('writes and reads plan result by ID', () => {
      const artifact: PlanArtifact = {
        timestamp: '2025-01-01T00:00:00Z',
        planId: 'plan-001',
        specId: 'spec-001',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: true,
        modules: ['src/auth.ts', 'src/api.ts'],
        consensusRounds: 3,
        verdict: 'viable'
      }

      writer.writePlanResult(artifact)
      const result = writer.readPlanResult('plan-001')

      expect(result).toEqual(artifact)
    })

    it('returns null for non-existent plan ID', () => {
      expect(writer.readPlanResult('nonexistent')).toBeNull()
    })

    it('reads the latest plan result', () => {
      writer.writePlanResult({
        timestamp: '2025-01-01T00:00:00Z',
        planId: 'plan-001',
        specId: '',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: true,
        modules: [],
        consensusRounds: 1,
        verdict: 'viable'
      })

      writer.writePlanResult({
        timestamp: '2025-01-02T00:00:00Z',
        planId: 'plan-002',
        specId: '',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: true,
        modules: [],
        consensusRounds: 2,
        verdict: 'viable'
      })

      const latest = writer.readLatestPlanResult()
      expect(latest).not.toBeNull()
      expect(latest!.planId).toBe('plan-002')
    })

    it('returns null when no plan results exist', () => {
      expect(writer.readLatestPlanResult()).toBeNull()
    })

    it('validates plan result correctly', () => {
      // Invalid: missing rollback strategy
      writer.writePlanResult({
        timestamp: '2025-01-01T00:00:00Z',
        planId: 'plan-001',
        specId: '',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: false,
        modules: [],
        consensusRounds: 1,
        verdict: 'viable'
      })
      expect(writer.hasValidPlanResult()).toBe(false)

      // Valid: all checks pass
      writer.writePlanResult({
        timestamp: '2025-01-01T00:00:00Z',
        planId: 'plan-002',
        specId: '',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: true,
        modules: [],
        consensusRounds: 1,
        verdict: 'viable'
      })
      expect(writer.hasValidPlanResult()).toBe(true)
    })

    it('updates current workflow state from plan result', () => {
      writer.writePlanResult({
        timestamp: '2025-01-01T00:00:00Z',
        planId: 'plan-001',
        specId: 'spec-001',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: true,
        modules: ['src/auth.ts'],
        consensusRounds: 1,
        verdict: 'APPROVE'
      })

      const state = writer.readCurrentState()
      expect(state).toMatchObject({
        phase: 'plan',
        lastSpecId: 'spec-001',
        lastPlanId: 'plan-001',
      })
    })

    it('keeps plan artifact files inside the state directory when planId contains traversal tokens', () => {
      const planId = '../../../../escape-plan'
      const artifact: PlanArtifact = {
        timestamp: '2025-01-01T00:00:00Z',
        planId,
        specId: 'spec-001',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: true,
        modules: ['src/auth.ts'],
        consensusRounds: 1,
        verdict: 'APPROVE'
      }

      writer.writePlanResult(artifact)

      expect(writer.readPlanResult(planId)).toEqual(artifact)
      expect(writer.planArtifactPath(planId)).toBe(join(dir, 'state', 'plan-..-..-..-..-escape-plan.json'))
      expect(existsSync(writer.planArtifactPath(planId))).toBe(true)
      expect(existsSync(join(dir, 'state', `plan-${planId}.json`))).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // TDD Evidence
  // ─────────────────────────────────────────────────────────────

  describe('TDD evidence', () => {
    it('writes and reads TDD evidence by task ID', () => {
      const evidence: TDDEvidence = {
        timestamp: '2025-01-01T00:00:00Z',
        taskId: 'task-001',
        red: true,
        green: true,
        refactor: true,
        testFirst: true,
        testFile: 'tests/auth.test.ts',
        implFile: 'src/auth.ts',
        coverage: 85
      }

      writer.writeTDDEvidence(evidence)
      const result = writer.readTDDEvidence('task-001')

      expect(result).toEqual(evidence)
    })

    it('returns null for non-existent task ID', () => {
      expect(writer.readTDDEvidence('nonexistent')).toBeNull()
    })

    it('reads the latest TDD evidence', () => {
      writer.writeTDDEvidence({
        timestamp: '2025-01-01T00:00:00Z',
        taskId: 'task-001',
        red: true,
        green: true,
        refactor: true,
        testFirst: true,
        testFile: 'a.test.ts',
        implFile: 'a.ts'
      })

      writer.writeTDDEvidence({
        timestamp: '2025-01-02T00:00:00Z',
        taskId: 'task-002',
        red: true,
        green: true,
        refactor: true,
        testFirst: true,
        testFile: 'b.test.ts',
        implFile: 'b.ts'
      })

      const latest = writer.readLatestTDDEvidence()
      expect(latest).not.toBeNull()
      expect(latest!.taskId).toBe('task-002')
    })

    it('validates TDD evidence correctly', () => {
      // Invalid: refactor not completed
      writer.writeTDDEvidence({
        timestamp: '2025-01-01T00:00:00Z',
        taskId: 'task-001',
        red: true,
        green: true,
        refactor: false,
        testFirst: true,
        testFile: 'test.ts',
        implFile: 'impl.ts'
      })
      expect(writer.hasValidTDDEvidence()).toBe(false)

      // Valid: all phases completed
      writer.writeTDDEvidence({
        timestamp: '2025-01-01T00:00:00Z',
        taskId: 'task-002',
        red: true,
        green: true,
        refactor: true,
        testFirst: true,
        testFile: 'test.ts',
        implFile: 'impl.ts'
      })
      expect(writer.hasValidTDDEvidence()).toBe(true)
      expect(writer.hasValidTDDEvidence('task-002')).toBe(true)
    })

    it('validates TDD evidence by specific task ID', () => {
      writer.writeTDDEvidence({
        timestamp: '2025-01-01T00:00:00Z',
        taskId: 'task-001',
        red: true,
        green: false,
        refactor: false,
        testFirst: true,
        testFile: 'test.ts',
        implFile: 'impl.ts'
      })

      expect(writer.hasValidTDDEvidence('task-001')).toBe(false)
      expect(writer.hasValidTDDEvidence('nonexistent')).toBe(false)
    })

    it('keeps TDD evidence files inside the state directory when taskId contains traversal tokens', () => {
      const taskId = '../../../../escape-task'
      const evidence: TDDEvidence = {
        timestamp: '2025-01-01T00:00:00Z',
        taskId,
        red: true,
        green: true,
        refactor: true,
        testFirst: true,
        testFile: 'tests/auth.test.ts',
        implFile: 'src/auth.ts',
      }

      writer.writeTDDEvidence(evidence)

      expect(writer.readTDDEvidence(taskId)).toEqual(evidence)
      expect(writer.tddEvidencePath(taskId)).toBe(join(dir, 'state', 'tdd-..-..-..-..-escape-task.json'))
      expect(existsSync(writer.tddEvidencePath(taskId))).toBe(true)
      expect(existsSync(join(dir, 'state', `tdd-${taskId}.json`))).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Checkpoint
  // ─────────────────────────────────────────────────────────────

  describe('checkpoint', () => {
    it('writes and reads checkpoint', () => {
      const data: CheckpointData = {
        timestamp: '2025-01-01T00:00:00Z',
        phase: 'explore',
        sessionId: 'session-001',
        data: { filesScanned: 42 }
      }

      writer.writeCheckpoint(data)
      const result = writer.readCheckpoint()

      expect(result).toEqual(data)
    })

    it('returns null when no checkpoint exists', () => {
      expect(writer.readCheckpoint()).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Generic Operations
  // ─────────────────────────────────────────────────────────────

  describe('clearAll', () => {
    it('removes all JSON artifacts', () => {
      writer.writeExploreResult({
        timestamp: '2025-01-01T00:00:00Z',
        files: [],
        fileCount: 0,
        mainContradiction: '',
        ambiguityScore: 0,
        socraticCompleted: false
      })
      writer.writePlanResult({
        timestamp: '2025-01-01T00:00:00Z',
        planId: 'p1',
        specId: '',
        hasBoundaryAnalysis: true,
        hasExceptionHandling: true,
        hasRollbackStrategy: true,
        modules: [],
        consensusRounds: 1,
        verdict: 'viable'
      })
      writer.writeCheckpoint({
        timestamp: '2025-01-01T00:00:00Z',
        phase: 'done',
        data: {}
      })

      writer.clearAll()

      expect(writer.readExploreResult()).toBeNull()
      expect(writer.readPlanResult('p1')).toBeNull()
      expect(writer.readCheckpoint()).toBeNull()
    })

    it('does nothing when state directory does not exist', () => {
      // Should not throw
      writer.clearAll()
    })
  })

  describe('getStateDir', () => {
    it('returns the state directory path', () => {
      expect(writer.getStateDir()).toBe(join(dir, 'state'))
    })
  })
})
