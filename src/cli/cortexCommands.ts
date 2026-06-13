import { defineCommand } from 'citty'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { InstinctExtractor } from '../cortex/InstinctExtractor.js'
import { InstinctStore } from '../cortex/InstinctStore.js'
import { ReflexionEngine } from '../cortex/ReflexionEngine.js'
import { SessionInjector } from '../cortex/SessionInjector.js'
import { GovernanceMetricsCalculator } from '../cortex/GovernanceMetrics.js'
import { candidateReviewSummary, formatRejectedCandidate, reviewInstinctCandidates, selectReviewedInstinctCandidates } from '../cortex/InstinctCandidateReview.js'
import { cortexApplyCommand } from './cortexApplyCommand.js'
import { cortexApproveCommand, cortexRejectCommand } from './cortexCandidateCommands.js'
// ---------------------------------------------------------------------------
// scale cortex extract
// ---------------------------------------------------------------------------

export const cortexExtractCommand = defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract instincts from observation logs — detect failure patterns and create learning entries',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    'min-confidence': { type: 'string', default: '0.5', description: 'Minimum confidence threshold (0.3-0.9)' },
    'dry-run': { type: 'boolean', default: false, description: 'Preview extracted instincts without saving them' },
    'include-stale': { type: 'boolean', default: false, description: 'Save stale or review-only candidates for backwards-compatible extraction' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const minConfidence = parseFloat(String(args['min-confidence'] ?? 0.5))
    const dryRun = args['dry-run'] === true
    const includeStale = args['include-stale'] === true

    const extractor = new InstinctExtractor(scaleDir)
    const store = new InstinctStore(join(scaleDir, 'instincts'))

    console.log('SCALE Cortex — Extracting Instincts\n')

    const observations = extractor.loadObservations()
    console.log(`  Observations loaded: ${observations.length}`)

    if (observations.length === 0) {
      console.log('  No observations found. Instincts are built from gate failure data.')
      console.log('  Run gates first, then re-run: scale cortex extract\n')
      return
    }

    const patterns = extractor.detectPatterns(observations)
    console.log(`  Patterns detected:  ${patterns.length}`)

    const instincts = extractor.extract(patterns)
    const reviewed = reviewInstinctCandidates(instincts, patterns, observations)
    const selection = selectReviewedInstinctCandidates(reviewed, minConfidence, includeStale)
    const filtered = selection.instincts
    const { eligibleReviews, saveableReviews, rejectedReviews, summary: reviewSummary } = selection
    const reviewLine = `  Candidate review: accepted=${reviewSummary.accepted}, stale=${reviewSummary.stale}, needs-review=${reviewSummary['needs-review']}`

    console.log(`  Instincts extracted: ${instincts.length} (${filtered.length} ≥ ${minConfidence} confidence)\n`)

    console.log(`  Eligible above threshold: ${eligibleReviews.length}; saveable=${filtered.length}`)
    console.log(reviewLine)
    if (!includeStale && rejectedReviews.length > 0) {
      console.log(`  Filtered out: ${rejectedReviews.length} stale/review-only candidate(s)`)
    }

    let saved = 0
    if (!dryRun) {
      for (const review of saveableReviews) {
        if (store.save(review.instinct)) saved++
      }
    }

    console.log(dryRun
      ? '  Dry run: no instincts saved to .scale/instincts/'
      : `  Saved: ${saved} instincts to .scale/instincts/`)

    if (args.json) {
      console.log(JSON.stringify({
        instincts: filtered,
        rejected: rejectedReviews.map(formatRejectedCandidate),
        review: reviewSummary,
      }, null, 2))
      return
    }

    if (filtered.length > 0) {
      console.log('\n  Top instincts:')
      for (const i of filtered.slice(0, 5)) {
        console.log(`  [${(i.confidence * 100).toFixed(0)}%] ${i.domain}: ${i.trigger}`)
      }
    }
    if (rejectedReviews.length > 0) {
      console.log('\n  Rejected candidates:')
      for (const review of rejectedReviews.slice(0, 5)) {
        console.log(`  [${review.status}] ${review.instinct.trigger} - ${review.reasons[0]}`)
      }
    }
    console.log()
  },
})

// ---------------------------------------------------------------------------
// scale cortex inject
// ---------------------------------------------------------------------------

export const cortexInjectCommand = defineCommand({
  meta: {
    name: 'inject',
    description: 'Preview what SCALE Cortex would inject at SessionStart — high-confidence instincts',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    minimal: { type: 'boolean', default: false, description: 'Show minimal (low-context) injection format' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const injector = new SessionInjector(store)

    const injection = args.minimal
      ? injector.buildMinimal()
      : injector.build()

    if (args.json) {
      console.log(JSON.stringify(injection, null, 2))
      return
    }

    console.log('SCALE Cortex — SessionStart Injection Preview\n')
    console.log(`  Instincts: ${injection.instinctCount}`)
    console.log(`  Character count: ${injection.content.length}\n`)
    console.log('─── Injection Content ───\n')
    console.log(injection.content || '(no high-confidence instincts to inject)')
    console.log()
  },
})

// ---------------------------------------------------------------------------
// scale cortex metrics
// ---------------------------------------------------------------------------

export const cortexMetricsCommand = defineCommand({
  meta: {
    name: 'metrics',
    description: 'Compute SCALE Cortex governance ROI — gate pass rates, instinct hit rates, cost savings',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    days: { type: 'string', default: '30', description: 'Lookback period in days' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const calculator = new GovernanceMetricsCalculator(scaleDir)
    const days = parseInt(String(args.days ?? 30), 10)

    const instincts = store.loadAll()
    const metrics = calculator.compute(instincts, days)

    if (args.json) {
      console.log(JSON.stringify(metrics, null, 2))
      return
    }

    console.log(calculator.render(metrics))
  },
})

// ---------------------------------------------------------------------------
// scale cortex evolve
// ---------------------------------------------------------------------------

export const cortexEvolveCommand = defineCommand({
  meta: {
    name: 'evolve',
    description: 'Run full Cortex evolution cycle: reflect → extract → save high-confidence instincts',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    'include-stale': { type: 'boolean', default: false, description: 'Save stale or review-only candidates for backwards-compatible evolution' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const includeStale = args['include-stale'] === true

    const extractor = new InstinctExtractor(scaleDir)
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const reflector = new ReflexionEngine()

    console.log('SCALE Cortex — Evolution Cycle\n')

    // 1. Load observations
    const observations = extractor.loadObservations()
    console.log(`  1. Observations: ${observations.length}`)

    // 2. Reflect on failures
    const reflections = await reflector.reflectAll(observations)
    console.log(`  2. Reflections:  ${reflections.length}`)

    // 3. Extract patterns
    const patterns = extractor.detectPatterns(observations)
    console.log(`  3. Patterns:     ${patterns.length}`)

    // 4. Extract instincts
    const instincts = extractor.extract(patterns)
    console.log(`  4. Instincts:    ${instincts.length}`)

    // 5. Save high-confidence (0.7+) instincts
    const reviewed = reviewInstinctCandidates(instincts, patterns, observations)
    const selection = selectReviewedInstinctCandidates(reviewed, 0.7, includeStale)
    const { saveableReviews, summary: reviewSummary } = selection
    let saved = 0
    for (const review of saveableReviews) {
      if (store.save(review.instinct)) saved++
    }
    console.log(`  5. Candidate review: accepted=${reviewSummary.accepted}, stale=${reviewSummary.stale}, needs-review=${reviewSummary['needs-review']}`)
    console.log(`  5. Saved:        ${saved} (confidence ≥ 0.7)\n`)

    // 6. Show reflection results
    for (const r of reflections.slice(0, 5)) {
      console.log(`  [${(r.confidence * 100).toFixed(0)}%] ${r.rootCause}`)
      console.log(`  Action: ${r.suggestedAction}\n`)
    }

    // 7. Stats
    const stats = store.stats()
    console.log(`  Store: ${stats.total} total instincts`)
    for (const [bucket, count] of Object.entries(stats.byConfidence)) {
      if (count > 0) console.log(`    ${bucket}: ${count}`)
    }
    console.log()

    if (args.json) {
      console.log(JSON.stringify({
        observations: observations.length,
        reflections: reflections.length,
        patterns: patterns.length,
        instincts: instincts.length,
        saved,
        review: reviewSummary,
        stats,
      }, null, 2))
    }
  },
})

// ---------------------------------------------------------------------------
// scale cortex verify
// ---------------------------------------------------------------------------

export const cortexVerifyCommand = defineCommand({
  meta: {
    name: 'verify',
    description: 'Verify Cortex pipeline health — instinct store integrity, observation data, injection readiness',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')

    const checks: { name: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string }[] = []

    // 1. Instinct store integrity
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const allInstincts = store.loadAll()
    const storeStats = store.stats()

    let storeIssues = 0
    for (const instinct of allInstincts) {
      if (!instinct.id || !instinct.trigger) { storeIssues++; continue }
      if (instinct.confidence < 0 || instinct.confidence > 1) storeIssues++
      if (instinct.hitRate < 0 || instinct.hitRate > 1) storeIssues++
      if (instinct.observations < 0) storeIssues++
    }

    checks.push({
      name: 'Instinct store integrity',
      status: storeIssues > 0 ? 'WARN' : 'PASS',
      detail: storeIssues > 0
        ? `${storeIssues} instinct(s) with invalid fields out of ${allInstincts.length}`
        : `${allInstincts.length} instincts loaded, all fields valid`,
    })

    // 2. Observation data validity
    const extractor = new InstinctExtractor(scaleDir)
    const observations = extractor.loadObservations()
    let validObs = 0
    let invalidObs = 0
    for (const obs of observations) {
      if (obs.timestamp && obs.gateName && obs.gateStatus) validObs++
      else invalidObs++
    }

    checks.push({
      name: 'Observation data',
      status: invalidObs > 0 ? 'WARN' : observations.length === 0 ? 'WARN' : 'PASS',
      detail: observations.length === 0
        ? 'No observations found — run gates first to generate data'
        : invalidObs > 0
          ? `${invalidObs} malformed observation(s) out of ${observations.length}`
          : `${observations.length} observations, all valid`,
    })

    // 3. Pipeline connectivity (observations → patterns → instincts)
    if (observations.length > 0) {
      const patterns = extractor.detectPatterns(observations)
      const extracted = extractor.extract(patterns)
      const reviewed = reviewInstinctCandidates(extracted, patterns, observations)
      const reviewSummary = candidateReviewSummary(reviewed)

      checks.push({
        name: 'Pipeline connectivity',
        status: patterns.length > 0 && extracted.length > 0 ? 'PASS' : 'WARN',
        detail: `${observations.length} observations → ${patterns.length} patterns → ${extracted.length} instincts`,
      })
      checks.push({
        name: 'Candidate review',
        status: reviewSummary.stale > 0 || reviewSummary['needs-review'] > 0 ? 'WARN' : 'PASS',
        detail: `accepted=${reviewSummary.accepted}, stale=${reviewSummary.stale}, needs-review=${reviewSummary['needs-review']}`,
      })
    } else {
      checks.push({
        name: 'Pipeline connectivity',
        status: 'WARN',
        detail: 'No observations to test pipeline — skipped',
      })
    }

    // 4. Injection readiness
    const injector = new SessionInjector(store)
    const injection = injector.build()

    checks.push({
      name: 'Injection readiness',
      status: injection.instinctCount > 0 ? 'PASS' : 'WARN',
      detail: injection.instinctCount > 0
        ? `${injection.instinctCount} reviewed instinct(s) ready for SessionStart (${injection.content.length} chars)`
        : 'No high-confidence instincts (≥0.7) for injection',
    })

    // 5. Metrics computability
    try {
      const calculator = new GovernanceMetricsCalculator(scaleDir)
      const metrics = calculator.compute(allInstincts, 30)
      const hasPlaceholders = metrics.cost.estimatedSavingsFromCaching > 0 &&
        metrics.trends.instinctHitRateDelta === 0

      checks.push({
        name: 'Metrics computability',
        status: 'PASS',
        detail: hasPlaceholders
          ? `Gate pass rate: ${(metrics.gates.passRate * 100).toFixed(0)}%, instinct hit rate: ${(metrics.instincts.hitRate * 100).toFixed(0)}% (some values use estimates)`
          : `Gate pass rate: ${(metrics.gates.passRate * 100).toFixed(0)}%, instinct hit rate: ${(metrics.instincts.hitRate * 100).toFixed(0)}%`,
      })
    } catch (err: unknown) {
      checks.push({
        name: 'Metrics computability',
        status: 'FAIL',
        detail: `Failed to compute metrics: ${err instanceof Error ? err.message : String(err)}`,
      })
    }

    // 6. Reflexion engine availability
    const hasLocalModel = !!process.env.SCALE_LOCAL_MODEL
    checks.push({
      name: 'Reflexion engine',
      status: hasLocalModel ? 'PASS' : 'WARN',
      detail: hasLocalModel
        ? `Local model configured: ${process.env.SCALE_LOCAL_MODEL}`
        : 'SCALE_LOCAL_MODEL not set — reflexion uses heuristic fallback',
    })

    // Output
    const passed = checks.filter(c => c.status === 'PASS').length
    const warned = checks.filter(c => c.status === 'WARN').length
    const failed = checks.filter(c => c.status === 'FAIL').length
    const overall = failed > 0 ? 'FAIL' : warned > 0 ? 'WARN' : 'PASS'

    if (args.json) {
      console.log(JSON.stringify({ overall, checks, store: storeStats }, null, 2))
      return
    }

    console.log('SCALE Cortex — Pipeline Verification\n')
    for (const check of checks) {
      const icon = check.status === 'PASS' ? '[OK]' : check.status === 'WARN' ? '[WARN]' : '[FAIL]'
      console.log(`  ${icon} ${check.name}: ${check.detail}`)
    }
    console.log(`\n  Overall: ${overall} (${passed} passed, ${warned} warnings, ${failed} failures)`)
    console.log(`  Store: ${storeStats.total} instincts across ${Object.keys(storeStats.byDomain).length} domain(s)\n`)
  },
})

// ---------------------------------------------------------------------------
// scale cortex audit
// ---------------------------------------------------------------------------

export const cortexAuditCommand = defineCommand({
  meta: {
    name: 'audit',
    description: 'List append-only Cortex instinct audit history',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    id: { type: 'string', description: 'Filter by instinct id' },
    limit: { type: 'string', default: '20', description: 'Maximum entries to show' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const limit = Math.max(1, parseInt(String(args.limit ?? 20), 10) || 20)
    const entries = store.history(args.id ? String(args.id) : undefined).slice(-limit)

    if (args.json) {
      console.log(JSON.stringify({ count: entries.length, entries }, null, 2))
      return
    }

    console.log('SCALE Cortex - Instinct Audit\n')
    if (entries.length === 0) {
      console.log('  No audit entries found.')
      return
    }
    for (const entry of entries) {
      const scope = [entry.scope, entry.projectId].filter(Boolean).join(':') || 'unknown-scope'
      const reason = entry.reason ? ` reason=${entry.reason}` : ''
      console.log(`  ${entry.ts} ${entry.op} ${entry.id} scope=${scope} audit=${entry.auditId}${reason}`)
    }
  },
})

// scale cortex restore
// ---------------------------------------------------------------------------

export const cortexRestoreCommand = defineCommand({
  meta: {
    name: 'restore',
    description: 'Restore a Cortex instinct from an audit entry snapshot',
  },
  args: {
    auditId: { type: 'positional', required: true, description: 'Audit entry id to restore' },
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const auditId = String(args.auditId)
    const restored = store.restore(auditId)

    if (args.json) {
      console.log(JSON.stringify({ restored, auditId }, null, 2))
      if (!restored) process.exitCode = 1
      return
    }

    if (restored) {
      console.log(`Restored Cortex instinct snapshot from audit entry: ${auditId}`)
    } else {
      console.error(`No restorable Cortex audit entry found: ${auditId}`)
      process.exitCode = 1
    }
  },
})

export const cortexCommand = defineCommand({
  meta: {
    name: 'cortex',
    description: 'SCALE Cortex — Evidence-driven continuous learning and governance evolution',
  },
  subCommands: {
    extract: cortexExtractCommand,
    inject: cortexInjectCommand,
    metrics: cortexMetricsCommand,
    evolve: cortexEvolveCommand,
    approve: cortexApproveCommand,
    reject: cortexRejectCommand,
    verify: cortexVerifyCommand,
    apply: cortexApplyCommand,
    audit: cortexAuditCommand,
    restore: cortexRestoreCommand,
  },
})
