# skill: integration-testing

## Phase
VERIFY

## Purpose
Validate integration between modules.

## Triggers
- Keywords: integration, e2e, full

## Procedure

1. **Identify Integration Points**
   - API endpoints
   - Database connections
   - External services

2. **Run Integration Tests**
   - Use real dependencies (not mocks)
   - Test data flow across boundaries

3. **Verify Contracts**
   - Response schemas match
   - Error handling works

4. **Clean Up**
   - Reset test data
   - Close connections
