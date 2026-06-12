// SCALE Engine — AST confirmers (P1.1)
// Each confirmer turns a regex pre-filter hit (a 1-based line number) into a
// precise yes/no by matching the real AST node, so occurrences inside string
// literals or comments no longer produce false positives.
//
// Architecture (decision B1): AST only *narrows* regex results — it never adds
// findings the regex did not already flag. When the file cannot be parsed the
// caller falls back to the raw regex result (fail open).

import { parseSource, walk } from './parse.js'
import type { TSESTree } from '@typescript-eslint/typescript-estree'

export interface AstConfirmer {
  /** A real `eval(...)` call or `Function(...)` / `new Function(...)` construction starts on this line. */
  hasUnsafeCodeExecution(line: number): boolean
  /** A `@ts-ignore` / `@ts-nocheck` directive appears in an actual comment on this line. */
  hasTsIgnore(line: number): boolean
  /** A real `any` type annotation (TSAnyKeyword) appears on this line. */
  hasAnyType(line: number): boolean
  /** An empty (or comment-only) catch block starts on this line. */
  hasEmptyCatch(line: number): boolean
}

interface LineIndex {
  unsafeExec: Set<number>
  anyType: Set<number>
  emptyCatch: Set<number>
  tsIgnore: Set<number>
}

function identifierName(node: TSESTree.Node | null | undefined): string | undefined {
  return node && node.type === 'Identifier' ? node.name : undefined
}

/**
 * Build a confirmer for one source file. Parses once and pre-collects, per line,
 * the set of lines carrying each construct. Returns null when parsing fails so
 * the caller can fall back to the regex result.
 */
export function createAstConfirmer(code: string, options: { jsx?: boolean } = {}): AstConfirmer | null {
  const parsed = parseSource(code, options)
  if (!parsed) return null

  const index: LineIndex = {
    unsafeExec: new Set(),
    anyType: new Set(),
    emptyCatch: new Set(),
    tsIgnore: new Set(),
  }

  walk(parsed.program, node => {
    switch (node.type) {
      // Mirror the regex pre-filter exactly (`eval(` | `new Function(`): the
      // confirmer must not be broader than the regex, otherwise it carries
      // dead branches that can never fire (AST is only consulted on a regex
      // hit). Bare `Function(...)` calls are intentionally a follow-up — adding
      // them requires widening the regex too, which is a detection-scope change.
      case 'CallExpression':
        if (identifierName(node.callee) === 'eval') {
          index.unsafeExec.add(node.callee.loc.start.line)
        }
        break
      case 'NewExpression':
        if (identifierName(node.callee) === 'Function') {
          index.unsafeExec.add(node.callee.loc.start.line)
        }
        break
      case 'TSAnyKeyword':
        index.anyType.add(node.loc.start.line)
        break
      case 'CatchClause':
        // body is a BlockStatement; comment-only blocks have zero statements.
        if (node.body.body.length === 0) index.emptyCatch.add(node.loc.start.line)
        break
      default:
        break
    }
  })

  for (const comment of parsed.comments) {
    if (/@ts-(?:ignore|nocheck|expect-error)\b/.test(comment.value)) {
      index.tsIgnore.add(comment.loc.start.line)
    }
  }

  return {
    hasUnsafeCodeExecution: line => index.unsafeExec.has(line),
    hasTsIgnore: line => index.tsIgnore.has(line),
    hasAnyType: line => index.anyType.has(line),
    hasEmptyCatch: line => index.emptyCatch.has(line),
  }
}
