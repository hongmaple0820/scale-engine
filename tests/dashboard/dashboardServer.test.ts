import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:net'
import Database from 'better-sqlite3'
import { DashboardServer } from '../../src/dashboard/DashboardServer.js'
import { MemoryBrain } from '../../src/memory/MemoryBrain.js'
import { ModelUsageLedger } from '../../src/runtime/ModelUsageLedger.js'
import { resolveDashboardLaunchPlan } from '../../src/api/DashboardHttpConfig.js'
import { safeRmSync } from '../helpers/fs.js'

const tempRoots: string[] = []
const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const root of tempRoots.splice(0)) safeRmSync(root)
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

    const health = await app.request('/api/health')
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toEqual(expect.objectContaining({
      status: 'ok',
      projectDir,
      scaleDir,
      pid: expect.any(Number),
    }))

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

  it('supports document download, online editing, knowledge import, and path guards', async () => {
    const projectDir = makeTempDir('scale-dashboard-doc-maintenance-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    mkdirSync(join(scaleDir, 'knowledge'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'guide.md'), '# Guide\n\nBefore', 'utf-8')
    writeFileSync(join(projectDir, 'docs', 'data.json'), JSON.stringify({ ok: true }), 'utf-8')

    const server = new DashboardServer({ projectDir, scaleDir })
    const app = server.getApp()

    const download = await app.request('/api/documents/docs/guide.md?download=1')
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toContain('attachment')
    expect(await download.text()).toContain('Before')

    const edit = await app.request('/api/documents/docs/guide.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Guide\n\nAfter' }),
    })
    expect(edit.status).toBe(200)
    const editPayload = await json<{ success: boolean; document: { path: string; updatedAt: number } }>(edit)
    expect(editPayload).toEqual(expect.objectContaining({
      success: true,
      document: expect.objectContaining({ path: 'docs/guide.md' }),
    }))
    expect(editPayload.document.updatedAt).toBeGreaterThan(0)
    expect(readFileSync(join(projectDir, 'docs', 'guide.md'), 'utf-8')).toContain('After')

    const invalidJson = await app.request('/api/documents/docs/data.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '{broken' }),
    })
    expect(invalidJson.status).toBe(400)
    expect(await invalidJson.text()).toContain('Invalid JSON')

    const imported = await app.request('/api/knowledge-base/documents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'team knowledge.md', content: '# Team Knowledge\n\nRules' }),
    })
    expect(imported.status).toBe(200)
    const importPayload = await json<{ document: { path: string } }>(imported)
    expect(importPayload.document.path).toMatch(/^\.scale\/knowledge\/imports\/team-knowledge\.md$/)
    expect(readFileSync(join(scaleDir, 'knowledge', 'imports', 'team-knowledge.md'), 'utf-8')).toContain('Team Knowledge')

    const knowledgeBase = await json<{ documents: Array<{ path: string }> }>(await app.request('/api/knowledge-base'))
    expect(knowledgeBase.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.scale/knowledge/imports/team-knowledge.md' }),
    ]))

    const traversal = await app.request('/api/documents/docs%2F..%2Fsecret.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'nope' }),
    })
    expect(traversal.status).toBe(400)
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
      vibeTemplates: Array<{ id: string; command: string; copyPrompt: string; methodologyReferences?: string[] }>
      phasePrompts: Array<{ id: string; source: string; command?: string; template: string }>
      packs: Array<{ id: string; command: string; templateIds: string[]; source?: string }>
    }>(await app.request('/api/prompts'))

    expect(promptReport.summary.vibeTemplates).toBeGreaterThanOrEqual(9)
    expect(promptReport.summary.phasePrompts).toBeGreaterThanOrEqual(7)
    expect(promptReport.summary.packs).toBeGreaterThanOrEqual(7)
    expect(promptReport.summary.customPrompts).toBeGreaterThanOrEqual(1)
    expect(promptReport.commands).toEqual(expect.objectContaining({
      vibeTemplate: 'scale vibe --template <template-id> --app "<project>"',
      promptOptimize: 'scale prompt optimize --input "<raw prompt>" --json',
    }))
    expect(promptReport.vibeTemplates).toContainEqual(expect.objectContaining({
      id: 'product-ceo-discovery',
      command: 'scale vibe --template product-ceo-discovery',
    }))
    expect(promptReport.vibeTemplates).toContainEqual(expect.objectContaining({
      id: 'agentic-company-operating-system',
      command: 'scale vibe --template agentic-company-operating-system',
      methodologyReferences: expect.arrayContaining([
        expect.stringContaining('MetaGPT'),
        expect.stringContaining('AutoGen'),
      ]),
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
    expect(promptReport.packs).toContainEqual(expect.objectContaining({
      id: 'agentic-company-flow',
      command: 'scale vibe --pack agentic-company-flow',
      source: 'vibe',
      templateIds: expect.arrayContaining([
        'agentic-company-operating-system',
        'multi-agent-governed-delivery',
        'mutual-review-red-team-loop',
      ]),
    }))

    const root = await app.request('/')
    if (root.status === 200) {
      const rootHtml = await root.text()
      expect(rootHtml).toContain('window.__SCALE_DASHBOARD_BOOTSTRAP__=')
      expect(rootHtml).toContain('/api/projects')
      expect(rootHtml).toContain('/api/integrations')
      expect(rootHtml).toContain('/api/agent-control')
      expect(rootHtml).toContain('/api/dashboard/service')
      expect(rootHtml).not.toContain('/api/prompts')
      expect(rootHtml).not.toContain('product-ceo-discovery')
    } else {
      expect(root.status).toBe(503)
    }

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

    const agentPlan = await json<{
      task: { task: string; level: string; files: string[] }
      governance: { effectiveMode: string; workflowProfile: string; evaluatorRisk: string }
      agentCollaboration: {
        strategy: string
        roles: Array<{ profileId: string; required: boolean }>
        reviewGates: Array<{ id: string; required: boolean }>
        summary: { totalRoles: number; reviewGateCount: number }
      }
    }>(await app.request('/api/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Implement Vue dashboard agent plan workbench with security review',
        level: 'L',
        files: 'dashboard/web/src/App.vue,src/dashboard/DashboardServer.ts',
        budget: 3600,
      }),
    }))
    expect(agentPlan.task.level).toBe('L')
    expect(agentPlan.task.files).toEqual(['dashboard/web/src/App.vue', 'src/dashboard/DashboardServer.ts'])
    expect(agentPlan.governance.workflowProfile).toEqual(expect.any(String))
    expect(agentPlan.agentCollaboration.strategy).toBe('agent-collaboration-v1')
    expect(agentPlan.agentCollaboration.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: 'frontend-agent', required: true }),
      expect.objectContaining({ profileId: 'security-agent', required: true }),
    ]))
    expect(agentPlan.agentCollaboration.summary.totalRoles).toBeGreaterThan(0)
    expect(agentPlan.agentCollaboration.summary.reviewGateCount).toBeGreaterThan(0)

    const agentPlanPreview = await json<{
      task: { level: string; files: string[] }
      agentCollaboration: { strategy: string }
    }>(await app.request('/api/agent/plan?task=Preview%20agent%20handoff&level=L&files=dashboard%2Fweb%2Fsrc%2FApp.vue'))
    expect(agentPlanPreview.task.level).toBe('L')
    expect(agentPlanPreview.task.files).toEqual(['dashboard/web/src/App.vue'])
    expect(agentPlanPreview.agentCollaboration.strategy).toBe('agent-collaboration-v1')

    const empty = await app.request('/api/prompts/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawPrompt: '   ' }),
    })
    expect(empty.status).toBe(400)
  })

  it('serves Agent OS task lifecycle and capability contracts through v1 API', async () => {
    const projectDir = makeTempDir('scale-dashboard-agent-os-api-')
    const scaleDir = join(projectDir, '.scale')
    const server = new DashboardServer({ projectDir, scaleDir, projectName: 'Agent OS API Project' })
    const app = server.getApp()

    const createdResponse = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'TASK-HTTP-OS',
        name: 'HTTP Agent OS task',
        level: 'L',
        files: ['src/os/AgentOsTaskStore.ts'],
        services: ['runtime'],
        surfaces: ['dashboard', 'agent-tool'],
      }),
    })
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json() as { task: { taskId: string; status: string; level: string } }
    expect(created.task).toMatchObject({ taskId: 'TASK-HTTP-OS', status: 'created', level: 'L' })

    const started = await json<{ run: { runId: string; status: string }; task: { status: string } }>(await app.request('/api/v1/tasks/TASK-HTTP-OS/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'RUN-HTTP-OS', agent: 'dashboard-api', contextPackId: 'CTX-HTTP-RUN' }),
    }))
    expect(started).toMatchObject({
      run: { runId: 'RUN-HTTP-OS', status: 'running' },
      task: { status: 'running' },
    })

    const checkpointResponse = await app.request('/api/v1/tasks/TASK-HTTP-OS/checkpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: 'kernel exposed over HTTP',
        completedSteps: ['store', 'routes'],
        remainingSteps: ['tests'],
        openApprovals: ['approve dashboard bridge scopes'],
        contextPackId: 'CTX-HTTP-CHECKPOINT',
      }),
    })
    expect(checkpointResponse.status).toBe(201)
    const checkpoint = await checkpointResponse.json() as { checkpoint: { checkpointId: string; resumePrompt: string } }
    expect(checkpoint.checkpoint.checkpointId).toMatch(/^CKP-/)
    expect(checkpoint.checkpoint.resumePrompt).toContain('TASK-HTTP-OS')

    const snapshot = await json<{
      task: { status: string }
      run: { status: string }
      checkpoints: Array<{ summary: string }>
      timeline: Array<{ kind: string; summary: string }>
    }>(await app.request('/api/v1/tasks/TASK-HTTP-OS'))
    expect(snapshot.task.status).toBe('running')
    expect(snapshot.run.status).toBe('running')
    expect(snapshot.checkpoints).toContainEqual(expect.objectContaining({ summary: 'kernel exposed over HTTP' }))
    expect(snapshot.timeline.map(entry => entry.kind)).toEqual(expect.arrayContaining(['event', 'run', 'checkpoint']))

    const workbench = await json<{
      summary: { tasks: { running: number }; capabilities: { total: number } }
      tasks: { focused: { task: { taskId: string } } }
      approvals: { open: Array<{ summary: string; source: string }> }
      contextPacks: Array<{ id: string; source: string }>
      panels: Array<{ id: string; status: string; count: number }>
      timeline: Array<{ kind: string }>
    }>(await app.request('/api/v1/tasks/TASK-HTTP-OS/workbench?limit=20'))
    expect(workbench.tasks.focused.task.taskId).toBe('TASK-HTTP-OS')
    expect(workbench.summary.tasks.running).toBe(1)
    expect(workbench.summary.capabilities.total).toBeGreaterThan(0)
    expect(workbench.approvals.open).toContainEqual(expect.objectContaining({
      summary: 'approve dashboard bridge scopes',
      source: 'checkpoint',
    }))
    expect(workbench.contextPacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'CTX-HTTP-RUN', source: 'run' }),
      expect.objectContaining({ id: 'CTX-HTTP-CHECKPOINT', source: 'checkpoint' }),
    ]))
    expect(workbench.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approvals', status: 'attention', count: 1 }),
    ]))
    expect(workbench.timeline.map(entry => entry.kind)).toEqual(expect.arrayContaining(['run', 'checkpoint', 'event']))

    const completed = await json<{
      ok: boolean
      completion: { outcome: string; evidenceIds: string[] }
      task: { status: string }
      evidence: { id: string; kind: string; status: string; metadata: { source: string } }
    }>(await app.request('/api/v1/tasks/TASK-HTTP-OS/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'RUN-HTTP-OS',
        summary: 'HTTP completion signal recorded',
        validation: ['npm run typecheck'],
        changedFiles: ['src/dashboard/DashboardServer.ts'],
      }),
    }))
    expect(completed.ok).toBe(true)
    expect(completed.task.status).toBe('completed')
    expect(completed.completion.outcome).toBe('complete')
    expect(completed.completion.evidenceIds).toContain(completed.evidence.id)
    expect(completed.evidence).toMatchObject({
      kind: 'final-report',
      status: 'passed',
      metadata: { source: 'dashboard-api' },
    })

    const capabilities = await json<{
      descriptors: Array<{ id: string; kind: string; trust: string; policyEnabled: boolean }>
    }>(await app.request('/api/v1/capabilities?capabilities=cua'))
    expect(capabilities.descriptors).toContainEqual(expect.objectContaining({
      id: 'desktop-cua',
      kind: 'desktop',
      trust: 'blocked',
      policyEnabled: false,
    }))

    const mapped = await json<{
      ok: boolean
      recommendations: Array<{ id: string }>
      capabilities: { descriptors: Array<{ id: string; kind: string; status: string }> }
    }>(await app.request('/api/v1/capabilities/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'Use CUA to inspect a WPS desktop workflow' }),
    }))
    expect(mapped.ok).toBe(false)
    expect(mapped.recommendations.map(item => item.id)).toContain('cua')
    expect(mapped.capabilities.descriptors).toContainEqual(expect.objectContaining({
      id: 'desktop-cua',
      kind: 'desktop',
      status: 'blocked',
    }))

    const filtered = await json<{
      total: number
      tasks: Array<{ taskId: string; status: string }>
    }>(await app.request('/api/v1/tasks?status=completed&level=L&agent=dashboard-api&service=runtime&surface=agent-tool&file=src/os/AgentOsTaskStore.ts'))
    expect(filtered.total).toBe(1)
    expect(filtered.tasks).toEqual([expect.objectContaining({ taskId: 'TASK-HTTP-OS', status: 'completed' })])
  })

  it('serves Agent OS bridge registration, heartbeats, auth, and event streams through v1 API', async () => {
    const projectDir = makeTempDir('scale-dashboard-agent-os-bridge-api-')
    const scaleDir = join(projectDir, '.scale')
    const server = new DashboardServer({ projectDir, scaleDir, projectName: 'Agent OS Bridge API Project' })
    const app = server.getApp()
    const originalToken = process.env.SCALE_AGENT_OS_API_TOKEN

    try {
      process.env.SCALE_AGENT_OS_API_TOKEN = 'local-api-token'
      const unauthorized = await app.request('/api/v1/bridges/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: 'BRIDGE-HTTP-IM', name: 'IM Bridge', kind: 'im' }),
      })
      expect(unauthorized.status).toBe(401)

      const registeredResponse = await app.request('/api/v1/bridges/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-scale-token': 'local-api-token',
        },
        body: JSON.stringify({
          bridgeId: 'BRIDGE-HTTP-IM',
          name: 'IM Bridge',
          kind: 'im',
          endpoint: 'https://example.test/bridge',
          token: 'bridge-secret',
          scopes: ['tasks:read', 'events:read', 'tasks:write'],
          capabilityIds: ['im-bridge'],
          metadata: { projectRef: 'cc-connect' },
        }),
      })
      expect(registeredResponse.status).toBe(201)
      const registered = await registeredResponse.json() as {
        bridge: { bridgeId: string; kind: string; status: string; tokenHash: string }
        token: string
        event: { type: string }
      }
      expect(registered.token).toBe('bridge-secret')
      expect(registered.bridge).toMatchObject({
        bridgeId: 'BRIDGE-HTTP-IM',
        kind: 'im',
        status: 'registered',
      })
      expect(registered.bridge.tokenHash).not.toContain('bridge-secret')
      expect(registered.event.type).toBe('bridge.registered')

      const heartbeat = await json<{
        bridge: { bridgeId: string; status: string; lastHeartbeatAt: string }
        event: { type: string; metadata: { bridgeId: string } }
      }>(await app.request('/api/v1/bridges/BRIDGE-HTTP-IM/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer bridge-secret',
        },
        body: JSON.stringify({}),
      }))
      expect(heartbeat.bridge).toMatchObject({
        bridgeId: 'BRIDGE-HTTP-IM',
        status: 'online',
      })
      expect(heartbeat.event).toMatchObject({
        type: 'bridge.heartbeat',
        metadata: { bridgeId: 'BRIDGE-HTTP-IM' },
      })

      const bridges = await json<{ bridges: Array<{ bridgeId: string; status: string }> }>(await app.request('/api/v1/bridges'))
      expect(bridges.bridges).toEqual([expect.objectContaining({ bridgeId: 'BRIDGE-HTTP-IM', status: 'online' })])

      const events = await json<{ total: number; events: Array<{ type: string; metadata: { bridgeId: string } }> }>(
        await app.request('/api/v1/events?type=bridge.heartbeat'),
      )
      expect(events.total).toBe(1)
      expect(events.events).toEqual([expect.objectContaining({
        type: 'bridge.heartbeat',
        metadata: expect.objectContaining({ bridgeId: 'BRIDGE-HTTP-IM' }),
      })])

      const stream = await app.request('/api/v1/events/stream?limit=5')
      expect(stream.status).toBe(200)
      const streamText = await stream.text()
      expect(streamText).toContain('event: snapshot')
      expect(streamText).toContain('event: bridge.registered')
      expect(streamText).toContain('event: bridge.heartbeat')
    } finally {
      if (originalToken === undefined) delete process.env.SCALE_AGENT_OS_API_TOKEN
      else process.env.SCALE_AGENT_OS_API_TOKEN = originalToken
    }
  })

  it('explains dashboard data sources, missing ledgers, and partial runtime wiring', async () => {
    const projectDir = makeTempDir('scale-dashboard-capabilities-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    mkdirSync(join(scaleDir, 'evidence', 'runtime'), { recursive: true })
    mkdirSync(join(scaleDir, 'ai-os', 'runs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'prototype.html'), '<main>Prototype</main>', 'utf-8')
    writeFileSync(join(scaleDir, 'evidence', 'runtime', 'run.json'), JSON.stringify({ status: 'passed' }), 'utf-8')
    writeFileSync(join(scaleDir, 'ai-os', 'runs', 'agent-plan.json'), JSON.stringify({
      plan: {
        agentCollaboration: {
          strategy: 'agent-collaboration-v1',
          roles: [{ profileId: 'frontend-agent' }],
        },
      },
      agentExecution: {
        strategy: 'agent-execution-settlement-v1',
        status: 'settled',
      },
    }), 'utf-8')
    new ModelUsageLedger(scaleDir).record({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      inputTokens: 1200,
      outputTokens: 300,
      cachedTokens: 400,
    })

    const server = new DashboardServer({ projectDir, scaleDir, projectName: 'Capability Project' })
    const app = server.getApp()
    const report = await json<{
      summary: { total: number; ready: number; partial: number; missing: number }
      realtime: { mode: string; heartbeatOnly: boolean }
      writeOps: { artifactTransitions: boolean; promptOptimization: boolean; documentEditing: boolean; knowledgeImport: boolean }
      dataSources: Array<{ id: string; status: string; count: number; emptyReason?: string }>
    }>(await app.request('/api/dashboard/capabilities'))

    const source = (id: string) => report.dataSources.find(item => item.id === id)
    expect(report.summary.total).toBeGreaterThanOrEqual(10)
    expect(report.summary.ready).toBeGreaterThanOrEqual(4)
    expect(report.summary.partial).toBeGreaterThanOrEqual(2)
    expect(report.realtime).toEqual(expect.objectContaining({
      mode: 'heartbeat-only',
      heartbeatOnly: true,
    }))
    expect(report.writeOps).toEqual(expect.objectContaining({
      artifactTransitions: false,
      promptOptimization: true,
      documentEditing: true,
      knowledgeImport: true,
    }))
    expect(source('runtime-evidence')).toEqual(expect.objectContaining({ status: 'ready', count: 1 }))
    expect(source('model-usage')).toEqual(expect.objectContaining({ status: 'ready', count: 1 }))
    expect(source('documents')).toEqual(expect.objectContaining({ status: 'ready', count: 1 }))
    expect(source('agent-collaboration')).toEqual(expect.objectContaining({ status: 'ready', count: 1 }))
    expect(source('dashboard-service')).toEqual(expect.objectContaining({
      status: expect.stringMatching(/missing|partial|ready/),
      source: join(scaleDir, 'artifacts', 'dashboard-service'),
    }))
    expect(source('feishu-channel')).toEqual(expect.objectContaining({
      status: expect.stringMatching(/missing|partial|ready/),
    }))
    expect(source('agent-control-plane')).toEqual(expect.objectContaining({
      status: expect.stringMatching(/partial|ready/),
      count: expect.any(Number),
    }))
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

    const integrations = await json<{
      summary: { providers: number }
      providers: Array<{
        id: string
        category: string
        command: string
        configBoundary: string
        dryRunSendPlan: { command: string; args: string[]; requiresConfirmation: boolean }
        eventConsumePlan: { command: string; args: string[]; risk: string }
        routeConfig: {
          configured: boolean
          configPath: string
          targetType: string
          targetId: string
          agentPlatformId: string
          agentSessionId: string
          dryRunSendPlan?: { command: string; args: string[]; requiresConfirmation: boolean }
          eventConsumePlan: { command: string; args: string[]; risk: string }
        }
        routeConfigs?: Array<{ agentPlatformId: string; routeId: string; configured: boolean }>
        knowledgeConfig?: { configured: boolean; configPath: string; consoleUrl: string }
        scope: { level: string; projectDir: string; projectScoped: boolean }
        platformTargets: Array<{ id: string; status: string; settingsPath?: string }>
        actions: Array<{ id: string; kind: string; plan: { command: string; args: string[] } }>
        setupCommands: string[]
        verifyCommands: string[]
      }>
      connectorWorkflow: {
        summary: { channels: number; readyChannels: number; providerPresets: number; skillPresets: number; automationLoops: number }
        config: { configured: boolean; configPath: string; bridge: { enabled: boolean; hasToken: boolean; allowPlatforms: string[] }; managementApi: { enabled: boolean; hasToken: boolean }; automation: { heartbeatIntervalMins: number }; endpoints: { bridgeWebSocket: string; managementApi: string } }
        channels: Array<{ id: string; status: string; configScope: string; capabilities: string[] }>
        bridge: { protocolVersion: number; inboundTypes: string[]; outboundTypes: string[]; restEndpoints: string[] }
        managementApi: { endpoints: string[] }
        providerPresets: Array<{ id: string; agents: string[]; authFields: string[] }>
        skillPresets: Array<{ id: string; defaultInstall: boolean; required: boolean }>
        automationLoops: Array<{ id: string; enabled: boolean }>
        daemon: { commands: string[]; hooks: string[] }
      }
      agentOs: {
        score: number
        status: string
        primaryAction: string
        summary: { ready: number; partial: number; missing: number; error: number; remoteControlReady: boolean; mobileControlReady: boolean; knowledgeReady: boolean; daemonReady: boolean }
        stages: Array<{ id: string; status: string; score: number; tab: string; primaryAction: string; evidence: string[]; blockers: string[]; commands: string[] }>
      }
      acceptance: {
        status: string
        score: number
        path: string
        steps: Array<{ id: string; status: string; error?: string }>
        nextActions: string[]
      }
    }>(await app.request('/api/integrations'))
    expect(integrations.summary.providers).toBe(2)
    expect(integrations.agentOs.score).toBeGreaterThanOrEqual(0)
    expect(integrations.agentOs.score).toBeLessThanOrEqual(100)
    expect(integrations.agentOs.primaryAction).toEqual(expect.any(String))
    expect(
      integrations.agentOs.summary.ready
      + integrations.agentOs.summary.partial
      + integrations.agentOs.summary.missing
      + integrations.agentOs.summary.error,
    ).toBe(integrations.agentOs.stages.length)
    expect(integrations.agentOs.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'remote-control', tab: 'agent-connect', commands: expect.arrayContaining([expect.stringContaining('scale agent-control inbox')]) }),
      expect.objectContaining({ id: 'mobile-message-channel', tab: 'messages', commands: expect.arrayContaining(['lark-cli doctor']) }),
      expect.objectContaining({ id: 'agent-control-session', tab: 'overview' }),
      expect.objectContaining({ id: 'knowledge-memory', tab: 'knowledge' }),
      expect.objectContaining({ id: 'loop-automation', tab: 'automation' }),
      expect.objectContaining({ id: 'diagnostic-acceptance', tab: 'diagnostics' }),
    ]))
    expect(integrations.connectorWorkflow.summary.channels).toBeGreaterThanOrEqual(13)
    expect(integrations.connectorWorkflow.config).toEqual(expect.objectContaining({
      configured: false,
      configPath: join(scaleDir, 'integrations', 'agent-connect.json'),
    }))
    expect(integrations.connectorWorkflow.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dashboard-local', status: 'ready', configScope: 'session' }),
      expect.objectContaining({ id: 'feishu', configScope: 'agent-platform' }),
      expect.objectContaining({ id: 'bridge-custom', capabilities: expect.arrayContaining(['stream-preview']) }),
      expect.objectContaining({ id: 'wecom' }),
      expect.objectContaining({ id: 'dingtalk' }),
      expect.objectContaining({ id: 'slack' }),
      expect.objectContaining({ id: 'telegram' }),
      expect.objectContaining({ id: 'discord' }),
      expect.objectContaining({ id: 'matrix' }),
      expect.objectContaining({ id: 'qq' }),
      expect.objectContaining({ id: 'qqbot' }),
      expect.objectContaining({ id: 'weixin-ilink' }),
      expect.objectContaining({ id: 'wps-xiezuo' }),
      expect.objectContaining({ id: 'max-webhook' }),
    ]))
    expect(integrations.connectorWorkflow.bridge).toEqual(expect.objectContaining({
      protocolVersion: 1,
      inboundTypes: expect.arrayContaining(['register', 'message', 'preview_ack']),
      outboundTypes: expect.arrayContaining(['reply', 'reply_stream', 'update_message']),
      restEndpoints: expect.arrayContaining([
        'GET /bridge/sessions',
        'POST /bridge/events',
        'GET /bridge/sessions/{id}/events',
        'POST /agent-connect/webhook',
        'POST /bridge/sessions/switch',
      ]),
    }))
    expect(integrations.connectorWorkflow.managementApi.endpoints).toEqual(expect.arrayContaining([
      'GET /api/v1/status',
      'POST /api/v1/reload',
      'GET /api/v1/projects/{name}/sessions',
      'POST /api/v1/projects/{name}/send',
    ]))
    expect(integrations.connectorWorkflow.providerPresets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'minimax', agents: expect.arrayContaining(['codex']), authFields: expect.arrayContaining(['apiKey']) }),
      expect.objectContaining({ id: 'aihubmix' }),
    ]))
    expect(integrations.connectorWorkflow.skillPresets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gbrain-memory', required: true, defaultInstall: true }),
      expect.objectContaining({ id: 'hookify-rules', required: true, defaultInstall: true }),
      expect.objectContaining({ id: 'find-skills', defaultInstall: true }),
    ]))
    expect(integrations.connectorWorkflow.automationLoops).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'permission-request' }),
      expect.objectContaining({ id: 'heartbeat' }),
      expect.objectContaining({ id: 'daemon-watchdog' }),
    ]))
    expect(integrations.connectorWorkflow.daemon.commands).toEqual(expect.arrayContaining([
      'scale dashboard daemon ensure --dir .',
    ]))
    const feishuProvider = integrations.providers.find(provider => provider.id === 'feishu')
    const imaProvider = integrations.providers.find(provider => provider.id === 'tencent-ima')
    expect(feishuProvider).toEqual(expect.objectContaining({
      id: 'feishu',
      category: 'message-channel',
      command: 'lark-cli',
      configBoundary: expect.stringContaining('keychain'),
      setupCommands: expect.arrayContaining([
        'lark-cli config init --new --lang zh',
      ]),
      verifyCommands: expect.arrayContaining([
        'lark-cli doctor',
      ]),
      scope: expect.objectContaining({
        level: 'machine',
        projectScoped: false,
      }),
    }))
    expect(feishuProvider?.routeConfigs).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentPlatformId: 'hermes' }),
      expect.objectContaining({ agentPlatformId: 'openclaw' }),
    ]))
    expect(feishuProvider?.platformTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hermes' }),
      expect.objectContaining({ id: 'openclaw' }),
    ]))
    expect(feishuProvider?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'doctor', kind: 'probe' }),
      expect.objectContaining({ id: 'dry-run-send', kind: 'dry-run' }),
      expect.objectContaining({ id: 'consume-once', kind: 'read' }),
    ]))
    expect(feishuProvider?.dryRunSendPlan).toEqual(expect.objectContaining({
      command: 'lark-cli',
      requiresConfirmation: false,
    }))
    expect(feishuProvider?.dryRunSendPlan.args).toContain('--dry-run')
    expect(feishuProvider?.eventConsumePlan.args).toEqual(expect.arrayContaining(['event', 'consume', 'im.message.receive_v1']))
    expect(feishuProvider?.routeConfig).toEqual(expect.objectContaining({
      configured: false,
      targetType: 'chat',
      targetId: '',
      agentPlatformId: 'codex',
      agentSessionId: 'default',
      configPath: join(scaleDir, 'integrations', 'feishu-channel.json'),
    }))
    expect(feishuProvider?.routeConfig.eventConsumePlan.args).toEqual(expect.arrayContaining(['event', 'consume', 'im.message.receive_v1']))
    expect(imaProvider).toEqual(expect.objectContaining({
      id: 'tencent-ima',
      category: 'knowledge-provider',
      command: 'browser',
      knowledgeConfig: expect.objectContaining({
        configured: false,
        configPath: join(scaleDir, 'integrations', 'tencent-ima-knowledge.json'),
        consoleUrl: 'https://ima.qq.com/agent-interface',
      }),
    }))

    const bootstrappedAgentOs = await json<{
      ok: boolean
      saved: boolean
      config: {
        configured: boolean
        configPath: string
        managementApi: { enabled: boolean; hasToken: boolean; tokenMasked?: string }
        bridge: { enabled: boolean; hasToken: boolean; allowPlatforms: string[]; tokenMasked?: string }
        webhook: { enabled: boolean; hasToken: boolean; tokenMasked?: string }
        automation: { cronEnabled: boolean; heartbeatEnabled: boolean; maxTurnTimeMins: number; resetOnIdleMins: number }
      }
      agentOs: {
        score: number
        stages: Array<{ id: string; status: string; blockers: string[] }>
      }
      secrets: { path: string; rawStored: boolean; tokens: { managementApi: string; bridge: string; webhook: string } }
      actions: string[]
    }>(await app.request('/api/integrations/agent-os/bootstrap-local', { method: 'POST' }))
    expect(bootstrappedAgentOs).toEqual(expect.objectContaining({
      ok: true,
      saved: true,
      config: expect.objectContaining({
        configured: true,
        configPath: join(scaleDir, 'integrations', 'agent-connect.json'),
        managementApi: expect.objectContaining({ enabled: true, hasToken: true }),
        bridge: expect.objectContaining({ enabled: true, hasToken: true, allowPlatforms: expect.arrayContaining(['feishu', 'bridge-custom', 'matrix']) }),
        webhook: expect.objectContaining({ enabled: true, hasToken: true }),
        automation: expect.objectContaining({ cronEnabled: true, heartbeatEnabled: true, maxTurnTimeMins: 90, resetOnIdleMins: 20 }),
      }),
      secrets: expect.objectContaining({
        path: join(scaleDir, 'secrets', 'agent-connect.local.json'),
        rawStored: true,
        tokens: expect.objectContaining({
          managementApi: expect.stringMatching(/^mgmt\.\.\.\w{4}$/),
          bridge: expect.stringMatching(/^brid\.\.\.\w{4}$/),
          webhook: expect.stringMatching(/^webh\.\.\.\w{4}$/),
        }),
      }),
      actions: expect.arrayContaining([
        expect.stringContaining('Agent Connect config saved'),
      ]),
    }))
    expect(bootstrappedAgentOs.agentOs.score).toBeGreaterThan(integrations.agentOs.score)
    expect(bootstrappedAgentOs.agentOs.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'remote-control', status: 'ready', blockers: [] }),
      expect.objectContaining({ id: 'agent-control-session', status: 'ready', blockers: [] }),
      expect.objectContaining({ id: 'loop-automation', status: 'partial' }),
    ]))
    const acceptance = await json<{
      ok: boolean
      status: string
      score: number
      path: string
      steps: Array<{ id: string; status: string; error?: string }>
      nextActions: string[]
    }>(await app.request('/api/integrations/agent-os/acceptance', { method: 'POST' }))
    expect(acceptance.status).toMatch(/^(passed|failed|blocked)$/)
    expect(acceptance.score).toBeGreaterThanOrEqual(0)
    expect(acceptance.score).toBeLessThanOrEqual(100)
    expect(acceptance.path).toBe(join(scaleDir, 'integrations', 'agent-os-acceptance.json'))
    expect(acceptance.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'integrations-api' }),
      expect.objectContaining({ id: 'agent-control-ready' }),
      expect.objectContaining({ id: 'dashboard-daemon' }),
      expect.objectContaining({ id: 'lark-cli-doctor' }),
      expect.objectContaining({ id: 'feishu-route-target' }),
      expect.objectContaining({ id: 'tencent-ima-provider' }),
    ]))
    expect(JSON.parse(readFileSync(join(scaleDir, 'integrations', 'agent-os-acceptance.json'), 'utf-8'))).toEqual(expect.objectContaining({
      status: acceptance.status,
      steps: expect.any(Array),
    }))
    const feishuAuth = await json<{
      provider: string
      ok: boolean
      status: string
      command: string
      args: string[]
      verificationUrl?: string
      setupCommand?: string
      error?: string
    }>(await app.request('/api/integrations/feishu/auth/start', { method: 'POST' }))
    expect(feishuAuth).toEqual(expect.objectContaining({
      provider: 'feishu',
      command: 'lark-cli',
      args: expect.arrayContaining(['auth', 'login', '--no-wait', '--json']),
    }))
    expect(['started', 'blocked', 'failed']).toContain(feishuAuth.status)
    if (feishuAuth.status === 'started') {
      expect(feishuAuth.verificationUrl).toEqual(expect.any(String))
    } else {
      expect(feishuAuth.setupCommand || feishuAuth.error).toEqual(expect.any(String))
    }
    const bootstrapConfigFile = readFileSync(join(scaleDir, 'integrations', 'agent-connect.json'), 'utf-8')
    expect(bootstrapConfigFile).not.toContain('mgmt_')
    expect(bootstrapConfigFile).not.toContain('bridge_')
    expect(bootstrapConfigFile).not.toContain('webhook_')
    const bootstrapSecretFile = JSON.parse(readFileSync(join(scaleDir, 'secrets', 'agent-connect.local.json'), 'utf-8')) as { tokens: Record<string, string> }
    expect(bootstrapSecretFile.tokens.managementApi).toMatch(/^mgmt_[a-f0-9]{48}$/)
    expect(bootstrapSecretFile.tokens.bridge).toMatch(/^bridge_[a-f0-9]{48}$/)
    expect(bootstrapSecretFile.tokens.webhook).toMatch(/^webhook_[a-f0-9]{48}$/)

    const savedAgentConnect = await json<{
      ok: boolean
      saved: boolean
      config: {
        configured: boolean
        configPath: string
        managementApi: { enabled: boolean; hasToken: boolean; tokenMasked?: string }
        bridge: { enabled: boolean; hasToken: boolean; allowPlatforms: string[]; tokenMasked?: string }
        webhook: { enabled: boolean; hasToken: boolean; tokenMasked?: string }
        automation: { cronEnabled: boolean; heartbeatEnabled: boolean; heartbeatIntervalMins: number; maxTurnTimeMins: number; resetOnIdleMins: number }
        endpoints: { managementApi: string; bridgeWebSocket: string; webhook: string }
      }
    }>(await app.request('/api/integrations/agent-connect', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        managementApi: {
          enabled: true,
          host: '127.0.0.1',
          port: 9820,
          token: 'management-token-123456',
          corsOrigins: ['http://127.0.0.1:3210'],
        },
        bridge: {
          enabled: true,
          host: '127.0.0.1',
          port: 9810,
          path: '/bridge/ws',
          token: 'bridge-token-123456',
          allowPlatforms: ['feishu', 'bridge-custom', 'matrix'],
        },
        webhook: {
          enabled: true,
          path: '/agent-connect/webhook',
          token: 'webhook-token-123456',
        },
        automation: {
          cronEnabled: true,
          heartbeatEnabled: true,
          heartbeatIntervalMins: 15,
          maxTurnTimeMins: 90,
          resetOnIdleMins: 20,
          longTaskNotifications: true,
        },
      }),
    }))
    expect(savedAgentConnect).toEqual(expect.objectContaining({
      ok: true,
      saved: true,
      config: expect.objectContaining({
        configured: true,
        configPath: join(scaleDir, 'integrations', 'agent-connect.json'),
        managementApi: expect.objectContaining({ enabled: true, hasToken: true, tokenMasked: 'mana...3456' }),
        bridge: expect.objectContaining({ enabled: true, hasToken: true, allowPlatforms: ['feishu', 'bridge-custom', 'matrix'], tokenMasked: 'brid...3456' }),
        webhook: expect.objectContaining({ enabled: true, hasToken: true, tokenMasked: 'webh...3456' }),
        automation: expect.objectContaining({ cronEnabled: true, heartbeatEnabled: true, heartbeatIntervalMins: 15, maxTurnTimeMins: 90, resetOnIdleMins: 20 }),
        endpoints: expect.objectContaining({ bridgeWebSocket: 'ws://127.0.0.1:9810/bridge/ws' }),
      }),
    }))
    const savedAgentConnectFile = JSON.parse(readFileSync(join(scaleDir, 'integrations', 'agent-connect.json'), 'utf-8')) as Record<string, unknown>
    expect(JSON.stringify(savedAgentConnectFile)).not.toContain('bridge-token-123456')
    expect(savedAgentConnectFile).toEqual(expect.objectContaining({
      enabled: true,
      bridge: expect.objectContaining({
        enabled: true,
        hasToken: true,
        tokenMasked: 'brid...3456',
        allowPlatforms: ['feishu', 'bridge-custom', 'matrix'],
      }),
    }))

    const refreshedAgentConnect = await json<{
      configured: boolean
      bridge: { hasToken: boolean; allowPlatforms: string[] }
      automation: { heartbeatIntervalMins: number }
    }>(await app.request('/api/integrations/agent-connect'))
    expect(refreshedAgentConnect).toEqual(expect.objectContaining({
      configured: true,
      bridge: expect.objectContaining({ hasToken: true, allowPlatforms: ['feishu', 'bridge-custom', 'matrix'] }),
      automation: expect.objectContaining({ heartbeatIntervalMins: 15 }),
    }))

    const refreshedIntegrationsAfterAgentConnect = await json<{
      connectorWorkflow: { config: { configured: boolean }; channels: Array<{ id: string; status: string }>; automationLoops: Array<{ id: string; enabled: boolean }> }
    }>(await app.request('/api/integrations'))
    expect(refreshedIntegrationsAfterAgentConnect.connectorWorkflow.config.configured).toBe(true)
    expect(refreshedIntegrationsAfterAgentConnect.connectorWorkflow.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bridge-custom', status: 'ready' }),
    ]))
    expect(refreshedIntegrationsAfterAgentConnect.connectorWorkflow.automationLoops).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cron', enabled: true }),
      expect.objectContaining({ id: 'heartbeat', enabled: true }),
    ]))

    const savedRoute = await json<{
      ok: boolean
      saved: boolean
      route: {
        configured: boolean
        targetType: string
        targetId: string
        agentPlatformId: string
        agentSessionId: string
        projectDir: string
        dryRunSendPlan?: { command: string; args: string[]; requiresConfirmation: boolean }
      }
    }>(await app.request('/api/integrations/feishu/route', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routeName: 'Release channel',
        targetType: 'chat',
        targetId: 'oc_release_channel',
        agentPlatformId: 'openclaw',
        agentSessionId: 'release-session',
        allowWriteCommands: true,
      }),
    }))
    expect(savedRoute).toEqual(expect.objectContaining({
      ok: true,
      saved: true,
      route: expect.objectContaining({
        configured: true,
        targetType: 'chat',
        targetId: 'oc_release_channel',
        agentPlatformId: 'openclaw',
        agentSessionId: 'release-session',
        projectDir,
      }),
    }))
    expect(savedRoute.route.dryRunSendPlan).toEqual(expect.objectContaining({
      command: 'lark-cli',
      requiresConfirmation: false,
    }))
    expect(savedRoute.route.dryRunSendPlan?.args).toEqual(expect.arrayContaining(['--chat-id', 'oc_release_channel', '--dry-run']))
    const savedRouteFile = JSON.parse(readFileSync(join(scaleDir, 'integrations', 'feishu-channel.json'), 'utf-8')) as Record<string, unknown>
    expect(savedRouteFile).toEqual(expect.objectContaining({
      projectDir,
      provider: 'feishu',
      routes: expect.arrayContaining([
        expect.objectContaining({
          routeName: 'Release channel',
          targetId: 'oc_release_channel',
          allowWriteCommands: true,
          agentPlatformId: 'openclaw',
        }),
      ]),
    }))

    const refreshedRoute = await json<{
      configured: boolean
      targetId: string
      dryRunSendPlan?: { args: string[] }
    }>(await app.request('/api/integrations/feishu/route'))
    expect(refreshedRoute).toEqual(expect.objectContaining({
      configured: true,
      targetId: 'oc_release_channel',
    }))
    expect(refreshedRoute.dryRunSendPlan?.args).toEqual(expect.arrayContaining(['--chat-id', 'oc_release_channel']))

    const initialAgentControl = await json<{
      summary: { sessions: number; queuedMessages: number }
      modelOptions: Array<{ id: string; modelId: string }>
      platformTargets: Array<{ id: string; status: string }>
      sessions: Array<{ sessionId: string; status: string; channel: { provider: string } }>
    }>(await app.request('/api/agent-control'))
    expect(initialAgentControl.summary.sessions).toBeGreaterThanOrEqual(1)
    expect(initialAgentControl.modelOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'balanced' }),
      expect.objectContaining({ id: 'deepseek-v3', modelId: 'deepseek-v3' }),
    ]))
    expect(initialAgentControl.platformTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hermes' }),
      expect.objectContaining({ id: 'openclaw' }),
    ]))

    const savedAgentSession = await json<{
      ok: boolean
      session: {
        sessionId: string
        platformId: string
        modelId: string
        channelProvider: string
        channel: { provider: string; targetLabel: string; routeId: string }
      }
    }>(await app.request('/api/agent-control/sessions/release-session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Release agent',
        platformId: 'openclaw',
        modelId: 'deepseek-v3',
        channelProvider: 'feishu',
        mode: 'interactive',
        commandPrefix: '/scale',
      }),
    }))
    expect(savedAgentSession).toEqual(expect.objectContaining({
      ok: true,
      session: expect.objectContaining({
        sessionId: 'release-session',
        platformId: 'openclaw',
        modelId: 'deepseek-v3',
        channelProvider: 'feishu',
        channel: expect.objectContaining({
          provider: 'feishu',
          targetLabel: 'chat:oc_release_channel',
        }),
      }),
    }))

    const managementStatus = await json<{
      ok: boolean
      project: { id: string; name: string }
      agentControl: { sessions: number }
      connectorWorkflow: { channels: number }
      security: { managementTokenConfigured: boolean; bridgeTokenConfigured: boolean; plaintextTokensStored: boolean }
    }>(await app.request('/api/v1/status'))
    expect(managementStatus).toEqual(expect.objectContaining({
      ok: true,
      project: expect.objectContaining({ id: 'capability-project', name: 'Capability Project' }),
      security: expect.objectContaining({
        managementTokenConfigured: true,
        bridgeTokenConfigured: true,
        plaintextTokensStored: false,
      }),
    }))
    expect(managementStatus.agentControl.sessions).toBeGreaterThanOrEqual(1)
    expect(managementStatus.connectorWorkflow.channels).toBeGreaterThanOrEqual(13)

    const managementProjects = await json<{
      projects: Array<{ id: string; name: string }>
      currentProject: { id: string }
    }>(await app.request('/api/v1/projects'))
    expect(managementProjects.currentProject.id).toBe('capability-project')
    expect(managementProjects.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'capability-project' }),
    ]))

    const managementSessions = await json<{
      ok: boolean
      sessions: Array<{ sessionId: string; platformId: string; modelId: string }>
    }>(await app.request('/api/v1/projects/capability-project/sessions'))
    expect(managementSessions).toEqual(expect.objectContaining({
      ok: true,
      sessions: expect.arrayContaining([
        expect.objectContaining({ sessionId: 'release-session', platformId: 'openclaw' }),
      ]),
    }))

    const managementProviders = await json<{
      ok: boolean
      providers: Array<{ id: string }>
      channels: Array<{ id: string }>
      modelOptions: Array<{ id: string }>
      platformTargets: Array<{ id: string }>
    }>(await app.request('/api/v1/projects/capability-project/providers'))
    expect(managementProviders).toEqual(expect.objectContaining({
      ok: true,
      providers: expect.arrayContaining([expect.objectContaining({ id: 'feishu' })]),
      channels: expect.arrayContaining([expect.objectContaining({ id: 'bridge-custom' })]),
      modelOptions: expect.arrayContaining([expect.objectContaining({ id: 'balanced' })]),
      platformTargets: expect.arrayContaining([expect.objectContaining({ id: 'openclaw' })]),
    }))

    const managementModel = await json<{
      ok: boolean
      session: { sessionId: string; platformId: string; modelId: string; channelProvider: string }
    }>(await app.request('/api/v1/projects/capability-project/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'remote-model-session',
        name: 'Remote model session',
        platformId: 'openclaw',
        modelId: 'balanced',
        channelProvider: 'dashboard',
      }),
    }))
    expect(managementModel).toEqual(expect.objectContaining({
      ok: true,
      session: expect.objectContaining({
        sessionId: 'remote-model-session',
        platformId: 'openclaw',
        modelId: 'balanced',
      }),
    }))

    const managementSend = await json<{
      ok: boolean
      message: { id: string; sessionId: string; status: string; text: string; from: string }
    }>(await app.request('/api/v1/projects/capability-project/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'remote-model-session',
        text: 'remote management api coding task',
        dryRun: true,
        from: 'mobile-panel',
      }),
    }))
    expect(managementSend).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        sessionId: 'remote-model-session',
        status: 'queued',
        text: 'remote management api coding task',
        from: 'mobile-panel',
      }),
    }))
    const managementCompleted = await json<{
      ok: boolean
      message: { id: string; sessionId: string; status: string }
      reply?: { text: string; from: string }
    }>(await app.request(`/api/agent-control/sessions/remote-model-session/messages/${managementSend.message.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'remote-management-runtime',
        status: 'completed',
        text: 'remote management api task accepted',
      }),
    }))
    expect(managementCompleted).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        id: managementSend.message.id,
        sessionId: 'remote-model-session',
        status: 'completed',
      }),
      reply: expect.objectContaining({
        from: 'remote-management-runtime',
        text: 'remote management api task accepted',
      }),
    }))

    const cronLoops = await json<{
      ok: boolean
      loops: Array<{ id: string; enabled: boolean }>
    }>(await app.request('/api/v1/cron'))
    expect(cronLoops).toEqual(expect.objectContaining({
      ok: true,
      loops: expect.arrayContaining([expect.objectContaining({ id: 'heartbeat', enabled: true })]),
    }))
    const heartbeatExec = await json<{
      ok: boolean
      result: string
      loop: { id: string }
    }>(await app.request('/api/v1/cron/heartbeat/exec', { method: 'POST' }))
    expect(heartbeatExec).toEqual(expect.objectContaining({
      ok: true,
      result: 'trigger-recorded',
      loop: expect.objectContaining({ id: 'heartbeat' }),
    }))

    const bridgeAdapters = await json<{
      ok: boolean
      enabled: boolean
      tokenConfigured: boolean
      allowPlatforms: string[]
      adapters: Array<{ id: string; status: string }>
    }>(await app.request('/api/v1/bridge/adapters'))
    expect(bridgeAdapters).toEqual(expect.objectContaining({
      ok: true,
      enabled: true,
      tokenConfigured: true,
      allowPlatforms: ['feishu', 'bridge-custom', 'matrix'],
      adapters: expect.arrayContaining([expect.objectContaining({ id: 'bridge-custom', status: 'ready' })]),
    }))

    const bridgeCreated = await json<{
      ok: boolean
      activeSessionId?: string
      session: { id: string; platform: string; agentPlatformId: string; agentSessionId: string; active: boolean }
      sessions: Array<{ id: string; agentSessionId: string; active: boolean }>
    }>(await app.request('/bridge/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'bridge-custom',
        agentPlatformId: 'openclaw',
        agentSessionId: 'bridge-release',
        user: 'mobile-user',
        title: 'Mobile bridge release',
        active: true,
        capabilities: ['text', 'card'],
      }),
    }))
    expect(bridgeCreated).toEqual(expect.objectContaining({
      ok: true,
      activeSessionId: bridgeCreated.session.id,
      session: expect.objectContaining({
        platform: 'bridge-custom',
        agentPlatformId: 'openclaw',
        agentSessionId: 'bridge-release',
        active: true,
      }),
      sessions: expect.arrayContaining([expect.objectContaining({ agentSessionId: 'bridge-release', active: true })]),
    }))

    const bridgeSession = await json<{
      ok: boolean
      session: { id: string; agentSessionId: string }
    }>(await app.request(`/bridge/sessions/${bridgeCreated.session.id}`))
    expect(bridgeSession).toEqual(expect.objectContaining({
      ok: true,
      session: expect.objectContaining({ agentSessionId: 'bridge-release' }),
    }))

    const bridgeSwitched = await json<{
      ok: boolean
      activeSessionId?: string
      session: { id: string; active: boolean }
    }>(await app.request('/bridge/sessions/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentSessionId: 'bridge-release' }),
    }))
    expect(bridgeSwitched).toEqual(expect.objectContaining({
      ok: true,
      activeSessionId: bridgeCreated.session.id,
      session: expect.objectContaining({ id: bridgeCreated.session.id, active: true }),
    }))

    const bridgeRegister = await json<{
      ok: boolean
      event: { id: string; payload: { token?: string } }
      session: { id: string; platform: string; agentSessionId: string }
      outbound: Array<{ type: string; sessionId: string; agentSessionId?: string }>
    }>(await app.request('/bridge/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'register',
        platform: 'bridge-custom',
        agentPlatformId: 'openclaw',
        agentSessionId: 'bridge-runtime',
        user: 'mobile-user',
        title: 'Bridge runtime',
        capabilities: ['text', 'card'],
        token: 'bridge-runtime-secret',
      }),
    }))
    expect(bridgeRegister).toEqual(expect.objectContaining({
      ok: true,
      event: expect.objectContaining({
        payload: expect.objectContaining({ token: '***' }),
      }),
      session: expect.objectContaining({
        platform: 'bridge-custom',
        agentSessionId: 'bridge-runtime',
      }),
      outbound: expect.arrayContaining([
        expect.objectContaining({ type: 'register_ack', agentSessionId: 'bridge-runtime' }),
      ]),
    }))
    expect(readFileSync(join(scaleDir, 'agents', 'bridge-events.jsonl'), 'utf-8')).not.toContain('bridge-runtime-secret')

    const bridgeMessage = await json<{
      ok: boolean
      session: { id: string; agentSessionId: string }
      agentMessage: { id: string; sessionId: string; status: string; text: string }
      outbound: Array<{ type: string; messageId?: string }>
    }>(await app.request('/bridge/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        sessionId: bridgeRegister.session.id,
        text: 'bridge runtime task',
        dryRun: true,
      }),
    }))
    expect(bridgeMessage).toEqual(expect.objectContaining({
      ok: true,
      session: expect.objectContaining({ agentSessionId: 'bridge-runtime' }),
      agentMessage: expect.objectContaining({
        sessionId: 'bridge-runtime',
        status: 'queued',
        text: 'bridge runtime task',
      }),
      outbound: expect.arrayContaining([
        expect.objectContaining({ type: 'preview_start', messageId: bridgeMessage.agentMessage.id }),
      ]),
    }))

    const bridgeCompleted = await json<{
      ok: boolean
      message: { id: string; sessionId: string; status: string }
      reply?: { text: string; direction: string }
    }>(await app.request(`/api/agent-control/sessions/bridge-runtime/messages/${bridgeMessage.agentMessage.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'bridge-runtime-agent',
        status: 'completed',
        text: 'bridge runtime reply delivered',
      }),
    }))
    expect(bridgeCompleted).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        id: bridgeMessage.agentMessage.id,
        status: 'completed',
      }),
      reply: expect.objectContaining({
        direction: 'agent-to-operator',
        text: 'bridge runtime reply delivered',
      }),
    }))

    const bridgePolled = await json<{
      ok: boolean
      session: { id: string; agentSessionId: string }
      nextCursor: number
      events: Array<{ type: string; text: string; messageId: string }>
    }>(await app.request(`/bridge/sessions/${bridgeRegister.session.id}/events?cursor=0`))
    expect(bridgePolled).toEqual(expect.objectContaining({
      ok: true,
      session: expect.objectContaining({ agentSessionId: 'bridge-runtime' }),
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'preview_start', text: 'bridge runtime task' }),
        expect.objectContaining({ type: 'reply', text: 'bridge runtime reply delivered' }),
      ]),
    }))
    expect(bridgePolled.nextCursor).toBeGreaterThan(0)

    const webhookMessage = await json<{
      ok: boolean
      session: { id: string; platform: string; agentSessionId: string; user: string }
      agentMessage: { id: string; sessionId: string; status: string; text: string }
    }>(await app.request('/agent-connect/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'feishu',
        agentPlatformId: 'openclaw',
        agentSessionId: 'webhook-release',
        senderId: 'ou_release_user',
        text: 'webhook inbound task',
        dryRun: true,
      }),
    }))
    expect(webhookMessage).toEqual(expect.objectContaining({
      ok: true,
      session: expect.objectContaining({
        platform: 'feishu',
        agentSessionId: 'webhook-release',
        user: 'ou_release_user',
      }),
      agentMessage: expect.objectContaining({
        sessionId: 'webhook-release',
        status: 'queued',
        text: 'webhook inbound task',
      }),
    }))

    const webhookCompleted = await json<{
      ok: boolean
      message: { id: string; sessionId: string; status: string }
    }>(await app.request(`/api/agent-control/sessions/webhook-release/messages/${webhookMessage.agentMessage.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'webhook-runtime-agent',
        status: 'completed',
        text: 'webhook task delivered',
      }),
    }))
    expect(webhookCompleted).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        id: webhookMessage.agentMessage.id,
        sessionId: 'webhook-release',
        status: 'completed',
      }),
    }))

    const bridgeDeleted = await json<{
      ok: boolean
      deleted: { id: string; agentSessionId: string }
    }>(await app.request(`/bridge/sessions/${bridgeCreated.session.id}`, { method: 'DELETE' }))
    expect(bridgeDeleted).toEqual(expect.objectContaining({
      ok: true,
      deleted: expect.objectContaining({ id: bridgeCreated.session.id, agentSessionId: 'bridge-release' }),
    }))

    const queuedMessage = await json<{
      ok: boolean
      message: {
        id: string
        sessionId: string
        status: string
        dryRun: boolean
        text: string
        commandPlan?: { command: string; args: string[] }
      }
    }>(await app.request('/api/agent-control/sessions/release-session/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '请检查发布风险并给出下一步建议',
        dryRun: true,
        from: 'dashboard',
      }),
    }))
    expect(queuedMessage).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        sessionId: 'release-session',
        status: 'queued',
        dryRun: true,
        text: '请检查发布风险并给出下一步建议',
      }),
    }))
    expect(queuedMessage.message.commandPlan).toEqual(expect.objectContaining({
      command: 'lark-cli',
      args: expect.arrayContaining(['--chat-id', 'oc_release_channel', '--dry-run']),
    }))

    const inbox = await json<{
      sessionId: string
      messages: Array<{ id: string; sessionId: string; status: string; text: string }>
    }>(await app.request('/api/agent-control/sessions/release-session/inbox'))
    expect(inbox).toEqual(expect.objectContaining({
      sessionId: 'release-session',
      messages: expect.arrayContaining([
        expect.objectContaining({ status: 'queued', text: '请检查发布风险并给出下一步建议' }),
      ]),
    }))

    const claimedTask = await json<{
      ok: boolean
      message: { id: string; sessionId: string; status: string; claimedBy?: string; claimedAt?: number }
    }>(await app.request(`/api/agent-control/sessions/release-session/messages/${queuedMessage.message.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'codex-runtime' }),
    }))
    expect(claimedTask).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        id: queuedMessage.message.id,
        status: 'claimed',
        claimedBy: 'codex-runtime',
      }),
    }))
    expect(claimedTask.message.claimedAt).toBeGreaterThan(0)

    const defaultInboxAfterClaim = await json<{
      messages: Array<{ id: string; status: string }>
    }>(await app.request('/api/agent-control/sessions/release-session/inbox'))
    expect(defaultInboxAfterClaim.messages).toEqual([])

    const claimedInbox = await json<{
      messages: Array<{ id: string; status: string; claimedBy?: string }>
    }>(await app.request('/api/agent-control/sessions/release-session/inbox?includeClaimed=true'))
    expect(claimedInbox.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: queuedMessage.message.id,
        status: 'claimed',
        claimedBy: 'codex-runtime',
      }),
    ]))

    const completedTask = await json<{
      ok: boolean
      message: { id: string; status: string; result?: string; completedAt?: number; evidencePath?: string }
      reply?: { sessionId: string; status: string; direction: string; from: string; text: string }
    }>(await app.request(`/api/agent-control/sessions/release-session/messages/${queuedMessage.message.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'codex-runtime',
        status: 'completed',
        text: 'release risk checked by runtime',
        evidencePath: '.scale/evidence/runtime/release-check.json',
      }),
    }))
    expect(completedTask).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        id: queuedMessage.message.id,
        status: 'completed',
        result: 'completed',
        evidencePath: '.scale/evidence/runtime/release-check.json',
      }),
      reply: expect.objectContaining({
        direction: 'agent-to-operator',
        from: 'codex-runtime',
        status: 'delivered',
        text: 'release risk checked by runtime',
      }),
    }))
    expect(completedTask.message.completedAt).toBeGreaterThan(0)

    const agentReply = await json<{
      ok: boolean
      message: { sessionId: string; status: string; direction: string; text: string }
    }>(await app.request('/api/agent-control/sessions/release-session/replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '已收到，建议先运行发版验证。' }),
    }))
    expect(agentReply).toEqual(expect.objectContaining({
      ok: true,
      message: expect.objectContaining({
        sessionId: 'release-session',
        direction: 'agent-to-operator',
        status: 'delivered',
      }),
    }))

    const refreshedAgentControl = await json<{
      summary: { sessions: number; queuedMessages: number; claimedMessages: number; completedMessages: number }
      sessions: Array<{ sessionId: string; messageCount: number; pendingCount: number }>
      messages: Array<{ sessionId: string; text: string }>
    }>(await app.request('/api/agent-control'))
    expect(refreshedAgentControl.summary.queuedMessages).toBe(0)
    expect(refreshedAgentControl.summary.claimedMessages).toBe(0)
    expect(refreshedAgentControl.summary.completedMessages).toBeGreaterThanOrEqual(1)
    expect(refreshedAgentControl.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'release-session',
        messageCount: 3,
        pendingCount: 0,
      }),
    ]))
    expect(refreshedAgentControl.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'release-session', text: 'release risk checked by runtime' }),
      expect.objectContaining({ sessionId: 'release-session', text: '已收到，建议先运行发版验证。' }),
    ]))

    const transcript = await json<{
      session: { sessionId: string; platformName: string }
      messageCount: number
      messages: Array<{ id: string; direction: string; status: string; text: string }>
      summary: { sessionId: string; messageCount: number; completedMessages: number; latestAgentText?: string; markdown: string }
      storage: { messagesPath: string; summaryPath: string }
    }>(await app.request('/api/agent-control/sessions/release-session/transcript'))
    expect(transcript.session).toEqual(expect.objectContaining({
      sessionId: 'release-session',
      platformName: 'OpenClaw',
    }))
    expect(transcript.messageCount).toBe(3)
    expect(transcript.messages.map(message => message.id)).toContain(queuedMessage.message.id)
    expect(transcript.summary).toEqual(expect.objectContaining({
      sessionId: 'release-session',
      messageCount: 3,
      completedMessages: 1,
    }))
    expect(transcript.summary.markdown).toContain('Release agent conversation summary')
    expect(transcript.storage.messagesPath).toBe('.scale/agents/messages/release-session.jsonl')
    expect(transcript.storage.summaryPath).toBe('.scale/agents/summaries/release-session.json')

    const transcriptSearch = await json<{
      query: string
      total: number
      hits: Array<{ sessionId: string; message: { id: string; status: string }; matchPreview: string }>
    }>(await app.request('/api/agent-control/transcripts?query=release%20risk&sessionId=release-session'))
    expect(transcriptSearch.query).toBe('release risk')
    expect(transcriptSearch.total).toBeGreaterThanOrEqual(1)
    expect(transcriptSearch.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'release-session',
        message: expect.objectContaining({ status: 'delivered' }),
        matchPreview: expect.stringContaining('release risk'),
      }),
    ]))

    const persistedSummary = await json<{
      ok: boolean
      summary: { sessionId: string; markdown: string; nextActions: string[] }
    }>(await app.request('/api/agent-control/sessions/release-session/summary', { method: 'POST' }))
    expect(persistedSummary).toEqual(expect.objectContaining({
      ok: true,
      summary: expect.objectContaining({
        sessionId: 'release-session',
        markdown: expect.stringContaining('Release agent conversation summary'),
      }),
    }))
    expect(readFileSync(join(scaleDir, 'agents', 'summaries', 'release-session.json'), 'utf-8')).toContain('Release agent conversation summary')

    const invalidAgentSessionResponse = await app.request('/api/agent-control/sessions/release-session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'not-a-real-model' }),
    })
    expect(invalidAgentSessionResponse.status).toBe(400)
    const invalidAgentSession = await invalidAgentSessionResponse.json() as { ok: boolean; error: string }
    expect(invalidAgentSession).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('Unsupported model'),
    }))

    const invalidRouteResponse = await app.request('/api/integrations/feishu/route', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentPlatformId: 'unknown-agent' }),
    })
    expect(invalidRouteResponse.status).toBe(400)
    const invalidRoute = await invalidRouteResponse.json() as { ok: boolean; saved: boolean; error: string }
    expect(invalidRoute).toEqual(expect.objectContaining({
      ok: false,
      saved: false,
      error: expect.stringContaining('Unsupported agent platform'),
    }))

    const blockedAction = await json<{
      ok: boolean
      status: string
      error: string
    }>(await app.request('/api/integrations/feishu/actions/live-send', { method: 'POST' }))
    expect(blockedAction).toEqual(expect.objectContaining({
      ok: false,
      status: 'blocked',
      error: expect.stringContaining('Unsupported Feishu integration action'),
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
