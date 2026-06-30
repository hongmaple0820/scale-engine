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
    `  能力包: ${report.packIds.join(', ') || 'core'}`,
    `  执行安装: ${report.apply ? '是' : '否'}`,
    `  完整可用: ${report.complete ? '是' : '否'}`,
    `  汇总: installed=${report.summary.installed}, ready=${report.summary.ready}, manual=${report.summary.manualReview}, needs-init=${report.summary.needsInit}, failed=${report.summary.failed}`,
  ]
  appendRuntimeChecks(lines, report.runtimeChecks, 'zh')
  appendItems(lines, report, 'zh')
  appendPostChecks(lines, report, 'zh')
  appendTail(lines, report, 'zh')
  return lines.join('\n')
}

function renderEnglish(report: DependencyBootstrapReport): string {
  const lines: string[] = [
    '',
    'SCALE Dependency Bootstrap',
    `  Project: ${report.projectDir}`,
    `  Packs: ${report.packIds.join(', ') || 'core'}`,
    `  Apply: ${report.apply}`,
    `  Complete: ${report.complete}`,
    `  Summary: installed=${report.summary.installed}, ready=${report.summary.ready}, manual=${report.summary.manualReview}, needs-init=${report.summary.needsInit}, failed=${report.summary.failed}`,
  ]
  appendRuntimeChecks(lines, report.runtimeChecks, 'en')
  appendItems(lines, report, 'en')
  appendPostChecks(lines, report, 'en')
  appendTail(lines, report, 'en')
  return lines.join('\n')
}

function appendItems(lines: string[], report: DependencyBootstrapReport, lang: ScaleLanguage): void {
  if (report.items.length === 0) {
    lines.push(lang === 'zh' ? '  无第三方依赖需要处理。' : '  No third-party dependencies selected.')
    return
  }
  lines.push(lang === 'zh' ? '  依赖项目:' : '  Items:')
  for (const item of report.items) {
    lines.push(`  [${formatStatus(item.status, lang)}] ${item.id} (${item.kind})`)
    lines.push(lang === 'zh' ? `    来源: ${item.source}` : `    source: ${item.source}`)
    lines.push(lang === 'zh' ? `    检测: ${item.detectedBy}` : `    detected: ${item.detectedBy}`)
    if (item.health) lines.push(lang === 'zh' ? `    健康: ${item.health.reason}` : `    health: ${item.health.reason}`)
    if (!item.installed && item.installCommand) lines.push(lang === 'zh' ? `    安装命令: ${item.installCommand}` : `    install: ${item.installCommand}`)
    if (!item.installed && item.manualReason) lines.push(lang === 'zh' ? `    原因: ${item.manualReason}` : `    reason: ${item.manualReason}`)
    if (!item.installed && item.prerequisites.length > 0) {
      const prereqs = item.prerequisites.map(req => `${req.command}=${req.present ? 'ok' : 'missing'}`).join(', ')
      lines.push(lang === 'zh' ? `    前置依赖: ${prereqs}` : `    prereqs: ${prereqs}`)
    }
    for (const command of item.health?.nextCommands ?? []) lines.push(lang === 'zh' ? `    下一步: ${command}` : `    next: ${command}`)
    if (item.error) lines.push(lang === 'zh' ? `    错误: ${item.error}` : `    error: ${item.error}`)
  }
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

function appendTail(lines: string[], report: DependencyBootstrapReport, lang: ScaleLanguage): void {
  const labels = lang === 'zh'
    ? { post: '后置', check: '检查', rollback: '回滚', next: '建议' }
    : { post: 'POST', check: 'CHECK', rollback: 'ROLLBACK', next: 'NEXT' }
  for (const action of report.postActions) lines.push(`  [${labels.post}] ${action}`)
  for (const command of report.postCheckCommands) lines.push(`  [${labels.check}] ${command}`)
  for (const hint of report.rollbackHints) lines.push(`  [${labels.rollback}] ${hint}`)
  for (const recommendation of report.recommendations) lines.push(`  [${labels.next}] ${recommendation}`)
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
