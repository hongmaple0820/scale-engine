#!/usr/bin/env node
// Install-time native binding self-check.
//
// better-sqlite3 ships a prebuilt .node binary. Up to 11.x that binary was a
// V8 addon compiled for exactly one Node ABI, so a Node major upgrade left
// require('better-sqlite3') succeeding (it only evaluates the JS wrapper) while
// the first `new Database()` failed to dlopen. 13.x is an N-API addon, so the
// binding is ABI-stable, but a missing or unusable prebuild fails the same way.
// Either way the visible symptom is `scale status` reporting DEGRADED while
// `scale doctor` looked healthy; surfacing it at install time turns a confusing
// runtime failure into one readable line.
//
// Contract: never block an install. Every path exits 0.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const RULE = '-'.repeat(70)

function report(lines) {
  console.warn(`\n${RULE}`)
  for (const line of lines) console.warn(line)
  console.warn(`${RULE}\n`)
}

const runtime = `Node ${process.version} (ABI ${process.versions.modules})`

let Database
try {
  Database = require('better-sqlite3')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  // Not installed at all (trimmed install / --omit=dev): nothing to check.
  if (message.includes("Cannot find module 'better-sqlite3'")) {
    process.exit(0)
  }
  report([
    '[scale] better-sqlite3 could not be loaded.',
    `[scale] Runtime: ${runtime}`,
    `[scale] ${message.split('\n')[0]}`,
    '[scale] Fix: npm rebuild better-sqlite3',
  ])
  process.exit(0)
}

try {
  const db = new Database(':memory:')
  db.close()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const compiledFor = /NODE_MODULE_VERSION (\d+)/.exec(message)?.[1]
  report([
    '[scale] better-sqlite3 native binding does not match this Node runtime.',
    `[scale] Runtime:            ${runtime}`,
    compiledFor
      ? `[scale] Binding compiled for: NODE_MODULE_VERSION ${compiledFor}`
      : '[scale] Binding ABI:        could not be parsed from the loader error',
    '[scale] Impact: artifact store, dashboard, and knowledge base are unavailable;',
    '[scale]         `scale status` reports DEGRADED even though the CLI starts.',
    '[scale] Fix:    npm rebuild better-sqlite3',
    '[scale] Alt:    run SCALE on the Node major version that built this binding.',
  ])
}
