// SCALE Engine — Evolve and Doctor Commands
import { defineCommand } from 'citty'
import { getEngine, SCALE_DIR } from './engineBootstrap.js'
import { LessonExtractor, RuleProposer, HookGenerator, EvolutionEngine } from '../evolution/EvolutionEngine.js'
import { Doctor } from '../api/doctor.js'
import { inspectEnvironment, renderEnvironmentDoctor } from '../env/EnvironmentDoctor.js'
import { listSurface, CLEANABLE_KINDS } from '../surface/ScaleSurface.js'
import { resolve } from 'node:path'

function runEnvironmentDoctor(json: unknown) {
  const report = inspectEnvironment()
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderEnvironmentDoctor(report))
  }
  process.exitCode = report.ok ? 0 : 1
}

function runSurfaceDoctor(dir: string, json: unknown) {
  const projectDir = resolve(dir || '.')
  const listing = listSurface(projectDir)
  if (json) {
    console.log(JSON.stringify(listing, null, 2))
    return
  }
  console.log('\nSCALE 产出面（plan 2026-10-24 产出治理）\n')
  console.log(`  .scale/ 顶层条目: ${listing.scaleEntryCount}`)
  console.log('\n  归类根（clean 依据）:')
  for (const root of listing.roots) {
    console.log(`    ${root.kind.padEnd(9)} ${root.path}${root.note ? `  — ${root.note}` : ''}`)
  }
  console.log(`\n  已登记的外部写入（manifest）: ${listing.external.length}`)
  for (const w of listing.external.slice(0, 20)) {
    console.log(`    ${w.kind.padEnd(9)} ${w.path}${w.platform ? `  [${w.platform}]` : ''}  (${w.by})`)
  }
  if (listing.external.length > 20) console.log(`    … 共 ${listing.external.length} 条`)
  if (listing.unregistered.length > 0) {
    console.log(`\n  ⚠️  存在但未登记（旧版本安装或手工创建）: ${listing.unregistered.length}`)
    for (const p of listing.unregistered.slice(0, 10)) console.log(`    ${p}`)
  }
  if (listing.missing.length > 0) {
    console.log(`\n  ⚠️  已登记但文件缺失: ${listing.missing.length}`)
    for (const p of listing.missing.slice(0, 10)) console.log(`    ${p}`)
  }
  console.log(`\n  可清理类别: ${[...CLEANABLE_KINDS].join(' / ')} — 用 scale clean --dry-run 查看`)
}

export const evolveCommand = defineCommand({
  meta: { name: 'evolve', description: 'Run evolution cycle (Defect→Lesson→Rule→Hook)' },
  args: {},
  async run() {
    const { store, kb, eventBus } = getEngine()
    const extractor = new LessonExtractor(store, kb, eventBus)
    const proposer = new RuleProposer(kb, eventBus)
    const generator = new HookGenerator(eventBus)
    const engine = new EvolutionEngine(extractor, proposer, generator, eventBus, SCALE_DIR)
    const stats = await engine.runCycle()
    console.log(JSON.stringify(stats, null, 2))
  },
})

export const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Diagnose SCALE Engine health' },
  args: {
    scope: { type: 'positional', required: false, description: 'Optional diagnostic scope: env | surface' },
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const scope = String(args.scope ?? '').trim().toLowerCase()
    if (scope === 'env' || scope === 'environment') {
      runEnvironmentDoctor(args.json)
      return
    }
    if (scope === 'surface') {
      runSurfaceDoctor(String(args.dir ?? '.'), args.json)
      return
    }
    if (scope) {
      console.error(`Unknown doctor scope: ${scope}. Supported scopes: env, surface.`)
      process.exitCode = 1
      return
    }
    const doc = new Doctor(args.dir)
    const report = await doc.diagnose()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(doc.formatReport(report))
    }
    process.exitCode = report.overall === 'broken' ? 1 : 0
  },
})
