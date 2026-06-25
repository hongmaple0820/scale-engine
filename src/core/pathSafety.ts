import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

function normalizeBoundaryPath(path: string): string {
  const resolved = resolve(path)
  if (!existsSync(resolved)) return resolved
  return typeof realpathSync.native === 'function' ? realpathSync.native(resolved) : realpathSync(resolved)
}

export function isPathWithinRoot(root: string, target: string): boolean {
  const normalizedRoot = normalizeBoundaryPath(root)
  const normalizedTarget = normalizeBoundaryPath(target)
  const rel = relative(normalizedRoot, normalizedTarget)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

export function resolvePathWithinRoots(inputPath: string, options: {
  baseDir: string
  allowedRoots: string[]
  label: string
}): string {
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(options.baseDir, inputPath)
  const normalizedPath = normalizeBoundaryPath(resolvedPath)
  if (options.allowedRoots.some(root => isPathWithinRoot(root, normalizedPath))) return normalizedPath
  throw new Error(`${options.label} path escapes allowed directories: ${inputPath}`)
}
