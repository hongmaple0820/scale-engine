/**
 * Dashboard Browser E2E — Start server, open pages, check for JS errors
 */
import { chromium } from 'playwright'
import { join } from 'node:path'

const PORT = 3213
const BASE = `http://localhost:${PORT}`

console.log('\n═══ Dashboard Browser E2E ═══\n')

// Start server
let server
try {
  const { DashboardServer } = await import('./dist/dashboard/DashboardServer.js')
  const dashboard = new DashboardServer({
    port: PORT, host: '127.0.0.1',
    projectDir: process.cwd(),
    scaleDir: join(process.cwd(), '.scale'),
  })
  await dashboard.start()
  server = dashboard
  console.log(`[OK] Server started on ${BASE}\n`)
} catch (e) {
  console.error(`[FATAL] ${e.message}`)
  process.exit(1)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const pages = ['overview', 'workflow', 'topology', 'monitoring', 'costs', 'documents']
let totalErrors = 0
const allErrors = []

for (const name of pages) {
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  console.log(`── ${name} ──`)
  try {
    await page.goto(`${BASE}/spa/#${name}`, { waitUntil: 'domcontentloaded', timeout: 10000 })
    await page.waitForTimeout(2000)

    // Check page rendered (not just loading placeholder)
    const appContent = await page.$eval('#app', el => el.innerHTML)
    const hasContent = appContent.length > 100 && !appContent.includes('loading-placeholder')
    console.log(`  ${hasContent ? '✓' : '✗'} Page rendered (${appContent.length} chars)`)

    // Check for JS errors
    const pageErrors = errors.filter(e => !e.includes('Failed to load resource')) // ignore network errors
    if (pageErrors.length === 0) {
      console.log('  ✓ No JavaScript errors')
    } else {
      console.log(`  ✗ ${pageErrors.length} JavaScript error(s):`)
      pageErrors.forEach(e => console.log(`    - ${e}`))
      totalErrors += pageErrors.length
      allErrors.push(...pageErrors.map(e => `[${name}] ${e}`))
    }
  } catch (e) {
    console.log(`  ✗ Navigation failed: ${e.message}`)
    totalErrors++
  }

  page.removeAllListeners('pageerror')
  page.removeAllListeners('console')
}

// Screenshot final state
await page.goto(`${BASE}/spa/#overview`, { waitUntil: 'domcontentloaded', timeout: 10000 })
await page.waitForTimeout(500)
await page.screenshot({ path: 'dashboard-overview.png', fullPage: false })
console.log('\n[OK] dashboard-overview.png saved')

await browser.close()
try { server?.stop() } catch {}

console.log(`\n═══ Results: ${totalErrors === 0 ? 'ALL PASSED' : `${totalErrors} error(s) found`} ═══`)
if (allErrors.length) {
  console.log('\nAll errors:')
  allErrors.forEach(e => console.log(`  - ${e}`))
}
console.log('')
process.exit(totalErrors > 0 ? 1 : 0)
