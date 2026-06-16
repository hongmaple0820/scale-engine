import { readFileSync } from 'node:fs'

export const FALLBACK_SCALE_ENGINE_VERSION = '0.50.8'

export function getScaleEngineVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { version?: unknown }
    return typeof packageJson.version === 'string' && packageJson.version.trim()
      ? packageJson.version
      : FALLBACK_SCALE_ENGINE_VERSION
  } catch {
    return FALLBACK_SCALE_ENGINE_VERSION
  }
}

export const SCALE_ENGINE_VERSION = getScaleEngineVersion()
