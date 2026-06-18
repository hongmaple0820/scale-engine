# skill: architecture-planning

## Phase
PLAN

## Purpose
Design technical implementation architecture from frozen spec.

## Triggers
- Command: `scale plan <spec-id>`
- Keywords: plan, architecture, design, how
- Workflow: basic-dev/step/create-plan

## Prerequisites
- Artifact: Spec/FROZEN

## Procedure

1. **Analyze Spec Requirements**
   - Read frozen spec success criteria
   - Identify technical implications

2. **Tech Stack Selection**
   - Evaluate framework options
   - Choose libraries based on criteria
   - Document rationale for each choice

3. **Module Breakdown**
   - Decompose into modules/files
   - Define interfaces between modules
   - Estimate complexity per module

4. **Rollback Strategy**
   - Define safe rollback approach
   - Create migration scripts if needed
   - Plan feature flags for gradual rollout

5. **Risk Assessment**
   - Identify technical risks
   - Propose mitigation strategies

## Verification Gate
- rollbackStrategy defined
- modules.length ≥ 1
- estimatedComplexity ≤ 8 (scale 1-10)

## Examples

```bash
scale plan SPEC-20260508-0001
# → Creates Plan with architecture design

scale plan SPEC-xxx --design "Use React with TypeScript"
# → Pre-fills design approach
```
