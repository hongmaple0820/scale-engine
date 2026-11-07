#!/usr/bin/env node
// Install smoke — 守护「首次安装 exit 0」这一 P0 不变量。
// 用本仓库 dist（发版前已 build）在隔离临时目录跑一次真实 install，
// 断言：进程退出码 0、stdout 是合法 JSON、ok=true、.scale 与至少一个 agent 入口生成。
// 若原生绑定在临时环境不可用，install 必须仍退出 0（通过 autoFixCommands 提示），
// 绝不能因可修复的运行时缺陷把首次安装判为失败（GitHub issue #34/#35/#36 同批实测）。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const cliPath = process.env.SCALE_INSTALL_SMOKE_CLI ?? join(repoRoot, 'dist', 'api', 'cli.js')

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function main() {
  if (!existsSync(cliPath)) {
    console.error(`[install-smoke] CLI not built at ${cliPath}. Run \`npm run build\` (or tsc) first.`)
    process.exitCode = 1
    return
  }

  const workDir = mkdtempSync(join(tmpdir(), 'scale-install-smoke-'))
  const projectDir = join(workDir, 'project')
  try {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'install', '--agent', 'claude-code', '--pack', 'core', '--lang', 'zh', '--dir', projectDir, '--no-git', '--json'],
      { encoding: 'utf8', timeout: 180_000, windowsHide: true, cwd: workDir },
    )

    record('install exits 0 (P0 invariant)', result.status === 0, `exit=${result.status}`)

    let report = null
    try {
      const start = String(result.stdout ?? '').indexOf('{')
      report = start >= 0 ? JSON.parse(String(result.stdout).slice(start)) : null
    } catch {
      report = null
    }
    record('install emits parseable JSON report', Boolean(report))

    if (report) {
      record('report.ok is true (no hard blocker)', report.ok === true, `ok=${report.ok}`)
      const blocking = report.verification?.summary?.blockingIssues ?? report.summary?.blockingIssues ?? []
      record('no hard blocking issues', blocking.length === 0, blocking.slice(0, 3).join('; '))
      const autoFix = report.verification?.autoFixCommands ?? report.autoFixCommands ?? []
      if (autoFix.length > 0) record('auto-fix commands surfaced (not a blocker)', true, autoFix.join(' | '))
    }

    record('.scale directory created', existsSync(join(projectDir, '.scale')), join(projectDir, '.scale'))
    const agentEntries = ['.claude', 'AGENTS.md', 'CLAUDE.md'].filter(name => existsSync(join(projectDir, name)))
    record('at least one agent entry generated', agentEntries.length > 0, agentEntries.join(', '))

    if (result.status !== 0 && result.stderr) {
      console.error('--- install stderr (tail) ---')
      console.error(String(result.stderr).split('\n').slice(-12).join('\n'))
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.ok)
  console.log(`\n[install-smoke] ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
}

main()
