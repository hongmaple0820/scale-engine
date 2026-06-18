# skill: spec-generation

## Phase
DEFINE

## Purpose
Generate comprehensive specification from user requirements with ambiguity scoring.

## Triggers
- Command: `scale define <title>`
- Keywords: spec, requirement, define, what
- Workflow: basic-dev/step/create-spec

## Prerequisites
- None (entry point)

## Procedure

1. **Capture Raw Input**
   - Record user's original request verbatim
   - Create Need artifact with rawText

2. **Extract Intent**
   - Identify primary goal
   - List implicit requirements
   - Note constraints and preferences

3. **Draft Spec**
   - Write `what` statement (single sentence goal)
   - Define `successCriteria` (measurable outcomes)
   - List `outOfScope` (explicit exclusions)
   - Identify `edgeCases` (boundary conditions)

4. **Score Ambiguity**
   - Calculate ambiguity score (0-1)
   - Target: ≤ 0.2 for FROZEN status

5. **Refine Loop**
   - If ambiguity > 0.2, ask clarifying questions
   - Update spec per answers
   - Re-score until target met

## Verification Gate
- ambiguityScore ≤ 0.2
- successCriteria.length ≥ 3
- No TBD placeholders

## Examples

```bash
scale define "User Authentication"
# → Creates Need + Spec with refined requirements

scale define "Add dark mode" --interactive
# → Enters interactive refinement mode
```

## Platform Compatibility
- Claude Code: ✅
- Codex CLI: ✅
- OpenCode: ✅
- Cursor: ✅
- Gemini CLI: ✅
