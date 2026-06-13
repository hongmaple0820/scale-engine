---
name: code-review
version: 1.0.0
description: Code quality review checklist
triggers:
  - "review"
  - "check"
  - "quality"
agents:
  - reviewer
---

# Code Review Checklist

Review all code before merge.

## Security

- [ ] No hardcoded secrets
- [ ] Input validated at boundaries
- [ ] SQL uses parameterized queries
- [ ] No XSS vulnerabilities
- [ ] Auth/authorization correct

## Quality

- [ ] Functions < 50 lines
- [ ] Files < 800 lines
- [ ] No deep nesting (>4 levels)
- [ ] Errors handled explicitly
- [ ] No mutation of inputs

## Performance

- [ ] No N+1 queries
- [ ] Pagination on large datasets
- [ ] Expensive operations cached
- [ ] No unbounded loops

## Testing

- [ ] Coverage >= 80%
- [ ] Edge cases covered
- [ ] Error paths tested

## Severity

| Level | Action |
|-------|--------|
| CRITICAL | Block merge |
| HIGH | Fix before merge |
| MEDIUM | Consider fixing |
| LOW | Optional |
