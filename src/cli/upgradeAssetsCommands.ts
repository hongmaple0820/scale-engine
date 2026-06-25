// SCALE Engine — Upgrade, Assets, Standards, and Artifact CLI Commands
// Extracted from api/cli.ts (lines 2042-2944)

import { defineCommand } from 'citty'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  getEngine,
  SCALE_DIR,
  PROJECT_DIR,
  isTruthyFlag,
  resolveScaleDirForProject,
  normalizePreflightProfile,
  gatesForPreflightProfile,
} from './engineBootstrap.js'
import { normalizeLanguage } from '../i18n/Language.js'
import {
  applyUpgradePlan,
  createUpgradeCheckReport,
  createUpgradePlanReport,
  createUpgradeRecommendReport,
  rollbackLatestUpgrade,
  writeUpgradePlanHtml,
} from '../workflow/UpgradeManager.js'
import {
  baselineEngineeringStandards,
  doctorEngineeringStandards,
  scanEngineeringStandards,
  settleEngineeringStandards,
} from '../workflow/EngineeringStandards.js'
import { doctorResourceAssets, scanResourceAssets, settleResourceAssets } from '../workflow/ResourceGovernance.js'
import {
  doctorHtmlArtifacts,
  renderHtmlArtifact,
  resolveHtmlArtifactForOpen,
  settleHtmlArtifacts,
} from '../output/HTMLArtifactLayer.js'
import { renderGovernanceDashboard } from '../output/GovernanceDashboard.js'

// ============================================================================
// Shared helpers
// ============================================================================

function normalizeThemeArg(value: unknown): 'dark' | 'light' | 'auto' {
  const normalized = String(value ?? 'auto').trim().toLowerCase()
  if (normalized === 'dark' || normalized === 'light' || normalized === 'auto') return normalized
  return 'auto'
}

function normalizeLangArg(value: unknown): 'zh' | 'en' {
  return normalizeLanguage(value ?? process.env.SCALE_LANG)
}

function splitChangedFiles(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function readGitPathList(projectDir: string, args: string[]): string[] {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function readGitChangedFiles(projectDir: string): string[] {
  const tracked = readGitPathList(projectDir, ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--'])
  const untracked = readGitPathList(projectDir, ['ls-files', '--others', '--exclude-standard'])
  return Array.from(new Set([...tracked, ...untracked]))
}

function resolveChangedFilesArg(args: { dir?: string; changed?: boolean; 'changed-files'?: string }): string[] | undefined {
  const explicit = splitChangedFiles(args['changed-files'])
  if (explicit.length > 0) return explicit
  if (!args.changed) return undefined
  return readGitChangedFiles(args.dir ?? '.')
}

function readGitChangedFilesForStandards(projectDir: string): string[] | undefined {
  try {
    execFileSync('git', ['-C', projectDir, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
  return readGitChangedFiles(projectDir)
}

function launchLocalFile(path: string): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', path], { stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      execFileSync('open', [path], { stdio: 'ignore' })
    } else {
      execFileSync('xdg-open', [path], { stdio: 'ignore' })
    }
  } catch {
    // Opening is convenience-only; artifact doctor/render remains the source of truth.
  }
}

function formatUpgradeBlockerMessage(code: string, fallback: string, lang: 'zh' | 'en'): string {
  if (lang !== 'zh') return fallback
  if (code === 'missing-governance-lock') return '缺少治理锁文件，无法判断哪些生成文件可以安全升级。'
  if (code === 'local-generated-file-changed') return '受管生成文件已有本地改动，需要三方对比或人工审阅后再升级。'
  return fallback
}

function formatUpgradeStepReason(action: string, fallback: string, lang: 'zh' | 'en'): string {
  if (lang !== 'zh') return fallback
  switch (action) {
    case 'initialize-governance-lock':
      return '先创建治理锁文件，后续才能安全升级生成的治理资产。'
    case 'upgrade-scale-engine':
      return fallback.replace('SCALE Engine changed from', 'SCALE Engine 版本变化：').replace(' to ', ' -> ')
    case 'upgrade-governance-pack':
      return fallback.replace('Governance pack', '治理包').replace('changed from', '版本变化：').replace(' to ', ' -> ')
    case 'refresh-managed-generated-files':
      return fallback.replace('clean managed governance files can be refreshed automatically; local edits still block automatic apply.', '个干净受管治理文件可自动刷新；已有本地改动的文件仍会阻止自动应用。')
    case 'restore-missing-generated-file':
      return '该文件由治理锁管理，但当前本地缺失，可从当前治理包恢复。'
    case 'review-local-change':
      return '需要保留、合并或明确替换本地改动，不能自动覆盖。'
    case 'setup-third-party-capabilities':
      return fallback.replace('Default setup provisions governed third-party capabilities; execution remains evidence-required and destructive actions stay policy-bound.', '默认安装受管第三方能力；执行仍需证据并受破坏性动作策略约束。')
    case 'adopt-ai-os-runtime':
      return '运行 AI OS 一键接入路径，生成运行态目录、首份 dry-run、benchmark 和 doctor 报告。'
    case 'migrate-ai-os-runtime':
      return 'AI OS 运行态目录缺失；接入 beta runtime 前先创建目录结构。'
    case 'check-ai-os-runtime':
      return '依赖 AI OS beta 编排前，先复核运行态就绪状态。'
    case 'run-preflight':
      return '完成已接受的升级后，运行项目级预检。'
    default:
      return fallback
  }
}

function formatUpgradeCommand(command: string, lang: 'zh' | 'en'): string {
  if (command === 'scale ai-os adopt --dir . --task "Adopt AI OS runtime" --json') {
    return lang === 'zh'
      ? 'scale ai-os adopt --dir . --task "接入 AI OS runtime" --lang zh'
      : 'scale ai-os adopt --dir . --task "Adopt AI OS runtime" --lang en'
  }
  if (command === 'scale ai-os doctor --dir . --json') {
    return lang === 'zh' ? 'scale ai-os doctor --dir . --lang zh' : 'scale ai-os doctor --dir . --lang en'
  }
  if (command === 'scale setup --dir . --pack full --apply --yes --json') {
    return lang === 'zh'
      ? 'scale setup --dir . --pack full --apply --yes --lang zh'
      : 'scale setup --dir . --pack full --apply --yes --lang en'
  }
  if (command === 'scale ai-os migrate --dir . --json') {
    return 'scale ai-os migrate --dir .'
  }
  return command
}

function formatUpgradeApplyReason(reason: string, lang: 'zh' | 'en'): string {
  if (lang !== 'zh') return reason
  switch (reason) {
    case 'Review scale upgrade plan first, then rerun with --confirm.':
      return '请先审阅 SCALE 升级计划，再使用 --confirm 重新运行。'
    case 'Upgrade requires manual review because generated files have local changes or the lock is missing.':
      return '生成文件存在本地改动或缺少锁文件，本次升级需要人工审阅。'
    case 'Cannot apply without a governance lock and pack id.':
      return '缺少治理锁文件或治理包 ID，无法应用升级。'
    case 'No safe upgrade changes were needed.':
      return '没有需要应用的安全升级变更。'
    case 'Safe upgrade changes were applied.':
      return '已应用安全升级变更。'
    case 'No SCALE-managed upgrade backup was found.':
      return '未找到 SCALE 管理的升级备份。'
    case 'Latest SCALE-managed upgrade backup was rolled back.':
      return '已回滚最近一次 SCALE 管理的升级备份。'
    default:
      return reason
  }
}

async function askUpgradeWizardQuestion(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise(resolve => rl.question(question, resolve))
  } finally {
    rl.close()
  }
}

function isUpgradeSubcommandInvocation(argv: string[]): boolean {
  const upgradeIndex = argv.findIndex((value, index) => index > 1 && value === 'upgrade')
  if (upgradeIndex < 0) return false
  const positional = argv.slice(upgradeIndex + 1).find(value => !value.startsWith('-') && !value.includes('='))
  return positional === 'check' || positional === 'plan' || positional === 'apply' || positional === 'rollback'
}

function renderUpgradeWizardReport(report: {
  ok: boolean
  cancelled: boolean
  htmlPath?: string
  plan: ReturnType<typeof createUpgradePlanReport>
  applyResult?: ReturnType<typeof applyUpgradePlan>
}, lang: 'zh' | 'en'): void {
  const plan = report.plan
  if (lang === 'zh') {
    console.log('\nSCALE 升级向导')
    console.log(`  项目: ${plan.projectDir}`)
    console.log(`  状态: ${plan.status}`)
    console.log(`  应用模式: ${plan.applyMode}`)
    console.log(`  阻塞项: ${plan.blockers.length}`)
    console.log(`  步骤数: ${plan.steps.length}`)
    if (report.htmlPath) console.log(`  HTML 计划: ${report.htmlPath}`)
    if (report.cancelled) console.log('  结果: 已取消')
    else if (report.applyResult) {
      console.log(`  结果: ${report.applyResult.applied ? '已应用' : '未应用'}`)
      console.log(`  原因: ${formatUpgradeApplyReason(report.applyResult.reason, lang)}`)
      for (const path of report.applyResult.changedFiles) console.log(`  已变更: ${path}`)
    } else {
      console.log('  结果: 已生成计划，未应用变更')
    }
    console.log('  下一步:')
    for (const command of plan.check.recommendedCommands.slice(0, 5)) console.log(`    ${formatUpgradeCommand(command, lang)}`)
    if (plan.blockers.length > 0) console.log('    先解决阻塞项后再执行 scale upgrade apply --confirm')
    return
  }

  console.log('\nSCALE Upgrade Wizard')
  console.log(`  Project: ${plan.projectDir}`)
  console.log(`  Status: ${plan.status}`)
  console.log(`  Apply mode: ${plan.applyMode}`)
  console.log(`  Blockers: ${plan.blockers.length}`)
  console.log(`  Steps: ${plan.steps.length}`)
  if (report.htmlPath) console.log(`  HTML plan: ${report.htmlPath}`)
  if (report.cancelled) console.log('  Result: cancelled')
  else if (report.applyResult) {
    console.log(`  Result: ${report.applyResult.applied ? 'applied' : 'not applied'}`)
    console.log(`  Reason: ${report.applyResult.reason}`)
    for (const path of report.applyResult.changedFiles) console.log(`  changed: ${path}`)
  } else {
    console.log('  Result: plan generated; no changes applied')
  }
  console.log('  Next:')
  for (const command of plan.check.recommendedCommands.slice(0, 5)) console.log(`    ${formatUpgradeCommand(command, lang)}`)
  if (plan.blockers.length > 0) console.log('    Resolve blockers before running scale upgrade apply --confirm')
}

// ============================================================================
// upgrade command - Safe workflow/template/capability update planning
// ============================================================================

const upgradeCheck = defineCommand({
  meta: { name: 'check', description: '检查 SCALE 工作流、治理包和第三方能力更新状态 / Check SCALE workflow, governance pack, and third-party capability update status' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    'target-version': { type: 'string', description: '目标 SCALE Engine 版本，默认使用当前 CLI 版本 / Target SCALE Engine version' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = createUpgradeCheckReport({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      targetScaleVersion: args['target-version'] ? String(args['target-version']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    if (lang === 'zh') {
      console.log('SCALE 升级检查')
      console.log(`  项目: ${report.projectDir}`)
      console.log(`  状态: ${report.status}`)
      console.log(`  SCALE Engine: ${report.scaleEngine.currentVersion ?? '无'} -> ${report.scaleEngine.latestVersion}`)
      console.log(`  治理包: ${report.governancePack.id ?? '无'} v${report.governancePack.currentVersion ?? '无'} -> v${report.governancePack.latestVersion ?? '无'}`)
      console.log(`  受管生成文件: ${report.generatedFiles.clean} 个干净, ${report.generatedFiles.changed} 个本地改动, ${report.generatedFiles.missing} 个缺失`)
      console.log(`  第三方能力策略: ${report.thirdParty.policy}; 需要人工审查: ${report.thirdParty.reviewRequired}`)
      console.log(`  AI OS Runtime: ${report.aiOsRuntime.status}`)
      console.log('  下一步:')
    } else {
      console.log('SCALE Upgrade Check')
      console.log(`  Project: ${report.projectDir}`)
      console.log(`  Status: ${report.status}`)
      console.log(`  SCALE Engine: ${report.scaleEngine.currentVersion ?? 'none'} -> ${report.scaleEngine.latestVersion}`)
      console.log(`  Governance pack: ${report.governancePack.id ?? 'none'} v${report.governancePack.currentVersion ?? 'none'} -> v${report.governancePack.latestVersion ?? 'none'}`)
      console.log(`  Generated files: ${report.generatedFiles.clean} clean, ${report.generatedFiles.changed} changed, ${report.generatedFiles.missing} missing`)
      console.log(`  Third-party policy: ${report.thirdParty.policy}; review required: ${report.thirdParty.reviewRequired}`)
      console.log(`  AI OS Runtime: ${report.aiOsRuntime.status}`)
      console.log('  Next:')
    }
    for (const command of report.recommendedCommands) console.log(`    ${formatUpgradeCommand(command, lang)}`)
  },
})

const upgradePlan = defineCommand({
  meta: { name: 'plan', description: '生成非破坏性的 SCALE 升级计划 / Create a non-destructive SCALE upgrade plan' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    'target-version': { type: 'string', description: '目标 SCALE Engine 版本，默认使用当前 CLI 版本 / Target SCALE Engine version' },
    html: { type: 'boolean', default: false, description: '写入 .scale/reports/upgrade-plan.html / Write HTML plan' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = createUpgradePlanReport({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      targetScaleVersion: args['target-version'] ? String(args['target-version']) : undefined,
    })
    const htmlPath = args.html ? writeUpgradePlanHtml(report, undefined, lang) : undefined
    if (args.json) {
      console.log(JSON.stringify({ ...report, htmlPath }, null, 2))
      return
    }
    if (lang === 'zh') {
      console.log('SCALE 升级计划')
      console.log(`  项目: ${report.projectDir}`)
      console.log(`  状态: ${report.status}`)
      console.log(`  应用模式: ${report.applyMode}`)
    } else {
      console.log('SCALE Upgrade Plan')
      console.log(`  Project: ${report.projectDir}`)
      console.log(`  Status: ${report.status}`)
      console.log(`  Apply mode: ${report.applyMode}`)
    }
    if (report.blockers.length > 0) {
      console.log(lang === 'zh' ? '  阻塞项:' : '  Blockers:')
      for (const blocker of report.blockers) console.log(`    [${blocker.code}] ${blocker.path ?? ''} ${formatUpgradeBlockerMessage(blocker.code, blocker.message, lang)}`)
    }
    console.log(lang === 'zh' ? '  步骤:' : '  Steps:')
    for (const step of report.steps) {
      const path = step.path ? ` ${step.path}` : ''
      const command = step.command ? ` -> ${formatUpgradeCommand(step.command, lang)}` : ''
      console.log(`    [${step.risk}] ${step.action}${path}: ${formatUpgradeStepReason(step.action, step.reason, lang)}${command}`)
    }
    if (htmlPath) console.log(`  HTML: ${htmlPath}`)
  },
})

const upgradeRecommend = defineCommand({
  meta: { name: 'recommend', description: '自动分析升级风险并推荐操作 / Auto-analyze upgrade risk and recommend actions' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    'target-version': { type: 'string', description: '目标 SCALE Engine 版本 / Target SCALE Engine version' },
    'auto-apply': { type: 'boolean', default: false, description: '如果安全则自动应用 / Auto-apply if safe' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = createUpgradeRecommendReport({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      targetScaleVersion: args['target-version'] ? String(args['target-version']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    const riskEmoji = report.riskLevel === 'high' ? '🔴' : report.riskLevel === 'medium' ? '🟡' : '🟢'
    const recEmoji = report.recommendation === 'safe-to-apply' ? '✅' : report.recommendation === 'blocked' ? '🚫' : '⚠️'
    if (lang === 'zh') {
      console.log('SCALE 升级推荐')
      console.log(`  项目: ${report.projectDir}`)
      console.log(`  ${riskEmoji} 风险分数: ${report.riskScore} (${report.riskLevel})`)
      console.log(`  ${recEmoji} 推荐: ${report.recommendation}`)
      console.log(`  摘要: ${report.summary}`)
      console.log(`  应用模式: ${report.applyMode}`)
    } else {
      console.log('SCALE Upgrade Recommend')
      console.log(`  Project: ${report.projectDir}`)
      console.log(`  ${riskEmoji} Risk score: ${report.riskScore} (${report.riskLevel})`)
      console.log(`  ${recEmoji} Recommendation: ${report.recommendation}`)
      console.log(`  Summary: ${report.summary}`)
      console.log(`  Apply mode: ${report.applyMode}`)
    }
    if (report.blockers.length > 0) {
      console.log(lang === 'zh' ? '  阻塞项:' : '  Blockers:')
      for (const blocker of report.blockers) console.log(`    [${blocker.code}] ${blocker.message}`)
    }
    if (report.steps.length > 0) {
      console.log(lang === 'zh' ? '  步骤:' : '  Steps:')
      for (const step of report.steps) console.log(`    [${step.risk}] ${step.action}: ${step.reason}`)
    }
    console.log(lang === 'zh' ? '  建议命令:' : '  Suggested commands:')
    for (const cmd of report.autoCommands) console.log(`    ${cmd}`)

    // Auto-apply if requested and safe
    if (args['auto-apply'] && report.recommendation === 'safe-to-apply') {
      console.log(lang === 'zh' ? '\n  自动应用中...' : '\n  Auto-applying...')
      const result = applyUpgradePlan({
        projectDir,
        scaleDir: resolveScaleDirForProject(projectDir),
        confirm: true,
        autoBackup: true,
      })
      console.log(lang === 'zh' ? `  结果: ${result.reason}` : `  Result: ${result.reason}`)
      if (result.gitBackup?.ok) console.log(lang === 'zh' ? `  Git 备份: ${result.gitBackup.branch}` : `  Git backup: ${result.gitBackup.branch}`)
    }
  },
})

const upgradeApply = defineCommand({
  meta: { name: 'apply', description: '按已审阅计划安全应用升级 / Guarded entrypoint for applying an upgrade plan' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    confirm: { type: 'boolean', default: false, description: '确认当前升级计划已经审阅 / Confirm the current plan was reviewed' },
    'auto-backup': { type: 'boolean', default: false, description: '应用前自动创建 git 分支备份 / Create git branch backup before applying' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const result = applyUpgradePlan({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      confirm: isTruthyFlag(args.confirm),
      autoBackup: isTruthyFlag(args['auto-backup']),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      if (!result.ok) process.exitCode = 1
      return
    }
    console.log(lang === 'zh' ? 'SCALE 应用升级' : 'SCALE Upgrade Apply')
    console.log(lang === 'zh' ? `  已应用: ${result.applied}` : `  Applied: ${result.applied}`)
    console.log(lang === 'zh' ? `  原因: ${formatUpgradeApplyReason(result.reason, lang)}` : `  Reason: ${result.reason}`)
    console.log(lang === 'zh' ? `  应用模式: ${result.plan.applyMode}` : `  Apply mode: ${result.plan.applyMode}`)
    if (result.gitBackup) {
      if (result.gitBackup.ok) {
        console.log(lang === 'zh' ? `  Git 备份分支: ${result.gitBackup.branch}` : `  Git backup branch: ${result.gitBackup.branch}`)
      } else {
        console.log(lang === 'zh' ? `  Git 备份失败: ${result.gitBackup.error}` : `  Git backup failed: ${result.gitBackup.error}`)
      }
    }
    if (result.backup) console.log(lang === 'zh' ? `  文件备份: ${result.backup.manifestPath}` : `  File backup: ${result.backup.manifestPath}`)
    for (const path of result.changedFiles) console.log(lang === 'zh' ? `  已变更: ${path}` : `  changed: ${path}`)
    if (!result.ok) process.exitCode = 1
  },
})

const upgradeRollback = defineCommand({
  meta: { name: 'rollback', description: '回滚最近一次 SCALE 托管升级 / Roll back the latest SCALE-managed upgrade' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const result = rollbackLatestUpgrade({ projectDir: args.dir })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      if (!result.ok) process.exitCode = 1
      return
    }
    console.log(lang === 'zh' ? 'SCALE 升级回滚' : 'SCALE Upgrade Rollback')
    console.log(lang === 'zh' ? `  已回滚: ${result.applied}` : `  Applied: ${result.applied}`)
    console.log(lang === 'zh' ? `  原因: ${formatUpgradeApplyReason(result.reason, lang)}` : `  Reason: ${result.reason}`)
    if (result.backup) console.log(lang === 'zh' ? `  备份: ${result.backup.manifestPath}` : `  Backup: ${result.backup.manifestPath}`)
    for (const path of result.restoredFiles) console.log(lang === 'zh' ? `  已恢复: ${path}` : `  restored: ${path}`)
    if (!result.ok) process.exitCode = 1
  },
})

export const upgradeCommand = defineCommand({
  meta: { name: 'upgrade', description: 'SCALE 工作流、模板、skills、MCP、CLI 工具的安全升级向导 / Safe update wizard for workflow assets' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    'target-version': { type: 'string', description: '目标 SCALE Engine 版本，默认使用当前 CLI 版本 / Target SCALE Engine version' },
    apply: { type: 'boolean', default: false, description: '直接应用安全升级计划 / Apply safe upgrade plan' },
    yes: { type: 'boolean', default: false, description: '非交互确认 / Confirm without prompting' },
    html: { type: 'boolean', default: true, description: '写入 HTML 升级计划 / Write HTML plan' },
    interactive: { type: 'boolean', default: true, description: '启用升级向导交互 / Enable upgrade wizard prompts' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  subCommands: { check: upgradeCheck, plan: upgradePlan, recommend: upgradeRecommend, apply: upgradeApply, rollback: upgradeRollback },
  async run({ args }) {
    if (isUpgradeSubcommandInvocation(process.argv)) return
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const targetScaleVersion = args['target-version'] ? String(args['target-version']) : undefined
    const plan = createUpgradePlanReport({ projectDir, scaleDir, targetScaleVersion })
    const htmlPath = args.html ? writeUpgradePlanHtml(plan, undefined, lang) : undefined
    const canApply = plan.applyMode === 'safe' && plan.blockers.length === 0
    const interactive = isTruthyFlag(args.interactive) && !args.json && Boolean(process.stdin.isTTY) && !isTruthyFlag(args.yes)
    let apply = isTruthyFlag(args.apply) || isTruthyFlag(args.yes)
    let cancelled = false

    if (interactive && canApply && !apply) {
      const answer = await askUpgradeWizardQuestion(lang === 'zh'
        ? '发现可安全应用的升级计划。现在应用吗？1=仅生成计划 2=应用 3=取消，默认 1: '
        : 'Safe upgrade plan found. Apply now? 1=plan only 2=apply 3=cancel, default 1: ')
      const normalized = answer.trim().toLowerCase()
      apply = normalized === '2' || normalized === 'apply' || normalized === 'yes' || normalized === 'y'
      cancelled = normalized === '3' || normalized === 'cancel' || normalized === 'c'
    }

    const applyResult = apply && !cancelled
      ? applyUpgradePlan({ projectDir, scaleDir, confirm: true })
      : undefined
    const ok = !cancelled && (!applyResult || applyResult.ok)
    const report = { ok, cancelled, htmlPath, plan, applyResult }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!ok) process.exitCode = 1
      return
    }

    renderUpgradeWizardReport(report, lang)
    if (!ok) process.exitCode = 1
  },
})

// ============================================================================
// assets command - Resource lifecycle governance
// ============================================================================

const assetsScan = defineCommand({
  meta: { name: 'scan', description: 'Classify project docs, reports, media, scripts, and temporary outputs' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = scanResourceAssets({ projectDir: args.dir })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Asset Scan')
    console.log(`  Project: ${report.projectDir}`)
    console.log(`  Total resources: ${report.summary.total}`)
    console.log(`  Tracked forbidden: ${report.summary.trackedForbidden}`)
    console.log(`  Large tracked: ${report.summary.largeTracked}`)
    console.log(`  Expired: ${report.summary.expired}`)
    console.log('\nBy type:')
    for (const [type, count] of Object.entries(report.summary.byType)) {
      if (count > 0) console.log(`  ${type}: ${count}`)
    }
  },
})

const assetsDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Find resource lifecycle and Git policy problems' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = doctorResourceAssets({ projectDir: args.dir })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`SCALE Asset Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    if (report.findings.length === 0) {
      console.log('  No resource lifecycle findings.')
      return
    }
    for (const finding of report.findings) {
      const path = finding.path ? ` ${finding.path}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
      if (finding.fix) console.log(`    fix: ${finding.fix}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const assetsSettle = defineCommand({
  meta: { name: 'settle', description: 'Record resource lifecycle settlement evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id for the settlement record' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where resource-impact.md should be updated' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = settleResourceAssets({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactsDir: args['artifact-dir'],
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`SCALE Asset Settlement: ${report.ok ? 'OK' : 'FAILED'}`)
      if (report.resourceImpactPath) console.log(`  Resource impact: ${report.resourceImpactPath}`)
      if (report.doctor.findings.length > 0) {
        for (const finding of report.doctor.findings) {
          const path = finding.path ? ` ${finding.path}` : ''
          console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
        }
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

export const assetsCommand = defineCommand({
  meta: { name: 'assets', description: 'Resource lifecycle governance for generated and maintained project assets' },
  subCommands: { scan: assetsScan, doctor: assetsDoctor, settle: assetsSettle },
})

// ============================================================================
// standards command - Engineering standards governance
// ============================================================================

const standardsScan = defineCommand({
  meta: { name: 'scan', description: 'Scan source files for engineering standard violations' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = scanEngineeringStandards({ projectDir: args.dir, changedFiles: resolveChangedFilesArg(args) })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Standards Scan')
    console.log(`  Project: ${report.projectDir}`)
    console.log(`  Files scanned: ${report.summary.filesScanned}`)
    console.log(`  Findings: ${report.summary.totalFindings}`)
    console.log(`  Blocking findings: ${report.summary.blockingFindings}`)
    for (const finding of report.findings.slice(0, 20)) {
      const line = finding.line ? `:${finding.line}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.ruleId} ${finding.path}${line}: ${finding.message}`)
    }
    if (report.findings.length > 20) console.log(`  ... ${report.findings.length - 20} more finding(s)`)
  },
})

const standardsDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Find blocking engineering standards problems' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = doctorEngineeringStandards({ projectDir: args.dir, changedFiles: resolveChangedFilesArg(args) })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Standards Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    if (report.findings.length === 0) {
      console.log('  No engineering standards findings.')
      return
    }
    for (const finding of report.findings) {
      const line = finding.line ? `:${finding.line}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.ruleId} ${finding.path}${line}: ${finding.message}`)
      if (finding.fix) console.log(`    fix: ${finding.fix}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const standardsSettle = defineCommand({
  meta: { name: 'settle', description: 'Record engineering standards settlement evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id for the settlement record' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where standards-impact.md should be updated' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = settleEngineeringStandards({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactsDir: args['artifact-dir'],
      changedFiles: resolveChangedFilesArg(args),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`SCALE Standards Settlement: ${report.ok ? 'OK' : 'FAILED'}`)
      if (report.standardsImpactPath) console.log(`  Standards impact: ${report.standardsImpactPath}`)
      for (const finding of report.doctor.findings) {
        const line = finding.line ? `:${finding.line}` : ''
        console.log(`  [${finding.severity.toUpperCase()}] ${finding.ruleId} ${finding.path}${line}: ${finding.message}`)
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

const standardsBaseline = defineCommand({
  meta: { name: 'baseline', description: 'Generate a legacy standards baseline and classification report' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    write: { type: 'boolean', default: false, description: 'Write .scale/engineering-standards-baseline.json' },
    'task-id': { type: 'string', description: 'Task id for the legacy debt report' },
    'artifact-dir': { type: 'string', description: 'Directory where standards-legacy-debt.md should be written' },
    reason: { type: 'string', default: 'legacy standards debt accepted for staged remediation', description: 'Reason recorded on generated baseline entries' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = baselineEngineeringStandards({
      projectDir: args.dir,
      writeBaseline: args.write,
      taskId: args['task-id'],
      artifactsDir: args['artifact-dir'],
      reason: args.reason,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`Standards baseline: ${report.wroteBaseline ? 'written' : 'dry-run'}`)
    console.log(`  Baseline entries: ${report.baselineEntries.length}`)
    console.log(`  Blocking findings: ${report.debt.blockingFindings}`)
    console.log(`  Baseline path: ${report.baselinePath}`)
    if (report.legacyDebtPath) console.log(`  Legacy debt report: ${report.legacyDebtPath}`)
    if (!report.wroteBaseline) console.log('  Re-run with --write to update .scale/engineering-standards-baseline.json.')
  },
})

export const standardsCommand = defineCommand({
  meta: { name: 'standards', description: 'Engineering standards governance for logs, security, architecture, database, and code quality' },
  subCommands: { scan: standardsScan, doctor: standardsDoctor, settle: standardsSettle, baseline: standardsBaseline },
})

// ============================================================================
// artifact command - Derived HTML artifacts for human review
// ============================================================================

const artifactRender = defineCommand({
  meta: { name: 'render', description: 'Render a task Markdown source set into a governed HTML artifact' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    type: { type: 'string', default: 'release-report', description: 'HTML artifact type' },
    source: { type: 'string', description: 'Comma or newline separated source Markdown files relative to the task directory' },
    theme: { type: 'string', default: 'auto', description: 'Theme mode: dark/light/auto' },
    lang: { type: 'string', default: 'zh', description: 'HTML language: zh/en' },
    title: { type: 'string', description: 'HTML document title override' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const result = renderHtmlArtifact({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
      type: String(args.type ?? 'release-report'),
      sourcePaths: splitChangedFiles(typeof args.source === 'string' ? args.source : undefined),
      theme: normalizeThemeArg(args.theme),
      lang: normalizeLangArg(args.lang),
      title: typeof args.title === 'string' ? args.title : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log('SCALE HTML Artifact Render')
    console.log(`  Type: ${result.type}`)
    console.log(`  HTML: ${result.outputPath}`)
    console.log(`  Index: ${result.indexPath}`)
    console.log(`  Manifest: ${result.manifestPath}`)
    if (result.missingSources.length > 0) {
      console.log(`  Missing sources: ${result.missingSources.join(', ')}`)
    }
  },
})

const artifactDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check HTML artifacts for traceability, stale sources, remote assets, and secret-like content' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    type: { type: 'string', description: 'Optional HTML artifact type to check' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = doctorHtmlArtifacts({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
      type: typeof args.type === 'string' ? args.type : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE HTML Artifact Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    console.log(`  Manifest: ${report.manifestPath}`)
    console.log(`  Artifacts: ${report.artifacts.length}`)
    if (report.findings.length === 0) {
      console.log('  No HTML artifact findings.')
    } else {
      for (const finding of report.findings) {
        const path = finding.path ? ` ${finding.path}` : ''
        console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
        if (finding.fix) console.log(`    fix: ${finding.fix}`)
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

const artifactSettle = defineCommand({
  meta: { name: 'settle', description: 'Record HTML artifact settlement evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = settleHtmlArtifacts({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE HTML Artifact Settlement: ${report.ok ? 'OK' : 'FAILED'}`)
    console.log(`  HTML impact: ${report.htmlImpactPath}`)
    for (const finding of report.doctor.findings) {
      const path = finding.path ? ` ${finding.path}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const artifactOpen = defineCommand({
  meta: { name: 'open', description: 'Open or print the local file URL for a rendered HTML artifact' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    type: { type: 'string', description: 'Optional HTML artifact type to open' },
    'print-only': { type: 'boolean', default: false, description: 'Only print the file URL without launching a browser' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const path = resolveHtmlArtifactForOpen({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
      type: typeof args.type === 'string' ? args.type : undefined,
    })
    const url = pathToFileURL(path).toString()
    const exists = existsSync(path)
    if (!args['print-only'] && exists) launchLocalFile(path)
    const output = { ok: exists, path, url, launched: Boolean(!args['print-only'] && exists) }
    if (args.json) {
      console.log(JSON.stringify(output, null, 2))
      if (!exists) process.exitCode = 1
      return
    }
    if (!exists) {
      console.log(`HTML artifact not found: ${path}`)
      process.exitCode = 1
      return
    }
    console.log(url)
  },
})

const artifactDashboard = defineCommand({
  meta: { name: 'dashboard', description: 'Render a governance HTML dashboard from runtime, eval, memory, resource, and artifact evidence' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Optional task id to scope runtime/eval evidence and task HTML artifacts' },
    output: { type: 'string', alias: 'o', description: 'Output HTML path; defaults to .scale/reports/governance-dashboard.html' },
    theme: { type: 'string', default: 'auto', description: 'Theme mode: dark/light/auto' },
    lang: { type: 'string', default: 'zh', description: 'HTML language: zh/en' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = renderGovernanceDashboard({
      projectDir,
      scaleDir,
      taskId: typeof args['task-id'] === 'string' ? args['task-id'] : undefined,
      output: typeof args.output === 'string' ? args.output : undefined,
      theme: normalizeThemeArg(args.theme),
      lang: normalizeLangArg(args.lang),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Governance Dashboard: ${report.ok ? 'OK' : 'ATTENTION'}`)
    console.log(`  HTML: ${report.outputPath}`)
    console.log(`  Manifest: ${report.manifestPath}`)
    for (const finding of report.findings) {
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

export const artifactCommand = defineCommand({
  meta: { name: 'artifact', description: 'Derived HTML artifact rendering and safety checks' },
  subCommands: { render: artifactRender, doctor: artifactDoctor, settle: artifactSettle, open: artifactOpen, dashboard: artifactDashboard },
})
