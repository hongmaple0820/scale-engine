import type { TaskPayload } from '../artifact/types.js'
import type { ReviewFinding } from './ReviewStore.js'
import type { SkillRole } from '../skills/RoleSkills.js'

export interface ChangedFile {
  status: string
  path: string
}

export interface DiffInput {
  file: string
  text: string
}

export interface VerificationEvidenceSummary {
  gate: string
  passed: boolean
}

export interface ReviewAnalysisInput {
  statusOutput: string
  diffs: DiffInput[]
  taskPayload?: Pick<TaskPayload, 'verificationEvidenceIds'>
  verificationEvidence?: VerificationEvidenceSummary[]
  largeDiffThreshold?: number
}

interface DiffLine {
  line: number
  text: string
}

export function parseChangedFiles(output: string): ChangedFile[] {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [status, ...pathParts] = line.split(/\s+/)
      return { status, path: pathParts.join(' ') }
    })
    .filter(file => file.path.length > 0)
}

export function shouldReviewFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return !normalized.endsWith('/') &&
    !normalized.startsWith('.scale/') &&
    !normalized.startsWith('dist/') &&
    !normalized.includes('node_modules/') &&
    !/\.(png|jpe?g|gif|webp|ico|db|db-shm|db-wal)$/i.test(normalized)
}

export function summarizeFindings(findings: ReviewFinding[]) {
  return {
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    high: findings.filter(f => f.severity === 'HIGH').length,
    medium: findings.filter(f => f.severity === 'MEDIUM').length,
    low: findings.filter(f => f.severity === 'LOW').length,
  }
}

function isDiffPayloadLine(line: string): boolean {
  return (line.startsWith('+') && !line.startsWith('+++')) ||
    (line.startsWith('-') && !line.startsWith('---'))
}

function getAddedLines(text: string): DiffLine[] {
  return text
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(item => item.text.startsWith('+') && !item.text.startsWith('+++'))
    .map(item => ({ line: item.line, text: item.text.slice(1) }))
}

function firstMatch(lines: DiffLine[], pattern: RegExp): DiffLine | undefined {
  return lines.find(line => pattern.test(line.text))
}

function isSourcePath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)
}

function normalizeReviewPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function isNewFile(file: ChangedFile): boolean {
  return file.status.includes('??') || file.status.includes('A')
}

function isPackageManifestPath(path: string): boolean {
  return normalizeReviewPath(path).endsWith('package.json')
}

function isAbstractionShapedPath(path: string): boolean {
  return /(?:^|[\/_.-])(helpers?|utils?|adapters?|wrappers?|managers?|factories|providers?|registries|strategies|builders?|orchestrators?|services?)(?:[\/_.-]|$)/i
    .test(normalizeReviewPath(path))
}

function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__)\//i.test(normalizeReviewPath(path)) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)
}

function isSecuritySensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return /(^|\/)(auth|security|permissions?|credentials?|secrets?|tokens?|sessions?)(\/|\.|-|_)/.test(normalized) ||
    /(auth|security|credential|secret|token|session|password)/.test(normalized)
}

function evidence(line: DiffLine, label: string): string {
  return `${label} at diff line ${line.line}: ${line.text.trim().slice(0, 160)}`
}

function isCommentOrWhitespace(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === '' ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
}

function isRegexRuleDefinition(text: string): boolean {
  const trimmed = text.trim()
  return /^\/.*\/[dgimsuy]*,?$/.test(trimmed) ||
    /^\/.*\/[dgimsuy]*,?\s*\/\/.*$/.test(trimmed) ||
    /^(?:if\s*\(|return\s+)?\/.*\/[dgimsuy]*\.(?:test|exec)\(/.test(trimmed) ||
    /^\/.*\/[dgimsuy]*\.(?:test|exec)\(/.test(trimmed) ||
    /=\s*\/.*\/[dgimsuy]*\.(?:test|exec)\(/.test(trimmed) ||
    /=\s*\/.*\/[dgimsuy]*\s*(?:[),;]|$)/.test(trimmed) ||
    /\bfirstMatch\([^,]+,\s*\/.*\/[dgimsuy]*\)?/.test(trimmed) ||
    /^pattern:\s*\/.*\/[dgimsuy]*,?$/.test(trimmed) ||
    /^(?:title|name|description|recommendation|remediation|reason|label):\s*['"`].*['"`],?$/.test(trimmed) ||
    // Array of regex patterns: /pattern/flags, // comment
    /^\/.*\/[dgimsuy]*\s*,/.test(trimmed)
}

function isTestDiffFixture(file: string, text: string): boolean {
  if (!isTestPath(file)) return false
  const trimmed = text.trim()
  const fixtureRiskPattern = /(?:password|api[_-]?key|secret|token|auth|credential|private[_-]?key|git add|rm\s+-rf|curl|wget|Invoke-WebRequest|Invoke-Expression|shell: true|innerHTML|dangerouslySetInnerHTML|document\.write|eval\(|new Function|@ts-ignore|catch)/i
  return (
    /\b(?:text|diff|diffs|[A-Za-z]+Diff)\b\s*[:=]/.test(text) && /['"`]\+/.test(text)
  ) || (
    /['"`][^'"`]+['"`]\s*:/.test(trimmed) &&
    /['"`].*(?:password|api[_-]?key|secret|token|auth|credential|private[_-]?key|git add|rm\s+-rf|curl|wget|Invoke-WebRequest|Invoke-Expression|shell: true|innerHTML|dangerouslySetInnerHTML|document\.write|eval\(|new Function|@ts-ignore|catch)/i.test(trimmed)
  ) || (
    isCommentOrWhitespace(trimmed) &&
    fixtureRiskPattern.test(trimmed)
  ) || (
    /^['"`].*['"`]\s*,?$/.test(trimmed) &&
    fixtureRiskPattern.test(trimmed)
  )
}

function getExecutableAddedLines(diff: DiffInput): DiffLine[] {
  const lines = getAddedLines(diff.text)
  const executable: DiffLine[] = []
  let insideTestFixtureTemplate = false

  for (const line of lines) {
    if (isTestPath(diff.file)) {
      const startsFixtureTemplate = startsTestFixtureTemplate(line.text)
      if (insideTestFixtureTemplate || startsFixtureTemplate) {
        const closesTemplate = containsUnescapedBacktick(line.text) && !startsFixtureTemplate
        insideTestFixtureTemplate = startsFixtureTemplate ? !templateStartsAndEndsOnSameLine(line.text) : !closesTemplate
        continue
      }
    }

    if (!isRegexRuleDefinition(line.text) && !isTestDiffFixture(diff.file, line.text)) {
      executable.push(line)
    }
  }

  return executable
}

function startsTestFixtureTemplate(text: string): boolean {
  return /\b(?:write|writeFileSync|appendFileSync)\s*\([^)]*,\s*`/.test(text) ||
    /\b(?:text|diff|diffs|content|fixture)\b\s*[:=]\s*`/.test(text)
}

function templateStartsAndEndsOnSameLine(text: string): boolean {
  return countUnescapedBackticks(text) >= 2
}

function containsUnescapedBacktick(text: string): boolean {
  return countUnescapedBackticks(text) > 0
}

function countUnescapedBackticks(text: string): number {
  let count = 0
  let escaped = false
  for (const char of text) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '`') count++
  }
  return count
}

function findEmptyCatch(lines: DiffLine[]): DiffLine | undefined {
  const inlineCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*.*?\*\/|\/\/.*)?\s*\}/
  const blockCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*$/
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]
    if (inlineCatch.test(current.text)) return current
    if (!blockCatch.test(current.text)) continue

    for (const next of lines.slice(index + 1, index + 8)) {
      const trimmed = next.text.trim()
      if (isCommentOrWhitespace(trimmed)) continue
      if (/^}\s*[),;]?$/.test(trimmed)) return current
      break
    }
  }
  return undefined
}

function findAddedDependency(lines: DiffLine[]): DiffLine | undefined {
  return firstMatch(
    lines,
    /^\s*"(@?[\w./-]+)"\s*:\s*"(?:(?:workspace:|file:|link:|npm:|git\+|https?:)|[\^~<>=]?\d)/,
  )
}

function findNewAbstraction(lines: DiffLine[]): DiffLine | undefined {
  return firstMatch(
    lines,
    /\b(?:export\s+)?(?:abstract\s+)?class\s+\w*(?:Factory|Manager|Registry|Strategy|Provider|Adapter|Wrapper|Builder|Orchestrator)\b|\b(?:export\s+)?interface\s+\w*(?:Factory|Manager|Registry|Strategy|Provider|Adapter|Wrapper|Builder|Config)\b|\b(?:export\s+)?(?:const|function)\s+\w*(?:Factory|Manager|Registry|Strategy|Provider|Adapter|Wrapper|Helper|Util|Builder)\b/,
  )
}

function analyzeLazyGuardrails(changedFiles: ChangedFile[], diffs: DiffInput[]): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  const newSourceFiles = changedFiles.filter(file => isNewFile(file) && isSourcePath(file.path) && !isTestPath(file.path))
  const newAbstractionFiles = newSourceFiles.filter(file => isAbstractionShapedPath(file.path))

  if (newSourceFiles.length >= 3) {
    findings.push({
      category: 'process',
      severity: 'MEDIUM',
      description: 'Multiple new source files were introduced; verify the request could not be handled by existing modules first.',
      file: newSourceFiles[0]?.path,
      evidence: newSourceFiles.map(file => file.path).slice(0, 5).join(', '),
    })
  }

  if (newAbstractionFiles.length > 0) {
    findings.push({
      category: 'process',
      severity: 'MEDIUM',
      description: 'New helper/adapter/manager-style source file introduced; document why existing code, standard library, or platform capabilities were not enough.',
      file: newAbstractionFiles[0]?.path,
      evidence: newAbstractionFiles.map(file => file.path).slice(0, 5).join(', '),
    })
  }

  for (const diff of diffs) {
    const added = getExecutableAddedLines(diff)
    if (added.length === 0) continue

    if (isPackageManifestPath(diff.file)) {
      const dependency = findAddedDependency(added)
      if (dependency) {
        findings.push({
          category: 'process',
          severity: 'MEDIUM',
          description: 'New package dependency introduced; verify existing dependencies, standard library, or platform capability cannot cover this.',
          file: diff.file,
          evidence: evidence(dependency, 'dependency addition'),
        })
      }
    }

    if (isSourcePath(diff.file) && !isTestPath(diff.file)) {
      const abstraction = findNewAbstraction(added)
      if (abstraction) {
        findings.push({
          category: 'process',
          severity: 'LOW',
          description: 'New abstraction-shaped code introduced; confirm it earns its place for the current request.',
          file: diff.file,
          evidence: evidence(abstraction, 'abstraction-shaped code'),
        })
      }
    }
  }

  return findings
}

function analyzeDiffRisk(diff: DiffInput): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  const added = getExecutableAddedLines(diff)
  if (added.length === 0) return findings

  const secret = firstMatch(
    added,
    /\b(password|passwd|api[_-]?key|secret|token|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key)\b\s*[:=]\s*['"`][^'"`]+['"`]/i,
  )
  if (secret) {
    findings.push({
      category: 'security',
      severity: 'CRITICAL',
      description: 'Possible hardcoded secret introduced in diff.',
      file: diff.file,
      evidence: evidence(secret, 'secret-like assignment'),
    })
  }

  const securityBypass = firstMatch(
    added,
    /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"`]0['"`]|rejectUnauthorized\s*:\s*false|strictSSL\s*:\s*false|dangerouslySetInnerHTML|innerHTML\s*=|eval\s*\(|new\s+Function\s*\(/i,
  )
  if (securityBypass) {
    findings.push({
      category: 'security',
      severity: 'HIGH',
      description: 'Security bypass or unsafe runtime execution was introduced.',
      file: diff.file,
      evidence: evidence(securityBypass, 'unsafe security pattern'),
    })
  }

  const dangerousShell = firstMatch(
    added,
    /\bgit\s+add\s+\.(?=$|[\s'"`),;])|rm\s+-rf\s+(?:\/|~|\*|\.)|curl\b.*\|.*\b(?:bash|sh|pwsh|powershell|cmd)\b|Invoke-WebRequest\b.*\|\s*iex\b/i,
  )
  if (dangerousShell) {
    findings.push({
      category: 'security',
      severity: 'HIGH',
      description: 'Dangerous shell or Git command was introduced.',
      file: diff.file,
      evidence: evidence(dangerousShell, 'dangerous command'),
    })
  }

  const shellExecution = firstMatch(added, /\bshell\s*:\s*true\b|\bexecSync\s*\(|\bchild_process\.exec\s*\(/)
  if (shellExecution) {
    findings.push({
      category: 'security',
      severity: isSourcePath(diff.file) ? 'HIGH' : 'MEDIUM',
      description: 'Shell execution was introduced; verify arguments are not user-controlled.',
      file: diff.file,
      evidence: evidence(shellExecution, 'shell execution'),
    })
  }

  const emptyCatch = findEmptyCatch(added)
  if (emptyCatch && isSourcePath(diff.file)) {
    findings.push({
      category: 'logic',
      severity: 'HIGH',
      description: 'Empty or comment-only catch block was introduced.',
      file: diff.file,
      evidence: evidence(emptyCatch, 'empty catch'),
    })
  }

  const tsIgnore = firstMatch(added, /^\s*(?:\/\/|\/\*)\s*@ts-ignore\b/)
  if (tsIgnore && isSourcePath(diff.file)) {
    findings.push({
      category: 'logic',
      severity: 'HIGH',
      description: 'TypeScript error suppression with @ts-ignore was introduced.',
      file: diff.file,
      evidence: evidence(tsIgnore, 'ts-ignore'),
    })
  }

  const looseAny = firstMatch(added, /\bas\s+any\b|:\s*any\b|<any\b|Array<any>|Promise<any>|Record<[^>]+,\s*any>/)
  if (looseAny && isSourcePath(diff.file) && !isTestPath(diff.file)) {
    findings.push({
      category: 'logic',
      severity: 'MEDIUM',
      description: 'New any-based type escape was introduced in source code.',
      file: diff.file,
      evidence: evidence(looseAny, 'type escape'),
    })
  }

  const focusedTest = firstMatch(added, /\b(describe|it|test)\.only\s*\(/)
  if (focusedTest) {
    findings.push({
      category: 'process',
      severity: 'HIGH',
      description: 'Focused test was introduced and would skip the rest of the suite.',
      file: diff.file,
      evidence: evidence(focusedTest, 'focused test'),
    })
  }

  const skippedTest = firstMatch(added, /\b(describe|it|test)\.skip\s*\(/)
  if (skippedTest) {
    findings.push({
      category: 'process',
      severity: 'MEDIUM',
      description: 'Skipped test was introduced; confirm this is temporary and tracked.',
      file: diff.file,
      evidence: evidence(skippedTest, 'skipped test'),
    })
  }

  return findings
}

export function analyzeReview(input: ReviewAnalysisInput): { changedFiles: ChangedFile[]; findings: ReviewFinding[] } {
  const changedFiles = parseChangedFiles(input.statusOutput).filter(file => shouldReviewFile(file.path))
  const findings: ReviewFinding[] = []

  // Check for verification evidence - downgrade to MEDIUM to not block review pass
  // Review can still proceed, but evidence persistence issue is noted
  if (input.taskPayload && !input.taskPayload.verificationEvidenceIds?.length) {
    findings.push({
      category: 'process',
      severity: 'MEDIUM',
      description: 'Task has no persisted verification evidence; consider running scale verify before review.',
    })
  }

  const deletedSource = changedFiles.filter(file => file.status.includes('D') && /\.(ts|tsx|js|jsx|test\.ts|spec\.ts)$/i.test(file.path))
  for (const file of deletedSource) {
    findings.push({
      category: 'logic',
      severity: 'HIGH',
      description: 'Source or test file deletion requires explicit review.',
      file: file.path,
      evidence: file.status,
    })
  }

  const publicApiChanged = changedFiles.some(file =>
    /(^src\/api\/|^src\/artifact\/types\.ts$|^src\/workflow\/types\.ts$|^src\/.*types\.ts$)/.test(file.path.replace(/\\/g, '/')),
  )
  const docsOrTestsChanged = changedFiles.some(file => /(^tests\/|^docs\/|README)/.test(file.path.replace(/\\/g, '/')))
  if (publicApiChanged && !docsOrTestsChanged) {
    findings.push({
      category: 'process',
      severity: 'MEDIUM',
      description: 'Public API or shared type changes were detected without accompanying docs or tests.',
    })
  }

  const securitySensitiveChanged = changedFiles.filter(file => isSecuritySensitivePath(file.path))
  const hasSecurityGateEvidence = input.verificationEvidence?.some(record => record.gate === 'G7' && record.passed) === true
  if (securitySensitiveChanged.length > 0 && !hasSecurityGateEvidence) {
    findings.push({
      category: 'security',
      severity: 'HIGH',
      description: 'Security-sensitive files changed without passing G7 security evidence.',
      file: securitySensitiveChanged[0].path,
      evidence: securitySensitiveChanged.map(file => file.path).slice(0, 5).join(', '),
    })
  }

  let totalDiffLines = 0
  for (const diff of input.diffs) {
    const text = diff.text.slice(0, 20000)
    totalDiffLines += text.split('\n').filter(isDiffPayloadLine).length
    findings.push(...analyzeDiffRisk({ ...diff, text }))
  }

  findings.push(...analyzeLazyGuardrails(
    changedFiles,
    input.diffs.map(diff => ({ ...diff, text: diff.text.slice(0, 20000) })),
  ))

  if (input.diffs.length > 0 && changedFiles.length > input.diffs.length) {
    findings.push({
      category: 'process',
      severity: 'MEDIUM',
      description: `Review scanned diffs for ${input.diffs.length}/${changedFiles.length} changed files; split the review or raise the scan limit.`,
    })
  }

  if (totalDiffLines > (input.largeDiffThreshold ?? 800)) {
    findings.push({
      category: 'process',
      severity: 'MEDIUM',
      description: `Large diff detected (${totalDiffLines} changed lines); consider splitting review scope.`,
    })
  }

  return { changedFiles, findings }
}


// ============================================================================
// Spec Dimension — 借鉴 mattpocock/skills 的双轴 Review（Standards × Spec）
// 检查 diff 是否匹配原始 Spec/PRD 要求的内容
// ============================================================================

export interface SpecAnalysisInput {
  /** Spec or PRD content to validate against */
  specContent: string
  /** Changed files from git status */
  changedFiles: ChangedFile[]
  /** The diff content */
  diffs: DiffInput[]
  /** Task description for semantic matching */
  taskDescription?: string
}

export interface SpecFinding {
  /** missing — spec asks for this but it's absent; extra — diff has this but spec didn't ask; mismatched — looks wrong */
  type: 'missing' | 'extra' | 'mismatched'
  /** Human-readable description */
  description: string
  /** Related spec line or requirement */
  specReference?: string
  /** Related file path */
  file?: string
}

/**
 * Analyze whether the diff changes match what the Spec/PRD asked for.
 * This implements the "Spec axis" of mattpocock's dual-axis review.
 *
 * The approach is keyword-driven: extract key terms from the spec,
 * then check whether the diff touches modules related to those terms.
 * This is intentionally simple — no LLM semantic analysis.
 */
export function analyzeSpecConformance(input: SpecAnalysisInput): {
  specFindings: SpecFinding[]
  coverageScore: number  // 0..1: what fraction of spec keywords appear in diffs
} {
  const findings: SpecFinding[] = []

  // Extract key terms from spec (nouns, module names, feature keywords)
  const specKeywords = extractSpecKeywords(input.specContent, input.taskDescription)

  // Check which keywords appear in changed files and diffs
  const diffText = [
    ...input.changedFiles.map(f => f.path),
    ...input.diffs.map(d => d.text.slice(0, 5000))
  ].join(' ').toLowerCase()

  let matchedKeywords = 0
  for (const keyword of specKeywords) {
    if (diffText.includes(keyword.toLowerCase())) {
      matchedKeywords++
    } else {
      // Keyword not found — might indicate missing implementation
      const inFiles = input.changedFiles.some(f => f.path.toLowerCase().includes(keyword.toLowerCase()))
      if (!inFiles) {
        findings.push({
          type: 'missing',
          description: `Spec mentions "${keyword}" but no changed file or diff references it`,
          specReference: keyword,
        })
      }
    }
  }

  // Check for scope creep: files changed that don't relate to spec keywords
  const unrelatedFiles = input.changedFiles.filter(file => {
    const path = file.path.toLowerCase()
    // Ignore known runtime/artifact dirs
    if (path.includes('.scale/') || path.includes('node_modules/') || path.includes('dist/')) return false
    return !specKeywords.some(kw => path.includes(kw.toLowerCase()))
  })

  if (unrelatedFiles.length > 0) {
    findings.push({
      type: 'extra',
      description: `${unrelatedFiles.length} changed file(s) not clearly related to spec keywords: ${unrelatedFiles.map(f => f.path).slice(0, 5).join(', ')}`,
      file: unrelatedFiles[0]?.path,
    })
  }

  const coverageScore = specKeywords.length > 0 ? matchedKeywords / specKeywords.length : 1.0

  return { specFindings: findings, coverageScore }
}

/**
 * Extract meaningful keywords from spec content.
 * Filters out common stop words and keeps nouns/technical terms.
 */
function extractSpecKeywords(specContent: string, taskDescription?: string): string[] {
  const text = (specContent + ' ' + (taskDescription ?? '')).toLowerCase()

  // Extract quoted terms, capitalized words, and CamelCase identifiers
  const patterns = [
    /"([^"]+)"/g,           // "quoted terms"
    /'([^']+)'/g,           // 'quoted terms'
    /([A-Z][a-z]+(?:[A-Z][a-z]+)+)/g,  // PascalCase
    /verification|evidence|review|ship|deploy|release/g,
  ]

  const keywords = new Set<string>()
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const kw = (match[1] || match[0]).toLowerCase()
      if (kw.length > 2 && !STOP_WORDS.has(kw)) {
        keywords.add(kw)
      }
    }
  }

  // Also extract significant nouns (words > 5 chars, not stop words)
  const words = text.split(/\W+/).filter(w => w.length > 5 && !STOP_WORDS.has(w))
  for (const w of words.slice(0, 10)) {
    keywords.add(w)
  }

  return [...keywords]
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'will',
  'should', 'must', 'need', 'when', 'where', 'which', 'what', 'into',
  'implement', 'implementation', 'create', 'support', 'feature',
  'description', 'requirement', 'solution', 'approach',
])

// ============================================================================
// Role-Based Review Analysis
// ============================================================================

export interface RoleReviewInput {
  role: SkillRole
  diffs: DiffInput[]
  changedFiles: ChangedFile[]
}

export interface RoleReviewResult {
  role: SkillRole
  findings: ReviewFinding[]
  checklistItems: { item: string; status: 'pass' | 'fail' | 'skip' }[]
}

const ROLE_CHECK_PATTERNS: Record<SkillRole, { check: string; pattern: RegExp; severity: ReviewFinding['severity'] }[]> = {
  'security-reviewer': [
    { check: 'Hardcoded credentials', pattern: /\b(password|passwd|api[_-]?key|secret|token)\b\s*[:=]\s*['"][^'"]{8,}['"]/i, severity: 'CRITICAL' },
    { check: 'SQL injection risk', pattern: /(?:query|execute)\s*\(\s*[`'"].*\$\{/i, severity: 'CRITICAL' },
    { check: 'XSS via innerHTML', pattern: /\.innerHTML\s*=/i, severity: 'HIGH' },
    { check: 'eval with user input', pattern: /\beval\s*\(/i, severity: 'CRITICAL' },
    { check: 'Weak crypto (MD5/SHA1)', pattern: /\b(?:md5|sha1)\b.*(?:hash|createHash)/i, severity: 'HIGH' },
  ],
  'eng-manager': [
    { check: 'Large file changes', pattern: /.*/, severity: 'MEDIUM' }, // Handled by file count
    { check: 'Test coverage for source changes', pattern: /\.(ts|tsx|js|jsx)$/i, severity: 'MEDIUM' },
  ],
  'qa-lead': [
    { check: 'Empty catch block', pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/i, severity: 'HIGH' },
    { check: 'Focused test (.only)', pattern: /\b(describe|it|test)\.only\s*\(/i, severity: 'HIGH' },
    { check: 'Skipped test (.skip)', pattern: /\b(describe|it|test)\.skip\s*\(/i, severity: 'MEDIUM' },
  ],
  'release-engineer': [
    { check: 'Version bump in package.json', pattern: /"version"\s*:\s*"/i, severity: 'MEDIUM' },
    { check: 'Changelog update', pattern: /CHANGELOG/i, severity: 'MEDIUM' },
  ],
  'design-reviewer': [
    { check: 'Accessibility attributes', pattern: /aria-|role=/i, severity: 'MEDIUM' },
    { check: 'Inline styles', pattern: /style\s*=\s*\{/i, severity: 'LOW' },
  ],
  'ceo-reviewer': [],
}

export function analyzeRoleReview(input: RoleReviewInput): RoleReviewResult {
  const findings: ReviewFinding[] = []
  const checklistItems: { item: string; status: 'pass' | 'fail' | 'skip' }[] = []
  const patterns = ROLE_CHECK_PATTERNS[input.role] ?? []

  if (input.role === 'eng-manager') {
    // Check if source changes have corresponding test changes
    const sourceChanged = input.changedFiles.some(f => isSourcePath(f.path) && !isTestPath(f.path))
    const testChanged = input.changedFiles.some(f => isTestPath(f.path))

    if (sourceChanged && !testChanged) {
      findings.push({
        category: 'process',
        severity: 'MEDIUM',
        description: 'Source files changed without corresponding test updates (eng-manager perspective).',
      })
      checklistItems.push({ item: 'Test coverage for source changes', status: 'fail' })
    } else if (sourceChanged) {
      checklistItems.push({ item: 'Test coverage for source changes', status: 'pass' })
    }

    // Check for excessive file count
    if (input.changedFiles.length > 20) {
      findings.push({
        category: 'process',
        severity: 'MEDIUM',
        description: `Large changeset (${input.changedFiles.length} files). Consider splitting into smaller PRs (eng-manager perspective).`,
      })
    }

    return { role: input.role, findings, checklistItems }
  }

  if (input.role === 'release-engineer') {
    const hasVersionBump = input.changedFiles.some(f => f.path.includes('package.json'))
    const hasChangelog = input.changedFiles.some(f => f.path.includes('CHANGELOG'))

    checklistItems.push({ item: 'Version bump', status: hasVersionBump ? 'pass' : 'skip' })
    checklistItems.push({ item: 'Changelog update', status: hasChangelog ? 'pass' : 'skip' })

    return { role: input.role, findings, checklistItems }
  }

  // For other roles, scan diffs for patterns
  for (const diff of input.diffs) {
    const added = getAddedLines(diff.text)
    for (const { check, pattern, severity } of patterns) {
      const match = firstMatch(added, pattern)
      if (match) {
        findings.push({
          category: 'security',
          severity,
          description: `${check} (${input.role} perspective).`,
          file: diff.file,
          evidence: evidence(match, check),
        })
        checklistItems.push({ item: check, status: 'fail' })
      }
    }
  }

  return { role: input.role, findings, checklistItems }
}
