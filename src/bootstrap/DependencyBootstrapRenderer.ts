import type { DependencyBootstrapReport, DependencyBootstrapRuntimeCheck } from './DependencyBootstrap.js'
import type { ScaleLanguage } from '../i18n/Language.js'

export function renderDependencyBootstrapReport(report: DependencyBootstrapReport, lang: ScaleLanguage): string {
  return lang === 'en' ? renderEnglish(report) : renderChinese(report)
}

function renderChinese(report: DependencyBootstrapReport): string {
  const lines: string[] = [
    '',
    'SCALE 依赖安装计划',
    `  项目: ${report.projectDir}`,
    `  依赖包: ${report.packIds.join(', ')}`,
    `  执行安装: ${report.apply ? '是' : '否'}`,
    `  已完整就绪: ${report.complete ? '是' : '否'}`,
  ]
  appendRuntimeChecks(lines, report.runtimeChecks, 'zh')
  for (const item of report.items) {
    lines.push(`  [${formatStatus(item.status, 'zh')}] ${item.id} (${item.kind})`)
    lines.push(`    来源: ${item.source}`)
    lines.push(`    检测: ${item.detectedBy}`)
    if (item.health) lines.push(`    健康: ${item.health.reason}`)
    if (!item.installed && item.installCommand) lines.push(`    安装: ${item.installCommand}`)
    if (!item.installed && item.manualReason) lines.push(`    原因: ${item.manualReason}`)
    if (!item.installed && item.prerequisites.length > 0) {
      lines.push(`    前置依赖: ${item.prerequisites.map(req => `${req.command}=${req.present ? 'ok' : 'missing'}`).join(', ')}`)
    }
    for (const command of item.health?.nextCommands ?? []) lines.push(`    下一步: ${command}`)
    if (item.error) lines.push(`    错误: ${item.error}`)
  }
  for (const action of report.postActions) lines.push(`  [后置] ${action}`)
  appendPostChecks(lines, report, 'zh')
  for (const command of report.postCheckCommands) lines.push(`  [检查] ${command}`)
  for (const hint of report.rollbackHints) lines.push(`  [回滚] ${hint}`)
  for (const recommendation of report.recommendations) lines.push(`  [建议] ${recommendation}`)
  return lines.join('\n')
}

function renderEnglish(report: DependencyBootstrapReport): string {
  const lines: string[] = [
    '',
    'SCALE Dependency Bootstrap',
    `  Project: ${report.projectDir}`,
    `  Packs: ${report.packIds.join(', ')}`,
    `  Apply: ${report.apply}`,
    `  Complete: ${report.complete}`,
  ]
  appendRuntimeChecks(lines, report.runtimeChecks, 'en')
  for (const item of report.items) {
    lines.push(`  [${item.status.toUpperCase()}] ${item.id} (${item.kind})`)
    lines.push(`    source: ${item.source}`)
    lines.push(`    detected: ${item.detectedBy}`)
    if (item.health) lines.push(`    health: ${item.health.reason}`)
    if (!item.installed && item.installCommand) lines.push(`    install: ${item.installCommand}`)
    if (!item.installed && item.manualReason) lines.push(`    reason: ${item.manualReason}`)
    if (!item.installed && item.prerequisites.length > 0) {
      lines.push(`    prereqs: ${item.prerequisites.map(req => `${req.command}=${req.present ? 'ok' : 'missing'}`).join(', ')}`)
    }
    for (const command of item.health?.nextCommands ?? []) lines.push(`    next: ${command}`)
    if (item.error) lines.push(`    error: ${item.error}`)
  }
  for (const action of report.postActions) lines.push(`  [POST] ${action}`)
  appendPostChecks(lines, report, 'en')
  for (const command of report.postCheckCommands) lines.push(`  [CHECK] ${command}`)
  for (const hint of report.rollbackHints) lines.push(`  [ROLLBACK] ${hint}`)
  for (const recommendation of report.recommendations) lines.push(`  [NEXT] ${recommendation}`)
  return lines.join('\n')
}

function appendRuntimeChecks(lines: string[], checks: DependencyBootstrapRuntimeCheck[], lang: ScaleLanguage): void {
  if (checks.length === 0) return
  lines.push(lang === 'zh' ? '  运行时依赖:' : '  Runtime dependencies:')
  for (const check of checks) {
    const status = formatRuntimeStatus(check.status, lang)
    const target = check.requiredFor.join(', ')
    const detected = check.detectedCommand
      ? lang === 'zh'
        ? `; 检测到: ${check.detectedCommand}${check.version ? ` (${check.version})` : ''}`
        : `; detected: ${check.detectedCommand}${check.version ? ` (${check.version})` : ''}`
      : ''
    lines.push(`    [${status}] ${check.label} -> ${target}${detected}`)
    lines.push(lang === 'zh' ? `      说明: ${check.reason}` : `      reason: ${check.reason}`)
    if (check.status !== 'ok' && check.installHint) {
      lines.push(lang === 'zh' ? `      修复: ${check.installHint}` : `      fix: ${check.installHint}`)
    }
  }
}

function appendPostChecks(lines: string[], report: DependencyBootstrapReport, lang: ScaleLanguage): void {
  if (report.postChecks.length === 0) return
  lines.push(lang === 'zh'
    ? `  后置检查: 通过=${report.postCheckSummary.passed}, 警告=${report.postCheckSummary.warned}, 失败=${report.postCheckSummary.failed}`
    : `  Post-checks: passed=${report.postCheckSummary.passed}, warned=${report.postCheckSummary.warned}, failed=${report.postCheckSummary.failed}`)
  for (const check of report.postChecks) {
    lines.push(lang === 'zh'
      ? `  [后置检查 ${check.status.toUpperCase()}] ${check.label}: ${check.summary}`
      : `  [POSTCHECK ${check.status.toUpperCase()}] ${check.label}: ${check.summary}`)
    lines.push(lang === 'zh' ? `    命令: ${check.command}` : `    command: ${check.command}`)
  }
}

function formatStatus(status: string, lang: ScaleLanguage): string {
  if (lang === 'en') return status.toUpperCase()
  const labels: Record<string, string> = {
    installed: '已安装',
    ready: '可安装',
    'manual-review': '需补齐环境',
    'installed-now': '刚安装',
    failed: '失败',
    'needs-init': '需初始化',
    'version-drift': '版本漂移',
  }
  return labels[status] ?? status
}

function formatRuntimeStatus(status: DependencyBootstrapRuntimeCheck['status'], lang: ScaleLanguage): string {
  if (lang === 'en') return status.toUpperCase()
  const labels: Record<DependencyBootstrapRuntimeCheck['status'], string> = {
    ok: '正常',
    warn: '警告',
    missing: '缺失',
  }
  return labels[status]
}
