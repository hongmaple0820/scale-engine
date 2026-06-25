import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { HTMLDocumentRenderer, type DocLang, type ThemeMode } from './HTMLDocumentRenderer.js'

export const HTML_ARTIFACT_TYPES = [
  'plan-comparison',
  'implementation-plan',
  'code-review',
  'status-report',
  'incident-report',
  'release-report',
] as const

export type HtmlArtifactType = typeof HTML_ARTIFACT_TYPES[number]

export interface HtmlArtifactPolicyTemplate {
  label: string
  sources: string[]
  description: string
}

export interface HtmlArtifactPolicy {
  version: number
  sourceFormat: 'markdown'
  artifactDirectory: string
  manifestFile: string
  defaultTheme: ThemeMode
  defaultGitPolicy: 'review' | 'ignore' | 'commit' | 'external'
  safety: {
    allowRemoteScripts: boolean
    allowRemoteStyles: boolean
    detectSecrets: boolean
  }
  templates: Record<HtmlArtifactType, HtmlArtifactPolicyTemplate>
}

export interface HtmlArtifactManifestEntry {
  type: HtmlArtifactType
  title: string
  path: string
  sourcePaths: string[]
  missingSources: string[]
  gitPolicy: HtmlArtifactPolicy['defaultGitPolicy']
  generatedAt: string
  renderer: 'scale-engine'
}

export interface HtmlArtifactManifest {
  version: number
  taskId?: string
  generatedAt: string
  artifactDirectory: string
  artifacts: HtmlArtifactManifestEntry[]
}

export interface RenderHtmlArtifactOptions {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  artifactDir?: string
  type?: HtmlArtifactType | string
  sourcePaths?: string[]
  theme?: ThemeMode
  lang?: DocLang
  title?: string
}

export interface RenderHtmlArtifactResult {
  ok: boolean
  type: HtmlArtifactType
  taskDir: string
  outputPath: string
  indexPath: string
  manifestPath: string
  sourcePaths: string[]
  missingSources: string[]
}

export interface HtmlArtifactFinding {
  severity: 'warn' | 'fail'
  code: string
  path?: string
  message: string
  fix?: string
}

export interface HtmlArtifactDoctorReport {
  ok: boolean
  projectDir: string
  taskDir: string
  manifestPath: string
  findings: HtmlArtifactFinding[]
  artifacts: HtmlArtifactManifestEntry[]
}

export interface SettleHtmlArtifactsOptions {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  artifactDir?: string
}

export interface SettleHtmlArtifactsReport {
  ok: boolean
  taskId?: string
  htmlImpactPath: string
  doctor: HtmlArtifactDoctorReport
}

const DEFAULT_TEMPLATE_SOURCES: Record<HtmlArtifactType, HtmlArtifactPolicyTemplate> = {
  'plan-comparison': {
    label: 'Plan Comparison',
    sources: ['mini-prd.md', 'explore.md', 'plan.md'],
    description: 'Compare candidate approaches, tradeoffs, open questions, and decision criteria.',
  },
  'implementation-plan': {
    label: 'Implementation Plan',
    sources: ['plan.md', 'verification.md'],
    description: 'Convert the implementation plan and verification strategy into a scannable delivery surface.',
  },
  'code-review': {
    label: 'Code Review',
    sources: ['review.md', 'security-review.md', 'standards-impact.md'],
    description: 'Summarize review findings, severity, evidence, and residual risks.',
  },
  'status-report': {
    label: 'Status Report',
    sources: ['summary.md', 'verification.md', 'resource-impact.md', 'standards-impact.md'],
    description: 'Show current task status, proof, blockers, resource state, and follow-ups.',
  },
  'incident-report': {
    label: 'Incident Report',
    sources: ['explore.md', 'plan.md', 'verification.md', 'review.md'],
    description: 'Explain incident context, diagnosis, fix, validation, and prevention work.',
  },
  'release-report': {
    label: 'Release Report',
    sources: ['summary.md', 'verification.md', 'review.md', 'db-change-plan.md', 'docs-impact.md', 'resource-impact.md', 'standards-impact.md'],
    description: 'Package release evidence, SQL/data/config/docs/resource impact, risk state, unverified items, and sign-off readiness.',
  },
}

export function outputPolicyPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  return join(projectDir, scaleDir, 'output-policy.json')
}

export function outputPolicyTemplate(): string {
  return JSON.stringify(defaultHtmlArtifactPolicy(), null, 2) + '\n'
}

export function defaultHtmlArtifactPolicy(): HtmlArtifactPolicy {
  return {
    version: 1,
    sourceFormat: 'markdown',
    artifactDirectory: 'artifacts',
    manifestFile: 'artifact-manifest.json',
    defaultTheme: 'auto',
    defaultGitPolicy: 'review',
    safety: {
      allowRemoteScripts: false,
      allowRemoteStyles: false,
      detectSecrets: true,
    },
    templates: DEFAULT_TEMPLATE_SOURCES,
  }
}

export function loadHtmlArtifactPolicy(projectDir = process.cwd(), scaleDir = '.scale'): HtmlArtifactPolicy {
  const defaults = defaultHtmlArtifactPolicy()
  const path = outputPolicyPath(projectDir, scaleDir)
  if (!existsSync(path)) return defaults
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<HtmlArtifactPolicy>
    return {
      ...defaults,
      ...parsed,
      safety: {
        ...defaults.safety,
        ...(parsed.safety ?? {}),
      },
      templates: {
        ...defaults.templates,
        ...(parsed.templates ?? {}),
      },
    }
  } catch {
    return defaults
  }
}

export function renderHtmlArtifact(options: RenderHtmlArtifactOptions = {}): RenderHtmlArtifactResult {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? '.scale'
  const policy = loadHtmlArtifactPolicy(projectDir, scaleDir)
  const type = normalizeHtmlArtifactType(options.type ?? 'release-report')
  const taskDir = resolveTaskDir(projectDir, options.taskId, options.artifactDir)
  const template = policy.templates[type] ?? DEFAULT_TEMPLATE_SOURCES[type]
  const sourcePaths = normalizeSourcePaths(options.sourcePaths?.length ? options.sourcePaths : template.sources)
  const sourceSections = readSourceSections(taskDir, sourcePaths)
  const title = options.title ?? `${template.label} - ${options.taskId ?? basename(taskDir)}`
  const outputDir = join(taskDir, policy.artifactDirectory)
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  const outputPath = join(outputDir, `${type}.html`)
  const renderer = new HTMLDocumentRenderer({
    title,
    theme: options.theme ?? policy.defaultTheme,
    lang: options.lang ?? 'zh',
    interactive: true,
    printFriendly: true,
  })

  const sections = [
    {
      heading: 'Purpose',
      content: renderPurposeSection(template, sourceSections),
    },
    ...sourceSections.present.map(section => ({
      heading: section.heading,
      content: markdownToHtml(section.content),
    })),
  ]

  const html = renderer.renderReport({
    type,
    title,
    timestamp: new Date().toISOString(),
    metrics: {
      sources: sourceSections.present.length,
      missing: sourceSections.missing.length,
      policy: policy.defaultGitPolicy,
    },
    sections,
  })
  writeFileSync(outputPath, html, 'utf-8')

  const manifestPath = join(taskDir, policy.manifestFile)
  const manifest = upsertManifestEntry({
    manifestPath,
    taskId: options.taskId,
    artifactDirectory: policy.artifactDirectory,
    entry: {
      type,
      title,
      path: normalizePath(relative(projectDir, outputPath)),
      sourcePaths: sourceSections.present.map(section => section.relativePath),
      missingSources: sourceSections.missing,
      gitPolicy: policy.defaultGitPolicy,
      generatedAt: new Date().toISOString(),
      renderer: 'scale-engine',
    },
  })
  const indexPath = writeArtifactIndex(projectDir, taskDir, policy, manifest)

  return {
    ok: true,
    type,
    taskDir,
    outputPath,
    indexPath,
    manifestPath,
    sourcePaths: sourceSections.present.map(section => section.relativePath),
    missingSources: sourceSections.missing,
  }
}

export function doctorHtmlArtifacts(options: RenderHtmlArtifactOptions = {}): HtmlArtifactDoctorReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const policy = loadHtmlArtifactPolicy(projectDir, options.scaleDir ?? '.scale')
  const taskDir = resolveTaskDir(projectDir, options.taskId, options.artifactDir)
  const manifestPath = join(taskDir, policy.manifestFile)
  const findings: HtmlArtifactFinding[] = []
  const manifest = readManifest(manifestPath)
  if (!manifest) {
    findings.push({
      severity: 'fail',
      code: 'missing-manifest',
      path: normalizePath(relative(projectDir, manifestPath)),
      message: 'HTML artifact manifest is missing.',
      fix: 'Run scale artifact render --task-id <task> --type release-report.',
    })
    return {
      ok: false,
      projectDir,
      taskDir,
      manifestPath,
      findings,
      artifacts: [],
    }
  }

  const selectedType = options.type ? normalizeHtmlArtifactType(options.type) : undefined
  const artifacts = selectedType
    ? manifest.artifacts.filter(artifact => artifact.type === selectedType)
    : manifest.artifacts
  if (artifacts.length === 0) {
    findings.push({
      severity: 'fail',
      code: 'missing-artifact-entry',
      message: selectedType
        ? `Manifest has no entry for ${selectedType}.`
        : 'Manifest has no artifact entries.',
      fix: 'Render the required HTML artifact before review or release.',
    })
  }

  for (const artifact of artifacts) {
    const absoluteArtifactPath = resolve(projectDir, artifact.path)
    if (!existsSync(absoluteArtifactPath)) {
      findings.push({
        severity: 'fail',
        code: 'missing-html-artifact',
        path: artifact.path,
        message: 'Manifest points to an HTML artifact that does not exist.',
        fix: `Re-render ${artifact.type} or remove the stale manifest entry.`,
      })
      continue
    }

    const html = readFileSync(absoluteArtifactPath, 'utf-8')
    findings.push(...checkHtmlSafety(html, artifact.path, policy))
    findings.push(...checkSourceFreshness(projectDir, absoluteArtifactPath, artifact))
  }

  return {
    ok: !findings.some(finding => finding.severity === 'fail'),
    projectDir,
    taskDir,
    manifestPath,
    findings,
    artifacts,
  }
}

export function settleHtmlArtifacts(options: SettleHtmlArtifactsOptions = {}): SettleHtmlArtifactsReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const doctor = doctorHtmlArtifacts(options)
  const taskDir = resolveTaskDir(projectDir, options.taskId, options.artifactDir)
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true })
  const htmlImpactPath = join(taskDir, 'html-artifacts.md')
  writeFileSync(htmlImpactPath, htmlArtifactSettlementMarkdown(options.taskId, doctor), 'utf-8')
  return {
    ok: doctor.ok,
    taskId: options.taskId,
    htmlImpactPath,
    doctor,
  }
}

export function resolveHtmlArtifactForOpen(options: RenderHtmlArtifactOptions = {}): string {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const policy = loadHtmlArtifactPolicy(projectDir, options.scaleDir ?? '.scale')
  const taskDir = resolveTaskDir(projectDir, options.taskId, options.artifactDir)
  const manifest = readManifest(join(taskDir, policy.manifestFile))
  const selectedType = options.type ? normalizeHtmlArtifactType(options.type) : undefined
  const artifact = selectedType
    ? manifest?.artifacts.find(item => item.type === selectedType)
    : manifest?.artifacts[manifest.artifacts.length - 1]
  if (artifact) return resolve(projectDir, artifact.path)

  const fallbackType = selectedType ?? 'release-report'
  return join(taskDir, policy.artifactDirectory, `${fallbackType}.html`)
}

export function normalizeHtmlArtifactType(value: string): HtmlArtifactType {
  const normalized = value.trim().toLowerCase()
  if (HTML_ARTIFACT_TYPES.includes(normalized as HtmlArtifactType)) return normalized as HtmlArtifactType
  if (normalized === 'plan') return 'implementation-plan'
  if (normalized === 'review') return 'code-review'
  if (normalized === 'status') return 'status-report'
  if (normalized === 'incident') return 'incident-report'
  if (normalized === 'release') return 'release-report'
  throw new Error(`Unknown HTML artifact type "${value}". Supported types: ${HTML_ARTIFACT_TYPES.join(', ')}`)
}

function resolveTaskDir(projectDir: string, taskId?: string, artifactDir?: string): string {
  if (artifactDir?.trim()) {
    return isAbsolute(artifactDir)
      ? artifactDir
      : resolve(projectDir, artifactDir)
  }
  if (taskId?.trim()) {
    return join(projectDir, 'docs', 'worklog', 'tasks', taskId.trim())
  }
  return projectDir
}

function normalizeSourcePaths(sourcePaths: string[]): string[] {
  return sourcePaths
    .map(item => normalizePath(item.trim()))
    .filter(Boolean)
}

function readSourceSections(taskDir: string, sourcePaths: string[]): {
  present: Array<{ heading: string; relativePath: string; content: string }>
  missing: string[]
} {
  const present: Array<{ heading: string; relativePath: string; content: string }> = []
  const missing: string[] = []
  for (const sourcePath of sourcePaths) {
    const absolutePath = resolve(taskDir, sourcePath)
    if (!absolutePath.startsWith(resolve(taskDir))) {
      missing.push(sourcePath)
      continue
    }
    if (!existsSync(absolutePath)) {
      missing.push(sourcePath)
      continue
    }
    present.push({
      heading: sourceHeading(sourcePath),
      relativePath: sourcePath,
      content: readFileSync(absolutePath, 'utf-8'),
    })
  }
  return { present, missing }
}

function renderPurposeSection(
  template: HtmlArtifactPolicyTemplate,
  sections: { present: Array<{ relativePath: string }>; missing: string[] },
): string {
  const present = sections.present.length
    ? `<ul>${sections.present.map(section => `<li><code>${escapeHtml(section.relativePath)}</code></li>`).join('')}</ul>`
    : '<p>No source artifacts were found.</p>'
  const missing = sections.missing.length
    ? `<p class="doc-warning">Missing source artifacts: ${sections.missing.map(item => `<code>${escapeHtml(item)}</code>`).join(', ')}</p>`
    : '<p>All configured source artifacts were found.</p>'
  return `
    <p>${escapeHtml(template.description)}</p>
    <h3>Source Artifacts</h3>
    ${present}
    ${missing}
  `
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let inList = false

  const closeList = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '')
    if (/^```/.test(line.trim())) {
      if (inCode) {
        html.push('</code></pre>')
        inCode = false
      } else {
        closeList()
        html.push('<pre><code>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      html.push(escapeHtml(rawLine) + '\n')
      continue
    }
    if (!line.trim()) {
      closeList()
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = Math.min(6, heading[1].length + 2)
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    const listItem = line.match(/^\s*[-*]\s+(.+)$/)
    if (listItem) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${inlineMarkdown(listItem[1])}</li>`)
      continue
    }
    closeList()
    html.push(`<p>${inlineMarkdown(line)}</p>`)
  }
  closeList()
  if (inCode) html.push('</code></pre>')
  return html.join('\n')
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function upsertManifestEntry(options: {
  manifestPath: string
  taskId?: string
  artifactDirectory: string
  entry: HtmlArtifactManifestEntry
}): HtmlArtifactManifest {
  const existing = readManifest(options.manifestPath)
  const artifacts = existing?.artifacts.filter(artifact => artifact.type !== options.entry.type) ?? []
  artifacts.push(options.entry)
  const manifest: HtmlArtifactManifest = {
    version: 1,
    taskId: options.taskId ?? existing?.taskId,
    generatedAt: new Date().toISOString(),
    artifactDirectory: options.artifactDirectory,
    artifacts,
  }
  const dir = dirname(options.manifestPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(options.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  return manifest
}

function readManifest(path: string): HtmlArtifactManifest | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as HtmlArtifactManifest
    return {
      version: parsed.version ?? 1,
      taskId: parsed.taskId,
      generatedAt: parsed.generatedAt ?? new Date(0).toISOString(),
      artifactDirectory: parsed.artifactDirectory ?? 'artifacts',
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    }
  } catch {
    return undefined
  }
}

function writeArtifactIndex(
  projectDir: string,
  taskDir: string,
  policy: HtmlArtifactPolicy,
  manifest: HtmlArtifactManifest,
): string {
  const outputDir = join(taskDir, policy.artifactDirectory)
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const indexPath = join(outputDir, 'index.html')
  const renderer = new HTMLDocumentRenderer({
    title: `HTML Artifacts - ${manifest.taskId ?? basename(taskDir)}`,
    theme: policy.defaultTheme,
    lang: 'zh',
    interactive: false,
    printFriendly: true,
  })
  const rows = manifest.artifacts.map(artifact => {
    const href = basename(artifact.path)
    return `<tr>
      <td><a href="${escapeAttribute(href)}">${escapeHtml(artifact.type)}</a></td>
      <td>${escapeHtml(artifact.title)}</td>
      <td>${escapeHtml(artifact.gitPolicy)}</td>
      <td>${escapeHtml(artifact.generatedAt)}</td>
      <td>${artifact.missingSources.length ? artifact.missingSources.map(item => `<code>${escapeHtml(item)}</code>`).join(', ') : 'none'}</td>
    </tr>`
  }).join('\n')
  const html = renderer.renderReport({
    type: 'html-artifacts',
    title: `HTML Artifacts - ${manifest.taskId ?? basename(taskDir)}`,
    timestamp: new Date().toISOString(),
    metrics: {
      artifacts: manifest.artifacts.length,
      policy: policy.defaultGitPolicy,
    },
    sections: [{
      heading: 'Artifact Index',
      content: `<table>
        <thead><tr><th>Type</th><th>Title</th><th>Git Policy</th><th>Generated</th><th>Missing Sources</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    }],
  })
  writeFileSync(indexPath, html, 'utf-8')
  return indexPath
}

function checkHtmlSafety(
  html: string,
  path: string,
  policy: HtmlArtifactPolicy,
): HtmlArtifactFinding[] {
  const findings: HtmlArtifactFinding[] = []
  if (!policy.safety.allowRemoteScripts && /<script\b[^>]*\bsrc=["']https?:/i.test(html)) {
    findings.push({
      severity: 'fail',
      code: 'remote-script',
      path,
      message: 'HTML artifact references a remote script.',
      fix: 'Use self-contained HTML or a reviewed local asset.',
    })
  }
  if (!policy.safety.allowRemoteStyles && (/<link\b[^>]*\bhref=["']https?:/i.test(html) || /@import\s+url\(["']?https?:/i.test(html))) {
    findings.push({
      severity: 'fail',
      code: 'remote-style',
      path,
      message: 'HTML artifact references a remote stylesheet.',
      fix: 'Inline safe CSS or use a reviewed local asset.',
    })
  }
  if (policy.safety.detectSecrets && containsSecretLikeValue(html)) {
    findings.push({
      severity: 'fail',
      code: 'secret-like-content',
      path,
      message: 'HTML artifact appears to contain a credential-like value.',
      fix: 'Regenerate after redacting tokens, cookies, credentials, and API keys from the source artifacts.',
    })
  }
  return findings
}

function checkSourceFreshness(
  projectDir: string,
  htmlPath: string,
  artifact: HtmlArtifactManifestEntry,
): HtmlArtifactFinding[] {
  const findings: HtmlArtifactFinding[] = []
  const htmlMtime = statSync(htmlPath).mtime.getTime()
  const taskDir = dirname(dirname(htmlPath))
  for (const sourcePath of artifact.sourcePaths) {
    const absoluteSourcePath = resolve(taskDir, sourcePath)
    if (!absoluteSourcePath.startsWith(taskDir) || !existsSync(absoluteSourcePath)) {
      findings.push({
        severity: 'warn',
        code: 'missing-source',
        path: sourcePath,
        message: `Source artifact for ${artifact.type} is missing.`,
        fix: 'Restore the source Markdown artifact or re-render with an explicit --source list.',
      })
      continue
    }
    if (statSync(absoluteSourcePath).mtime.getTime() > htmlMtime) {
      findings.push({
        severity: 'warn',
        code: 'stale-html-artifact',
        path: normalizePath(relative(projectDir, htmlPath)),
        message: `${artifact.type} is older than source ${sourcePath}.`,
        fix: `Run scale artifact render --type ${artifact.type} for this task.`,
      })
    }
  }
  return findings
}

function htmlArtifactSettlementMarkdown(taskId: string | undefined, doctor: HtmlArtifactDoctorReport): string {
  const findings = doctor.findings.length
    ? doctor.findings.map(finding => `| ${finding.severity.toUpperCase()} | ${finding.code} | ${escapeCell(finding.path ?? '')} | ${escapeCell(finding.message)} |`).join('\n')
    : '| OK | no-findings |  | No HTML artifact findings. |'
  const artifacts = doctor.artifacts.length
    ? doctor.artifacts.map(artifact => `| ${artifact.type} | ${escapeCell(artifact.path)} | ${artifact.sourcePaths.length} | ${artifact.missingSources.length} | ${artifact.gitPolicy} |`).join('\n')
    : '| none |  | 0 | 0 |  |'
  return `# HTML Artifacts

Task: ${taskId ?? 'unspecified'}
Status: ${doctor.ok ? 'passed' : 'blocked'}
Generated: ${new Date().toISOString()}

## Artifacts

| Type | Path | Sources | Missing | Git policy |
| --- | --- | ---: | ---: | --- |
${artifacts}

## Findings

| Severity | Code | Path | Message |
| --- | --- | --- | --- |
${findings}
`
}

function sourceHeading(path: string): string {
  return path.replace(/[/\\]/g, ' / ').replace(/\.md$/i, '')
}

function containsSecretLikeValue(text: string): boolean {
  return /(authorization\s*:\s*bearer\s+)[A-Za-z0-9._-]{16,}/i.test(text)
    || /\b(password|passwd|pwd|token|secret|credential|api[_-]?key|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._/-]{16,}/i.test(text)
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizePath(path: string): string {
  return path.split(/[/\\]+/).filter(Boolean).join('/')
}

export function listExistingHtmlArtifacts(options: RenderHtmlArtifactOptions = {}): string[] {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const policy = loadHtmlArtifactPolicy(projectDir, options.scaleDir ?? '.scale')
  const taskDir = resolveTaskDir(projectDir, options.taskId, options.artifactDir)
  const outputDir = join(taskDir, policy.artifactDirectory)
  if (!existsSync(outputDir)) return []
  return readdirSync(outputDir)
    .filter(file => file.endsWith('.html'))
    .map(file => normalizePath(relative(projectDir, join(outputDir, file))))
}
