// W11 Tests: Codex Adapter + MCP Server
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CodexAdapter } from '../../src/adapters/CodexAdapter.js'
import { createAdapter } from '../../src/adapters/index.js'
import { ScaleMCPServer } from '../../src/api/mcp.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-w11'

// ============================================================================
// Codex Adapter
// ============================================================================
describe('CodexAdapter', () => {
  let adapter: CodexAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new CodexAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is codex', () => {
    expect(adapter.agentType).toBe('codex')
  })

  it('generateSettings produces hooks.json format', () => {
    const settings = adapter.generateSettings()
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks!['pre-exec']).toHaveLength(1)
    expect(settings.hooks!['post-exec']).toHaveLength(1)
  })

  it('init creates .codex/ and AGENTS.md', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(existsSync(join(TMP, '.codex', 'hooks.json'))).toBe(true)
    expect(existsSync(join(TMP, '.codex', 'config.toml'))).toBe(true)
    expect(existsSync(join(TMP, 'AGENTS.md'))).toBe(true)
    expect(result.knowledgeDocPath).toContain('AGENTS.md')
  })

  it('generateCodexConfig includes model and approval', () => {
    const config = adapter.generateCodexConfig()
    expect(config).toContain('[model]')
    expect(config).toContain('auto_approve')
    expect(config).toContain('scale')
  })

  it('generateKnowledgeDoc produces AGENTS.md content', () => {
    const doc = adapter.generateKnowledgeDoc('my-codex-project', ['Python'])
    expect(doc).toContain('# my-codex-project')
    expect(doc).toContain('Python')
    expect(doc).toContain('SCALE Engine')
    expect(doc).toContain('Agent Full Workflow Bootstrap')
    expect(doc).toContain('scale setup --verify --pack full')
    expect(doc).toContain('gbrain')
    expect(doc).toContain('codegraph status')
  })

  it('init is idempotent', async () => {
    await adapter.init({ projectDir: TMP })
    const result2 = await adapter.init({ projectDir: TMP })
    expect(result2.skipped.length).toBeGreaterThan(0)
  })

  it('mergeSettings preserves existing hooks', () => {
    const existing = {
      hooks: { 'pre-exec': [{ matcher: '', command: 'my-check' }] },
    }
    const merged = adapter.mergeSettings(existing)
    expect(merged.hooks!['pre-exec'].some((e) => e.command === 'my-check')).toBe(true)
    expect(merged.hooks!['post-exec']).toBeDefined()
  })
})

describe('createAdapter multi-agent', () => {
  it('creates codex adapter', () => {
    const adapter = createAdapter('codex')
    expect(adapter.agentType).toBe('codex')
  })

  it('creates claude-code adapter', () => {
    const adapter = createAdapter('claude-code')
    expect(adapter.agentType).toBe('claude-code')
  })

  it('throws for unknown', () => {
    expect(() => createAdapter('vscode')).toThrow('Unsupported')
  })
})

// ============================================================================
// MCP Server
// ============================================================================
describe('ScaleMCPServer', () => {
  let server: ScaleMCPServer

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    server = new ScaleMCPServer(join(TMP, '.scale'))
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('initialize returns server info', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 1, method: 'initialize',
    })
    expect(res.result).toBeDefined()
    expect((res.result as any).serverInfo.name).toBe('scale-engine')
  })

  it('tools/list returns workflow and Agent OS tools', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/list',
    })
    const tools = (res.result as any).tools as Array<{ name: string }>
    expect(tools.length).toBeGreaterThanOrEqual(18)
    expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'scale_create',
      'task_create',
      'task_start',
      'task_checkpoint',
      'task_resume',
      'complete_task',
      'capability_list',
      'capability_map',
      'bridge_register',
      'bridge_heartbeat',
      'shell_plan',
      'shell_run',
      'delegation_delegate',
      'delegation_review',
      'cortex_promotion_propose',
      'cortex_promotion_hit',
      'cortex_promotion_approve',
    ]))
  })

  it('scale_create creates artifact', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'scale_create', arguments: { type: 'Spec', title: 'Test Spec' } },
    })
    const content = JSON.parse((res.result as any).content[0].text)
    expect(content.id).toMatch(/^SPEC-/)
    expect(content.status).toBe('DRAFT')
  })

  it('scale_transition with guard check', async () => {
    // Create spec
    const createRes = await server.handleRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: {
        name: 'scale_create',
        arguments: {
          type: 'Spec', title: 'Guard Test',
          payload: { successCriteria: ['x'], ambiguityScore: 0.1 },
        },
      },
    })
    const specId = JSON.parse((createRes.result as any).content[0].text).id

    // Refine
    const refineRes = await server.handleRequest({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'scale_transition', arguments: { artifactId: specId, action: 'refine' } },
    })
    expect(JSON.parse((refineRes.result as any).content[0].text).success).toBe(true)

    // Approve
    const approveRes = await server.handleRequest({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'scale_transition', arguments: { artifactId: specId, action: 'approve' } },
    })
    expect(JSON.parse((approveRes.result as any).content[0].text).status).toBe('FROZEN')
  })

  it('scale_list returns artifacts', async () => {
    await server.handleToolCall('scale_create', { type: 'Task', title: 'T1' })
    await server.handleToolCall('scale_create', { type: 'Task', title: 'T2' })

    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'scale_list', arguments: { type: 'Task' } },
    })
    const list = JSON.parse((res.result as any).content[0].text)
    expect(list.length).toBe(2)
  })

  it('scale_show returns artifact details', async () => {
    const created = await server.handleToolCall('scale_create', { type: 'Need', title: 'Show Test' }) as any
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'scale_show', arguments: { artifactId: created.id } },
    })
    const detail = JSON.parse((res.result as any).content[0].text)
    expect(detail.title).toBe('Show Test')
  })

  it('scale_available_actions returns valid actions', async () => {
    const created = await server.handleToolCall('scale_create', {
      type: 'Spec', title: 'Actions', payload: { successCriteria: ['x'] },
    }) as any

    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'scale_available_actions', arguments: { artifactId: created.id } },
    })
    const actions = JSON.parse((res.result as any).content[0].text)
    expect(actions.actions).toContain('refine')
  })

  it('scale_stats returns counts', async () => {
    await server.handleToolCall('scale_create', { type: 'Spec', title: 'S' })
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'scale_stats', arguments: {} },
    })
    const stats = JSON.parse((res.result as any).content[0].text)
    expect(stats.artifactCount).toBe(1)
  })

  it('Agent OS MCP tools create resumable tasks and explicit completion evidence', async () => {
    const created = await server.handleToolCall('task_create', {
      taskId: 'TASK-MCP-OS',
      name: 'MCP Agent OS task',
      level: 'L',
      files: ['src/api/mcp.ts'],
    }) as { task: { taskId: string; status: string; level: string } }
    expect(created.task).toMatchObject({ taskId: 'TASK-MCP-OS', status: 'created', level: 'L' })

    const started = await server.handleToolCall('task_start', {
      taskId: 'TASK-MCP-OS',
      runId: 'RUN-MCP-OS',
      agent: 'mcp-client',
    }) as { run: { runId: string; status: string }; task: { status: string } }
    expect(started).toMatchObject({
      run: { runId: 'RUN-MCP-OS', status: 'running' },
      task: { status: 'running' },
    })

    const checkpoint = await server.handleToolCall('task_checkpoint', {
      taskId: 'TASK-MCP-OS',
      summary: 'MCP bridge checkpointed',
      completedSteps: ['tool-schema'],
      remainingSteps: ['completion'],
    }) as { checkpoint: { checkpointId: string; resumePrompt: string } }
    expect(checkpoint.checkpoint.checkpointId).toMatch(/^CKP-/)
    expect(checkpoint.checkpoint.resumePrompt).toContain('TASK-MCP-OS')

    const resumed = await server.handleToolCall('task_resume', { taskId: 'TASK-MCP-OS' }) as {
      checkpoint: { checkpointId: string }
      task: { status: string }
    }
    expect(resumed).toMatchObject({
      checkpoint: { checkpointId: checkpoint.checkpoint.checkpointId },
      task: { status: 'running' },
    })

    const completed = await server.handleToolCall('complete_task', {
      taskId: 'TASK-MCP-OS',
      runId: 'RUN-MCP-OS',
      summary: 'MCP completion recorded',
      changedFiles: ['src/api/mcp.ts'],
      validation: ['npm run typecheck'],
    }) as {
      ok: boolean
      completion: { outcome: string; evidenceIds: string[] }
      task: { status: string }
      evidence: { id: string; kind: string; status: string; metadata: { source: string } }
    }
    expect(completed.ok).toBe(true)
    expect(completed.task.status).toBe('completed')
    expect(completed.completion.outcome).toBe('complete')
    expect(completed.completion.evidenceIds).toContain(completed.evidence.id)
    expect(completed.evidence).toMatchObject({
      kind: 'final-report',
      status: 'passed',
      metadata: { source: 'mcp-tool' },
    })

    const capabilities = await server.handleToolCall('capability_list', {
      capabilityIds: ['cua'],
    }) as { descriptors: Array<{ id: string; kind: string; trust: string }> }
    expect(capabilities.descriptors).toContainEqual(expect.objectContaining({
      id: 'desktop-cua',
      kind: 'desktop',
      trust: 'blocked',
    }))
  })

  it('Agent OS MCP bridge tools register connector surfaces and record heartbeats', async () => {
    const registered = await server.handleToolCall('bridge_register', {
      bridgeId: 'BRIDGE-MCP-IM',
      name: 'MCP IM Bridge',
      kind: 'im',
      endpoint: 'https://example.test/mcp-bridge',
      token: 'mcp-secret',
      capabilityIds: ['im-bridge'],
      scopes: ['tasks:read', 'events:read'],
      metadata: { projectRef: 'cc-connect' },
    }) as {
      bridge: { bridgeId: string; kind: string; status: string; tokenHash: string; capabilityIds: string[] }
      token: string
      event: { type: string }
    }

    expect(registered.token).toBe('mcp-secret')
    expect(registered.bridge).toMatchObject({
      bridgeId: 'BRIDGE-MCP-IM',
      kind: 'im',
      status: 'registered',
      capabilityIds: ['im-bridge'],
    })
    expect(registered.bridge.tokenHash).not.toContain('mcp-secret')
    expect(registered.event.type).toBe('bridge.registered')

    const heartbeat = await server.handleToolCall('bridge_heartbeat', {
      bridgeId: 'BRIDGE-MCP-IM',
      token: 'mcp-secret',
    }) as {
      bridge: { bridgeId: string; status: string; lastHeartbeatAt: string }
      event: { type: string }
    }
    expect(heartbeat.bridge).toEqual(expect.objectContaining({
      bridgeId: 'BRIDGE-MCP-IM',
      status: 'online',
      lastHeartbeatAt: expect.any(String),
    }))
    expect(heartbeat.event.type).toBe('bridge.heartbeat')

    const ledger = readFileSync(join(TMP, '.scale', 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"bridge.registered"')
    expect(ledger).toContain('"bridge.heartbeat"')
  })

  it('Agent OS MCP shell tools plan blocked commands and record command evidence for safe commands', async () => {
    const plan = await server.handleToolCall('shell_plan', {
      command: 'git reset --hard HEAD',
      taskId: 'TASK-MCP-SHELL',
    }) as { risk: string; blocked: boolean; requiresApproval: boolean }
    expect(plan).toMatchObject({
      risk: 'destructive',
      blocked: true,
      requiresApproval: true,
    })

    const execution = await server.handleToolCall('shell_run', {
      command: 'node -e "process.stdout.write(\'ok\')"',
      taskId: 'TASK-MCP-SHELL',
      sessionId: 'RUN-MCP-SHELL',
      profile: 'mcp',
      timeoutMs: 10_000,
    }) as {
      status: string
      result: { exitCode: number; stdout: string }
      evidence: { id: string; taskId: string; source: string; status: string }
    }
    expect(execution).toMatchObject({
      status: 'passed',
      result: { exitCode: 0, stdout: 'ok' },
      evidence: {
        taskId: 'TASK-MCP-SHELL',
        source: 'agent-os-smart-shell',
        status: 'passed',
      },
    })

    const ledger = readFileSync(join(TMP, '.scale', 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"shell.planned"')
    expect(ledger).toContain('"shell.executed"')
  })

  it('Agent OS MCP V2 tools delegate multi-agent work and run Cortex promotion lifecycle', async () => {
    const delegated = await server.handleToolCall('delegation_delegate', {
      taskId: 'TASK-MCP-V2',
      task: 'Implement dashboard API security tests and release verification',
      level: 'L',
      files: ['src/dashboard/DashboardServer.ts', 'tests/dashboard/dashboardServer.test.ts'],
      services: ['dashboard', 'api'],
      budget: 4000,
    }) as {
      delegation: {
        delegationId: string
        status: string
        assignments: Array<{ profileId: string }>
        reviews: unknown[]
      }
      event: { type: string }
    }
    expect(delegated.delegation.status).toBe('delegated')
    expect(delegated.delegation.assignments.length).toBeGreaterThan(0)
    expect(delegated.delegation.reviews.length).toBeGreaterThan(0)
    expect(delegated.event.type).toBe('agent.delegated')

    const reviewed = await server.handleToolCall('delegation_review', {
      delegationId: delegated.delegation.delegationId,
      profileId: delegated.delegation.assignments[0]!.profileId,
      status: 'accepted',
      reason: 'role output verified',
      reviewer: 'mcp-reviewer',
    }) as { delegation: { status: string }; event: { type: string } }
    expect(reviewed.delegation.status).toBe('accepted')
    expect(reviewed.event.type).toBe('agent.reviewed')

    const proposed = await server.handleToolCall('cortex_promotion_propose', {
      title: 'Require validation before completion',
      description: 'Completion claims must include command or review evidence.',
      source: 'failure-learning',
      sourceEvidenceIds: ['RTE-FAILED-VALIDATION'],
      pattern: 'complete without validation',
      enforcement: 'hook',
      rollback: 'Disable hook and keep prompt reminder',
      taskId: 'TASK-MCP-V2',
    }) as { proposal: { id: string; maturity: { stage: string } }; report: { summary: { shadowRules: number } } }
    expect(proposed.proposal.maturity.stage).toBe('shadow')
    expect(proposed.report.summary.shadowRules).toBe(1)

    let proposalId = proposed.proposal.id
    for (let index = 0; index < 10; index += 1) {
      const hit = await server.handleToolCall('cortex_promotion_hit', {
        proposalId,
        evidenceId: `RTE-MCP-SHADOW-${index}`,
        taskId: 'TASK-MCP-V2',
      }) as { proposal: { id: string; maturity: { shadowHits: number } } }
      proposalId = hit.proposal.id
    }

    const approved = await server.handleToolCall('cortex_promotion_approve', {
      proposalId,
      approvedBy: 'mcp-reviewer',
      taskId: 'TASK-MCP-V2',
    }) as { proposal: { maturity: { stage: string; approvedBy: string } }; report: { summary: { approvedBlocking: number } } }
    expect(approved.proposal.maturity).toEqual(expect.objectContaining({
      stage: 'approved-blocking',
      approvedBy: 'mcp-reviewer',
    }))
    expect(approved.report.summary.approvedBlocking).toBe(1)

    const ledger = readFileSync(join(TMP, '.scale', 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"agent.delegated"')
    expect(ledger).toContain('"agent.reviewed"')
    expect(ledger).toContain('"cortex.promotion"')
  }, 120_000)

  it('scale_context builds context', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: { name: 'scale_context', arguments: { sessionId: 'mcp-test' } },
    })
    const ctx = JSON.parse((res.result as any).content[0].text)
    expect(ctx.system).toContain('SCALE')
  })

  it('unknown method returns error', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 99, method: 'foo/bar',
    })
    expect(res.error).toBeDefined()
    expect(res.error!.code).toBe(-32601)
  })

  it('unknown tool returns error', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 100, method: 'tools/call',
      params: { name: 'scale_nonexistent', arguments: {} },
    })
    expect(res.error).toBeDefined()
  })
})
