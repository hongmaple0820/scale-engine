---
name: refactoring
version: 1.0.0
description: Safe refactoring steps
triggers:
  - "refactor"
  - "clean"
  - "improve"
agents:
  - reviewer
  - implementer
---

# Safe Refactoring

Improve structure without changing behavior.

## Preconditions

- [ ] Tests exist and pass
- [ ] Coverage >= 80%
- [ ] Understand current behavior

## Step 1: Identify

- Find code smell
- Document why change needed
- Estimate impact

## Step 2: Test Coverage

- Add tests for behavior to preserve
- Run tests - must pass before refactor

## Step 3: Refactor

- Make smallest possible change
- Run tests after each change
- Commit when tests pass

## Step 4: Verify

- Full test suite passes
- No new lint errors
- Performance not degraded

## Common Refactors

- Extract function
- Rename for clarity
- Remove duplication
- Simplify conditionals
- Introduce abstraction

## Anti-Patterns

- Never refactor without tests
- Never mix refactor with feature
- Never skip running tests
