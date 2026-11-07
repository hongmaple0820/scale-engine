// SCALE Engine — P4-D property-based 验收检查模板
//
// Kiro 方向：对「数值/状态类」验收标准生成 property 断言模板，而不只是「跑一次测试」。
// 输入是 P1-B AcceptanceCompiler 产出的 kind==='property' 的 check，输出可粘贴的
// property-based 断言骨架（fast-check / vitest 风格）。纯函数。

import type { AcceptanceCheck } from '../spec/AcceptanceCompiler.js'

export type PropertyFramework = 'fast-check' | 'vitest'

export interface PropertyTemplate {
  checkId: string
  clauseId: string
  framework: PropertyFramework
  /** 生成的断言骨架（含 TODO 提示，不假装可运行）。 */
  template: string
  rationale: string
}

export interface PropertyTemplateOptions {
  framework?: PropertyFramework
}

export function generatePropertyTemplate(
  check: AcceptanceCheck,
  options: PropertyTemplateOptions = {},
): PropertyTemplate | null {
  if (check.kind !== 'property') return null
  const framework = options.framework ?? 'fast-check'
  const id = check.checkId

  if (framework === 'vitest') {
    return {
      checkId: check.checkId,
      clauseId: check.clauseId,
      framework,
      rationale: 'Measurable threshold → table-driven vitest case with explicit numeric bounds.',
      template: [
        `// ${check.clauseId}: ${check.clauseText}`,
        `test('${id}', () => {`,
        `  // TODO: replace sample with the real measured value source`,
        `  const sample = [/* measured values */]`,
        `  for (const value of sample) {`,
        `    expect(value).toBeLessThanOrEqual(/* threshold from clause */ 0)`,
        `  }`,
        `})`,
      ].join('\n'),
    }
  }

  return {
    checkId: check.checkId,
    clauseId: check.clauseId,
    framework: 'fast-check',
    rationale: 'Measurable threshold → property-based assertion over generated inputs.',
    template: [
      `// ${check.clauseId}: ${check.clauseText}`,
      `import fc from 'fast-check'`,
      `test.prop([fc.integer({ min: 0, max: 1_000_000 })])('${id}', (n) => {`,
      `  // TODO: invoke the real subject under test with n`,
      `  const result = /* call subject */ n`,
      `  expect(/* measured */ result).toBeLessThanOrEqual(/* threshold */ 0)`,
      `})`,
    ].join('\n'),
  }
}

export function generatePropertyTemplates(
  checks: AcceptanceCheck[],
  options: PropertyTemplateOptions = {},
): PropertyTemplate[] {
  return checks
    .map(check => generatePropertyTemplate(check, options))
    .filter((template): template is PropertyTemplate => template !== null)
}
