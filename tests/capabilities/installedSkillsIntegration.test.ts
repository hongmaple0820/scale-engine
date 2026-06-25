import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveInstalledSkillPath, runInstalledSkillCommand, InstalledSkillsInvoker } from '../../src/capabilities/InstalledSkillsIntegration.js'

let dirs: string[] = []
let servers: Server[] = []
const originalWebAccessBaseUrl = process.env.SCALE_WEB_ACCESS_BASE_URL

afterEach(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
  servers = []
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
  if (originalWebAccessBaseUrl === undefined) delete process.env.SCALE_WEB_ACCESS_BASE_URL
  else process.env.SCALE_WEB_ACCESS_BASE_URL = originalWebAccessBaseUrl
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-skills-'))
  dirs.push(dir)
  return dir
}

async function startWebAccessServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to resolve test server port')
  return `http://127.0.0.1:${address.port}`
}

describe('installed skills integration', () => {
  it('prefers the first skill root that contains the requested script', () => {
    const agentsRoot = makeDir()
    const claudeRoot = makeDir()
    const scriptDir = join(agentsRoot, 'ui-ux-pro-max', 'scripts')
    mkdirSync(scriptDir, { recursive: true })
    writeFileSync(join(scriptDir, 'search.py'), 'print("ok")\n', 'utf-8')

    expect(resolveInstalledSkillPath('ui-ux-pro-max', ['scripts', 'search.py'], [agentsRoot, claudeRoot]))
      .toBe(join(scriptDir, 'search.py'))
  })

  it('falls back to the first configured root for actionable missing-skill errors', () => {
    const agentsRoot = makeDir()
    const claudeRoot = makeDir()

    expect(resolveInstalledSkillPath('missing-skill', ['SKILL.md'], [agentsRoot, claudeRoot]))
      .toBe(join(agentsRoot, 'missing-skill', 'SKILL.md'))
  })

  it('runs installed skill commands without requiring a shell fallback', async () => {
    const result = await runInstalledSkillCommand('node -e "process.stdout.write(\'ok\')"', 5000, 'test-skill')

    expect(result).toMatchObject({
      success: true,
      output: 'ok',
      skillId: 'test-skill',
    })
  })

  it('rejects shell metacharacters instead of retrying with shell execution', async () => {
    const result = await runInstalledSkillCommand(
      'node -e "process.stdout.write(\'safe\')" && node -e "process.stdout.write(\'unsafe\')"',
      5000,
      'test-skill',
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Shell metacharacter "&" is not allowed')
  })

  it('passes web_access_eval input as literal curl arguments', async () => {
    let receivedTarget = ''
    let receivedBody = ''
    process.env.SCALE_WEB_ACCESS_BASE_URL = await startWebAccessServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      receivedTarget = url.searchParams.get('target') ?? ''
      req.setEncoding('utf-8')
      req.on('data', chunk => {
        receivedBody += chunk
      })
      req.on('end', () => {
        res.statusCode = 200
        res.end('ok')
      })
    })

    const invoker = new InstalledSkillsInvoker()
    const js = 'console.log("quoted"); process.stdout.write("&& stays literal")'
    const targetId = 'tab "alpha" & beta'
    const result = await invoker.webAccessEval(targetId, js)

    expect(result).toMatchObject({
      success: true,
      output: 'ok',
      skillId: 'web-access',
    })
    expect(receivedTarget).toBe(targetId)
    expect(receivedBody).toBe(js)
  })

  it('passes playwright_open url as a literal argv entry', async () => {
    let captured: { command: string; args: string[]; timeout: number; skillId: string } | null = null
    const invoker = new InstalledSkillsInvoker() as unknown as InstalledSkillsInvoker & {
      runCommandArgs: (command: string, args: string[], timeout: number, skillId: string) => Promise<{
        success: boolean
        output?: string
        error?: string
        durationMs: number
        skillId: string
      }>
    }
    invoker.runCommandArgs = async (command, args, timeout, skillId) => {
      captured = { command, args, timeout, skillId }
      return { success: true, output: 'ok', durationMs: 0, skillId }
    }

    const url = 'https://example.com/"quoted"?x=1&y=2'
    const result = await invoker.playwrightOpen(url)

    expect(result).toMatchObject({
      success: true,
      output: 'ok',
      skillId: 'playwright',
    })
    expect(captured).toEqual(expect.objectContaining({
      args: ['open', url],
      timeout: 30000,
      skillId: 'playwright',
    }))
    expect(captured?.command).toContain(join('.agents', 'skills', 'playwright', 'scripts', 'playwright_cli.sh'))
  })
})
