---
name: update-docs
version: 1.0.0
description: Documentation impact analysis and update workflow
triggers:
  - "docs"
  - "documentation"
  - "readme"
  - "guide"
agents:
  - doc-writer
  - implementer
---

# Update Docs

Use this skill when behavior, commands, configuration, public API, governance rules, or release workflow changes.

## Workflow

1. Identify entry docs that users rely on first: README, AGENTS, getting started, workflow docs, and command help.
2. Update only docs whose contract changed.
3. Keep examples executable and aligned with current command names.
4. Mention verification limits when a workflow is not fully exercised.
5. Run doc-related tests or governance drift checks when available.

## Evidence

- Updated doc paths and why they changed.
- Commands or tests used to validate generated docs and templates.
- Explicit note for docs intentionally left unchanged.

## Anti-Patterns

- No stale command examples.
- No doc-only promise for a rule that should be enforced by script or config.
- No broad README rewrite for a narrow behavior change.
