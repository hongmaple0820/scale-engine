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
  slugifyBundleName,
  type MySpecBundleFiles,
  type ParsedMySpecBundle,
} from '../spec/MySpecImporter.js'

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

export const specCommand = defineCommand({
  meta: { name: 'spec', description: 'Spec bundle ingestion and conformance (MySpec SDD integration)' },
  subCommands: {
    'import-myspec': specImportMySpecCommand,
    conformance: specConformanceCommand,
  },
})
