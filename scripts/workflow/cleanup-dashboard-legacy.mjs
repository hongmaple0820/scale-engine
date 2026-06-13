import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const retiredTargets = [
  join(root, 'dist', 'dashboard', 'classic'),
  join(root, 'dist', 'dashboard', 'vue'),
]

for (const target of retiredTargets) {
  rmSync(target, { recursive: true, force: true })
}
