import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GovernancePackId } from './GovernanceTemplatePacks.js'
import { workflowDocPhysicalPath } from '../surface/ScaleSurface.js'

export interface GovernanceLockFile {
  version: 1
  scalePackage: '@hongmaple0820/scale-engine'
  scaleVersion: string
  pack: GovernancePackId
  packVersion: number
  generatedAt: string
  files: GovernanceLockEntry[]
}

export interface GovernanceLockEntry {
  path: string
  sha256: string
  owned: boolean
}

export interface GovernanceLockInput {
  pack: GovernancePackId
  packVersion: number
  scaleVersion: string
  files: Array<{ path: string; owned: boolean; sha256?: string }>
}

export interface GovernanceDriftReport {
  lockExists: boolean
  missing: GovernanceLockEntry[]
  changed: GovernanceLockEntry[]
  clean: GovernanceLockEntry[]
}

export function writeGovernanceLock(projectDir: string, input: GovernanceLockInput): GovernanceLockFile {
  const lock: GovernanceLockFile = {
    version: 1,
    scalePackage: '@hongmaple0820/scale-engine',
    scaleVersion: input.scaleVersion,
    pack: input.pack,
    packVersion: input.packVersion,
    generatedAt: new Date().toISOString(),
    files: input.files
      .filter(file => file.sha256 || existsSync(workflowDocPhysicalPath(projectDir, file.path)))
      .map(file => ({
        path: file.path,
        sha256: file.sha256 ?? hashFile(workflowDocPhysicalPath(projectDir, file.path)),
        owned: file.owned,
      })),
  }
  const target = governanceLockPath(projectDir)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(lock, null, 2) + '\n', 'utf-8')
  return lock
}

export function readGovernanceLock(projectDir: string): GovernanceLockFile | null {
  const target = governanceLockPath(projectDir)
  if (!existsSync(target)) return null
  return JSON.parse(readFileSync(target, 'utf-8')) as GovernanceLockFile
}

export function computeGovernanceDrift(projectDir: string): GovernanceDriftReport {
  const lock = readGovernanceLock(projectDir)
  if (!lock) return { lockExists: false, missing: [], changed: [], clean: [] }

  const missing: GovernanceLockEntry[] = []
  const changed: GovernanceLockEntry[] = []
  const clean: GovernanceLockEntry[] = []

  for (const entry of lock.files.filter(file => file.owned)) {
    // lock keys are logical (docs/workflow/...) — resolve the physical
    // location (docs/workflow legacy or .scale/reports/workflow)
    const target = workflowDocPhysicalPath(projectDir, entry.path)
    if (!existsSync(target)) {
      missing.push(entry)
      continue
    }
    const current = hashFile(target)
    if (current !== entry.sha256) changed.push(entry)
    else clean.push(entry)
  }

  return { lockExists: true, missing, changed, clean }
}

export function governanceLockPath(projectDir: string): string {
  return join(projectDir, '.scale', 'governance.lock.json')
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
