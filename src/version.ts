import { readFileSync } from 'node:fs'

export const FALLBACK_SCALE_ENGINE_VERSION = '0.58.0'

export interface ScaleEngineReleaseManifest {
  schemaVersion: number
  package: { name: string; version: string; engines: { node?: string } }
  source: { commit: string | null; dirty: boolean | null }
  build: { timestamp: string | null; node: string | null }
  plugins: { dshScale?: { name: string; version: string; peerDependencies: Record<string, string> } }
}

export function getScaleEngineVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version?: unknown }
    return typeof packageJson.version === 'string' && packageJson.version.trim()
      ? packageJson.version
      : FALLBACK_SCALE_ENGINE_VERSION
  } catch {
    return FALLBACK_SCALE_ENGINE_VERSION
  }
}

/** Read build provenance embedded in the published dist. Source runs report unknown provenance. */
export function getScaleEngineReleaseManifest(): ScaleEngineReleaseManifest {
  try {
    const manifest = JSON.parse(readFileSync(new URL('./release-manifest.json', import.meta.url), 'utf-8')) as ScaleEngineReleaseManifest
    if (manifest.schemaVersion === 1 && manifest.package?.version) return manifest
  } catch {
    // The manifest is generated after compilation and is absent in source mode.
  }

  let packageJson: { name?: string; version?: string; engines?: { node?: string } } = {}
  try {
    packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as typeof packageJson
  } catch {
    // Keep a useful fallback for unusual embedded installations.
  }

  return {
    schemaVersion: 1,
    package: {
      name: packageJson.name ?? '@hongmaple0820/scale-engine',
      version: packageJson.version ?? FALLBACK_SCALE_ENGINE_VERSION,
      engines: packageJson.engines ?? {},
    },
    source: { commit: null, dirty: null },
    build: { timestamp: null, node: null },
    plugins: {},
  }
}

export const SCALE_ENGINE_VERSION = getScaleEngineVersion()
