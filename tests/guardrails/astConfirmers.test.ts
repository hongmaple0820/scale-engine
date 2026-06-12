import { describe, expect, it } from 'vitest'
import { createAstConfirmer } from '../../src/guardrails/ast/confirmers.js'

describe('createAstConfirmer (P1.1)', () => {
  it('returns null for unparseable source so callers fail open', () => {
    expect(createAstConfirmer('export function bad( {')).toBeNull()
  })

  it('confirms real eval / Function execution and rejects string/comment occurrences', () => {
    const code = [
      'const a = eval("1 + 1")',          // line 1: real call
      'const b = new Function("return 1")', // line 2: real construction
      'const c = "eval(x)"',              // line 3: string literal
      '// eval(x) in a comment',          // line 4: comment
    ].join('\n')
    const ast = createAstConfirmer(code)!

    expect(ast.hasUnsafeCodeExecution(1)).toBe(true)
    expect(ast.hasUnsafeCodeExecution(2)).toBe(true)
    expect(ast.hasUnsafeCodeExecution(3)).toBe(false)
    expect(ast.hasUnsafeCodeExecution(4)).toBe(false)
  })

  it('confirms @ts-ignore only in real comments', () => {
    const code = [
      '// @ts-ignore',           // line 1: real directive comment
      'const note = "@ts-ignore"', // line 2: string literal
    ].join('\n')
    const ast = createAstConfirmer(code)!

    expect(ast.hasTsIgnore(1)).toBe(true)
    expect(ast.hasTsIgnore(2)).toBe(false)
  })

  it('confirms a real any annotation and rejects the literal text in a string', () => {
    const code = [
      'function f(x: any) { return x }', // line 1: real TSAnyKeyword
      'const s = "value: any here"',     // line 2: string literal
    ].join('\n')
    const ast = createAstConfirmer(code)!

    expect(ast.hasAnyType(1)).toBe(true)
    expect(ast.hasAnyType(2)).toBe(false)
  })

  it('confirms empty (and comment-only) catch blocks, rejecting handled ones', () => {
    const code = [
      'try { a() } catch (e) {}',                 // line 1: empty
      'try { b() } catch (e) { /* ignore */ }',   // line 2: comment-only -> still empty
      'try { c() } catch (e) { log(e) }',         // line 3: handled
    ].join('\n')
    const ast = createAstConfirmer(code)!

    expect(ast.hasEmptyCatch(1)).toBe(true)
    expect(ast.hasEmptyCatch(2)).toBe(true)
    expect(ast.hasEmptyCatch(3)).toBe(false)
  })

  it('parses tsx when jsx is enabled', () => {
    const ast = createAstConfirmer('const el = <div>{value}</div>\nconst x: any = el\n', { jsx: true })
    expect(ast).not.toBeNull()
    expect(ast!.hasAnyType(2)).toBe(true)
  })
})
