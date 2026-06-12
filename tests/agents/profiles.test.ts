// SCALE Engine — Agent Profiles Tests

import { describe, it, expect } from 'vitest'
import { PROFESSIONAL_AGENTS, getProfile, getProfilesByDomain, getProfilesByRole, listProfiles } from '../../src/agents/profiles.js'
import { EVIDENCE_DISCIPLINE_PROMPT } from '../../src/agents/evidenceDiscipline.js'

describe('Agent Profiles', () => {
  it('should have 12 predefined agents', () => {
    expect(PROFESSIONAL_AGENTS.length).toBe(12)
  })

  it('should include frontend-agent', () => {
    expect(getProfile('frontend-agent')).toBeDefined()
    expect(getProfile('frontend-agent')?.name).toBe('Frontend Developer')
    expect(getProfile('frontend-agent')?.domain).toBe('frontend')
    expect(getProfile('frontend-agent')?.inheritsRole).toBe('Implementer')
  })

  it('should include backend-agent', () => {
    expect(getProfile('backend-agent')).toBeDefined()
    expect(getProfile('backend-agent')?.name).toBe('Backend Developer')
  })

  it('should include test-agent', () => {
    expect(getProfile('test-agent')).toBeDefined()
    expect(getProfile('test-agent')?.inheritsRole).toBe('Verifier')
    expect(getProfile('test-agent')?.preferredModel).toBe('fast')
  })

  // ===== 新增 Agent 测试 =====
  it('should include database-agent', () => {
    expect(getProfile('database-agent')).toBeDefined()
    expect(getProfile('database-agent')?.name).toBe('Database Specialist')
    expect(getProfile('database-agent')?.domain).toBe('database')
    expect(getProfile('database-agent')?.capabilities).toContain('migration')
    expect(getProfile('database-agent')?.capabilities).toContain('schema-design')
  })

  it('should include performance-agent', () => {
    expect(getProfile('performance-agent')).toBeDefined()
    expect(getProfile('performance-agent')?.name).toBe('Performance Engineer')
    expect(getProfile('performance-agent')?.domain).toBe('performance')
    expect(getProfile('performance-agent')?.inheritsRole).toBe('Verifier')
    expect(getProfile('performance-agent')?.preferredModel).toBe('powerful')
  })

  it('should include docs-agent', () => {
    expect(getProfile('docs-agent')).toBeDefined()
    expect(getProfile('docs-agent')?.name).toBe('Documentation Specialist')
    expect(getProfile('docs-agent')?.domain).toBe('documentation')
    expect(getProfile('docs-agent')?.preferredModel).toBe('fast')
  })

  it('should include architect-agent', () => {
    expect(getProfile('architect-agent')).toBeDefined()
    expect(getProfile('architect-agent')?.name).toBe('Software Architect')
    expect(getProfile('architect-agent')?.domain).toBe('architecture')
    expect(getProfile('architect-agent')?.inheritsRole).toBe('Planner')
    expect(getProfile('architect-agent')?.capabilities).toContain('system-design')
  })

  it('should get profiles by domain', () => {
    const frontendProfiles = getProfilesByDomain('frontend')
    expect(frontendProfiles.length).toBe(1)
    expect(frontendProfiles[0].id).toBe('frontend-agent')

    const databaseProfiles = getProfilesByDomain('database')
    expect(databaseProfiles.length).toBe(1)
    expect(databaseProfiles[0].id).toBe('database-agent')
  })

  it('should get profiles by role', () => {
    const implementers = getProfilesByRole('Implementer')
    expect(implementers.length).toBe(3) // frontend-agent, backend-agent, database-agent
  })

  // ===== P1.3: 证据纪律 addendum =====
  it('should carry the shared evidence-discipline addendum on all 12 profiles', () => {
    expect(EVIDENCE_DISCIPLINE_PROMPT).toContain('证据纪律')
    for (const profile of PROFESSIONAL_AGENTS) {
      expect(profile.systemPromptAddendum).toBe(EVIDENCE_DISCIPLINE_PROMPT)
    }
    expect(getProfile('frontend-agent')?.systemPromptAddendum).toBe(EVIDENCE_DISCIPLINE_PROMPT)
  })

  it('should list all profile IDs', () => {
    const ids = listProfiles()
    expect(ids.length).toBe(12)
    expect(ids).toContain('frontend-agent')
    expect(ids).toContain('backend-agent')
    expect(ids).toContain('database-agent')
    expect(ids).toContain('performance-agent')
    expect(ids).toContain('docs-agent')
    expect(ids).toContain('architect-agent')
  })
})
