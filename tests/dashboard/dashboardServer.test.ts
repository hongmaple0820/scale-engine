import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:net'
import Database from 'better-sqlite3'
import { DashboardServer } from '../../src/dashboard/DashboardServer.js'
import { MemoryBrain } from '../../src/memory/MemoryBrain.js'
import { ModelUsageLedger } from '../../src/runtime/ModelUsageLedger.js'
import { resolveDashboardLaunchPlan } from '../../src/api/DashboardHttpConfig.js'

const tempRoots: string[] = []
const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('DashboardServer API', () => {
  it('serves the Vue dashboard at the root and retires the classic fallback route', async () => {
    const projectDir = makeTempDir('scale-dashboard-static-')
    const scaleDir = join(projectDir, '.scale')
    const server = new DashboardServer({ projectDir, scaleDir })
    const app = server.getApp()

    const vue = await app.request('/')
    expect(vue.status).toBe(200)
    expect(await vue.text()).toContain('SCALE Engine Dashboard')

    const legacySpa = await app.request('/spa/')
    expect(legacySpa.status).toBe(302)
    expect(legacySpa.headers.get('location')).toBe('/')

    const legacyPreview = await app.request('/vue/')
    expect(legacyPreview.status).toBe(302)
    expect(legacyPreview.headers.get('location')).toBe('/')

    const classic = await app.request('/classic/')
    expect(classic.status).toBe(404)
  })

  it('serves project metadata, previewable documents, and local knowledge', async () => {
    const projectDir = makeTempDir('scale-dashboard-server-project-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(scaleDir, { recursive: true })
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'guide.md'), '# Guide\n\nAuth pattern', 'utf-8')
    writeFileSync(join(projectDir, 'docs', 'CODE_INTELLIGENCE.md'), '# Code Intelligence\n\nGraphify knowledge graph.', 'utf-8')
    mkdirSync(join(projectDir, 'src', 'skills', 'karpathy-guidelines'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'skills', 'karpathy-guidelines', 'SKILL.md'), '# Karpathy LLM Guidelines\n\nKeep context simple.', 'utf-8')
    mkdirSync(join(projectDir, 'graphify-out'), { recursive: true })
    writeFileSync(join(projectDir, 'graphify-out', 'GRAPH_REPORT.md'), '# Graph Report\n\nTwo nodes.', 'utf-8')
    writeFileSync(join(projectDir, 'graphify-out', 'graph.json'), JSON.stringify({
      nodes: [
        { id: 'guide', label: 'Guide', kind: 'doc', group: 'docs', path: 'docs/guide.md' },
        { id: 'karpathy', label: 'Karpathy', kind: 'skill', group: 'llm', path: 'src/skills/karpathy-guidelines/SKILL.md' },
      ],
      edges: [{ source: 'guide', target: 'karpathy', label: 'references' }],
    }), 'utf-8')
    const knowledgeDb = new Database(join(scaleDir, 'knowledge.db'))
    try {
      knowledgeDb.exec(`
        CREATE TABLE knowledge_entries (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL,
          tags TEXT NOT NULL,
          score REAL NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          source TEXT
        )
      `)
      knowledgeDb.prepare(`
        INSERT INTO knowledge_entries (id, title, content, type, tags, score, createdAt, updatedAt, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('KB-LLM', 'LLM Context Rule', 'Prefer compact repo-native context.', 'guideline', JSON.stringify(['llm', 'karpathy']), 0.91, 1, 2, 'test')
    } finally {
      knowledgeDb.close()
    }

    const brain = new MemoryBrain({ projectDir, scaleDir })
    try {
      brain.addNode({
        id: 'MEM-AUTH',
        type: 'decision',
        layer: 'L2-policy',
        title: 'Auth Pattern',
        summary: 'Use project-scoped auth evidence before release.',
        source: 'manual',
        evidencePaths: ['docs/guide.md'],
        confidence: 0.82,
        status: 'active',
      })
    } finally {
      brain.close()
    }

    const server = new DashboardServer({
      projectDir,
      scaleDir,
      projectName: 'Demo Project',
      projectUrl: 'http://localhost:4321',
      projects: [
        { id: 'demo-project', name: 'Demo Project', projectDir, scaleDir, url: 'http://localhost:4321' },
      ],
    })
    const app = server.getApp()

    const projects = await json<Array<{ name: string; current: boolean }>>(await app.request('/api/projects'))
    expect(projects).toEqual([expect.objectContaining({ name: 'Demo Project', current: true })])

    expect((await app.request('/favicon.ico')).status).toBe(204)

    const documents = await json<Array<{ name: string; path: string; type: string }>>(await app.request('/api/documents'))
    expect(documents).toContainEqual(expect.objectContaining({ name: 'guide.md', path: 'docs/guide.md', type: 'md' }))

    const doc = await app.request('/api/documents/docs/guide.md')
    expect(doc.status).toBe(200)
    expect(await doc.text()).toContain('Auth pattern')

    const knowledge = await json<{ local: { total: number; nodes: Array<{ id: string; title: string }> } }>(
      await app.request('/api/knowledge?query=auth&providers=false'),
    )
    expect(knowledge.local.total).toBe(1)
    expect(knowledge.local.nodes).toEqual([expect.objectContaining({ id: 'MEM-AUTH', title: 'Auth Pattern' })])

    const knowledgeBase = await json<{
      summary: { documents: number; entries: number; graphNodes: number; graphEdges: number; memoryNodes: number }
      documents: Array<{ path: string }>
      entries: Array<{ id: string; tags: string[] }>
      graph: { status: string; nodeCount: number; edgeCount: number; reportPath?: string }
      memoryGraph: { status: string; nodeCount: number; edgeCount: number }
    }>(await app.request('/api/knowledge-base'))
    expect(knowledgeBase.summary).toEqual(expect.objectContaining({
      entries: 1,
      graphNodes: 2,
      graphEdges: 1,
    }))
    expect(knowledgeBase.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/skills/karpathy-guidelines/SKILL.md' }),
      expect.objectContaining({ path: 'graphify-out/GRAPH_REPORT.md' }),
    ]))
    expect(knowledgeBase.entries).toEqual([expect.objectContaining({ id: 'KB-LLM', tags: ['llm', 'karpathy'] })])
    expect(knowledgeBase.graph).toEqual(expect.objectContaining({ status: 'ready', nodeCount: 2, edgeCount: 1, reportPath: 'graphify-out/GRAPH_REPORT.md' }))
    expect(knowledgeBase.memoryGraph.status).toBe('ready')
    expect(knowledgeBase.memoryGraph.nodeCount).toBeGreaterThan(0)

    const karpathyDoc = await app.request('/api/documents/src/skills/karpathy-guidelines/SKILL.md')
    expect(karpathyDoc.status).toBe(200)
    expect(await karpathyDoc.text()).toContain('Karpathy LLM Guidelines')
  })

  it('serves prompt studio templates and optimizes raw prompts', async () => {
    const projectDir = makeTempDir('scale-dashboard-prompts-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(scaleDir, 'prompts'), { recursive: true })
    writeFileSync(join(scaleDir, 'prompts', 'release-check.md'), '# Release Check\n\nVerify release gates.', 'utf-8')

    const server = new DashboardServer({ projectDir, scaleDir, projectName: 'Prompt Project' })
    const app = server.getApp()

    const promptReport = await json<{
      summary: { vibeTemplates: number; phasePrompts: number; packs: number; customPrompts: number }
      commands: { vibeTemplate: string; promptOptimize: string }
      vibeTemplates: Array<{ id: string; command: string; copyPrompt: string }>
      phasePrompts: Array<{ id: string; source: string; command?: string; template: string }>
      packs: Array<{ id: string; command: string; templateIds: string[] }>
    }>(await app.request('/api/prompts'))

    expect(promptReport.summary.vibeTemplates).toBeGreaterThanOrEqual(5)
    expect(promptReport.summary.phasePrompts).toBeGreaterThanOrEqual(7)
    expect(promptReport.summary.packs).toBeGreaterThanOrEqual(4)
    expect(promptReport.summary.customPrompts).toBeGreaterThanOrEqual(1)
    expect(promptReport.commands).toEqual(expect.objectContaining({
      vibeTemplate: 'scale vibe --template <template-id> --app "<project>"',
      promptOptimize: 'scale prompt optimize --input "<raw prompt>" --json',
    }))
    expect(promptReport.vibeTemplates).toContainEqual(expect.objectContaining({
      id: 'product-ceo-discovery',
      command: 'scale vibe --template product-ceo-discovery',
    }))
    expect(promptReport.phasePrompts).toContainEqual(expect.objectContaining({
      id: 'idea-validate',
      source: 'builtin',
      command: 'scale vibe --phase idea',
    }))
    expect(promptReport.phasePrompts).toContainEqual(expect.objectContaining({
      id: 'project:release-check',
      source: 'project',
      template: expect.stringContaining('Verify release gates.'),
    }))
    expect(promptReport.packs).toContainEqual(expect.objectContaining({
      id: 'full-mvp',
      command: 'scale vibe --pack full-mvp',
      templateIds: expect.arrayContaining(['idea-validate', 'build-mvp']),
    }))

    const optimized = await json<{
      result: {
        language: string
        optimizedPrompt: string
        quality: { score: number }
        stats: { originalChars: number; optimizedChars: number }
      }
    }>(await app.request('/api/prompts/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawPrompt: 'Implement dashboard prompt studio and verify tests pass.',
        language: 'en',
        files: ['src/dashboard/spa/pages/prompts.js'],
        successCriteria: ['dashboard API returns prompt templates'],
      }),
    }))
    expect(optimized.result.language).toBe('en')
    expect(optimized.result.optimizedPrompt).toContain('Objective')
    expect(optimized.result.quality.score).toBeGreaterThan(0)
    expect(optimized.result.stats.optimizedChars).toBeGreaterThan(optimized.result.stats.originalChars)

    const empty = await app.request('/api/prompts/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawPrompt: '   ' }),
    })
    expect(empty.status).toBe(400)
  })

  it('explains dashboard data sources, missing ledgers, and partial runtime wiring', async () => {
    const projectDir = makeTempDir('scale-dashboard-capabilities-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    mkdirSync(join(scaleDir, 'evidence', 'runtime'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'prototype.html'), '<main>Prototype</main>', 'utf-8')
    writeFileSync(join(scaleDir, 'evidence', 'runtime', 'run.json'), JSON.stringify({ status: 'passed' }), 'utf-8')
    new ModelUsageLedger(scaleDir).record({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      inputTokens: 1200,
      outputTokens: 300,
      cachedTokens: 400,
    })

    const server = new DashboardServer({ projectDir, scaleDir, projectName: 'Capability Project' })
    const report = await json<{
      summary: { total: number; ready: number; partial: number; missing: number }
      realtime: { mode: string; heartbeatOnly: boolean }
      writeOps: { artifactTransitions: boolean; promptOptimization: boolean }
      dataSources: Array<{ id: string; status: string; count: number; emptyReason?: string }>
    }>(await server.getApp().request('/api/dashboard/capabilities'))

    const source = (id: string) => report.dataSources.find(item => item.id === id)
    expect(report.summary.total).toBeGreaterThanOrEqual(9)
    expect(report.summary.ready).toBeGreaterThanOrEqual(4)
    expect(report.summary.partial).toBeGreaterThanOrEqual(2)
    expect(report.realtime).toEqual(expect.objectContaining({
      mode: 'heartbeat-only',
      heartbeatOnly: true,
    }))
    expect(report.writeOps).toEqual(expect.objectContaining({
      artifactTransitions: false,
      promptOptimization: true,
    }))
    expect(source('runtime-evidence')).toEqual(expect.objectContaining({ status: 'ready', count: 1 }))
    expect(source('model-usage')).toEqual(expect.objectContaining({ status: 'ready', count: 1 }))
    expect(source('documents')).toEqual(expect.objectContaining({ status: 'ready', count: 1 }))
    expect(source('knowledge-base')).toEqual(expect.objectContaining({
      status: 'missing',
      emptyReason: expect.stringContaining('knowledge docs'),
    }))
    expect(source('event-stream')).toEqual(expect.objectContaining({
      status: 'partial',
      emptyReason: expect.stringContaining('EventBus'),
    }))
    expect(source('artifact-fsm')).toEqual(expect.objectContaining({
      status: 'partial',
      emptyReason: expect.stringContaining('FSM'),
    }))
  })

  it('summarizes documents, local memory, and health across configured projects', async () => {
    const projectA = makeTempDir('scale-dashboard-summary-a-')
    const scaleA = join(projectA, '.scale')
    mkdirSync(join(projectA, 'docs'), { recursive: true })
    mkdirSync(scaleA, { recursive: true })
    writeFileSync(join(projectA, 'docs', 'alpha.md'), '# Alpha\n', 'utf-8')

    const projectB = makeTempDir('scale-dashboard-summary-b-')
    const scaleB = join(projectB, '.scale')
    mkdirSync(join(projectB, 'docs'), { recursive: true })
    mkdirSync(scaleB, { recursive: true })
    writeFileSync(join(projectB, 'docs', 'beta.md'), '# Beta\n', 'utf-8')

    const brain = new MemoryBrain({ projectDir: projectA, scaleDir: scaleA })
    try {
      brain.addNode({
        id: 'MEM-ALPHA',
        type: 'decision',
        layer: 'L2-policy',
        title: 'Alpha Memory',
        summary: 'Project alpha memory signal.',
        source: 'manual',
        evidencePaths: ['docs/alpha.md'],
        confidence: 0.9,
        status: 'active',
      })
    } finally {
      brain.close()
    }

    const server = new DashboardServer({
      projectDir: projectA,
      scaleDir: scaleA,
      projectName: 'Alpha',
      projectUrl: 'http://localhost:4101',
      projects: [
        { id: 'alpha', name: 'Alpha', projectDir: projectA, scaleDir: scaleA, url: 'http://localhost:4101' },
        { id: 'beta', name: 'Beta', projectDir: projectB, scaleDir: scaleB, url: 'http://localhost:4102' },
      ],
    })

    const summary = await json<{
      totals: { projects: number; documents: number; localMemoryNodes: number; activeMemoryNodes: number }
      projects: Array<{ project: { name: string; current: boolean }; health: string; documents: { total: number }; knowledge: { total: number; active: number } }>
    }>(await server.getApp().request('/api/projects/summary?days=14'))

    expect(summary.totals).toEqual(expect.objectContaining({
      projects: 2,
      documents: 2,
      localMemoryNodes: 1,
      activeMemoryNodes: 1,
    }))
    expect(summary.projects).toEqual([
      expect.objectContaining({
        project: expect.objectContaining({ name: 'Alpha', current: true }),
        health: 'ready',
        documents: expect.objectContaining({ total: 1 }),
        knowledge: expect.objectContaining({ total: 1, active: 1 }),
      }),
      expect.objectContaining({
        project: expect.objectContaining({ name: 'Beta', current: false }),
        health: 'ready',
        documents: expect.objectContaining({ total: 1 }),
        knowledge: expect.objectContaining({ total: 0, active: 0 }),
      }),
    ])
  })

  it('reviews local memory through governed dashboard API and records runtime evidence', async () => {
    const projectDir = makeTempDir('scale-dashboard-memory-review-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'memory.md'), '# Memory Evidence\n', 'utf-8')

    const brain = new MemoryBrain({ projectDir, scaleDir })
    try {
      brain.addNode({
        id: 'MEM-REVIEW',
        type: 'decision',
        layer: 'L2-policy',
        title: 'Review Candidate',
        summary: 'Candidate memory must be reviewed before activation.',
        source: 'manual',
        evidencePaths: ['docs/memory.md'],
        confidence: 0.76,
        status: 'candidate',
      })
    } finally {
      brain.close()
    }

    const server = new DashboardServer({ projectDir, scaleDir })
    const response = await server.getApp().request('/api/knowledge/local/MEM-REVIEW/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', reason: 'test approval' }),
    })
    const result = await json<{
      success: boolean
      previousStatus: string
      node: { id: string; status: string }
      evidence: { id: string; metadata: { action: string; nodeId: string; previousStatus: string; nextStatus: string } }
    }>(response)

    expect(result).toEqual(expect.objectContaining({
      success: true,
      previousStatus: 'candidate',
      node: expect.objectContaining({ id: 'MEM-REVIEW', status: 'active' }),
      evidence: expect.objectContaining({
        id: expect.stringMatching(/^RTE-/),
        metadata: expect.objectContaining({
          action: 'approve',
          nodeId: 'MEM-REVIEW',
          previousStatus: 'candidate',
          nextStatus: 'active',
        }),
      }),
    }))

    const reopened = new MemoryBrain({ projectDir, scaleDir })
    try {
      expect(reopened.get('MEM-REVIEW')).toEqual(expect.objectContaining({ status: 'active' }))
    } finally {
      reopened.close()
    }

    const evidenceDir = join(scaleDir, 'evidence', 'runtime')
    const evidenceFiles = readdirSync(evidenceDir).filter(file => file.endsWith('.json'))
    expect(evidenceFiles).toHaveLength(1)
    const evidence = JSON.parse(readFileSync(join(evidenceDir, evidenceFiles[0]!), 'utf-8')) as { metadata: Record<string, unknown> }
    expect(evidence.metadata).toEqual(expect.objectContaining({
      action: 'approve',
      nodeId: 'MEM-REVIEW',
      nextStatus: 'active',
      source: 'dashboard',
    }))
  })

  it('blocks invalid dashboard memory review transitions', async () => {
    const projectDir = makeTempDir('scale-dashboard-memory-review-block-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'active.md'), '# Active Evidence\n', 'utf-8')

    const brain = new MemoryBrain({ projectDir, scaleDir })
    try {
      brain.addNode({
        id: 'MEM-ACTIVE',
        type: 'fact',
        layer: 'L1-trace',
        title: 'Active Memory',
        summary: 'Active memory cannot be rejected directly from the dashboard.',
        source: 'manual',
        evidencePaths: ['docs/active.md'],
        confidence: 0.8,
        status: 'active',
      })
    } finally {
      brain.close()
    }

    const server = new DashboardServer({ projectDir, scaleDir })
    const response = await server.getApp().request('/api/knowledge/local/MEM-ACTIVE/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    })
    expect(response.status).toBe(422)
    const result = await response.json() as { error: string; previousStatus: string }
    expect(result.error).toContain('Reject requires candidate memory')
    expect(result.previousStatus).toBe('active')

    const reopened = new MemoryBrain({ projectDir, scaleDir })
    try {
      expect(reopened.get('MEM-ACTIVE')).toEqual(expect.objectContaining({ status: 'active' }))
    } finally {
      reopened.close()
    }
  })
})

describe('dashboard HTTP launch config', () => {
  it('allocates distinct project ports and skips an occupied base port', async () => {
    const projectA = makeTempDir('scale-dashboard-project-a-')
    const projectB = makeTempDir('scale-dashboard-project-b-')
    const blocker = await listenOnRandomPort()
    servers.push(blocker)
    const address = blocker.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP address')

    const plan = await resolveDashboardLaunchPlan({
      SCALE_DASHBOARD_HOST: '127.0.0.1',
      SCALE_DASHBOARD_PORT: String(address.port),
      SCALE_DASHBOARD_PROJECTS: `alpha=${projectA};beta=${projectB}`,
    }, projectA)

    expect(plan.projects.map(project => project.name)).toEqual(['alpha', 'beta'])
    expect(plan.projects.map(project => project.port)).not.toContain(address.port)
    expect(new Set(plan.projects.map(project => project.port)).size).toBe(2)
    expect(plan.projects[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})

function makeTempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function json<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200)
  return await response.json() as T
}

function listenOnRandomPort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}
