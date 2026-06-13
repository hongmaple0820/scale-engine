import { cpSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const source = join(root, 'src', 'dashboard', 'spa')
const target = join(root, 'dist', 'dashboard', 'spa')

if (!existsSync(source)) {
  throw new Error(`Dashboard SPA source directory is missing: ${source}`)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
