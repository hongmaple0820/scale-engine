import { defineCommand } from 'citty'
import { PROJECT_DIR, isTruthyFlag } from './engineBootstrap.js'
import { renderCliError } from './CliUx.js'
import {
  addSubrepo,
  ensureGitInitialized,
  inspectGitGuardian,
  type GitGuardianReport,
} from '../setup/GitGuardian.js'

function renderGitError(error: unknown, json: boolean, command: string): void {
  if (json) console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
  else console.error(renderCliError(error, 'en', { title: `${command} failed`, command }))
  process.exitCode = 1
}

// ---------------------------------------------------------------------------
// scale git status
// ---------------------------------------------------------------------------

export const gitStatusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Report repository state, worktree cleanliness and registered subrepos',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable report' },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? PROJECT_DIR)
    try {
      const report = inspectGitGuardian(projectDir)
      if (report.repository.status === 'broken' || report.subrepos.warnings.length > 0) process.exitCode = 1
      if (isTruthyFlag(args.json)) {
        console.log(JSON.stringify(report, null, 2))
        return
      }
      renderGitStatus(report)
    } catch (error) {
      renderGitError(error, isTruthyFlag(args.json), 'scale git status')
    }
  },
})

function renderGitStatus(report: GitGuardianReport): void {
  const { repository, subrepos } = report
  console.log('\nSCALE GitGuardian')
  console.log(`  Directory: ${repository.projectDir}`)
  console.log(`  Status:    ${repository.status}`)
  if (repository.toplevel) console.log(`  Toplevel:  ${repository.toplevel}`)
  if (repository.branch) console.log(`  Branch:    ${repository.branch}`)
  if (repository.clean !== undefined) {
    const changed = repository.changedFiles?.length ?? 0
    console.log(`  Worktree:  ${repository.clean ? 'clean' : `dirty (${changed} change(s))`}`)
  }
  console.log(`  ${repository.message}`)

  console.log('\nSubrepositories')
  if (subrepos.repos.length === 0) {
    console.log(`  none (${subrepos.configPath})`)
  } else {
    for (const repo of subrepos.repos) {
      console.log(`  ${repo.state.padEnd(16)} ${repo.path} -> ${repo.remote}${repo.commit ? ` @ ${repo.commit}` : ''}${repo.clean === undefined ? '' : repo.clean ? ' (clean)' : ` (dirty: ${repo.changedFiles?.length ?? 0})`}`)
    }
  }

  const hints: string[] = []
  if (repository.status === 'none') {
    hints.push('Run `scale git init` to create a repository, or `scale install` to do it as part of setup.')
  }
  if (repository.status === 'nested') {
    hints.push('Run `scale git init --nested` to create an independent repository inside the parent.')
  }
  if (repository.status === 'broken') {
    hints.push('The .git directory is unreadable; repair it manually before relying on git governance.')
  }
  if (subrepos.warnings.length > 0) hints.push(...subrepos.warnings)
  if (hints.length > 0) {
    console.log('\nNext steps')
    for (const hint of hints) console.log(`  - ${hint}`)
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// scale git init
// ---------------------------------------------------------------------------

export const gitInitCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Prepare Git and commit only .gitignore in a new repository; existing repositories stay untouched',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    branch: { type: 'string', default: 'main', description: 'Default branch name for a new repository' },
    nested: { type: 'boolean', default: false, description: 'Create an independent repository even inside a parent repository' },
    'dry-run': { type: 'boolean', default: false, description: 'Report what would happen without touching git' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable report' },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? PROJECT_DIR)
    try {
      if (isTruthyFlag(args['dry-run'])) {
        const report = inspectGitGuardian(projectDir)
        const preview = {
          dryRun: true,
          status: report.repository.status,
          wouldInit: report.repository.status === 'none'
            || (report.repository.status === 'nested' && isTruthyFlag(args.nested)),
          repository: report.repository,
        }
        if (isTruthyFlag(args.json)) console.log(JSON.stringify(preview, null, 2))
        else {
          console.log('\nSCALE GitGuardian (dry run)')
          console.log(`  Status:   ${preview.status}`)
          console.log(`  Would init: ${preview.wouldInit ? 'yes' : 'no'}`)
          console.log('')
        }
        return
      }

      const report = ensureGitInitialized(projectDir, {
        defaultBranch: String(args.branch ?? 'main'),
        nestedStrategy: isTruthyFlag(args.nested) ? 'init' : 'reuse',
      })
      if (!report.ok || (report.initialized && !report.committed)) process.exitCode = 1
      if (isTruthyFlag(args.json)) {
        console.log(JSON.stringify(report, null, 2))
        return
      }
      console.log('\nSCALE GitGuardian')
      console.log(`  Status:      ${report.status}`)
      console.log(`  Initialized: ${report.initialized ? 'yes' : 'no'}`)
      console.log(`  Reused:      ${report.reused ? 'yes' : 'no'}`)
      if (report.branch) console.log(`  Branch:      ${report.branch}`)
      if (report.commit) console.log(`  Commit:      ${report.commit}`)
      if (report.gitignore) {
        console.log(`  .gitignore:  ${report.gitignore.added.length} added, ${report.gitignore.present.length} already present`)
      }
      if (report.parentIgnore) console.log(`  Parent ignore updated: ${report.parentIgnore}`)
      for (const warning of report.warnings) console.log(`  ! ${warning}`)
      if (report.nextSteps.length > 0) {
        console.log('\nNext steps')
        for (const step of report.nextSteps) console.log(`  - ${step}`)
      }
      console.log('')
    } catch (error) {
      renderGitError(error, isTruthyFlag(args.json), 'scale git init')
    }
  },
})

// ---------------------------------------------------------------------------
// scale git subrepo add
// ---------------------------------------------------------------------------

export const gitSubrepoAddCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Add a git submodule and record it in .scale/subrepos.json',
  },
  args: {
    path: { type: 'positional', required: true, description: 'Relative path of the submodule inside the project' },
    remote: { type: 'positional', required: true, description: 'HTTPS/SSH URL or git@host:path remote (local paths are rejected)' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    clone: { type: 'boolean', default: true, description: 'Clone the submodule; --no-clone records configuration only' },
    strategy: { type: 'string', default: 'submodule', description: 'submodule or standalone (register only)' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable report' },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? PROJECT_DIR)
    try {
      const strategy = String(args.strategy ?? 'submodule')
      if (strategy !== 'submodule' && strategy !== 'standalone') throw new Error('strategy must be submodule or standalone')
      const report = addSubrepo(
        projectDir,
        { path: String(args.path ?? ''), remote: String(args.remote ?? ''), strategy },
        { runSubmoduleAdd: isTruthyFlag(args.clone) },
      )
      if (isTruthyFlag(args.json)) {
        console.log(JSON.stringify(report, null, 2))
      } else if (report.ok) {
        console.log(`\n${report.message}\n  Config: ${report.configPath}\n`)
      } else {
        console.error(`\n${report.message}\n`)
      }
      if (!report.ok) process.exitCode = 1
    } catch (error) {
      renderGitError(error, isTruthyFlag(args.json), 'scale git subrepo add')
    }
  },
})

export const gitSubrepoCommand = defineCommand({
  meta: {
    name: 'subrepo',
    description: 'Declare and inspect subrepositories recorded in .scale/subrepos.json',
  },
  subCommands: {
    add: gitSubrepoAddCommand,
  },
})

// ---------------------------------------------------------------------------
// scale git (parent command)
// ---------------------------------------------------------------------------

export const gitCommand = defineCommand({
  meta: {
    name: 'git',
    description: 'GitGuardian — repository detection, bootstrap and subrepo registry',
  },
  subCommands: {
    status: gitStatusCommand,
    init: gitInitCommand,
    subrepo: gitSubrepoCommand,
  },
})
