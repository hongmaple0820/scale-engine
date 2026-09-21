import { defineCommand } from 'citty'
import { PROJECT_DIR, isTruthyFlag } from './engineBootstrap.js'
import { renderCliError } from './CliUx.js'
import { executeCommit, planCommit, type CommitSuggestPlan } from '../workflow/CommitSuggest.js'

export const commitSuggestCommand = defineCommand({
  meta: {
    name: 'commit-suggest',
    description: 'Suggest a conventional commit from the current worktree changes; optionally stage and commit them',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    type: { type: 'string', description: 'Override the inferred commit type (feat/fix/test/docs/chore/refactor/perf/ci)' },
    message: { type: 'string', description: 'Override the suggested commit message' },
    execute: { type: 'boolean', default: false, description: 'Stage the planned files and create the commit' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable report' },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? PROJECT_DIR)
    const json = isTruthyFlag(args.json)
    try {
      const plan = planCommit(projectDir, {
        type: args.type ? String(args.type) : undefined,
        message: args.message ? String(args.message) : undefined,
      })
      const execute = isTruthyFlag(args.execute)
      const result = execute ? executeCommit(projectDir, plan, { message: args.message ? String(args.message) : undefined }) : undefined
      if (!plan.ok && !execute) process.exitCode = 1
      if (result && !result.ok) process.exitCode = 1
      if (json) {
        console.log(JSON.stringify({ plan, execute: result }, null, 2))
        return
      }
      renderPlan(plan, result)
    } catch (error) {
      if (json) console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
      else console.error(renderCliError(error, 'en', { title: 'commit-suggest failed', command: 'scale commit-suggest' }))
      process.exitCode = 1
    }
  },
})

function renderPlan(plan: CommitSuggestPlan, result?: ReturnType<typeof executeCommit>): void {
  console.log('\nSCALE Commit Suggest')
  console.log(`  Directory: ${plan.projectDir}`)
  if (plan.branch) console.log(`  Branch:    ${plan.branch}`)
  console.log(`  Type:      ${plan.suggestedType}`)
  console.log(`  Message:   ${plan.suggestedMessage}`)
  if (plan.entries.length > 0) {
    console.log(`\n  Changes (${plan.entries.length}):`)
    for (const entry of plan.entries) console.log(`    ${entry.status.padEnd(3)} ${entry.path}`)
  }
  if (plan.excluded.length > 0) {
    console.log(`\n  Excluded as tool artifacts (${plan.excluded.length}):`)
    for (const entry of plan.excluded) console.log(`    ${entry.status.padEnd(3)} ${entry.path}`)
  }
  if (result) {
    if (result.ok) {
      console.log(`\n  Commit:    ${result.commit} (${result.staged.length} file(s) staged)`)
      console.log(`  Message:   ${result.message}`)
    } else {
      console.log(`\n  Failed:    ${result.message}`)
      for (const warning of result.warnings) console.log(`  ! ${warning}`)
    }
  }
  for (const warning of plan.warnings) console.log(`  ! ${warning}`)
  if (!result) {
    console.log('\n  Review the message, then run again with --execute to stage and commit.')
  }
  console.log('')
}
