/**
 * Dashboard Browser E2E — Start server, open pages, check for JS errors.
 *
 * Navigation strategy: the SPA shell is loaded exactly once (the server-side
 * bootstrap snapshot is expensive), then pages are switched via `location.hash`
 * which the app already handles through its `hashchange` listener. This keeps
 * the run fast while still exercising every page's render path.
 *
 * The agents console is checked on both sides of the virtualization threshold:
 * a small session must keep the plain list, a large one must switch to the
 * windowed `n-virtual-list`.
 */
import { chromium } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 3213
const BASE = `http://localhost:${PORT}`
const BOOTSTRAP_TIMEOUT_MS = 120000
const MESSAGE_COUNT = 60

console.log('\n═══ Dashboard Browser E2E ═══\n')

// Start server against an isolated project so injected test messages never touch the real .scale
const e2eProjectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-browser-'))
mkdirSync(join(e2eProjectDir, '.scale'), { recursive: true })
let server
try {
  const { DashboardServer } = await import('./dist/dashboard/DashboardServer.js')
  const dashboard = new DashboardServer({
    port: PORT, host: '127.0.0.1',
    projectDir: e2eProjectDir,
    scaleDir: join(e2eProjectDir, '.scale'),
  })
  await dashboard.start()
  server = dashboard
  console.log(`[OK] Server started on ${BASE}\n`)
} catch (e) {
  console.error(`[FATAL] ${e.message}`)
  process.exit(1)
}

let totalErrors = 0
const allErrors = []
const fail = (message) => {
  console.log(`  ✗ ${message}`)
  totalErrors++
  allErrors.push(message)
}

// This check only talks to a local server; bypass any ambient HTTP proxy
// (CI/dev boxes often export http_proxy, which would blackhole localhost).
const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(err.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push(msg.text())
})

const goTo = async (name) => {
  await page.evaluate((target) => { window.location.hash = target }, name)
  await page.waitForTimeout(1500)
}

// ── Single full load of the SPA shell ─────────────────────────────────────
const shellStart = Date.now()
try {
  await page.goto(`${BASE}/#overview`, { waitUntil: 'domcontentloaded', timeout: BOOTSTRAP_TIMEOUT_MS })
  await page.waitForSelector('#app', { timeout: 15000 })
  console.log(`── shell load ──\n  ✓ SPA shell loaded in ${Date.now() - shellStart}ms\n`)
} catch (e) {
  fail(`SPA shell failed to load: ${e.message}`)
}

const pages = ['overview', 'workflow', 'agentos', 'topology', 'monitoring', 'costs', 'documents', 'agents', 'integrations']

for (const name of pages) {
  const before = pageErrors.length
  console.log(`── ${name} ──`)
  try {
    await goTo(name)

    const active = await page.evaluate(() => window.location.hash.slice(1))
    const appContent = await page.$eval('#app', el => el.innerHTML)
    const hasContent = appContent.length > 100 && !appContent.includes('loading-placeholder')
    console.log(`  ${active === name ? '✓' : '✗'} Route active (#${active})`)
    console.log(`  ${hasContent ? '✓' : '✗'} Page rendered (${appContent.length} chars)`)
    if (active !== name) fail(`route did not switch to #${name}`)
    if (!hasContent) fail(`#${name} rendered empty`)

    const newErrors = pageErrors.slice(before).filter(e => !e.includes('Failed to load resource'))
    if (newErrors.length === 0) {
      console.log('  ✓ No JavaScript errors')
    } else {
      console.log(`  ✗ ${newErrors.length} JavaScript error(s):`)
      newErrors.forEach(e => console.log(`    - ${e}`))
      totalErrors += newErrors.length
      allErrors.push(...newErrors.map(e => `[${name}] ${e}`))
    }
  } catch (e) {
    fail(`#${name} check failed: ${e.message}`)
  }
}

// ── Below the threshold: the plain (non-windowed) list must still be used ──
console.log('── agents list (empty session) ──')
try {
  // Navigate explicitly: the page loop above may leave the router on another page.
  await goTo('agents')
  const plainList = await page.$('.agent-message-list') !== null
  const virtualList = await page.$('.agent-message-list-virtual') !== null
  console.log(`  plain container: ${plainList}; virtual container: ${virtualList}`)
  if (!plainList) fail('plain agent-message-list missing on a small session')
  if (virtualList) fail('virtual list mounted on a small session (threshold regression)')
  else console.log('  ✓ Small session keeps the plain list')
} catch (e) {
  fail(`small-session check failed: ${e.message}`)
}

// ── Above the threshold: seeding must switch the console to windowed rendering ──
console.log('\n── seeding messages ──')
let sessionId = ''
try {
  const control = await (await fetch(`${BASE}/api/agent-control`)).json()
  sessionId = control.sessions?.[0]?.sessionId
  if (!sessionId) throw new Error('no agent-control session available')
  for (let index = 0; index < MESSAGE_COUNT; index += 1) {
    const response = await fetch(`${BASE}/api/agent-control/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Virtual list load message ${index + 1}`, from: 'browser-e2e', dryRun: true }),
    })
    if (!response.ok) throw new Error(`message ${index + 1} failed with HTTP ${response.status}`)
  }
  console.log(`  ✓ Seeded ${MESSAGE_COUNT} messages into session ${sessionId}`)
} catch (e) {
  fail(`seeding failed: ${e.message}`)
}

if (sessionId) {
  console.log('\n── agents virtual list ──')
  try {
    // Bounce off the agents page so its watcher re-fetches the transcript.
    await goTo('overview')
    await goTo('agents')

    const rendered = await page.$$eval('.agent-message', nodes => nodes.length)
    const usingVirtualList = await page.$('.agent-message-list-virtual') !== null
    console.log(`  rendered ${rendered} of ${MESSAGE_COUNT} messages; virtual container: ${usingVirtualList}`)
    if (!usingVirtualList) fail('virtual list container did not mount above the message threshold')
    else if (rendered >= MESSAGE_COUNT) fail(`expected windowed rendering, got ${rendered} DOM nodes for ${MESSAGE_COUNT} messages`)
    else console.log('  ✓ Virtual list active with bounded DOM')
  } catch (e) {
    fail(`virtual list check failed: ${e.message}`)
  }
}

// ── New operating surfaces: governance config tab, feishu bridge, task actions ──
// These render only after tab switches / data loads, so assert on real DOM presence
// rather than relying on the page-level "no JS errors" check.
console.log('\n── integrations: governance + bridge ──')
try {
  await goTo('integrations')
  const governanceTab = page.locator('.n-tabs-tab', { hasText: '治理配置' })
  if (await governanceTab.count() === 0) {
    fail('governance tab missing on the integrations page')
  } else {
    await governanceTab.first().click()
    await page.waitForTimeout(1200)
    const textareas = await page.$$eval('textarea', nodes => nodes.length)
    const hasPolicy = (await page.content()).includes('policy.yaml')
    const hasThresholds = (await page.content()).includes('覆盖率下限')
    const hasMemory = (await page.content()).includes('路由模式')
    console.log(`  textareas=${textareas} policy=${hasPolicy} thresholds=${hasThresholds} memory=${hasMemory}`)
    if (!hasPolicy || !hasThresholds || !hasMemory) fail('governance tab did not render all three config sections')
    else console.log('  ✓ Governance tab renders policy / thresholds / memory routing')
  }

  const bridgeHeading = (await page.content()).includes('飞书桥接')
  void bridgeHeading
  // 桥接面板在 agent-connect 标签页内，必须先切过去才会渲染
  const agentConnectTab = page.locator('.n-tabs-tab', { hasText: 'Agent Connect' })
  if (await agentConnectTab.count() === 0) {
    fail('agent-connect tab missing on the integrations page')
  } else {
    await agentConnectTab.first().click()
    await page.waitForTimeout(1000)
  }
  const bridgeStart = page.locator('button', { hasText: '启动桥接' })
  const bridgeStop = page.locator('button', { hasText: '停止桥接' })
  const bridgeButtons = await bridgeStart.count() + await bridgeStop.count()
  const hasBridgeHeading = (await page.content()).includes('飞书桥接')
  console.log(`  bridgeHeading=${hasBridgeHeading} bridgeButtons=${bridgeButtons}`)
  if (!hasBridgeHeading || bridgeButtons === 0) fail('feishu bridge panel missing on the agent-connect tab')
  else console.log('  ✓ Feishu bridge panel renders with start/stop control')
} catch (e) {
  fail(`integrations new-surface check failed: ${e.message}`)
}

console.log('\n── agentos: task lifecycle + executor selector ──')
try {
  // 任务生命周期在 Agent OS 页；执行器选择在 Agent 控制台的会话配置里
  await goTo('agentos')
  await page.waitForTimeout(800)
  const agentosContent = await page.content()
  const hasCreateTask = agentosContent.includes('创建任务')
  const hasTaskPlaceholder = agentosContent.includes('任务名称')
  console.log(`  createTask=${hasCreateTask} taskInput=${hasTaskPlaceholder}`)
  if (!hasCreateTask || !hasTaskPlaceholder) fail('task lifecycle controls missing on the Agent OS workbench')
  else console.log('  ✓ Task creation + lifecycle actions render')

  await goTo('agents')
  await page.waitForTimeout(800)
  const executorSelect = (await page.content()).includes('执行器类型')
  console.log(`  executorSelect=${executorSelect}`)
  if (!executorSelect) fail('executor selector missing in the session setup form')
  else console.log('  ✓ Executor selector renders')
} catch (e) {
  fail(`new-surface check failed: ${e.message}`)
}

// ── Screenshot + teardown ─────────────────────────────────────────────────
// Screenshots are runtime artifacts: keep them out of the repo root so the
// `root-artifact-placement` docs-health gate stays green.
const screenshotPath = join('.agent', 'logs', 'dashboard-e2e', 'dashboard-overview.png')
try {
  await goTo('overview')
  mkdirSync(join('.agent', 'logs', 'dashboard-e2e'), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: false })
  console.log(`\n[OK] ${screenshotPath} saved`)
} catch (e) {
  fail(`screenshot failed: ${e.message}`)
}

const exitCode = totalErrors > 0 ? 1 : 0

// Teardown must never mask the verdict: bound each step and force the exit.
await Promise.race([browser.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))])
try { server?.stop() } catch {}
try { rmSync(e2eProjectDir, { recursive: true, force: true }) } catch {}

console.log(`\n═══ Results: ${exitCode === 0 ? 'ALL PASSED' : `${totalErrors} error(s) found`} ═══`)
if (allErrors.length) {
  console.log('\nAll errors:')
  allErrors.forEach(e => console.log(`  - ${e}`))
}
console.log('')
process.exit(exitCode)
