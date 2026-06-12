// SCALE Engine — AST parse layer (P1.1)
// Thin wrapper over @typescript-eslint/typescript-estree used to turn a regex
// "fast pre-filter" hit into a "precise confirmation" against the real AST.
// Parsing is best-effort: any failure returns null so callers can fail open and
// fall back to the regex result (never lose detection coverage).

import { parse, type TSESTree } from '@typescript-eslint/typescript-estree'

export interface ParsedSource {
  program: TSESTree.Program
  comments: TSESTree.Comment[]
}

/**
 * Parse TypeScript/JavaScript source into an ESTree AST. Returns null when the
 * source cannot be parsed (non-TS content, syntax errors, unsupported syntax).
 *
 * `jsx` should be enabled only for .tsx/.jsx files: enabling it for plain .ts
 * misparses old-style `<Type>value` type assertions as JSX.
 */
export function parseSource(code: string, options: { jsx?: boolean } = {}): ParsedSource | null {
  try {
    const program = parse(code, {
      loc: true,
      comment: true,
      jsx: options.jsx ?? false,
      tolerant: false,
    })
    return { program, comments: program.comments ?? [] }
  } catch {
    return null
  }
}

function isNode(value: unknown): value is TSESTree.Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

/**
 * Depth-first walk over every AST node. The `parent` back-reference (when
 * present) is skipped to avoid infinite recursion.
 */
export function walk(node: TSESTree.Node, visit: (node: TSESTree.Node) => void): void {
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit)
    } else if (isNode(value)) {
      walk(value, visit)
    }
  }
}
