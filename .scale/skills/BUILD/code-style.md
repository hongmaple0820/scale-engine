---
Phase: BUILD
Purpose: Maintain consistent code quality during implementation
Triggers:
  - Code written during BUILD phase
  - Before refactor step
Prerequisites:
  - Passing tests
  - Project style guide
---

# Code Style Guidelines

## Core Principles

1. **Immutability**
   - Create new objects, never mutate
   - Use spread for updates
   - Prefer const over let

2. **Small Units**
   - Functions <50 lines
   - Files <800 lines
   - Single responsibility per unit

3. **Explicit Errors**
   - No silent failures
   - Handle all error paths
   - User-friendly messages

4. **No Magic**
   - Named constants for thresholds
   - No hardcoded values
   - Configuration over hardcoding

## Checklist

Before commit:

- [ ] Functions focused (<50 lines)
- [ ] Files cohesive (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] No hardcoded values
- [ ] Error handling explicit
- [ ] No mutation patterns

## Verification Gate

- Lint passes
- Typecheck passes
- Style checklist complete
