// scale spec — spec-bundle ingestion and conformance
//
// `import-myspec` lands a MySpec SDD bundle in both spec layers:
//   .scale/specs/myspec/<name>/{constitution,requirements,solution,tasks}.md  (originals)
//   .scale/specs/myspec/imported.json                                        (registry)
//   .scale/specs/<name>.md                                                   (digest, session-injectable)
//   + Spec/Plan/Task artifacts in the store (FSM-governed) unless --no-artifacts
//
// `conformance` is the gate-checkable traceability audit: every EARS+
// criterion must be referenced by at least one task, no task may reference a
// requirement id that does not exist, and open tasks are reported. Exits
// non-zero when untraceable, and records a RuntimeEvidence record either way.

import { defineCommand } from 'citty'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getEngine } from './engineBootstrap.js'
import { RuntimeEvidenceLedger } from '../runtime/RuntimeEvidenceLedger.js'
import {
  buildSpecDigest,
  checkTraceability,
  mapToSpecPayload,
  parseMySpecBundle,
  parseRequirements,
  slugifyBundleName,
  type MySpecBundleFiles,
  type ParsedMySpecBundle,
} from '../spec/MySpecImporter.js'
import { compileAcceptanceChecks } from '../spec/AcceptanceCompiler.js'
import { detectSpecDrift } from '../spec/SpecDriftDetector.js'
import { intakeBrainstorm } from '../spec/BrainstormIntake.js'

const BUNDLE_FILES = ['constitution.md', 'requirements.md', 'solution.md', 'tasks.md'] as const

function readBundleFromDir(dir: string): MySpecBundleFiles {
  const missing = BUNDLE_FILES.filter(f => !existsSync(join(dir, f)))
  if (missing.length > 0) {
    throw new Error(`not a MySpec bundle: ${dir} is missing ${missing.join(', ')}`)
  }
  const read = (f: string) => readFileSync(join(dir, f), 'utf-8')
  return {
    constitution: read('constitution.md'),
    requirements: read('requirements.md'),
    solution: read('solution.md'),
    tasks: read('tasks.md'),
  }
}

interface ImportedRegistry {
  version: 1
  bundles: Array<{ name: string; slug: string; dir: string; importedAt: string }>
}

function registryPath(scaleDir: string): string {
  return join(scaleDir, 'specs', 'myspec', 'imported.json')
}

function loadRegistry(scaleDir: string): ImportedRegistry {
  const file = registryPath(scaleDir)
  if (!existsSync(file)) return { version: 1, bundles: [] }
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ImportedRegistry
  } catch {
    return { version: 1, bundles: [] }
  }
}

function scaleDirOf(): string {
  return process.env.SCALE_DIR || '.scale'
}

export const specImportMySpecCommand = defineCommand({
  meta: { name: 'import-myspec', description: 'Import a MySpec SDD bundle (constitution/requirements/solution/tasks) into SCALE specs' },
  args: {
    path: { type: 'positional', required: true, description: 'Directory containing the 4 markdown files (unzip MySpec export first)' },
    name: { type: 'string', description: 'Bundle display name (defaults to directory name)' },
    'no-artifacts': { type: 'boolean', default: false, description: 'Only write .scale/specs files; skip Spec/Plan/Task artifacts' },
  },
  async run({ args }) {
    const scaleDir = scaleDirOf()
    const dir = args.path
    if (!existsSync(dir)) throw new Error(`bundle directory not found: ${dir}`)

    const files = readBundleFromDir(dir)
    const parsed = parseMySpecBundle(files)
    if (parsed.criteria.length === 0) {
      throw new Error('no EARS+ acceptance criteria found in requirements.md (expected WHEN/WHILE/IF … SHALL lines)')
    }

    const name = args.name || dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'myspec-bundle'
    const slug = slugifyBundleName(name)

    // 1. originals under .scale/specs/myspec/<slug>/
    const originalsDir = join(scaleDir, 'specs', 'myspec', slug)
    mkdirSync(originalsDir, { recursive: true })
    writeFileSync(join(originalsDir, 'constitution.md'), files.constitution, 'utf-8')
    writeFileSync(join(originalsDir, 'requirements.md'), files.requirements, 'utf-8')
    writeFileSync(join(originalsDir, 'solution.md'), files.solution, 'utf-8')
    writeFileSync(join(originalsDir, 'tasks.md'), files.tasks, 'utf-8')

    // 2. registry
    const registry = loadRegistry(scaleDir)
    registry.bundles = registry.bundles.filter(b => b.slug !== slug)
    registry.bundles.push({ name, slug, dir: originalsDir, importedAt: new Date().toISOString() })
    writeFileSync(registryPath(scaleDir), JSON.stringify(registry, null, 2), 'utf-8')

    // 3. digest — top-level so SessionInjector's .scale/specs/*.md scan picks it up
    writeFileSync(join(scaleDir, 'specs', `${slug}.md`), buildSpecDigest(name, parsed), 'utf-8')

    // 4. artifacts (Spec → Plan → Tasks), FSM-governed like `scale define`
    let artifactIds: { spec?: string; plan?: string; tasks: string[] } = { tasks: [] }
    if (!args['no-artifacts']) {
      const { store } = getEngine()
      const payload = mapToSpecPayload(parsed)
      const spec = await store.create({
        type: 'Spec',
        title: `${name} (MySpec)`,
        payload,
        initialStatus: 'FROZEN',
        createdBy: { kind: 'human', userId: process.env.USER ?? 'cli' },
      })
      const plan = await store.create({
        type: 'Plan',
        title: `${name} — solution design (MySpec)`,
        payload: { design: parsed.design },
        parents: [spec.id],
        initialStatus: 'FROZEN',
        createdBy: { kind: 'human', userId: process.env.USER ?? 'cli' },
      })
      const tasks: string[] = []
      for (const task of parsed.tasks) {
        const artifact = await store.create({
          type: 'Task',
          title: task.text,
          payload: {
            description: task.text,
            filesInvolved: [],
            dependsOn: [],
            requiredRole: 'implementer',
            requiredCapabilities: [],
            requirementRefs: task.requirementRefs,
          },
          parents: [plan.id],
          initialStatus: task.done ? 'DONE' : 'TODO',
          createdBy: { kind: 'human', userId: process.env.USER ?? 'cli' },
        })
        tasks.push(artifact.id)
      }
      artifactIds = { spec: spec.id, plan: plan.id, tasks }
    }

    const trace = checkTraceability(parsed)
    console.log(`\n✅ MySpec bundle "${name}" imported`)
    console.log(`   originals : ${originalsDir}`)
    console.log(`   digest    : ${join(scaleDir, 'specs', slug + '.md')}`)
    if (artifactIds.spec) {
      console.log(`   artifacts : Spec ${artifactIds.spec} → Plan ${artifactIds.plan} → ${artifactIds.tasks.length} Task(s)`)
    }
    console.log(`   parsed    : ${parsed.stories.length} story(ies), ${parsed.criteria.length} EARS+ criteria, ${parsed.invariants.length} invariant(s), ${parsed.tasks.length} task(s)`)
    if (trace.untracedCriteria.length > 0) {
      console.log(`\n⚠️  ${trace.untracedCriteria.length} criterion(ia) not referenced by any task: ${trace.untracedCriteria.slice(0, 5).join(', ')}${trace.untracedCriteria.length > 5 ? ' …' : ''}`)
      console.log('   run `scale spec conformance` for the full traceability report')
    }
  },
})

export const specConformanceCommand = defineCommand({
  meta: { name: 'conformance', description: 'Traceability audit over imported MySpec bundles (gate-checkable: non-zero exit on untraceable criteria)' },
  args: {
    'allow-open-tasks': { type: 'boolean', default: false, description: 'Do not fail for unchecked tasks (fail only for broken traceability)' },
  },
  async run({ args }) {
    const scaleDir = scaleDirOf()
    const registry = loadRegistry(scaleDir)
    if (registry.bundles.length === 0) {
      console.log('No imported MySpec bundles. Import one with `scale spec import-myspec <dir>`.')
      return
    }

    const ledger = new RuntimeEvidenceLedger({ projectDir: process.cwd(), scaleDir })
    let allOk = true
    const summaries: string[] = []

    for (const entry of registry.bundles) {
      const originals = readdirSync(entry.dir).filter(f => f.endsWith('.md'))
      if (originals.length < 4) continue
      const files = readBundleFromDir(entry.dir)
      const parsed: ParsedMySpecBundle = parseMySpecBundle(files)
      const trace = checkTraceability(parsed)

      const openTaskFails = !args['allow-open-tasks'] && trace.openTasks.length > 0
      const bundleOk = trace.ok && !openTaskFails
      allOk = allOk && bundleOk

      console.log(`\n📦 ${entry.name} (${entry.slug})`)
      console.log(`   criteria: ${trace.criteriaCount}  tasks: ${trace.taskCount}  open tasks: ${trace.openTasks.length}`)
      if (trace.untracedCriteria.length > 0) {
        console.log(`   ❌ untraced criteria: ${trace.untracedCriteria.join(', ')}`)
      }
      if (trace.phantomRefs.length > 0) {
        for (const p of trace.phantomRefs.slice(0, 5)) console.log(`   ❌ phantom reference ${p.ref} in task: ${p.task.slice(0, 60)}`)
      }
      if (openTaskFails) console.log(`   ⏳ open tasks (${trace.openTasks.length}) — complete them or pass --allow-open-tasks`)
      if (bundleOk) console.log('   ✅ traceable')

      summaries.push(`${entry.slug}: ${bundleOk ? 'ok' : 'failed'} (${trace.criteriaCount} criteria, ${trace.untracedCriteria.length} untraced, ${trace.phantomRefs.length} phantom)`)
    }

    ledger.record({
      kind: 'gate',
      title: 'spec-conformance (MySpec)',
      status: allOk ? 'passed' : 'failed',
      summary: summaries.join(' | ').slice(0, 500),
      metadata: { bundles: registry.bundles.map(b => b.slug), source: 'scale spec conformance' },
    })

    console.log(`\n${allOk ? '✅ spec conformance passed' : '❌ spec conformance FAILED'} — evidence recorded to ${join(scaleDir, 'evidence', 'runtime')}`)
    if (!allOk) process.exitCode = 1
  },
})

export const specCompileChecksCommand = defineCommand({
  meta: { name: 'compile-checks', description: 'P1-B: 把 EARS+ 验收标准编译为可执行检查（command/property/checklist，供 verification.json 承载）' },
  args: {
    path: { type: 'positional', required: true, description: 'MySpec bundle 目录（含 requirements.md）或直接 requirements.md 文件' },
    'test-runner': { type: 'string', default: 'npm test --', description: '可执行 check 的命令模板前缀（会拼 --grep "<checkId>"）' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const p = String(args.path)
    let requirementsText: string
    if (existsSync(join(p, 'requirements.md'))) {
      requirementsText = readFileSync(join(p, 'requirements.md'), 'utf-8')
    } else if (existsSync(p)) {
      requirementsText = readFileSync(p, 'utf-8')
    } else {
      throw new Error(`requirements not found: ${p}`)
    }

    const stories = parseRequirements(requirementsText)
    const criteria = stories.flatMap(s => s.criteria)
    const result = compileAcceptanceChecks(
      criteria.map(c => ({ id: c.id, text: c.text, kind: c.kind })),
      { testRunner: String(args['test-runner']) },
    )

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`\nAcceptance checks: ${result.summary.total} total — ${result.summary.automatable} automatable, ${result.summary.needsHuman} needsHuman (coverage ${(result.coverage * 100).toFixed(0)}%)`)
    console.log(`  by kind: command=${result.summary.byKind.command} property=${result.summary.byKind.property} checklist=${result.summary.byKind.checklist}`)
    for (const c of result.checks) {
      const tag = c.needsHuman ? 'HUMAN' : c.kind.toUpperCase()
      console.log(`  [${tag}] ${c.checkId} <- ${c.clauseId}: ${c.clauseText.slice(0, 80)}`)
      if (c.commandTemplate) console.log(`         ${c.commandTemplate}`)
    }
  },
})

export const specDriftCommand = defineCommand({
  meta: { name: 'drift', description: 'P1-C: 检测 spec↔code 漂移并产出 append-only 草拟更新（不自动改 spec，人工确认）' },
  args: {
    'spec-file': { type: 'string', description: 'requirements.md / spec 文件路径（其解析出的条款参与匹配）' },
    changed: { type: 'string', description: '逗号分隔的变更文件；不传则用 --base 的 git diff，再否则用 git status' },
    base: { type: 'string', description: 'git ref（如 HEAD~1），用于计算变更文件' },
    'min-token': { type: 'string', default: '4' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { execSync } = await import('node:child_process')
    let changedFiles: string[] = []
    if (args.changed) {
      changedFiles = String(args.changed).split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    } else {
      try {
        changedFiles = args.base
          ? execSync(`git diff --name-only ${String(args.base)}`, { encoding: 'utf-8' }).split(/\r?\n/).filter(Boolean)
          : execSync('git status --porcelain', { encoding: 'utf-8' }).split(/\r?\n/).map(l => l.slice(3).trim()).filter(Boolean)
      } catch {
        changedFiles = []
      }
    }

    const specFile = args['spec-file'] ? String(args['spec-file']) : undefined
    let clauses: Array<{ id: string; text: string }> = []
    if (specFile && existsSync(specFile)) {
      const stories = parseRequirements(readFileSync(specFile, 'utf-8'))
      clauses = stories.flatMap(s => s.criteria).map(c => ({ id: c.id, text: c.text }))
    }

    const report = detectSpecDrift({
      clauses,
      changedFiles,
      specFiles: specFile ? [specFile] : [],
      minTokenLength: Number.parseInt(String(args['min-token']), 10) || 4,
    })

    if (args.json) {
      console.log(JSON.stringify({ ...report, changedFiles }, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`\nSpec drift: ${report.driftCount} finding(s), specTouched=${report.specTouched}`)
    for (const f of report.findings) {
      console.log(`  [DRIFT] ${f.clauseId} — ${f.reason}`)
      console.log(`     draft: ${f.suggestedUpdate}`)
    }
    if (report.ok) console.log('  No drift detected (or spec updated in this change set).')
    if (!report.ok) process.exitCode = 1
  },
})

export const specIntakeBrainstormCommand = defineCommand({
  meta: { name: 'intake-brainstorm', description: 'P2-D: translate superpowers/BMAD brainstorm output (GWT / checklists) into EARS+ and optionally compile to executable checks' },
  args: {
    file: { type: 'positional', required: true, description: 'Brainstorm output file (Given/When/Then, bullet checklists, or EARS lines)' },
    compile: { type: 'boolean', default: false, description: 'Also compile into executable acceptance checks' },
    'id-prefix': { type: 'string', default: 'BS', description: 'Generated criterion id prefix' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const file = String(args.file)
    if (!existsSync(file)) throw new Error(`file not found: ${file}`)
    const text = readFileSync(file, 'utf-8')
    const intake = intakeBrainstorm(text, { idPrefix: String(args['id-prefix']) })

    if (args.compile) {
      const compiled = compileAcceptanceChecks(intake.criteria)
      if (args.json) { console.log(JSON.stringify({ intake, compiled }, null, 2)); return }
      console.log(`\nBrainstorm intake: ${intake.converted} criteria (${intake.dropped.length} dropped)`)
      console.log(`Compiled: ${compiled.summary.automatable} automatable / ${compiled.summary.needsHuman} needsHuman (coverage ${(compiled.coverage * 100).toFixed(0)}%)`)
      for (const c of compiled.checks) console.log(`  [${c.needsHuman ? 'HUMAN' : c.kind.toUpperCase()}] ${c.checkId} <- ${c.clauseId}: ${c.clauseText.slice(0, 70)}`)
      return
    }
    if (args.json) { console.log(JSON.stringify(intake, null, 2)); return }
    console.log(`\nBrainstorm intake: ${intake.converted} criteria, ${intake.dropped.length} dropped`)
    for (const c of intake.criteria) console.log(`  [${c.kind}] ${c.id}: ${c.text}`)
    if (intake.dropped.length > 0) console.log(`  dropped: ${intake.dropped.slice(0, 5).join(' | ')}`)
  },
})

export const specCommand = defineCommand({
  meta: { name: 'spec', description: 'Spec bundle ingestion, conformance, acceptance-check compilation, drift, and brainstorm intake' },
  subCommands: {
    'import-myspec': specImportMySpecCommand,
    conformance: specConformanceCommand,
    'compile-checks': specCompileChecksCommand,
    drift: specDriftCommand,
    'intake-brainstorm': specIntakeBrainstormCommand,
  },
})
