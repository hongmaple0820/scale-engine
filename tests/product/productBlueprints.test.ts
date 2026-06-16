import { describe, expect, it } from 'vitest'
import {
  COMMON_PRODUCT_SOLUTION_BLUEPRINTS,
  ENTERPRISE_CODE_ARCHITECTURE_STANDARD,
  ENTERPRISE_LANGUAGE_STANDARDS,
  createProductProjectBlueprintPlan,
  getProductSolutionBlueprint,
  renderProductProjectBlueprintPlanMarkdown,
  renderProductSolutionBlueprintMarkdown,
} from '../../src/product/index.js'

describe('product blueprints', () => {
  it('defines code architecture and language standards for product scaffolds', () => {
    expect(ENTERPRISE_CODE_ARCHITECTURE_STANDARD.layerRules.length).toBeGreaterThanOrEqual(5)
    expect(ENTERPRISE_CODE_ARCHITECTURE_STANDARD.securityRules).toContain('Authentication, authorization, tenant isolation, and license checks are separate policies.')
    expect(ENTERPRISE_LANGUAGE_STANDARDS.map(standard => standard.id)).toEqual([
      'java-spring-standard',
      'vue-typescript-standard',
      'sql-migration-standard',
    ])
  })

  it('includes common product solution, design, and implementation blueprints', () => {
    expect(COMMON_PRODUCT_SOLUTION_BLUEPRINTS.length).toBeGreaterThanOrEqual(5)
    const identity = getProductSolutionBlueprint('identity-auth-rbac')

    expect(identity?.modules).toEqual(['auth-registration-login', 'user-management-rbac'])
    expect(identity?.productDesign.screens).toEqual(expect.arrayContaining(['login', 'user list', 'permission tree']))
    expect(identity?.technicalImplementation.security).toEqual(expect.arrayContaining([
      'rate limit login and registration',
      'admin write audit',
    ]))
    expect(identity?.openSourceReferences.map(reference => reference.label)).toEqual(expect.arrayContaining([
      'RuoYi-Plus',
      'Sa-Token',
      'JHipster',
    ]))
  })

  it('creates a project blueprint plan with generated standard docs', () => {
    const plan = createProductProjectBlueprintPlan({
      solutions: ['identity-auth-rbac', 'license-card-commerce'],
    })

    expect(plan.version).toBe('product-project-blueprint-plan-v1')
    expect(plan.selectedSolutions.map(solution => solution.id)).toEqual([
      'identity-auth-rbac',
      'license-card-commerce',
    ])
    expect(plan.phases.map(phase => phase.id)).toEqual([
      'discovery',
      'architecture',
      'product-design',
      'technical-implementation',
      'verification',
    ])
    expect(plan.generatedFiles.map(file => file.path)).toEqual([
      'docs/product/architecture-standard.md',
      'docs/product/language-standards.md',
      'docs/product/solution-blueprints.md',
      'docs/product/project-plan.md',
    ])
    expect(plan.generatedFiles.find(file => file.path.endsWith('solution-blueprints.md'))?.content)
      .toContain('License key and card-code commerce')
  })

  it('renders markdown for a solution and the complete plan', () => {
    const solution = getProductSolutionBlueprint('license-card-commerce')
    expect(solution).toBeDefined()

    const solutionMarkdown = renderProductSolutionBlueprintMarkdown(solution!)
    const planMarkdown = renderProductProjectBlueprintPlanMarkdown(createProductProjectBlueprintPlan({
      solutions: ['license-card-commerce'],
    }))

    expect(solutionMarkdown).toContain('## Product Design')
    expect(solutionMarkdown).toContain('## Technical Implementation')
    expect(planMarkdown).toContain('# Product Project Plan')
    expect(planMarkdown).toContain('# Product Solution Blueprints')
  })

  it('rejects unknown solution blueprint ids', () => {
    expect(() => createProductProjectBlueprintPlan({
      solutions: ['missing-solution'],
    })).toThrow('Unknown product solution blueprints')
  })
})
