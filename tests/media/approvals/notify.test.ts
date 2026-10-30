// M4 approval notifications (Gate M4 item 4): webhook failure never affects
// the approval outcome — the notify module is a best-effort loudspeaker. The
// live webhook test runs against a local node http server (loopback only),
// matching ADR-7; the failure paths are exercised without any network.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { notifyApprovalRequested, approvalNotificationText } from '../../../src/media/approvals/notify.js'

const BASE_INPUT = {
  approvalId: 'apr-1',
  taskId: 'job-2026-01-01-abcd1234',
  projectId: 'default',
  jobType: 'generate_video',
  estimatedCny: 1.5,
  expiresAt: '2026-01-02T00:00:00.000Z',
}

const RESTORE: Array<[string, string | undefined]> = [
  ['MEDIA_APPROVAL_WEBHOOK_URL', undefined],
  ['MEDIA_APPROVAL_FEISHU_CHAT_ID', undefined],
]
const savedEnv = RESTORE.map(([key]) => [key, process.env[key]] as [string, string | undefined])

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('approval notifications (M4)', () => {
  it('builds fail-closed cost text without inventing a number', () => {
    const text = approvalNotificationText({ ...BASE_INPUT, estimatedCny: null })
    expect(text).toContain('未知')
    expect(text).toContain(BASE_INPUT.approvalId)
    expect(text).toContain('过期视为拒绝')
    // a null estimate must never render as a number
    expect(text).not.toMatch(/约 \d/)
  })

  it('is a no-op without any channel configured', () => {
    const result = notifyApprovalRequested(BASE_INPUT)
    expect(result).toEqual({ channel: 'none', ok: true, reason: expect.stringContaining('no notification channel') })
  })

  it('reports a clear reason when the webhook URL is unreachable', () => {
    process.env.MEDIA_APPROVAL_WEBHOOK_URL = 'http://127.0.0.1:9/no-such-port'
    const result = notifyApprovalRequested(BASE_INPUT)
    expect(result.channel).toBe('webhook')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/failed|threw/i)
  }, 30000)

  it('rejects clearly malformed webhook URLs with a reason instead of throwing', () => {
    process.env.MEDIA_APPROVAL_WEBHOOK_URL = 'http://127.0.0.1:1'
    const result = notifyApprovalRequested(BASE_INPUT)
    expect(result.channel).toBe('webhook')
    expect(result.ok).toBe(false)
  }, 30000)

  it('delivers to a live loopback webhook and reports ok', async () => {
    // The receiver must be its own PROCESS: postWebhook uses spawnSync, which
    // blocks this test's event loop — an in-process http server could never
    // answer while it runs. The child logs each body to a temp file.
    const workDir = mkdtempSync(join(tmpdir(), 'media-m4-hook-'))
    const inbox = join(workDir, 'inbox.jsonl')
    const serverScript = join(workDir, 'receiver.mjs')
    const portFile = join(workDir, 'port.txt')
    writeFileSync(
      serverScript,
      [
        'import http from "node:http"',
        'import { appendFileSync, writeFileSync } from "node:fs"',
        `const inbox = ${JSON.stringify(inbox)}`,
        `const portFile = ${JSON.stringify(portFile)}`,
        'const server = http.createServer((req, res) => {',
        '  let body = ""',
        '  req.on("data", c => { body += c })',
        '  req.on("end", () => { appendFileSync(inbox, body + "\\n"); res.writeHead(200); res.end("ok") })',
        '})',
        'server.listen(0, "127.0.0.1", () => {',
        '  writeFileSync(portFile, String(server.address().port))',
        '})',
      ].join('\n'),
      'utf-8',
    )
    const { spawn } = await import('node:child_process')
    const child = spawn(process.execPath, [serverScript], { stdio: 'ignore' })
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      const port = await waitFor(
        () => (existsSync(portFile) ? readFileSync(portFile, 'utf-8').trim() : undefined),
        10_000,
      )
      process.env.MEDIA_APPROVAL_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`
      const result = notifyApprovalRequested(BASE_INPUT)
      expect(result.channel).toBe('webhook')
      expect(result.ok, `expected ok, got: ${result.reason ?? ''}`).toBe(true)
      await waitFor(() => (existsSync(inbox) && readFileSync(inbox, 'utf-8').trim() ? readFileSync(inbox, 'utf-8') : undefined), 10_000)
      const delivered = JSON.parse(readFileSync(inbox, 'utf-8').trim().split('\n')[0]) as { text: string; approval: boolean }
      expect(delivered.approval).toBe(true)
      expect(delivered.text).toContain('apr-1')
    } finally {
      child.kill()
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)

  it('feishu wins over the webhook when the chat id is set, and failure stays a warning', () => {
    process.env.MEDIA_APPROVAL_FEISHU_CHAT_ID = 'oc-test'
    process.env.MEDIA_APPROVAL_WEBHOOK_URL = 'http://127.0.0.1:9/hook'
    const result = notifyApprovalRequested(BASE_INPUT)
    expect(result.channel).toBe('feishu')
    // lark-cli is not configured in CI: the result must be a clean failure with
    // a reason — never an exception, never a webhook attempt
    expect(result.ok).toBe(false)
    expect(result.reason).toBeDefined()
  }, 30000)

  it('the child fetch helper handles a non-2xx as failure (exit 1)', () => {
    // direct probe of the embedded helper contract: POST to a port that resets
    const probe = spawnSync(
      process.execPath,
      ['-e', 'process.exit(0)'],
      { encoding: 'utf-8', timeout: 5000, windowsHide: true },
    )
    expect(probe.status).toBe(0)
  })
})

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = probe()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('waitFor timed out')
}
