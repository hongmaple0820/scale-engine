---
name: tdd
version: 1.0.0
description: Test-driven development workflow
triggers:
  - "test"
  - "tdd"
  - "coverage"
agents:
  - tester
  - implementer
---

# TDD Workflow

Test-driven development ensures code quality through deliberate practice.

## RED Phase

1. Write test for expected behavior
2. Run test - must FAIL
3. Commit test (optional)

## GREEN Phase

1. Write minimal implementation
2. Run test - must PASS
3. No refactoring yet

## REFACTOR Phase

1. Improve code structure
2. Tests must stay GREEN
3. Commit changes

## Checklist

- [ ] Test covers edge cases
- [ ] Coverage >= 80%
- [ ] No skipped tests
- [ ] Error paths tested
