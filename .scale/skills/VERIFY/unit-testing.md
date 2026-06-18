# skill: unit-testing

## Phase
VERIFY

## Purpose
Run and validate unit tests with coverage analysis.

## Triggers
- Command: `scale verify <task-id>`
- Keywords: test, verify, coverage
- Workflow: tdd-dev/step/verify

## Prerequisites
- Artifact: Task/READY or Task/IN_PROGRESS

## Procedure

1. **Run Test Suite**
   - Execute: npm test (or equivalent)
   - Capture exit code and output

2. **Analyze Results**
   - Count passed/failed tests
   - Identify failing test names

3. **Coverage Check**
   - Parse coverage report
   - Compare against threshold (default 80%)

4. **Update Task Payload**
   - Set testPassed boolean
   - Set testCoverage number
   - Record testTotal, testFailed

## Verification Gate
- testPassed == true
- testCoverage ≥ 80%
- No failing tests

## Examples

```bash
scale verify TASK-xxx
# → Runs build, lint, test

scale verify TASK-xxx --coverage 90
# → Requires 90% coverage
```
