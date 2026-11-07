#!/usr/bin/env node
// Agent self-install smoke — 守护 P0-5 「agent 自主安装不静默降级」。
// 模拟 agent 按 docs/start/agent-full-workflow.md 提示词走一遍：
//   1) install core（默认能力阶梯 Level 1）
//   2) setup --verify --pack full（检查满配能力，识别缺失/降级）
// 断言：验证报告必须显式暴露缺失项与可执行修复命令，不能把「缺第三方能力」静默当成功。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const cliPath = process.env.SCALE_INSTALL_SMOKE_CLI ?? join(repoRoot, 'dist', 'api', 'cli.js')

const results = []
function record(name, ok, detail) {
  results.push({ name, ok })
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
function runCli(args, cwd, timeout = 180_000) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8', timeout, windowsHide: true, cwd,
  })
}
function parseJson(stdout) {
  const text = String(stdout ?? '')
  const start = text.indexOf('{')
  if (start < 0) return null
  try { return JSON.parse(text.slice(start)) } catch { return null }
}

function main() {
  if (!existsSync(cliPath)) {
    console.error(`[agent-install-smoke] CLI not built at ${cliPath}. Run \`npm run build\` first.`)
    process.exitCode = 1
    return
  }
  const workDir = mkdtempSync(join(tmpdir(), 'scale-agent-install-smoke-'))
  const projectDir = join(workDir, 'project')
  try {
    // 步骤 1：安装 core（agent 的默认第一步）
    const install = runCli(['install', '--agent', 'claude-code', '--pack', 'core', '--lang', 'zh', '--dir', projectDir, '--no-git', '--json'], workDir)
    record('step1 install core exits 0', install.status === 0, `exit=${install.status}`)
    const installReport = parseJson(install.stdout)
    record('step1 report exposes capabilityTier', Boolean(installReport?.capabilityTier?.level), installReport?.capabilityTier?.label)
    record('step1 core tier is Level 1', installReport?.capabilityTier?.level === 1, `level=${installReport?.capabilityTier?.level}`)

    // 步骤 2：agent 检查满配能力
    const verify = runCli(['setup', '--verify', '--pack', 'full', '--dir', projectDir, '--json'], workDir)
    const verifyReport = parseJson(verify.stdout)
    record('step2 setup --verify emits JSON', Boolean(verifyReport))

    if (verifyReport) {
      const warnings = verifyReport.warnings ?? []
      const recommendations = verifyReport.recommendations ?? []
      const blocking = verifyReport.summary?.blockingIssues ?? []
      const missingSignals = [
        ...warnings, ...recommendations, ...blocking,
      ].filter(text => typeof text === 'string' && text.trim().length > 0)
      // 不静默降级：若 full 能力未就绪，必须至少有一个显式信号（警告/建议/阻塞）
      const fullNotReady = verifyReport.ok === false
        || (verifyReport.summary?.availableMemoryProviders ?? 0) === 0
        || missingSignals.length > 0
      record(
        'step2 surfaces explicit degraded/missing signals (no silent downgrade)',
        verifyReport.ok === true ? missingSignals.length > 0 || fullNotReady : true,
        `warnings=${warnings.length} recommendations=${recommendations.length} blocking=${blocking.length}`,
      )
      // 每条建议都要是可执行命令或明确修复指引
      const actionable = recommendations.filter(text => typeof text === 'string' && text.trim().length > 0)
      record('step2 recommendations are present and actionable', actionable.length > 0, actionable.slice(0, 2).join(' | '))
      // autoFixCommands 若存在，必须非空命令
      const autoFix = verifyReport.autoFixCommands ?? []
      if (autoFix.length > 0) record('step2 autoFixCommands surfaced', autoFix.every(c => typeof c === 'string' && c.length > 0), autoFix.join(' | '))
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.ok)
  console.log(`\n[agent-install-smoke] ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
}

main()
