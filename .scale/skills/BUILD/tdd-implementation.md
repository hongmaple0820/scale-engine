# skill: tdd-implementation

## Phase
BUILD

## Purpose
Implement code using Test-Driven Development cycle.

## Triggers
- Command: `scale build <plan-id>`
- Keywords: build, implement, code
- Workflow: tdd-dev

## Prerequisites
- Artifact: Plan/APPROVED
- Artifact: Task/READY

## Procedure

### RED Phase
1. Write failing test for feature
2. Test should describe expected behavior
3. Run test: must fail (not error)

### GREEN Phase
1. Write minimal implementation
2. Focus on making test pass
3. Ignore elegance temporarily

### REFACTOR Phase
1. Clean up code
2. Remove duplication
3. Improve naming
4. Tests must stay green

## Verification Gate
- testPassed: true
- testCoverage ≥ 80%
- No skipped tests

## Examples

```bash
scale build PLAN-xxx --tdd
# → Creates Task and starts TDD cycle
```
