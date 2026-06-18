# skill: code-review

## Phase
REVIEW

## Purpose
Systematic code review across quality dimensions.

## Triggers
- Command: `scale review <change-id>`
- Keywords: review, check, quality
- Workflow: code-review

## Prerequisites
- Artifact: Change/DRAFT

## Procedure

1. **Style Review**
   - Naming conventions
   - Formatting consistency
   - No hardcoded magic values

2. **Logic Review**
   - Correctness of algorithms
   - Edge case handling
   - Error propagation

3. **Security Review** (optional)
   - Input validation
   - No SQL injection / XSS
   - Secrets not hardcoded

4. **Performance Review** (optional)
   - No N+1 queries
   - Efficient data structures
   - Memory leak check

## Output
- Create Defect for issues found
- Review summary document

## Examples

```bash
scale review CHANGE-xxx --security
# → Includes security audit
```
