import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('spec-kit preset (P3-B)', () => {
  const path = join(process.cwd(), 'integrations', 'spec-kit-preset', 'preset.yaml')

  it('is valid YAML with required metadata and steps', () => {
    const doc = yaml.load(readFileSync(path, 'utf-8')) as Record<string, unknown>
    expect(doc.name).toBe('scale-verification')
    expect(typeof doc.version).toBe('string')
    expect(typeof doc.description).toBe('string')
    expect(Array.isArray(doc.steps)).toBe(true)
  })

  it('declares the effort-tuned verification and isolated review steps', () => {
    const doc = yaml.load(readFileSync(path, 'utf-8')) as { steps: Array<{ id: string; command: string }> }
    const ids = doc.steps.map(s => s.id)
    expect(ids).toContain('verify-effort')
    expect(ids).toContain('review-isolated')
    expect(doc.steps.find(s => s.id === 'review-isolated')!.command).toContain('--isolated')
  })
})
