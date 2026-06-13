import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:net'
import { DashboardServer } from '../../src/dashboard/DashboardServer.js'
import { MemoryBrain } from '../../src/memory/MemoryBrain.js'
import { resolveDashboardLaunchPlan } from '../../src/api/DashboardHttpConfig.js'

const tempRoots: string[] = []
const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('DashboardServer API', () => {
  it('serves project metadata, previewable documents, and local knowledge', async () => {
    const projectDir = makeTempDir('scale-dashboard-server-project-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'guide.md'), '# Guide\n\nAuth pattern', 'utf-8')

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
