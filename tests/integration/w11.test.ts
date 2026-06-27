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

  it('tools/list returns 10 tools', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/list',
    })
    expect((res.result as any).tools.length).toBe(10)
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
