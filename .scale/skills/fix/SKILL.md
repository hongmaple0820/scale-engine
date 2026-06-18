---
name: fix
version: 1.0.0
description: Format, lint, and small repair workflow
triggers:
  - "fix"
  - "lint"
  - "format"
  - "ci"
agents:
  - implementer
---

# Fix

Use this skill for targeted repairs after tests, lint, formatting, typecheck, or CI fail.

## Workflow

1. Reproduce the failing command or inspect its exact output.
2. Locate the smallest owned code path that explains the failure.
3. Patch only the failing behavior or formatting issue.
4. Rerun the original failing command.
5. Run the smallest adjacent regression test when the fix touches shared behavior.

## Evidence

- Original failing command and reason.
- Changed files and risk boundary.
- Passing rerun of the original command.

## Anti-Patterns

- No broad refactor while fixing a narrow failure.
- No claiming CI is fixed without the failing command or equivalent evidence.
- No deleting tests to make the run pass.
