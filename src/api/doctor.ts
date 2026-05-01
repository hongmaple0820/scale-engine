// SCALE Engine — Doctor (W10)
// 环境诊断 + 健康检查
// Usage: scale doctor

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DiagnosticResult {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
  fix?: string
}

export interface DoctorReport {
  overall: 'healthy' | 'degraded' | 'broken'
  checks: DiagnosticResult[]
  timestamp: number
}

export class Doctor {
  constructor(
    private projectDir: string = '.',
    private scaleDir: string = '.scale',
  ) {}

  async diagnose(): Promise<DoctorReport> {
    const checks: DiagnosticResult[] = []

    checks.push(this.checkScaleDir())
    checks.push(this.checkEventsDir())
    checks.push(this.checkArtifactsDir())
    checks.push(this.checkSettingsJson())
    checks.push(this.checkKnowledgeDoc())
    checks.push(this.checkRulesDir())
    checks.push(this.checkHooksDir())
    checks.push(this.checkNodeVersion())
    checks.push(this.checkDiskUsage())
    checks.push(this.checkGitignore())

    const fails = checks.filter((c) => c.status === 'fail').length
    const warns = checks.filter((c) => c.status === 'warn').length
    const overall = fails > 0 ? 'broken' : warns > 0 ? 'degraded' : 'healthy'

    return { overall, checks, timestamp: Date.now() }
  }

  private checkScaleDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir)
    if (!existsSync(dir)) {
      return { name: '.scale directory', status: 'fail', message: 'Missing .scale/ directory', fix: 'Run: scale init' }
    }
    return { name: '.scale directory', status: 'ok', message: `Found at ${dir}` }
  }

  private checkEventsDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'events')
    if (!existsSync(dir)) {
      return { name: 'Events directory', status: 'fail', message: 'Missing events/ directory', fix: 'Run: scale init' }
    }
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      const totalSize = files.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0)
      const sizeMB = (totalSize / 1024 / 1024).toFixed(2)
      if (totalSize > 100 * 1024 * 1024) {
        return { name: 'Events directory', status: 'warn', message: `${files.length} files, ${sizeMB}MB — consider archiving`, fix: 'Archive old event files' }
      }
      return { name: 'Events directory', status: 'ok', message: `${files.length} files, ${sizeMB}MB` }
    } catch {
      return { name: 'Events directory', status: 'ok', message: 'Empty (fresh install)' }
    }
  }

  private checkArtifactsDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'artifacts')
    if (!existsSync(dir)) {
      return { name: 'Artifacts directory', status: 'fail', message: 'Missing artifacts/ directory', fix: 'Run: scale init' }
    }
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
      return { name: 'Artifacts directory', status: 'ok', message: `${files.length} artifacts` }
    } catch {
      return { name: 'Artifacts directory', status: 'ok', message: 'Empty' }
    }
  }

  private checkSettingsJson(): DiagnosticResult {
    const candidates: Array<{ agent: string; path: string }> = [
      { agent: 'claude-code', path: join(this.projectDir, '.claude', 'settings.json') },
      { agent: 'claude-code', path: join(this.projectDir, '.claude', 'settings.local.json') },
      { agent: 'codex', path: join(this.projectDir, '.codex', 'hooks.json') },
      { agent: 'cursor', path: join(this.projectDir, '.cursor', 'settings.json') },
      { agent: 'gemini', path: join(this.projectDir, '.gemini', 'settings.json') },
      { agent: 'openclaw', path: join(this.projectDir, '.openclaw', 'settings.json') },
      { agent: 'hermes', path: join(this.projectDir, '.hermes', 'settings.json') },
    ]
    const found = candidates.find((c) => existsSync(c.path))
    if (!found) {
      return {
        name: 'Agent settings',
        status: 'warn',
        message: 'No agent settings found (.claude/.codex/.cursor/.gemini/.openclaw/.hermes)',
        fix: 'Run: scale init --agent <claude-code|codex|cursor|gemini|openclaw|hermes>',
      }
    }
    try {
      const content = JSON.parse(readFileSync(found.path, 'utf-8'))
      const hasScaleHooks = JSON.stringify(content).includes('scale ')
      if (!hasScaleHooks) {
        return {
          name: 'Agent settings',
          status: 'warn',
          message: `${found.path} exists but no SCALE hooks`,
          fix: `Run: scale init --agent ${found.agent} to inject hooks`,
        }
      }
      const hookCount = Object.values(content.hooks ?? {}).flat().length
      return { name: 'Agent settings', status: 'ok', message: `${hookCount} hooks configured (${found.agent})` }
    } catch {
      return { name: 'Agent settings', status: 'fail', message: `${found.path} is invalid JSON`, fix: 'Fix JSON syntax' }
    }
  }

  private checkKnowledgeDoc(): DiagnosticResult {
    const paths = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', 'GEMINI.md', '.hermes.md']
    for (const name of paths) {
      const p = join(this.projectDir, name)
      if (existsSync(p)) {
        const lines = readFileSync(p, 'utf-8').split('\n').length
        if (lines > 200) {
          return { name: 'Knowledge doc', status: 'warn', message: `${name}: ${lines} lines (>200 — compliance may drop)`, fix: 'Split low-frequency rules to .claude/rules/' }
        }
        return { name: 'Knowledge doc', status: 'ok', message: `${name}: ${lines} lines` }
      }
    }
    return { name: 'Knowledge doc', status: 'warn', message: 'No knowledge doc found', fix: 'Run: scale init' }
  }

  private checkRulesDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'rules')
    if (!existsSync(dir)) {
      return { name: 'Rules directory', status: 'ok', message: 'Not created yet (no evolved rules)' }
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    return { name: 'Rules directory', status: 'ok', message: `${files.length} rules` }
  }

  private checkHooksDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'hooks')
    if (!existsSync(dir)) {
      return { name: 'Hooks directory', status: 'ok', message: 'Not created yet (no evolved hooks)' }
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.sh'))
    return { name: 'Hooks directory', status: 'ok', message: `${files.length} hooks` }
  }

  private checkNodeVersion(): DiagnosticResult {
    const version = process.version
    const major = parseInt(version.slice(1).split('.')[0])
    if (major < 20) {
      return { name: 'Node.js version', status: 'fail', message: `${version} — requires >=20`, fix: 'Upgrade Node.js to v20+' }
    }
    return { name: 'Node.js version', status: 'ok', message: version }
  }

  private checkDiskUsage(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir)
    if (!existsSync(dir)) return { name: 'Disk usage', status: 'ok', message: 'N/A' }
    try {
      let totalSize = 0
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f)
          const s = statSync(p)
          if (s.isDirectory()) walk(p)
          else totalSize += s.size
        }
      }
      walk(dir)
      const mb = (totalSize / 1024 / 1024).toFixed(2)
      if (totalSize > 500 * 1024 * 1024) {
        return { name: 'Disk usage', status: 'warn', message: `${mb}MB — consider cleanup`, fix: 'Archive old events/checkpoints' }
      }
      return { name: 'Disk usage', status: 'ok', message: `${mb}MB` }
    } catch {
      return { name: 'Disk usage', status: 'ok', message: 'Unable to calculate' }
    }
  }

  private checkGitignore(): DiagnosticResult {
    const p = join(this.projectDir, this.scaleDir, '.gitignore')
    if (!existsSync(p)) {
      return { name: '.scale/.gitignore', status: 'warn', message: 'Missing — runtime data may be committed', fix: 'Run: scale init' }
    }
    return { name: '.scale/.gitignore', status: 'ok', message: 'Present' }
  }

  formatReport(report: DoctorReport): string {
    const icon = { healthy: '✅', degraded: '⚠️', broken: '❌' }
    const statusIcon = { ok: '✅', warn: '⚠️', fail: '❌' }
    const lines: string[] = [
      `\n${icon[report.overall]} SCALE Engine Health: ${report.overall.toUpperCase()}`,
      `${'─'.repeat(50)}`,
    ]

    for (const check of report.checks) {
      lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
      if (check.fix) lines.push(`     💡 Fix: ${check.fix}`)
    }

    lines.push(`${'─'.repeat(50)}`)
    const ok = report.checks.filter((c) => c.status === 'ok').length
    const warn = report.checks.filter((c) => c.status === 'warn').length
    const fail = report.checks.filter((c) => c.status === 'fail').length
    lines.push(`  ${ok} passed, ${warn} warnings, ${fail} failures`)
    return lines.join('\n')
  }
}

