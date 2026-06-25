---
Phase: ALL
Purpose: Avoid common implementation mistakes
Triggers:
  - During any phase
  - Self-check before gates
Prerequisites:
  - Active implementation
---

# Common Anti-Patterns

## DEFINE Phase Pitfalls

- Vague requirements ("make it better")
- Missing acceptance criteria
- No rollback plan
- Assuming user context

## PLAN Phase Pitfalls

- Over-engineering
- Missing dependencies
- No parallel execution opportunities
- Ignoring existing solutions
- Skipping the lazy ladder: existing code -> standard library -> platform capability -> installed dependency -> minimal implementation

## BUILD Phase Pitfalls

- Writing code before tests
- Adding helper/adapter/manager files before proving reuse is not enough
- Adding dependencies before checking the standard library, platform capability, and installed packages
- Premature optimization
- Deep nesting (>4 levels)
- Large functions (>50 lines)
- Hardcoded values
- Mutation instead of immutability

## VERIFY Phase Pitfalls

- Testing only happy paths
- Skipping coverage analysis
- Ignoring performance baseline
- Missing edge cases

## REVIEW Phase Pitfalls

- Skipping security checklist
- Ignoring N+1 queries
- Missing auth boundaries
- Hardcoded secrets

## SHIP Phase Pitfalls

- Committing without tests
- Missing rollback plan
- No monitoring after deploy
- Skipping staging verification

## Prevention

- Follow phase verification gates
- Use checklists religiously
- Document anti-patterns encountered
- Add to this file when discovered
