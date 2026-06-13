import { describe, expect, it } from 'vitest'
import { analyzeReview, parseChangedFiles, shouldReviewFile, summarizeFindings } from '../../src/workflow/ReviewAnalyzer.js'

describe('ReviewAnalyzer', () => {
  it('parses git status changed files', () => {
    expect(parseChangedFiles(' M src/a.ts\n?? src/new file.ts\nD  src/old.ts\n')).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: '??', path: 'src/new file.ts' },
      { status: 'D', path: 'src/old.ts' },
    ])
  })

  it('ignores runtime and binary paths', () => {
    expect(shouldReviewFile('.scale/evidence/a.json')).toBe(false)
    expect(shouldReviewFile('dist/index.js')).toBe(false)
    expect(shouldReviewFile('docs/imgs/logo.png')).toBe(false)
    expect(shouldReviewFile('src/workflow/')).toBe(false)
    expect(shouldReviewFile('src/index.ts')).toBe(true)
  })

  it('flags missing verification evidence as MEDIUM (not blocking)', () => {
    const result = analyzeReview({ statusOutput: ' M src/a.ts', diffs: [], taskPayload: { verificationEvidenceIds: [] } })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'process',
      severity: 'MEDIUM',
      description: expect.stringContaining('verification evidence'),
    }))
  })

  it('flags deleted source files', () => {
    const result = analyzeReview({
      statusOutput: ' D src/removed.ts',
      diffs: [],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'logic',
      severity: 'HIGH',
      file: 'src/removed.ts',
    }))
  })

  it('flags public API changes without docs or tests', () => {
    const result = analyzeReview({
      statusOutput: ' M src/artifact/types.ts',
      diffs: [],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'process',
      severity: 'MEDIUM',
    }))
  })

  it('does not flag public API changes when docs or tests changed', () => {
    const result = analyzeReview({
      statusOutput: ' M src/artifact/types.ts\n M tests/workflow/example.test.ts',
      diffs: [],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings.some(f => f.description.includes('Public API'))).toBe(false)
  })

  it('flags secret-like assignments in diffs', () => {
    const secretLikeDiff = '+const api' + 'Key = "abc123"\n'
    const result = analyzeReview({
      statusOutput: ' M src/config.ts',
      diffs: [{ file: 'src/config.ts', text: secretLikeDiff }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'security',
      severity: 'CRITICAL',
      file: 'src/config.ts',
    }))
  })

  it('flags empty catch blocks in source diffs', () => {
    const result = analyzeReview({
      statusOutput: ' M src/retry.ts',
      diffs: [{ file: 'src/retry.ts', text: '+try { risky() }\n+catch (error) {\n+}\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'logic',
      severity: 'HIGH',
      file: 'src/retry.ts',
      description: expect.stringContaining('Empty'),
    }))
  })

  it('flags TypeScript suppression and source any escapes', () => {
    const result = analyzeReview({
      statusOutput: ' M src/types.ts',
      diffs: [{ file: 'src/types.ts', text: '+// @ts-ignore\n+const payload = input as any\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'logic',
      severity: 'HIGH',
      description: expect.stringContaining('@ts-ignore'),
    }))
    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'logic',
      severity: 'MEDIUM',
      description: expect.stringContaining('any'),
    }))
  })

  it('allows any escapes in tests while still flagging focused tests', () => {
    const result = analyzeReview({
      statusOutput: ' M tests/workflow/example.test.ts',
      diffs: [{ file: 'tests/workflow/example.test.ts', text: '+const value = payload as any\n+it.only("focus", () => {})\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings.some(f => f.description.includes('any'))).toBe(false)
    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'process',
      severity: 'HIGH',
      description: expect.stringContaining('Focused test'),
    }))
  })

  it('flags skipped tests as review debt', () => {
    const result = analyzeReview({
      statusOutput: ' M tests/workflow/example.test.ts',
      diffs: [{ file: 'tests/workflow/example.test.ts', text: '+describe.skip("slow path", () => {})\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'process',
      severity: 'MEDIUM',
      description: expect.stringContaining('Skipped test'),
    }))
  })

  it('flags dangerous shell and git commands', () => {
    const result = analyzeReview({
      statusOutput: ' M scripts/release.ts',
      diffs: [{ file: 'scripts/release.ts', text: '+await run("git add .")\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'security',
      severity: 'HIGH',
      description: expect.stringContaining('Dangerous'),
    }))
  })

  it('flags new shell execution in source files', () => {
    const result = analyzeReview({
      statusOutput: ' M src/workflow/run.ts',
      diffs: [{ file: 'src/workflow/run.ts', text: '+await execa(command, { shell: true })\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'security',
      severity: 'HIGH',
      description: expect.stringContaining('Shell execution'),
    }))
  })

  it('ignores scanner regex definitions that contain risky tokens', () => {
    const result = analyzeReview({
      statusOutput: ' M src/workflow/ReviewAnalyzer.ts',
      diffs: [{
        file: 'src/workflow/ReviewAnalyzer.ts',
        text: [
          '+/.*(?:password|api[_-]?key|secret|shell: true|innerHTML|catch)/i.test(text)',
          '+const fixtureRiskPattern = /(?:password|api[_-]?key|secret|shell: true|innerHTML|catch)/i',
          "+if (/^(?:name|title|description):\\\\s*['\\\"].*(?:dangerouslySetInnerHTML|innerHTML|document\\\\.write|eval\\\\(|new Function|shell:\\\\s*true)/i.test(trimmed)) return true",
          '+const riskyFixtureText = /[\\\'"`].*(?:password|api[_-]?key|secret|curl\\\\b.*\\\\|.*(?:bash|sh)|rm\\\\s+-rf|shell: true|dangerouslySetInnerHTML|eval\\\\(|new Function)/i.test(line)',
          "+  recommendation: 'Sanitize HTML with DOMPurify before passing to dangerouslySetInnerHTML.',",
        ].join('\n'),
      }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings.some(f => f.category === 'security')).toBe(false)
  })

  it('ignores risky test fixture string values while still scanning executable test code', () => {
    const fixtureResult = analyzeReview({
      statusOutput: ' M tests/workflow/gateSystem.test.ts',
      diffs: [{
        file: 'tests/workflow/gateSystem.test.ts',
        text: "+'await execa(command, { shell: true })',\n+'document.body.innerHTML = userHtml',\n",
      }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })
    const executableResult = analyzeReview({
      statusOutput: ' M tests/workflow/example.test.ts',
      diffs: [{ file: 'tests/workflow/example.test.ts', text: '+await execa(command, { shell: true })\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })
    const securityFixtureResult = analyzeReview({
      statusOutput: ' M tests/workflow/gateSystem.test.ts',
      diffs: [{
        file: 'tests/workflow/gateSystem.test.ts',
        text: [
          "+\"{ pattern: /curl\\\\s+.*\\\\|\\\\s*(bash|sh)/i, description: 'curl pipe to shell' },\"",
          "+'/** A real `eval(...)` call or `Function(...)` / `new Function(...)` construction starts on this line. */',",
          "+\"execSync('rm -rf /')\",",
        ].join('\n'),
      }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })
    const templateFixtureResult = analyzeReview({
      statusOutput: ' M tests/workflow/engineeringStandards.test.ts',
      diffs: [{
        file: 'tests/workflow/engineeringStandards.test.ts',
        text: [
          "+write(projectDir, 'src/business/upload.ts', `",
          '+export function unsafe(userHtml: string) {',
          '+  document.body.innerHTML = userHtml',
          '+}',
          '+`)',
        ].join('\n'),
      }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(fixtureResult.findings.some(f => f.category === 'security')).toBe(false)
    expect(securityFixtureResult.findings.some(f => f.category === 'security')).toBe(false)
    expect(templateFixtureResult.findings.some(f => f.category === 'security')).toBe(false)
    expect(executableResult.findings).toContainEqual(expect.objectContaining({
      category: 'security',
      severity: 'HIGH',
      description: expect.stringContaining('Shell execution'),
    }))
  })

  it('requires passing G7 evidence for security-sensitive files', () => {
    const result = analyzeReview({
      statusOutput: ' M src/security/tokens.ts',
      diffs: [{ file: 'src/security/tokens.ts', text: '+export const ttl = 60\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-G0-1'] },
      verificationEvidence: [{ gate: 'G0', passed: true }],
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'security',
      severity: 'HIGH',
      description: expect.stringContaining('G7'),
    }))
  })

  it('accepts security-sensitive files when G7 passed', () => {
    const result = analyzeReview({
      statusOutput: ' M src/security/tokens.ts',
      diffs: [{ file: 'src/security/tokens.ts', text: '+export const ttl = 60\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-G7-1'] },
      verificationEvidence: [{ gate: 'G7', passed: true }],
    })

    expect(result.findings.some(f => f.description.includes('G7'))).toBe(false)
  })

  it('includes untracked files in changed files', () => {
    const result = analyzeReview({
      statusOutput: '?? src/new.ts',
      diffs: [],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.changedFiles).toEqual([{ status: '??', path: 'src/new.ts' }])
  })

  it('excludes untracked directory placeholders while keeping expanded files', () => {
    const result = analyzeReview({
      statusOutput: '?? src/workflow/\n?? src/workflow/index.ts',
      diffs: [],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.changedFiles).toEqual([{ status: '??', path: 'src/workflow/index.ts' }])
  })

  it('flags secret-like assignments in untracked file content', () => {
    const secretLikeDiff = '+const tok' + 'en = "abc123"\n'
    const result = analyzeReview({
      statusOutput: '?? src/new-config.ts',
      diffs: [{ file: 'src/new-config.ts', text: secretLikeDiff }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'security',
      severity: 'CRITICAL',
      file: 'src/new-config.ts',
    }))
  })

  it('flags large diffs', () => {
    const text = Array.from({ length: 6 }, (_, index) => `+line ${index}`).join('\n')
    const result = analyzeReview({
      statusOutput: ' M src/large.ts',
      diffs: [{ file: 'src/large.ts', text }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
      largeDiffThreshold: 5,
    })

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: 'process',
      severity: 'MEDIUM',
    }))
  })

  it('flags partial diff review coverage only when changed files exceed scanned diffs', () => {
    const partial = analyzeReview({
      statusOutput: ' M src/a.ts\n M src/b.ts',
      diffs: [{ file: 'src/a.ts', text: '+const a = 1\n' }],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })
    const complete = analyzeReview({
      statusOutput: ' M src/a.ts\n M src/b.ts',
      diffs: [
        { file: 'src/a.ts', text: '+const a = 1\n' },
        { file: 'src/b.ts', text: '+const b = 1\n' },
      ],
      taskPayload: { verificationEvidenceIds: ['GATE-1'] },
    })

    expect(partial.findings).toContainEqual(expect.objectContaining({
      category: 'process',
      severity: 'MEDIUM',
      description: expect.stringContaining('Review scanned diffs for 1/2 changed files'),
    }))
    expect(complete.findings.some(f => f.description.includes('Review scanned diffs'))).toBe(false)
  })

  it('summarizes finding severity counts', () => {
    const summary = summarizeFindings([
      { category: 'security', severity: 'CRITICAL', description: 'a' },
      { category: 'logic', severity: 'HIGH', description: 'b' },
      { category: 'process', severity: 'MEDIUM', description: 'c' },
      { category: 'style', severity: 'LOW', description: 'd' },
    ])

    expect(summary).toEqual({ critical: 1, high: 1, medium: 1, low: 1 })
  })
})
