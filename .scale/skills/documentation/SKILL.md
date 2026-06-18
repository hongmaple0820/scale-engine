---
name: documentation
version: 1.0.0
description: Documentation writing standards
triggers:
  - "document"
  - "readme"
  - "doc"
agents:
  - doc-writer
---

# Documentation Standards

Clear, maintainable documentation.

## README Structure

1. Project name and description
2. Quick start / installation
3. Usage examples
4. Configuration options
5. API reference (if library)
6. Contributing guide

## Code Comments

- WHY not WHAT
- Explain non-obvious decisions
- Document constraints
- No redundant comments

## API Documentation

- All parameters with types
- Return values and errors
- Examples for common cases
- Version compatibility

## Anti-Patterns

- No commented-out code
- No TODO without issue link
- No outdated examples
- No missing version info
