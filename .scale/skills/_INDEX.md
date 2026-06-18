# SCALE Engine Skills Index (v0.9.0)

Phase-based skills for AI-assisted development. Organized by development workflow for intuitive discovery.

## Phase Overview

| Phase | Purpose | Commands |
|-------|---------|----------|
| DEFINE | Requirements capture, spec generation | `scale define` |
| PLAN | Architecture design, task breakdown | `scale plan` |
| BUILD | TDD implementation, coding | `scale build` |
| VERIFY | Testing, coverage analysis | `scale verify` |
| REVIEW | Code review, security audit | `scale review` |
| SHIP | Commit, release management | `scale ship` |

---

## DEFINE Phase

> Requirements capture, ambiguity scoring, spec generation

| Skill | Purpose | Triggers |
|-------|---------|----------|
| [spec-generation](DEFINE/spec-generation.md) | Generate unambiguous specs | define, spec |
| [ambiguity-scoring](DEFINE/ambiguity-scoring.md) | Quantify spec clarity | ambiguity, score |
| [deep-interview](DEFINE/deep-interview.md) | Clarify vague requirements | clarify, interview |

## PLAN Phase

> Architecture design, task breakdown, risk assessment

| Skill | Purpose | Triggers |
|-------|---------|----------|
| [architecture-planning](PLAN/architecture-planning.md) | Design system architecture | architecture, design |
| [task-breakdown](PLAN/task-breakdown.md) | Decompose into atomic tasks | breakdown, tasks |
| [risk-assessment](PLAN/risk-assessment.md) | Identify implementation risks | risk, assess |

## BUILD Phase

> TDD implementation, code style, feature development

| Skill | Purpose | Triggers |
|-------|---------|----------|
| [tdd-implementation](BUILD/tdd-implementation.md) | RED-GREEN-REFACTOR cycle | tdd, build, implement |
| [code-style](BUILD/code-style.md) | Maintain code quality | style, lint |

## VERIFY Phase

> Unit testing, integration testing, coverage analysis

| Skill | Purpose | Triggers |
|-------|---------|----------|
| [unit-testing](VERIFY/unit-testing.md) | Validate implementation | test, verify |
| [integration-testing](VERIFY/integration-testing.md) | Test module interactions | integration, e2e |

## REVIEW Phase

> Code review, security audit, quality gates

| Skill | Purpose | Triggers |
|-------|---------|----------|
| [code-review](REVIEW/code-review.md) | Quality and maintainability | review, check |
| [security-audit-phase](REVIEW/security-audit-phase.md) | OWASP Top 10 checklist | security, audit |

## SHIP Phase

> Git commit, release management, deployment

| Skill | Purpose | Triggers |
|-------|---------|----------|
| [git-commit](SHIP/git-commit.md) | Commit verified changes | commit, ship |
| [release-management](SHIP/release-management.md) | Production deployment | release, deploy |

---

## ANTI-PATTERNS

> Common pitfalls to avoid across all phases

| Skill | Purpose | Triggers |
|-------|---------|----------|
| [common-pitfalls](ANTI-PATTERNS/common-pitfalls.md) | Avoid implementation mistakes | pitfall, anti-pattern |

---

## Legacy Skills (Retained)

These skills remain available with backward compatibility:

| Skill | Description | Location |
|-------|-------------|----------|
| tdd | Test-driven development | [tdd/SKILL.md](tdd/SKILL.md) |
| debugging | Systematic debugging | [debugging/SKILL.md](debugging/SKILL.md) |
| planning | Architecture planning | [planning/SKILL.md](planning/SKILL.md) |
| code-review | Review checklist | [code-review/SKILL.md](code-review/SKILL.md) |
| security-audit | OWASP Top 10 | [security-audit/SKILL.md](security-audit/SKILL.md) |
| git-workflow | Commit and PR | [git-workflow/SKILL.md](git-workflow/SKILL.md) |

---

## Usage

### Phase Commands (Recommended)

```bash
scale define "Feature description"   # DEFINE phase
scale plan <spec-id>                  # PLAN phase
scale build <plan-id>                 # BUILD phase
scale verify <task-id>                # VERIFY phase
scale review                          # REVIEW phase
scale ship <task-id>                  # SHIP phase
```

### Skill Triggers

Skills auto-discovered by trigger keywords:

```
"tdd this feature"       → activates tdd workflow
"review this code"       → activates review checklist
"security audit"         → activates security audit
```

---

*Version 0.9.0 introduces phase-aligned commands mirroring agent-skills workflow.*
