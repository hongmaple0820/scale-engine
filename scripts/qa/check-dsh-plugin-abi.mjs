#!/usr/bin/env node
// P2-B: assess whether the dsh-scale plugin can use the full (SQLite) engine.
//
// 背景：dsh-scale README 早前声明「DSH 的 Electron ABI(MODULE_VERSION 149) 与主包原生模块(137)
// 不兼容，故插件只走 InMemory/纯函数路径」。但主包自 0.58.0-alpha.2 起把 better-sqlite3 升到
// 13.x 的 N-API 版本——N-API 跨 ABI 稳定，该「不兼容」前提可能已过时。本脚本核对事实并给出结论，
// 供人工在真实 Electron 运行时复核。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const pluginDir = join(repoRoot, 'packages', 'dsh-scale')

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return null }
}

function walkTs(dir) {
  const files = []
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkTs(p))
    else if (entry.name.endsWith('.ts')) files.push(p)
  }
  return files
}

function main() {
  const rootPkg = readJson(join(repoRoot, 'package.json'))
  const sqliteRange = rootPkg?.dependencies?.['better-sqlite3'] ?? rootPkg?.dependencies?.['better' + '-sqlite3'] ?? null
  const majorMatch = String(sqliteRange ?? '').match(/(\d+)/)
  const sqliteMajor = majorMatch ? Number(majorMatch[1]) : null
  const isNapi = sqliteMajor !== null && sqliteMajor >= 13

  const pluginPkg = readJson(join(pluginDir, 'package.json'))
  const pluginSrc = walkTs(join(pluginDir, 'src'))
  const importsSqlite = pluginSrc.some(file => {
    const text = readFileSync(file, 'utf-8')
    return /better-sqlite3|SQLiteArtifactStore|MemoryBrain/.test(text)
  })

  const readmePath = join(pluginDir, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : ''
  const readmeClaimsAbiIncompat = /ABI|MODULE_VERSION|不兼容/.test(readme)

  const abiAssumptionStale = isNapi && readmeClaimsAbiIncompat
  const canGoFull = isNapi

  const report = {
    plugin: pluginPkg?.name ?? 'dsh-scale',
    betterSqlite3Range: sqliteRange,
    sqliteMajor,
    isNapi,
    pluginUsesSqlite: importsSqlite,
    pluginMode: importsSqlite ? 'full (SQLite engine)' : 'degraded (InMemory / pure-function)',
    readmeStillClaimsAbiIncompatibility: readmeClaimsAbiIncompat,
    abiAssumptionStale,
    recommendation: canGoFull
      ? (importsSqlite
        ? 'Plugin already on the full engine; verify in a real Electron (DSH desktop) runtime.'
        : 'better-sqlite3 is N-API (ABI-stable) — the plugin CAN move to the full SQLite engine in DSH. This needs a code change in packages/dsh-scale plus a real Electron runtime verification; document the degraded boundary until then.')
      : 'better-sqlite3 is not N-API; keep the InMemory/pure-function degraded path.',
    verifiedAt: new Date().toISOString(),
  }

  console.log(JSON.stringify(report, null, 2))
}

main()
