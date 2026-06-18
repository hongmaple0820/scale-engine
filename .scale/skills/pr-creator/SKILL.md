---
name: pr-creator
version: 1.0.0
description: Template-aware pull request creation workflow
triggers:
  - "pull request"
  - "pr"
  - "merge"
  - "branch"
agents:
  - reviewer
  - implementer
---

# PR Creator

Use this skill when preparing a branch or pull request for review.

## Workflow

1. Check the current branch, remote, and dirty worktree before staging.
2. Stage only files that belong to the requested change.
3. Summarize behavior changes, validation, risks, and rollback notes.
4. Include issue links, release notes, screenshots, or artifacts when relevant.
5. Push the intended branch and create the PR with the repo's existing template.

## Evidence

- `git status --short` before staging.
- Exact validation commands and results.
- PR URL or branch push result.

## Anti-Patterns

- No unrelated files in the commit.
- No unstated generated artifacts.
- No PR body that says tests passed when they were not run.
