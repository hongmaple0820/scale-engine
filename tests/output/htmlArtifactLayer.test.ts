import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  doctorHtmlArtifacts,
  loadHtmlArtifactPolicy,
  normalizeHtmlArtifactType,
  outputPolicyTemplate,
  renderHtmlArtifact,
  settleHtmlArtifacts,
} from '../../src/output/HTMLArtifactLayer.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-html-artifact-'))
  dirs.push(dir)
  return dir
}

function write(projectDir: string, relativePath: string, content: string): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(target.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

describe('HTMLArtifactLayer', () => {
  it('renders a release report, manifest, and index from task Markdown sources', () => {
    const projectDir = makeProject()
    const taskId = '2026-05-18-demo'
    const taskDir = `docs/worklog/tasks/${taskId}`
    write(projectDir, `${taskDir}/summary.md`, '# Summary\n\n- Delivered workflow adapter\n- Escaped <script>alert(1)</script>\n')
    write(projectDir, `${taskDir}/verification.md`, '# Verification\n\n`npm test` exit 0\n')
    write(projectDir, `${taskDir}/review.md`, '# Review\n\nNo blocking findings.\n')

    const result = renderHtmlArtifact({ projectDir, taskId, type: 'release-report' })

    expect(result.ok).toBe(true)
    expect(existsSync(result.outputPath)).toBe(true)
    expect(existsSync(join(projectDir, taskDir, 'artifacts', 'index.html'))).toBe(true)
    const html = readFileSync(result.outputPath, 'utf-8')
    expect(html).toContain('Release Report')
    expect(html).toContain('Delivered workflow adapter')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')

    const manifest = JSON.parse(readFileSync(join(projectDir, taskDir, 'artifact-manifest.json'), 'utf-8'))
    expect(manifest.artifacts).toHaveLength(1)
    expect(manifest.artifacts[0]).toMatchObject({
      type: 'release-report',
      gitPolicy: 'review',
      sourcePaths: ['summary.md', 'verification.md', 'review.md'],
    })
    expect(manifest.artifacts[0].missingSources).toEqual([
      'architecture-review.md',
      'db-change-plan.md',
      'docs-impact.md',
      'resource-impact.md',
      'standards-impact.md',
    ])
  })

  it('checks rendered artifacts for safety and traceability', () => {
    const projectDir = makeProject()
    const taskId = '2026-05-18-review'
    const taskDir = `docs/worklog/tasks/${taskId}`
    write(projectDir, `${taskDir}/review.md`, '# Review\n\nNo findings.\n')

    const result = renderHtmlArtifact({
      projectDir,
      taskId,
      type: 'code-review',
      sourcePaths: ['review.md'],
    })
    expect(doctorHtmlArtifacts({ projectDir, taskId }).ok).toBe(true)

    writeFileSync(result.outputPath, `${readFileSync(result.outputPath, 'utf-8')}\n<script src="https://example.invalid/x.js"></script>\n`, 'utf-8')
    const report = doctorHtmlArtifacts({ projectDir, taskId, type: 'code-review' })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'remote-script', severity: 'fail' }),
    ]))
  })

  it('writes HTML settlement evidence', () => {
    const projectDir = makeProject()
    const taskId = '2026-05-18-settle'
    const taskDir = `docs/worklog/tasks/${taskId}`
    write(projectDir, `${taskDir}/summary.md`, '# Summary\n\nReady.\n')
    renderHtmlArtifact({ projectDir, taskId, type: 'status-report', sourcePaths: ['summary.md'] })

    const report = settleHtmlArtifacts({ projectDir, taskId })

    expect(report.ok).toBe(true)
    expect(report.htmlImpactPath).toBe(join(projectDir, taskDir, 'html-artifacts.md'))
    expect(readFileSync(report.htmlImpactPath, 'utf-8')).toContain('status-report')
  })

  it('loads default output policy and aliases artifact types', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/output-policy.json', outputPolicyTemplate())

    const policy = loadHtmlArtifactPolicy(projectDir)

    expect(policy.templates['plan-comparison'].sources).toContain('plan.md')
    expect(policy.safety.allowRemoteScripts).toBe(false)
    expect(normalizeHtmlArtifactType('release')).toBe('release-report')
    expect(normalizeHtmlArtifactType('review')).toBe('code-review')
  })
})
