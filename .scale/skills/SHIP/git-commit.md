# skill: git-commit

## Phase
SHIP

## Purpose
Create well-structured git commit with verified changes.

## Triggers
- Command: `scale ship <task-id>`
- Keywords: commit, ship, release
- Workflow: basic-dev/step/complete

## Prerequisites
- Artifact: Task/verified (testPassed == true)

## Procedure

1. **Verify Tests Pass**
   - Confirm build success
   - Confirm test success
   - Block if failing

2. **Stage Changes**
   - git add relevant files
   - Exclude sensitive files (.env, credentials)

3. **Write Commit Message**
   - Format: <type>(<scope>): <subject>
   - Types: feat, fix, refactor, docs, test

4. **Commit**
   - git commit with message

5. **Optionally Push**
   - git push to remote
   - Optionally create PR

## Examples

```bash
scale ship TASK-xxx --push --pr
# → Commit + push + create PR
```
