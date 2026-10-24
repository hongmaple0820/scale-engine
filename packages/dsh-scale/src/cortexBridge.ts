// dsh-scale: Cortex Bridge — system prompt instinct injection
// Uses SCALE's own InstinctStore + SessionInjector so the on-disk format is
// read by the code that writes it (<domain>/<id>.yaml, .audit.jsonl — plan §3.3).
// The earlier hand-rolled reader expected manifest.json + flat .md files,
// which InstinctStore never writes: it silently matched zero instincts.

import { join } from 'node:path'
import { InstinctStore, SessionInjector } from '@hongmaple0820/scale-engine'

export interface CortexContextEntry {
  id: string
  content: string
  order: number
}

/**
 * Build the single systemPrompt.context entry for a project.
 *
 * buildMinimal() always returns at least the evidence-discipline contract;
 * high-confidence instincts (≥0.7, plan §3.3) are appended when present.
 * Returns null only if the injection cannot be built at all (graceful degrade).
 *
 * Note: SessionInjector.loadScopedSpecs resolves .scale/specs against
 * process.cwd(), not projectDir — single-project deployments where the DSH
 * session cwd === projectDir get the full injection (plan §6 T1.2 caveat).
 */
export function buildCortexContext(projectDir: string): CortexContextEntry | null {
  try {
    // createDirs: false — reading must never mint a .scale/instincts directory
    const store = new InstinctStore(join(projectDir, '.scale', 'instincts'), { createDirs: false })
    const injector = new SessionInjector(store)
    const injection = injector.buildMinimal()
    if (!injection?.content?.trim()) return null
    return { id: 'scale-cortex', content: injection.content, order: 900 }
  } catch {
    // Instinct store unreadable → no injection; Shield and Evidence stay up
    return null
  }
}
