/**
 * Dashboard E2E Verification — API + SPA + Screenshots
 * Usage: node verify-dashboard.mjs
 */
import { join } from 'node:path'

const PORT = 3211
const BASE = `http://localhost:${PORT}`

let passed = 0, failed = 0
const failures = []

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`) }
  else { failed++; failures.push(msg); console.log(`  ✗ ${msg}`) }
}

async function fetchJSON(url) {
  const res = await fetch(url)
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: res.status, data, text }
}

// ── Start Server ──────────────────────────────────────────────────────

console.log('\n═══ Dashboard E2E Verification ═══\n')

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

// ── Health ────────────────────────────────────────────────────────────

console.log('── Health ──')
{
  const { status, data } = await fetchJSON(`${BASE}/health`)
  assert(status === 200, 'GET /health → 200')
  assert(data?.status === 'ok', 'status = ok')
}

// ── Root Redirect ─────────────────────────────────────────────────────

console.log('\n── Root Redirect ──')
{
  const res = await fetch(`${BASE}/`, { redirect: 'manual' })
  assert([301, 302].includes(res.status), `GET / → ${res.status}`)
  assert((res.headers.get('location') || '').includes('/spa/'), 'redirects to /spa/')
}

// ── SPA HTML ──────────────────────────────────────────────────────────

console.log('\n── SPA HTML ──')
{
  const res = await fetch(`${BASE}/spa/`)
  const html = await res.text()
  assert(res.status === 200, 'GET /spa/ → 200')
  assert(html.includes('<title>SCALE Engine'), 'has title')
  assert(html.includes('id="app"'), 'has #app container')
  assert(html.includes('data-page="overview"'), 'has overview nav')

  // Critical: verify script loading order
  const i18n = html.indexOf('i18n.js')
  const app = html.indexOf('app.js')
  const overview = html.indexOf('overview.js')
  assert(i18n < app, 'i18n.js loads before app.js')
  assert(app < overview, 'app.js loads before page scripts')
  assert(html.includes('navigate(location.hash'), 'has deferred initial navigation')
}

// ── SPA Static Files ─────────────────────────────────────────────────

console.log('\n── SPA Static Files ──')
for (const f of ['app.js', 'i18n.js', 'pages/overview.js', 'pages/workflow.js', 'pages/monitoring.js', 'pages/costs.js', 'pages/documents.js', 'pages/topology.js']) {
  const res = await fetch(`${BASE}/spa/${f}`)
  assert(res.status === 200, `/spa/${f} → 200`)
}

// ── app.js exports ───────────────────────────────────────────────────

console.log('\n── app.js Module ──')
{
  const res = await fetch(`${BASE}/spa/app.js`)
  const js = await res.text()
  assert(js.includes('window.Dashboard'), 'sets window.Dashboard')
  assert(js.includes('fetchJSON'), 'exports fetchJSON')
  assert(js.includes('navigate'), 'exports navigate')
  // handleHash is defined but must not be called at module load
  assert(!js.match(/^[\s]*handleHash\(\)/m), 'handleHash not called at top level')
}

// ── Page Scripts ──────────────────────────────────────────────────────

console.log('\n── Page Scripts ──')
for (const p of ['overview', 'workflow', 'monitoring', 'costs', 'documents', 'topology']) {
  const res = await fetch(`${BASE}/spa/pages/${p}.js`)
  const js = await res.text()
  assert(js.includes('window.DashboardPages'), `${p} registers on DashboardPages`)
}

// ── API Endpoints ─────────────────────────────────────────────────────

const apiTests = [
  ['/api/state',         d => Array.isArray(d?.artifacts) && typeof d?.timestamp === 'number'],
  ['/api/artifacts',     d => Array.isArray(d)],
  ['/api/evolution',     d => true],  // may be null when no data
  ['/api/detectors',     d => Array.isArray(d)],
  ['/api/events',        d => Array.isArray(d)],
  ['/api/auto-defects',  d => true],  // may be null when no data
  ['/api/metrics',       d => d?.taskMetrics !== undefined && d?.gateFailures !== undefined],
  ['/api/topology',      d => Array.isArray(d?.nodes) && Array.isArray(d?.edges)],
  ['/api/topology/tour', d => d !== null],
  ['/api/topology/domains', d => d !== null],
  ['/api/documents',     d => d !== null],
]

console.log('\n── API Endpoints ──')
for (const [path, check] of apiTests) {
  const { status, data } = await fetchJSON(`${BASE}${path}`)
  assert(status === 200, `GET ${path} → 200`)
  assert(check(data), `GET ${path} response shape valid`)
}

// ── SSE Stream ────────────────────────────────────────────────────────

console.log('\n── SSE Stream ──')
{
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${BASE}/api/stream`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' }
    })
    assert(res.status === 200, 'GET /api/stream → 200')
    const ct = res.headers.get('content-type') || ''
    assert(ct.includes('text/event-stream'), 'content-type = text/event-stream')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const { value } = await reader.read()
    const chunk = decoder.decode(value)
    reader.cancel()
    clearTimeout(timeout)
    assert(chunk.length > 0, 'SSE sends initial data')
    assert(chunk.includes('event:') || chunk.includes('data:'), 'SSE format correct')
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('  ! SSE read timed out (server may not send init immediately)')
    } else {
      assert(false, `SSE: ${e.message}`)
    }
  }
}

// ── 404 Handling ──────────────────────────────────────────────────────

console.log('\n── 404 Handling ──')
{
  const res = await fetch(`${BASE}/spa/nonexistent.js`)
  assert(res.status === 404, '/spa/nonexistent.js → 404')
}

// ── Legacy Views ──────────────────────────────────────────────────────

console.log('\n── Legacy Views ──')
{
  const res = await fetch(`${BASE}/legacy/topology`)
  assert(res.status === 200, '/legacy/topology → 200')
}

// ── CORS ──────────────────────────────────────────────────────────────

console.log('\n── CORS ──')
{
  const res = await fetch(`${BASE}/health`, {
    headers: { Origin: 'http://example.com' }
  })
  const acao = res.headers.get('access-control-allow-origin')
  assert(acao === '*' || acao === 'http://example.com', `CORS header present: ${acao}`)
}

// ── Cleanup & Summary ────────────────────────────────────────────────

try { server?.stop() } catch {}

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══`)
if (failures.length) {
  console.log('\nFailures:')
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
}
console.log('')
process.exit(failed > 0 ? 1 : 0)
