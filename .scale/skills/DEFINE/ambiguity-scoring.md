# skill: ambiguity-scoring

## Phase
DEFINE

## Purpose
Calculate and reduce ambiguity score for requirements.

## Triggers
- Command: `scale spec refine`
- Keywords: ambiguity, clarify, refine

## Procedure

1. **Analyze Spec Components**
   - Score each field: what, successCriteria, edgeCases
   - Weight: what (40%), successCriteria (40%), edgeCases (20%)

2. **Ambiguity Indicators**
   - TBD/TODO placeholders: +0.3 each
   - Vague terms ("fast", "good", "user-friendly"): +0.1 each
   - Missing success criteria: +0.2 per missing

3. **Clarification Protocol**
   - Ask 5-why questions for vague terms
   - Convert subjective to objective criteria
   - Add quantified thresholds

4. **Update Score**
   - Recalculate after each refinement
   - Track score history

## Examples

```
Before: "Make it fast" → ambiguity 0.8
After: "Response time < 200ms for 95% of requests" → ambiguity 0.1
```
