import { describe, expect, it } from 'vitest'
import { analyzeTestDiff, parseTestDiff, TestIntegrityGate } from '../../src/workflow/gates/TestIntegrityGate.js'

function diff(body: string): string {
  // Trim a leading newline so test literals can start on their own line.
  return body.replace(/^\n/, '')
}

const ASSERTION_DROP = diff(`
diff --git a/tests/foo.test.ts b/tests/foo.test.ts
index 1111111..2222222 100644
--- a/tests/foo.test.ts
+++ b/tests/foo.test.ts
@@ -1,5 +1,4 @@
 it('works', () => {
-  expect(result).toBe(42)
-  expect(other).toEqual(7)
+  expect(result).toBe(42)
 })
`)

const SKIP_ADDED = diff(`
diff --git a/tests/foo.test.ts b/tests/foo.test.ts
index 1111111..2222222 100644
--- a/tests/foo.test.ts
+++ b/tests/foo.test.ts
@@ -1,1 +1,1 @@
-it('works', () => {
+it.skip('works', () => {
`)

const ONLY_ADDED = diff(`
diff --git a/tests/foo.spec.ts b/tests/foo.spec.ts
index 1111111..2222222 100644
--- a/tests/foo.spec.ts
+++ b/tests/foo.spec.ts
@@ -1,1 +1,1 @@
-describe('suite', () => {
+describe.only('suite', () => {
`)

const WEAKENED = diff(`
diff --git a/src/__tests__/bar.test.ts b/src/__tests__/bar.test.ts
index 1111111..2222222 100644
--- a/src/__tests__/bar.test.ts
+++ b/src/__tests__/bar.test.ts
@@ -1,1 +1,1 @@
-  expect(payload).toEqual({ id: 1, name: 'x' })
+  expect(payload).toEqual(expect.any(Object))
`)

const TIMEOUT_INFLATED = diff(`
diff --git a/tests/slow.test.ts b/tests/slow.test.ts
index 1111111..2222222 100644
--- a/tests/slow.test.ts
+++ b/tests/slow.test.ts
@@ -1,1 +1,2 @@
 import { it } from 'vitest'
+vi.setConfig({ testTimeout: 120000 })
`)

const NON_TEST_ONLY = diff(`
diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-export const a = 1
+export const a = 2
`)

const ASSERTIONS_ADDED = diff(`
diff --git a/tests/foo.test.ts b/tests/foo.test.ts
index 1111111..2222222 100644
--- a/tests/foo.test.ts
+++ b/tests/foo.test.ts
@@ -1,2 +1,4 @@
 it('works', () => {
+  expect(result).toBe(42)
+  expect(other).toEqual(7)
 })
`)

describe('analyzeTestDiff', () => {
  it('flags a net assertion-count drop as a block-severity finding', () => {
    const analysis = analyzeTestDiff(ASSERTION_DROP)
    expect(analysis.assertionCountDelta).toBeLessThan(0)
    const finding = analysis.findings.find(f => f.kind === 'assertion-removed')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('block')
  })

  it('flags newly added skipped tests', () => {
    const analysis = analyzeTestDiff(SKIP_ADDED)
    expect(analysis.findings.some(f => f.kind === 'skip-added' && f.severity === 'block')).toBe(true)
  })

  it('flags newly added focused (.only) tests', () => {
    const analysis = analyzeTestDiff(ONLY_ADDED)
    expect(analysis.findings.some(f => f.kind === 'only-added' && f.severity === 'block')).toBe(true)
  })

  it('flags weakened assertions as warn-severity', () => {
    const analysis = analyzeTestDiff(WEAKENED)
    const finding = analysis.findings.find(f => f.kind === 'weakened-assertion')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('warn')
  })

  it('flags inflated/changed timeouts as warn-severity', () => {
    const analysis = analyzeTestDiff(TIMEOUT_INFLATED)
    const finding = analysis.findings.find(f => f.kind === 'timeout-inflated')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('warn')
  })

  it('ignores non-test files entirely', () => {
    const analysis = analyzeTestDiff(NON_TEST_ONLY)
    expect(analysis.analyzedFiles).toEqual([])
    expect(analysis.findings).toEqual([])
    expect(analysis.assertionCountDelta).toBe(0)
  })

  it('does not flag a net assertion increase', () => {
    const analysis = analyzeTestDiff(ASSERTIONS_ADDED)
    expect(analysis.assertionCountDelta).toBeGreaterThan(0)
    expect(analysis.findings.some(f => f.kind === 'assertion-removed')).toBe(false)
  })
})

describe('parseTestDiff', () => {
  it('parses only lines belonging to test files', () => {
    const mixed = diff(`
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-export const a = 1
+export const a = 2
diff --git a/tests/foo.test.ts b/tests/foo.test.ts
--- a/tests/foo.test.ts
+++ b/tests/foo.test.ts
@@ -1,1 +1,1 @@
-  expect(a).toBe(1)
+  expect(a).toBe(2)
`)
    const parsed = parseTestDiff(mixed)
    expect(parsed.every(line => line.file === 'tests/foo.test.ts')).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
  })
})

describe('TestIntegrityGate', () => {
  it('is advisory by default: passes even when block-severity findings exist', async () => {
    const gate = new TestIntegrityGate({ diff: ASSERTION_DROP })
    const result = await gate.execute()
    expect(result.gate).toBe('G23')
    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.blockers).toEqual([])
    expect(result.evidence).toContain('assertion-removed')
  })

  it('blocks block-severity findings when advisory is disabled', async () => {
    const gate = new TestIntegrityGate({ diff: ASSERTION_DROP, advisory: false })
    const result = await gate.execute()
    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers.length).toBeGreaterThan(0)
  })

  it('passes cleanly when no test files changed', async () => {
    const gate = new TestIntegrityGate({ diff: NON_TEST_ONLY })
    const result = await gate.execute()
    expect(result.passed).toBe(true)
    expect(result.evidence).toContain('No test files changed')
  })

  it('does not block warn-only findings even when advisory is disabled', async () => {
    const gate = new TestIntegrityGate({ diff: WEAKENED, advisory: false })
    const result = await gate.execute()
    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
  })
})
