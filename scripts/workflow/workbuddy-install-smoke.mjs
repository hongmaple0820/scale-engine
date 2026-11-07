#!/usr/bin/env node
// P5: workbuddy install smoke — 验证 `scale install --agent workbuddy` 在真实临时目录
// 干净安装：exit 0、JSON ok=true、无 blocker、且生成 .workbuddy/settings.json。
// 用法: node scripts/workflow/workbuddy-install-smoke.mjs
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cli = join(repoRoot, 'dist', 'api', 'cli.js')
const node = process.execPath

const dir = mkdtempSync(join(tmpdir(), 'scale-workbuddy-'))
let code = 1
try {
  const result = spawnSync(node, [
    cli, 'install',
    '--agent', 'workbuddy',
    '--pack', 'core',
    '--lang', 'zh',
    '--dir', dir,
    '--json',
    '--no-git',
  ], { encoding: 'utf-8', timeout: 120_000, env: { ...process.env, SCALE_LOG_LEVEL: 'silent' } })

  const stdout = String(result.stdout || '')
  const checks = []
  checks.push(['exit 0', result.status === 0, `status=${result.status}`])
  let json = null
  try {
    json = JSON.parse(stdout.trim())
  } catch {
    json = null
  }
  checks.push(['JSON parse', Boolean(json), json ? 'ok' : stdout.slice(0, 200)])
  checks.push(['ok=true', json?.ok === true, JSON.stringify(json?.ok)])
  checks.push(['no blockers', !json?.report?.blockers || json.report.blockers.length === 0, JSON.stringify(json?.report?.blockers ?? []).slice(0, 200)])
  checks.push(['.workbuddy/settings.json', existsSync(join(dir, '.workbuddy', 'settings.json')), join(dir, '.workbuddy', 'settings.json')])

  const failed = checks.filter(([, passed]) => !passed)
  for (const [name, passed, detail] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
  }
  console.log(`\nworkbuddy-install-smoke: ${checks.length - failed.length}/${checks.length} checks passed`)
  code = failed.length === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
process.exit(code)
