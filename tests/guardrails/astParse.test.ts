import { describe, expect, it } from 'vitest'
import {
  isAstParsingAvailable,
  parseSource,
  walk,
  type EstreeLoader,
} from '../../src/guardrails/ast/parse.js'

// The AST layer must degrade, never explode. `@typescript-eslint/typescript-estree`
// requires `typescript` as a peer; strict package managers (pnpm with
// `autoInstallPeers: false`, hoisted profile installs) skip it. A static import
// used to turn that into MODULE_NOT_FOUND at module-load time, killing every
// caller of the workflow layer instead of just losing AST precision.
describe('guardrails/ast/parse — toolchain absence', () => {
  it('reports unavailable and returns null instead of throwing when the loader is null', () => {
    const unavailable = () => null

    expect(isAstParsingAvailable({ loadEstree: unavailable })).toBe(false)
    expect(parseSource('const a = 1', {}, { loadEstree: unavailable })).toBeNull()
  })

  it('reports available when a loader is injected', () => {
    const loader: EstreeLoader = { parse: () => ({ type: 'Program', body: [], comments: [] }) as never }

    expect(isAstParsingAvailable({ loadEstree: () => loader })).toBe(true)
  })

  it('parses through an injected loader', () => {
    const loader: EstreeLoader = {
      parse: () => ({ type: 'Program', body: [], comments: [{ type: 'Line', value: ' hi' }] }) as never,
    }

    expect(parseSource('// hi', {}, { loadEstree: () => loader })).toEqual({
      program: { type: 'Program', body: [], comments: [{ type: 'Line', value: ' hi' }] },
      comments: [{ type: 'Line', value: ' hi' }],
    })
  })

  it('fails open to null when the parser throws', () => {
    const loader: EstreeLoader = {
      parse: () => {
        throw new SyntaxError('unexpected token')
      },
    }

    expect(parseSource('export function bad( {', {}, { loadEstree: () => loader })).toBeNull()
  })

  it('walks ESTree-shaped nodes without needing the parser installed', () => {
    const seen: string[] = []
    walk({ type: 'Program', body: [{ type: 'ExpressionStatement' }] } as never, node => seen.push(node.type))

    expect(seen).toEqual(['Program', 'ExpressionStatement'])
  })
})
