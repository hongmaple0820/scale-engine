// SCALE Engine — P1-D evals-in-CI 金数据集（确定性层）
//
// 2026 共识（Anthropic AI-native SDLC playbook / EDD pattern）：把版本化金案例
// 作为 CI 合并门禁。本模块实现「确定性层」——对仓库关键产物做**不需要模型**的
// 结构断言（file-exists / json-field / text-contains / markdown-section / regex），
// 在 PR 级快速跑、失败即拦。model-in-loop 层是后续 roadmap。
//
// 纯函数：给定金集 + 项目根，产出可复现的 pass/fail 报告。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type GoldenAssertionType =
  | 'file-exists'
  | 'json-field'
  | 'text-contains'
  | 'markdown-section'
  | 'regex'

export type GoldenFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'

export interface GoldenAssertion {
  type: GoldenAssertionType
  /** 项目根相对路径。 */
  path: string
  /** json-field：点路径（如 "bin.scale"、"scripts.build"）。 */
  field?: string
  /** json-field：期望值（精确比较）。 */
  equals?: unknown
  /** json-field：期望类型（无 equals 时校验类型）。 */
  fieldType?: GoldenFieldType
  /** text-contains / markdown-section：需包含的文本/标题片段。 */
  contains?: string
  /** regex：JavaScript 正则源码（无前导斜杠）。 */
  pattern?: string
  /** 说明，便于失败定位。 */
  description?: string
}

export interface GoldenCase {
  id: string
  description: string
  assertions: GoldenAssertion[]
}

export interface GoldenSuite {
  version: number
  id: string
  name: string
  cases: GoldenCase[]
}

export interface GoldenAssertionResult {
  assertion: GoldenAssertion
  passed: boolean
  detail: string
}

export interface GoldenCaseResult {
  id: string
  description: string
  passed: boolean
  assertions: GoldenAssertionResult[]
}

export interface GoldenReport {
  suiteId: string
  suiteName: string
  cases: GoldenCaseResult[]
  totalAssertions: number
  passedAssertions: number
  failedAssertions: number
  ok: boolean
}

function readText(projectDir: string, relPath: string): string | null {
  try {
    const abs = join(projectDir, relPath)
    if (!existsSync(abs)) return null
    return readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}

function getByPath(obj: unknown, dotPath: string): unknown {
  let current: unknown = obj
  for (const segment of dotPath.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function typeOfValue(value: unknown): GoldenFieldType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as GoldenFieldType
}

function checkAssertion(projectDir: string, assertion: GoldenAssertion): GoldenAssertionResult {
  const fail = (detail: string): GoldenAssertionResult => ({ assertion, passed: false, detail })

  if (assertion.type === 'file-exists') {
    const abs = join(projectDir, assertion.path)
    return existsSync(abs)
      ? { assertion, passed: true, detail: `exists: ${assertion.path}` }
      : fail(`missing file: ${assertion.path}`)
  }

  const text = readText(projectDir, assertion.path)
  if (text === null) return fail(`cannot read: ${assertion.path}`)

  if (assertion.type === 'text-contains') {
    const needle = assertion.contains ?? ''
    return text.includes(needle)
      ? { assertion, passed: true, detail: `${assertion.path} contains "${needle}"` }
      : fail(`${assertion.path} does not contain "${needle}"`)
  }

  if (assertion.type === 'markdown-section') {
    const needle = assertion.contains ?? ''
    const hasHeading = text.split(/\r?\n/).some(line => /^#{1,6}\s/.test(line) && line.includes(needle))
    return hasHeading
      ? { assertion, passed: true, detail: `${assertion.path} has a heading containing "${needle}"` }
      : fail(`${assertion.path} has no heading containing "${needle}"`)
  }

  if (assertion.type === 'regex') {
    const re = new RegExp(assertion.pattern ?? '(?!)')
    return re.test(text)
      ? { assertion, passed: true, detail: `${assertion.path} matches /${assertion.pattern}/` }
      : fail(`${assertion.path} does not match /${assertion.pattern}/`)
  }

  if (assertion.type === 'json-field') {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return fail(`invalid JSON: ${assertion.path}`)
    }
    if (!assertion.field) return fail('json-field assertion missing "field"')
    const value = getByPath(parsed, assertion.field)
    if (value === undefined) return fail(`${assertion.path}: field "${assertion.field}" is undefined`)
    if (assertion.equals !== undefined) {
      const ok = JSON.stringify(value) === JSON.stringify(assertion.equals)
      return ok
        ? { assertion, passed: true, detail: `${assertion.field} = ${JSON.stringify(value)}` }
        : fail(`${assertion.field} expected ${JSON.stringify(assertion.equals)} got ${JSON.stringify(value)}`)
    }
    if (assertion.fieldType) {
      const actual = typeOfValue(value)
      return actual === assertion.fieldType
        ? { assertion, passed: true, detail: `${assertion.field} is ${actual}` }
        : fail(`${assertion.field} expected type ${assertion.fieldType} got ${actual}`)
    }
    return { assertion, passed: true, detail: `${assertion.field} present` }
  }

  return fail(`unknown assertion type: ${String((assertion as { type?: unknown }).type)}`)
}

export function runGoldenSuite(suite: GoldenSuite, projectDir: string): GoldenReport {
  const cases: GoldenCaseResult[] = suite.cases.map(goldenCase => {
    const assertions = goldenCase.assertions.map(a => checkAssertion(projectDir, a))
    return {
      id: goldenCase.id,
      description: goldenCase.description,
      passed: assertions.every(a => a.passed),
      assertions,
    }
  })
  const totalAssertions = cases.reduce((n, c) => n + c.assertions.length, 0)
  const passedAssertions = cases.reduce((n, c) => n + c.assertions.filter(a => a.passed).length, 0)
  return {
    suiteId: suite.id,
    suiteName: suite.name,
    cases,
    totalAssertions,
    passedAssertions,
    failedAssertions: totalAssertions - passedAssertions,
    ok: cases.every(c => c.passed),
  }
}
