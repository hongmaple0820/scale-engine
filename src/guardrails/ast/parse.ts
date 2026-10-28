// SCALE Engine — AST parse layer (P1.1)
// Thin wrapper over @typescript-eslint/typescript-estree used to turn a regex
// "fast pre-filter" hit into a "precise confirmation" against the real AST.
// Parsing is best-effort: any failure returns null so callers can fail open and
// fall back to the regex result (never lose detection coverage).
//
// Loaded lazily on purpose. `@typescript-eslint/typescript-estree` requires
// `typescript` as a *peer*, and package managers configured with
// `autoInstallPeers: false` (pnpm default in some setups, hoisted DSH profiles,
// strict installs) do not provide it. A static import turns that missing peer
// into a MODULE_NOT_FOUND at module-load time, which takes down every caller of
// this file — including the whole workflow layer — instead of degrading. The
// lazy require below keeps the contract this module advertises: no TypeScript
// toolchain means "AST unavailable", not "CLI dead".

import { createRequire } from 'node:module'
import type { TSESTree } from '@typescript-eslint/typescript-estree'

export interface ParsedSource {
  program: TSESTree.Program
  comments: TSESTree.Comment[]
}

type ParseFn = (code: string, options: Record<string, unknown>) => TSESTree.Program

export interface EstreeLoader {
  parse: ParseFn
}

export interface AstParseDeps {
  /** Inject a loader in tests. Returns null when the AST toolchain is unavailable. */
  loadEstree?: () => EstreeLoader | null
}

/** `undefined` = not probed yet, `null` = probed and unavailable. */
let cachedLoader: EstreeLoader | null | undefined

function loadEstree(): EstreeLoader | null {
  if (cachedLoader !== undefined) return cachedLoader
  try {
    const requireFromHere = createRequire(import.meta.url)
    const loaded = requireFromHere('@typescript-eslint/typescript-estree') as
      | (Partial<EstreeLoader> & { default?: Partial<EstreeLoader> })
      | undefined
    const parse = loaded?.parse ?? loaded?.default?.parse
    cachedLoader = typeof parse === 'function' ? { parse: parse as ParseFn } : null
  } catch {
    cachedLoader = null
  }
  return cachedLoader
}

/**
 * Cheap resolvability probe used by diagnostics. Requiring the parser costs
 * ~400ms because it pulls in the TypeScript compiler, which is far too much to
 * pay on every `scale doctor`. Resolution is a faithful proxy here: both sides
 * are pure JavaScript, so the only realistic failure is the missing `typescript`
 * peer, which resolution catches immediately.
 */
function canResolveAstToolchain(): boolean {
  try {
    const requireFromHere = createRequire(import.meta.url)
    requireFromHere.resolve('@typescript-eslint/typescript-estree')
    requireFromHere.resolve('typescript')
    return true
  } catch {
    return false
  }
}

/**
 * Whether the AST layer can actually parse. Exposed so diagnostics can report
 * "regex-only mode" instead of silently losing precision.
 *
 * Defaults to the cheap resolvability probe; pass `loadEstree` to test the real
 * load path.
 */
export function isAstParsingAvailable(deps: AstParseDeps = {}): boolean {
  if (deps.loadEstree) return deps.loadEstree() !== null
  return canResolveAstToolchain()
}

/**
 * Parse TypeScript/JavaScript source into an ESTree AST. Returns null when the
 * source cannot be parsed (non-TS content, syntax errors, unsupported syntax)
 * or when the AST toolchain is not installed.
 *
 * `jsx` should be enabled only for .tsx/.jsx files: enabling it for plain .ts
 * misparses old-style `<Type>value` type assertions as JSX.
 */
export function parseSource(
  code: string,
  options: { jsx?: boolean } = {},
  deps: AstParseDeps = {},
): ParsedSource | null {
  const loader = (deps.loadEstree ?? loadEstree)()
  if (!loader) return null
  try {
    const program = loader.parse(code, {
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
 *
 * Walks the node structurally, so it works on any ESTree-shaped object and does
 * not need the parser to be installed.
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
