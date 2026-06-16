import type { ProductGeneratedFile } from './ProductModuleTemplates.js'

export interface ProjectCodeArchitectureStandard {
  id: string
  name: string
  description: string
  packageLayout: string[]
  layerRules: string[]
  boundaryRules: string[]
  apiRules: string[]
  dataRules: string[]
  securityRules: string[]
  testingRules: string[]
  observabilityRules: string[]
}

export interface ProjectLanguageStandard {
  id: string
  language: string
  appliesTo: string[]
  naming: string[]
  structure: string[]
  errorHandling: string[]
  validation: string[]
  testing: string[]
}

export interface ProductSolutionBlueprint {
  id: string
  name: string
  category: 'identity' | 'commerce' | 'operations' | 'content' | 'platform'
  description: string
  openSourceReferences: Array<{ label: string; url: string; lesson: string }>
  modules: string[]
  productDesign: {
    personas: string[]
    userJourneys: string[]
    screens: string[]
    decisions: string[]
  }
  technicalImplementation: {
    backend: string[]
    frontend: string[]
    dataModel: string[]
    integrations: string[]
    security: string[]
  }
  verification: string[]
}

export interface ProductProjectBlueprintPlan {
  version: 'product-project-blueprint-plan-v1'
  architecture: ProjectCodeArchitectureStandard
  languageStandards: ProjectLanguageStandard[]
  selectedSolutions: ProductSolutionBlueprint[]
  phases: Array<{
    id: string
    name: string
    outcomes: string[]
    requiredArtifacts: string[]
    gates: string[]
  }>
  generatedFiles: ProductGeneratedFile[]
  warnings: string[]
}

export const ENTERPRISE_CODE_ARCHITECTURE_STANDARD: ProjectCodeArchitectureStandard = {
  id: 'enterprise-modular-architecture',
  name: 'Enterprise modular architecture standard',
  description: 'A pragmatic RuoYi-Plus/JHipster/Spring-inspired modular architecture for admin and SaaS products.',
  packageLayout: [
    'modules/<module>/controller',
    'modules/<module>/service',
    'modules/<module>/domain',
    'modules/<module>/repository',
    'modules/<module>/dto',
    'modules/<module>/permission',
    'common/security',
    'common/audit',
    'common/error',
    'common/validation',
  ],
  layerRules: [
    'Controllers only translate HTTP input/output and delegate business decisions to services.',
    'Services own transactions, business invariants, permission decisions, and domain events.',
    'Repositories only access persistence and never return transport DTOs.',
    'DTOs are versioned at the API boundary and never reused as database entities.',
    'Cross-module calls go through service interfaces or domain events, not repository shortcuts.',
  ],
  boundaryRules: [
    'Each product module has a manifest describing capabilities, permissions, routes, data tables, and verification.',
    'Common utilities stay infrastructure-oriented; business policies remain in modules.',
    'Generated module code must be reviewed before it becomes owned business code.',
    'No module may hardcode tenant, role, user, license, or environment values.',
  ],
  apiRules: [
    'REST endpoints use stable resource names, explicit pagination, and structured error codes.',
    'Mutation endpoints write audit events for identity, payment, license, permission, and admin operations.',
    'Public API contracts must define request DTO, response DTO, validation errors, and permission scope.',
  ],
  dataRules: [
    'Every table has an owner module, lifecycle fields, and migration ownership.',
    'Security-sensitive tables include creator/updater, tenant where applicable, and audit correlation id.',
    'Generated schemas are treated as proposal artifacts until reviewed against the target database.',
  ],
  securityRules: [
    'Authentication, authorization, tenant isolation, and license checks are separate policies.',
    'Registration, login, redemption, payment, and admin write flows require rate limit and audit design.',
    'Secrets, tokens, private keys, and default passwords are never generated into source files.',
  ],
  testingRules: [
    'Each module defines happy path, denial path, validation path, and audit path tests.',
    'Generated scaffolds must not be shipped without project-specific integration tests.',
    'Permission and tenant isolation tests are mandatory for identity and admin modules.',
  ],
  observabilityRules: [
    'Important business flows emit structured audit events and operational logs.',
    'Module manifests define dashboards, alerts, and failure categories for production readiness.',
    'External integrations expose timeout, retry, idempotency, and dead-letter behavior.',
  ],
}

export const ENTERPRISE_LANGUAGE_STANDARDS: ProjectLanguageStandard[] = [
  {
    id: 'java-spring-standard',
    language: 'Java / Spring Boot',
    appliesTo: ['backend', 'service', 'domain', 'repository'],
    naming: [
      'Package names are lowercase Java identifiers.',
      'Controller names end with Controller, services end with Service, and request/response objects end with Req/Resp or DTO.',
      'Permission constants are namespaced by module and action.',
    ],
    structure: [
      'One module owns one package subtree under modules/<modulePackage>.',
      'Transaction boundaries live in service methods.',
      'Framework annotations stay near the application boundary.',
    ],
    errorHandling: [
      'Use structured business error codes instead of raw exception messages.',
      'Convert validation and permission failures to stable API errors.',
      'Do not leak database, token, or provider details to end users.',
    ],
    validation: [
      'Validate request DTOs at the boundary.',
      'Validate business invariants again in the service layer.',
      'Rate-limit identity, license redemption, and payment entry points.',
    ],
    testing: [
      'Unit-test business policies.',
      'Integration-test controller, permission, persistence, and audit behavior.',
      'Add migration tests for schema-bearing modules.',
    ],
  },
  {
    id: 'vue-typescript-standard',
    language: 'Vue / TypeScript',
    appliesTo: ['frontend', 'admin-ui', 'form', 'table'],
    naming: [
      'Routes use stable module ids.',
      'API clients are named by resource and action.',
      'Stores are scoped by module and avoid global mutable catch-alls.',
    ],
    structure: [
      'Views compose feature components, API clients, and stores.',
      'Forms declare schema, validation, submit state, and permission state.',
      'Tables declare columns, filters, pagination, bulk actions, and empty/error states.',
    ],
    errorHandling: [
      'Show actionable validation messages and stable error states.',
      'Separate auth expired, permission denied, network failure, and business rejection.',
      'Never expose raw backend stack traces or secrets.',
    ],
    validation: [
      'Mirror backend required fields and formats in form validation.',
      'Disable unavailable actions based on permission and entity state.',
      'Confirm destructive admin operations.',
    ],
    testing: [
      'Test route rendering, form validation, permission visibility, and main submit flows.',
      'Snapshot only stable UI structure, not volatile generated ids.',
      'Use e2e smoke for critical identity and payment flows.',
    ],
  },
  {
    id: 'sql-migration-standard',
    language: 'SQL / migration',
    appliesTo: ['database', 'migration', 'seed-data'],
    naming: [
      'Table names are module-prefixed when collision risk exists.',
      'Indexes describe access pattern and uniqueness intent.',
      'Seed data has an owner, purpose, and rollback path.',
    ],
    structure: [
      'Migrations are append-only and ordered.',
      'Schema, indexes, seed data, and rollback notes are separate sections.',
      'Sensitive fields document retention and masking behavior.',
    ],
    errorHandling: [
      'Migration failure paths are documented before execution.',
      'Destructive changes require backup and rollback evidence.',
    ],
    validation: [
      'Validate nullable, unique, foreign key, and tenant constraints.',
      'Validate license/payment idempotency keys where applicable.',
    ],
    testing: [
      'Run migration up/down or forward-only verification in a disposable database.',
      'Test queries used by paged admin tables.',
    ],
  },
]

export const COMMON_PRODUCT_SOLUTION_BLUEPRINTS: ProductSolutionBlueprint[] = [
  {
    id: 'identity-auth-rbac',
    name: 'Identity, auth, and RBAC center',
    category: 'identity',
    description: 'Registration, login, session, role, menu permission, tenant hook, and admin audit solution.',
    openSourceReferences: [
      { label: 'RuoYi-Plus', url: 'https://github.com/dromara/RuoYi-Vue-Plus', lesson: 'Admin module packaging, RBAC screens, and Spring/Vue enterprise conventions.' },
      { label: 'Sa-Token', url: 'https://github.com/dromara/Sa-Token', lesson: 'Authentication and authorization policy separation.' },
      { label: 'JHipster', url: 'https://github.com/jhipster/generator-jhipster', lesson: 'Generated app conventions, user management, and entity scaffolding.' },
    ],
    modules: ['auth-registration-login', 'user-management-rbac'],
    productDesign: {
      personas: ['visitor', 'registered user', 'tenant admin', 'platform admin'],
      userJourneys: ['register -> verify -> login -> complete profile', 'admin creates role -> grants menu -> audits permission change'],
      screens: ['login', 'register', 'forgot password', 'user list', 'role list', 'permission tree', 'audit log'],
      decisions: ['Separate account status from role assignment.', 'Show permission denial as a product state, not a generic error.'],
    },
    technicalImplementation: {
      backend: ['auth controller', 'session service', 'rbac service', 'permission policy', 'audit event writer'],
      frontend: ['auth pages', 'user table', 'role editor', 'permission tree', 'profile store'],
      dataModel: ['user', 'role', 'permission', 'user_role', 'menu', 'audit_event'],
      integrations: ['captcha provider', 'oauth provider placeholder', 'message provider for verification'],
      security: ['rate limit login and registration', 'lockout policy', 'password reset expiry', 'admin write audit'],
    },
    verification: ['registration happy path', 'login lockout', 'permission denial', 'admin audit write', 'tenant boundary smoke'],
  },
  {
    id: 'license-card-commerce',
    name: 'License key and card-code commerce',
    category: 'commerce',
    description: 'License generation, redemption, quota, expiry, revocation, import/export, and activation audit.',
    openSourceReferences: [
      { label: 'RuoYi-Plus', url: 'https://github.com/dromara/RuoYi-Vue-Plus', lesson: 'Admin CRUD, import/export, and permissioned operations.' },
      { label: 'JHipster', url: 'https://github.com/jhipster/generator-jhipster', lesson: 'Entity generation and lifecycle scaffolding.' },
    ],
    modules: ['license-card-system'],
    productDesign: {
      personas: ['customer', 'support operator', 'finance operator', 'platform admin'],
      userJourneys: ['redeem license -> activate product -> view entitlement', 'operator imports batch -> monitors redemption -> revokes abuse'],
      screens: ['redeem license', 'license list', 'batch import', 'activation detail', 'revocation dialog'],
      decisions: ['Treat expired, duplicate, revoked, and quota-exceeded as distinct states.', 'Expose traceable audit for every redemption decision.'],
    },
    technicalImplementation: {
      backend: ['license service', 'redeem command', 'activation policy', 'batch import job', 'audit event writer'],
      frontend: ['redeem dialog', 'license list', 'batch import table', 'activation detail'],
      dataModel: ['license_key', 'license_batch', 'license_redemption', 'activation_record', 'license_audit_event'],
      integrations: ['payment/order hook placeholder', 'export/import storage'],
      security: ['idempotent redemption', 'rate limit redeem endpoint', 'mask card codes', 'admin revoke audit'],
    },
    verification: ['redeem success', 'duplicate redeem rejection', 'expired key rejection', 'revoked key rejection', 'batch import validation'],
  },
  {
    id: 'audit-and-operation-log',
    name: 'Audit and operation log',
    category: 'operations',
    description: 'Cross-module admin operation audit, security event timeline, and searchable evidence trail.',
    openSourceReferences: [
      { label: 'RuoYi-Plus', url: 'https://github.com/dromara/RuoYi-Vue-Plus', lesson: 'Admin operation log and monitoring conventions.' },
      { label: 'Spring PetClinic', url: 'https://github.com/spring-projects/spring-petclinic', lesson: 'Simple layered Spring application boundaries for understandable examples.' },
    ],
    modules: ['audit-log'],
    productDesign: {
      personas: ['security reviewer', 'tenant admin', 'support operator'],
      userJourneys: ['filter audit events -> inspect actor -> export evidence', 'review suspicious operation -> create follow-up task'],
      screens: ['audit timeline', 'event detail', 'actor activity', 'export dialog'],
      decisions: ['Audit is read-only for most operators.', 'Security-sensitive events are immutable after write.'],
    },
    technicalImplementation: {
      backend: ['audit event writer', 'search service', 'export service', 'retention policy'],
      frontend: ['audit table', 'event detail drawer', 'actor filter', 'export action'],
      dataModel: ['audit_event', 'audit_actor_snapshot', 'audit_export_job'],
      integrations: ['object storage export', 'alert webhook placeholder'],
      security: ['immutable append-only writes', 'mask sensitive payload fields', 'permissioned export'],
    },
    verification: ['audit write on admin mutation', 'masked payload', 'permissioned search', 'export job smoke'],
  },
  {
    id: 'notification-center',
    name: 'Notification center',
    category: 'operations',
    description: 'Email/SMS/in-app notification template, delivery, retry, and user preference solution.',
    openSourceReferences: [
      { label: 'JHipster', url: 'https://github.com/jhipster/generator-jhipster', lesson: 'Generated email and account activation patterns.' },
    ],
    modules: ['notification-center'],
    productDesign: {
      personas: ['end user', 'operator', 'platform admin'],
      userJourneys: ['trigger business event -> select template -> deliver -> track receipt', 'user updates notification preferences'],
      screens: ['template list', 'delivery records', 'preference settings'],
      decisions: ['Separate transactional messages from marketing messages.', 'Expose retry state and failure reason to operators.'],
    },
    technicalImplementation: {
      backend: ['template service', 'delivery dispatcher', 'retry worker', 'preference service'],
      frontend: ['template editor', 'delivery table', 'preference form'],
      dataModel: ['notification_template', 'notification_delivery', 'notification_preference'],
      integrations: ['email provider', 'sms provider', 'webhook provider'],
      security: ['template variable allowlist', 'rate limit external sends', 'mask recipient data'],
    },
    verification: ['template render', 'provider failure retry', 'preference opt-out', 'delivery audit'],
  },
  {
    id: 'tenant-saas-foundation',
    name: 'Tenant SaaS foundation',
    category: 'platform',
    description: 'Tenant isolation, tenant admin, plan limits, and module entitlement foundation.',
    openSourceReferences: [
      { label: 'JHipster', url: 'https://github.com/jhipster/generator-jhipster', lesson: 'Multi-profile generated application conventions and entity boundaries.' },
      { label: 'RuoYi-Plus', url: 'https://github.com/dromara/RuoYi-Cloud-Plus', lesson: 'Cloud/admin platform conventions for enterprise systems.' },
    ],
    modules: ['tenant-foundation'],
    productDesign: {
      personas: ['tenant owner', 'tenant admin', 'platform operator'],
      userJourneys: ['create tenant -> invite admin -> assign plan -> enforce limits'],
      screens: ['tenant list', 'tenant detail', 'plan assignment', 'usage limits'],
      decisions: ['Tenant state is separate from billing state.', 'Plan limits are visible before they block user actions.'],
    },
    technicalImplementation: {
      backend: ['tenant context resolver', 'tenant service', 'plan policy', 'entitlement checker'],
      frontend: ['tenant switcher', 'tenant admin pages', 'plan usage panel'],
      dataModel: ['tenant', 'tenant_member', 'tenant_plan', 'tenant_usage'],
      integrations: ['billing placeholder', 'identity center'],
      security: ['tenant context required on tenant data', 'cross-tenant denial tests', 'admin impersonation audit'],
    },
    verification: ['tenant data isolation', 'plan limit denial', 'tenant admin permission', 'usage counter update'],
  },
]

export function listProductSolutionBlueprints(): ProductSolutionBlueprint[] {
  return COMMON_PRODUCT_SOLUTION_BLUEPRINTS.map(solution => ({
    ...solution,
    openSourceReferences: [...solution.openSourceReferences],
    modules: [...solution.modules],
    productDesign: {
      personas: [...solution.productDesign.personas],
      userJourneys: [...solution.productDesign.userJourneys],
      screens: [...solution.productDesign.screens],
      decisions: [...solution.productDesign.decisions],
    },
    technicalImplementation: {
      backend: [...solution.technicalImplementation.backend],
      frontend: [...solution.technicalImplementation.frontend],
      dataModel: [...solution.technicalImplementation.dataModel],
      integrations: [...solution.technicalImplementation.integrations],
      security: [...solution.technicalImplementation.security],
    },
    verification: [...solution.verification],
  }))
}

export function getProductSolutionBlueprint(id: string): ProductSolutionBlueprint | undefined {
  return listProductSolutionBlueprints().find(solution => solution.id === id)
}

function renderArchitectureStandardMarkdown(architecture: ProjectCodeArchitectureStandard): string {
  return [
    `# ${architecture.name}`,
    '',
    architecture.description,
    '',
    '## Package Layout',
    '',
    architecture.packageLayout.map(item => `- ${item}`).join('\n'),
    '',
    '## Layer Rules',
    '',
    architecture.layerRules.map(item => `- ${item}`).join('\n'),
    '',
    '## Boundary Rules',
    '',
    architecture.boundaryRules.map(item => `- ${item}`).join('\n'),
    '',
    '## API Rules',
    '',
    architecture.apiRules.map(item => `- ${item}`).join('\n'),
    '',
    '## Data Rules',
    '',
    architecture.dataRules.map(item => `- ${item}`).join('\n'),
    '',
    '## Security Rules',
    '',
    architecture.securityRules.map(item => `- ${item}`).join('\n'),
    '',
    '## Testing Rules',
    '',
    architecture.testingRules.map(item => `- ${item}`).join('\n'),
    '',
    '## Observability Rules',
    '',
    architecture.observabilityRules.map(item => `- ${item}`).join('\n'),
    '',
  ].join('\n')
}

function renderLanguageStandardsMarkdown(standards: ProjectLanguageStandard[]): string {
  return [
    '# Language Standards',
    '',
    standards.map(standard => [
      `## ${standard.language}`,
      '',
      `Applies to: ${standard.appliesTo.join(', ')}`,
      '',
      '### Naming',
      standard.naming.map(item => `- ${item}`).join('\n'),
      '',
      '### Structure',
      standard.structure.map(item => `- ${item}`).join('\n'),
      '',
      '### Error Handling',
      standard.errorHandling.map(item => `- ${item}`).join('\n'),
      '',
      '### Validation',
      standard.validation.map(item => `- ${item}`).join('\n'),
      '',
      '### Testing',
      standard.testing.map(item => `- ${item}`).join('\n'),
      '',
    ].join('\n')).join('\n'),
  ].join('\n')
}

export function renderProductSolutionBlueprintMarkdown(solution: ProductSolutionBlueprint): string {
  return [
    `# ${solution.name}`,
    '',
    solution.description,
    '',
    `- id: ${solution.id}`,
    `- category: ${solution.category}`,
    `- modules: ${solution.modules.join(', ')}`,
    '',
    '## Open Source Lessons',
    '',
    solution.openSourceReferences.map(reference => `- ${reference.label}: ${reference.lesson} (${reference.url})`).join('\n'),
    '',
    '## Product Design',
    '',
    '### Personas',
    solution.productDesign.personas.map(item => `- ${item}`).join('\n'),
    '',
    '### User Journeys',
    solution.productDesign.userJourneys.map(item => `- ${item}`).join('\n'),
    '',
    '### Screens',
    solution.productDesign.screens.map(item => `- ${item}`).join('\n'),
    '',
    '### Decisions',
    solution.productDesign.decisions.map(item => `- ${item}`).join('\n'),
    '',
    '## Technical Implementation',
    '',
    '### Backend',
    solution.technicalImplementation.backend.map(item => `- ${item}`).join('\n'),
    '',
    '### Frontend',
    solution.technicalImplementation.frontend.map(item => `- ${item}`).join('\n'),
    '',
    '### Data Model',
    solution.technicalImplementation.dataModel.map(item => `- ${item}`).join('\n'),
    '',
    '### Integrations',
    solution.technicalImplementation.integrations.map(item => `- ${item}`).join('\n'),
    '',
    '### Security',
    solution.technicalImplementation.security.map(item => `- ${item}`).join('\n'),
    '',
    '## Verification',
    '',
    solution.verification.map(item => `- ${item}`).join('\n'),
    '',
  ].join('\n')
}

function renderSolutionsMarkdown(solutions: ProductSolutionBlueprint[]): string {
  return [
    '# Product Solution Blueprints',
    '',
    solutions.map(renderProductSolutionBlueprintMarkdown).join('\n---\n'),
  ].join('\n')
}

function renderProjectPlanMarkdown(plan: ProductProjectBlueprintPlan): string {
  return [
    '# Product Project Plan',
    '',
    `Version: ${plan.version}`,
    '',
    '## Selected Solutions',
    '',
    plan.selectedSolutions.map(solution => `- ${solution.id}: ${solution.name}`).join('\n'),
    '',
    '## Phases',
    '',
    plan.phases.map(phase => [
      `### ${phase.name}`,
      '',
      'Outcomes:',
      phase.outcomes.map(item => `- ${item}`).join('\n'),
      '',
      'Required artifacts:',
      phase.requiredArtifacts.map(item => `- ${item}`).join('\n'),
      '',
      'Gates:',
      phase.gates.map(item => `- ${item}`).join('\n'),
    ].join('\n')).join('\n\n'),
    '',
  ].join('\n')
}

export function createProductProjectBlueprintPlan(options: {
  solutions?: string[]
} = {}): ProductProjectBlueprintPlan {
  const requested = new Set((options.solutions ?? []).map(item => item.trim()).filter(Boolean))
  const allSolutions = listProductSolutionBlueprints()
  const selectedSolutions = requested.size > 0
    ? allSolutions.filter(solution => requested.has(solution.id))
    : allSolutions
  const missing = [...requested].filter(id => !selectedSolutions.some(solution => solution.id === id))
  if (missing.length > 0) throw new Error(`Unknown product solution blueprints: ${missing.join(', ')}`)
  const plan: ProductProjectBlueprintPlan = {
    version: 'product-project-blueprint-plan-v1',
    architecture: ENTERPRISE_CODE_ARCHITECTURE_STANDARD,
    languageStandards: ENTERPRISE_LANGUAGE_STANDARDS,
    selectedSolutions,
    phases: [
      {
        id: 'discovery',
        name: 'Discovery and product framing',
        outcomes: ['target users and business goals are explicit', 'core workflows and acceptance criteria are listed'],
        requiredArtifacts: ['mini-prd.md', 'user-journeys.md', 'solution-selection.md'],
        gates: ['business-goal-defined', 'target-user-defined', 'core-workflow-defined'],
      },
      {
        id: 'architecture',
        name: 'Architecture and module boundary',
        outcomes: ['module ownership is clear', 'code architecture and language standards are selected'],
        requiredArtifacts: ['architecture-standard.md', 'module-manifest.md', 'api-contract.md'],
        gates: ['module-owner-declared', 'boundary-rules-accepted', 'security-policy-declared'],
      },
      {
        id: 'product-design',
        name: 'Product design',
        outcomes: ['screens, states, empty/error cases, and permission states are described'],
        requiredArtifacts: ['product-design.md', 'screen-map.md', 'interaction-states.md'],
        gates: ['critical-screens-listed', 'permission-states-designed', 'error-states-designed'],
      },
      {
        id: 'technical-implementation',
        name: 'Technical implementation',
        outcomes: ['backend, frontend, data, integration, and security tasks are decomposed'],
        requiredArtifacts: ['technical-implementation.md', 'migration-plan.md', 'test-plan.md'],
        gates: ['api-contract-ready', 'data-model-reviewed', 'verification-plan-ready'],
      },
      {
        id: 'verification',
        name: 'Verification and release readiness',
        outcomes: ['happy path, denial path, validation path, audit path, and regression checks are run'],
        requiredArtifacts: ['verification.md', 'security-review.md', 'release-readiness.md'],
        gates: ['tests-passed', 'security-reviewed', 'release-risk-recorded'],
      },
    ],
    generatedFiles: [],
    warnings: [
      'Blueprints are reference standards and generated project artifacts; target projects still need framework-specific implementation and tests.',
      'Open-source references are learning sources, not vendored code. Preserve each project license if code is copied.',
    ],
  }
  plan.generatedFiles = [
    {
      path: 'docs/product/architecture-standard.md',
      kind: 'doc',
      overwrite: false,
      content: renderArchitectureStandardMarkdown(plan.architecture),
    },
    {
      path: 'docs/product/language-standards.md',
      kind: 'doc',
      overwrite: false,
      content: renderLanguageStandardsMarkdown(plan.languageStandards),
    },
    {
      path: 'docs/product/solution-blueprints.md',
      kind: 'doc',
      overwrite: false,
      content: renderSolutionsMarkdown(plan.selectedSolutions),
    },
    {
      path: 'docs/product/project-plan.md',
      kind: 'doc',
      overwrite: false,
      content: renderProjectPlanMarkdown(plan),
    },
  ]
  return plan
}

export function renderProductProjectBlueprintPlanMarkdown(plan: ProductProjectBlueprintPlan): string {
  return [
    renderProjectPlanMarkdown(plan),
    '',
    renderArchitectureStandardMarkdown(plan.architecture),
    '',
    renderLanguageStandardsMarkdown(plan.languageStandards),
    '',
    renderSolutionsMarkdown(plan.selectedSolutions),
  ].join('\n')
}
