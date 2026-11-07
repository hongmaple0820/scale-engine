// SCALE Engine — P3-D GitHub integration commands (tasks→issues, dry-run by default)
import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { getEngine } from './engineBootstrap.js'
import { planIssues, type TaskInput } from '../integrations/GitHubIssuePlanner.js'

const planIssuesCommand = defineCommand({
  meta: { name: 'plan-issues', description: 'Dry-run: plan GitHub issues from SCALE tasks (no issues are created)' },
  args: {
    input: { type: 'string', description: 'JSON file with an array of tasks ({id,title,description?,level?,filesInvolved?})' },
    'task-ids': { type: 'string', description: 'Comma-separated task ids to read from the artifact store' },
    repo: { type: 'string', default: '<owner/repo>', description: 'Target repository (for the publish hint only)' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let tasks: TaskInput[] = []
    if (args.input) {
      const raw = readFileSync(String(args.input), 'utf-8')
      // 容忍 UTF-8 BOM：PowerShell 5 的 Out-File -Encoding UTF8 会写 BOM，
      // 直接 JSON.parse 会报 "Unexpected token"（实测复现）。
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Array<Record<string, unknown>>
      tasks = parsed.map(t => ({
        id: String(t.id),
        title: String(t.title ?? t.id),
        description: t.description ? String(t.description) : undefined,
        level: t.level as TaskInput['level'],
        filesInvolved: Array.isArray(t.filesInvolved) ? t.filesInvolved.map(String) : undefined,
      }))
    } else if (args['task-ids']) {
      const { store } = getEngine()
      for (const id of String(args['task-ids']).split(',').map(s => s.trim()).filter(Boolean)) {
        const artifact = await store.get(id)
        if (!artifact) continue
        const payload = artifact.payload as Record<string, unknown>
        tasks.push({
          id: artifact.id,
          title: artifact.title,
          description: payload.description ? String(payload.description) : undefined,
          level: payload.workflowLevel as TaskInput['level'],
          filesInvolved: Array.isArray(payload.filesInvolved) ? (payload.filesInvolved as unknown[]).map(String) : undefined,
        })
      }
    } else {
      throw new Error('provide --input <tasks.json> or --task-ids <ids>')
    }

    const plan = planIssues(tasks, String(args.repo))
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
      return
    }
    console.log(`\nGitHub issue plan (dry run): ${plan.issues.length} issue(s)`)
    for (const issue of plan.issues) {
      console.log(`  ${issue.title}`)
      console.log(`     labels: ${issue.labels.join(', ')}`)
    }
    console.log(`\n  ${plan.repoNote}`)
  },
})

export const githubCommand = defineCommand({
  meta: { name: 'github', description: 'GitHub integration (dry-run planners)' },
  subCommands: { 'plan-issues': planIssuesCommand },
})
