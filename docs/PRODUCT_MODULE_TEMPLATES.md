# Product Module Templates

Product work often needs repeated modules such as registration/login, license-key cards, and user management. SCALE now exposes these as reusable module templates instead of one-off copy work.

## Project Blueprints

Reusable modules are not enough by themselves. `scale product blueprint` adds the project-level assets that should sit around module generation:

- code architecture standard
- Java/Spring, Vue/TypeScript, and SQL migration language standards
- common solution blueprints
- product design plan
- technical implementation plan
- verification and release gates

Dry-run:

```bash
scale product blueprint --solutions identity-auth-rbac,license-card-commerce
```

Write blueprint documents:

```bash
scale product blueprint --solutions identity-auth-rbac,license-card-commerce --output .scale/generated/product-blueprint --write
```

Generated files:

- `docs/product/architecture-standard.md`
- `docs/product/language-standards.md`
- `docs/product/solution-blueprints.md`
- `docs/product/project-plan.md`

Built-in solution blueprints currently cover:

- identity/auth/RBAC
- license-key/card-code commerce
- audit and operation log
- notification center
- tenant SaaS foundation

## Governance Template Packs

`scale install` can now select project-level governance packs before any module scaffold is generated:

| Pack | Use when | Generated guidance |
| --- | --- | --- |
| `frontend-app` | React/Vue/Next/Vite user-facing apps | UI boundary, visual evidence, accessibility and product smoke expectations |
| `node-library` | npm packages and Node libraries | package build/test/pack checks and workflow wrappers |
| `enterprise-admin` | RuoYi-Vue-Plus-style enterprise admin products | RBAC, tenant, audit, module ownership, architecture standard |
| `spring-vue-admin` | Spring Boot + Vue admin systems | backend layering, frontend route/API boundaries, SQL migration review |
| `microservice-platform` | gateway/auth/admin/worker/shared-package platforms | service ownership, contract review, release ordering |
| `python-service` | Python API, worker, data or CLI projects | environment, static check and targeted test gates |
| `desktop-app` | Electron/Tauri apps | OS access, installer, secret storage, cross-platform path review |
| `agent-os-workbench` | Agent OS products | tools, memory, sessions, dashboard, runtime evidence and local-first provider routing |

These packs write governance documents and policy files. They do not vendor upstream source code.

## Existing Project Onboarding

For mature or legacy projects, start by making the current state explicit. `scale product onboard-existing` scans the target project, builds a codebase map, and generates the planning artifacts a development agent should read before changing old code.

Dry-run:

```bash
scale product onboard-existing --dir . --project LegacyApp --mode legacy --max-files 500
```

Write onboarding documents:

```bash
scale product onboard-existing --dir . --project LegacyApp --mode legacy --output .scale/generated/existing-project --write
```

Generated files:

- `docs/project/codebase-map.md`
- `docs/project/project-plan.md`
- `docs/project/module-boundaries.md`
- `docs/project/legacy-risk-register.md`
- `docs/project/development-guide.md`

Supported modes:

- `legacy`: default for old systems where tests, ownership, or boundaries may be weak.
- `mature`: for established systems that need a fresh codebase map and development guide.
- `migration`: for systems being moved to a new architecture, framework, or service boundary.

## Built-in Template

The built-in template is:

```bash
scale product modules --template ruoyi-plus-enterprise-starter
```

It includes:

- `auth-registration-login`: registration, login, recovery, session, captcha, OAuth hook, and audit trail.
- `license-card-system`: license key generation, redemption, expiry, quota, revoke, import/export, and audit.
- `user-management-rbac`: user, role, department, menu permission, tenant hook, and admin audit.

The template is RuoYi-Plus-style and does not vendor upstream source automatically. Generated files are shells that must be reviewed and adapted to the target project.

## Generate Files

Dry-run:

```bash
scale product scaffold --modules auth,license,user --product DemoApp --package com.example.demo
```

Write files:

```bash
scale product scaffold --modules auth,license,user --product DemoApp --package com.example.demo --output .scale/generated/product-modules --write
```

The command refuses to overwrite existing files unless `--force` is provided.

## Custom Templates

Users can supply their own template manifest:

```bash
scale product modules --template-file .scale/product-templates/internal/template.yaml --template internal-suite
scale product scaffold --template-file .scale/product-templates/internal/template.yaml --template internal-suite --modules auth --write
```

Manifest variables:

- `{{productName}}`
- `{{packageName}}`
- `{{packagePath}}`
- `{{moduleId}}`
- `{{modulePackage}}`
- `{{moduleName}}`

Required gates:

- License notices are reviewed.
- Permission and security policies are reviewed.
- Generated files do not overwrite by default.
- Custom template manifests are validated.
- Project-specific tests run before shipping.

## References

- [RuoYi-Vue-Plus](https://github.com/dromara/RuoYi-Vue-Plus)
- [RuoYi-Cloud-Plus](https://github.com/dromara/RuoYi-Cloud-Plus)
- [Sa-Token](https://github.com/dromara/Sa-Token)
- [JHipster](https://github.com/jhipster/generator-jhipster)
- [Spring PetClinic](https://github.com/spring-projects/spring-petclinic)
