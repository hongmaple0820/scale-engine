---
name: performance
version: 1.0.0
description: Optimization patterns
triggers:
  - "performance"
  - "optimize"
  - "slow"
  - "latency"
agents:
  - debugger
  - implementer
---

# Performance Optimization

Find and fix bottlenecks.

## Measurement First

- Profile before optimizing
- Establish baseline metrics
- Identify top bottlenecks

## Common Issues

### N+1 Queries
- Use JOINs or batch queries
- Check ORM lazy loading

### Memory Leaks
- Check unclosed resources
- Review event listener cleanup

### Blocking Operations
- Async for I/O
- Worker threads for CPU

### Large Payloads
- Pagination
- Compression
- Lazy loading

## Checklist

- [ ] Database queries indexed
- [ ] No unbounded loops
- [ ] Caching for hot paths
- [ ] Assets optimized
- [ ] Bundle size checked

## Anti-Patterns

- Premature optimization
- Optimize without measuring
- Trade correctness for speed
