---
name: git-workflow
version: 1.0.0
description: Commit and PR standards
triggers:
  - "commit"
  - "pr"
  - "merge"
agents:
  - implementer
---

# Git Workflow

Clean, traceable history.

## Commit Format

```
<type>: <description>

[optional body]
```

Types: feat, fix, refactor, test, docs, chore, perf, ci

## Commit Rules

- One logical change per commit
- Describe WHY not HOW
- No WIP commits
- Tests must pass

## PR Workflow

1. Create feature branch
2. Make commits with messages
3. Run all tests
4. Push with -u
5. Create PR with summary
6. Wait for review
7. Address feedback
8. Merge when approved

## PR Description

- Summary of changes
- Link to issue/PRD
- Test plan checklist
- Screenshots (if UI)

## Branch Names

- feature/xxx - new features
- fix/xxx - bug fixes
- refactor/xxx - code cleanup
