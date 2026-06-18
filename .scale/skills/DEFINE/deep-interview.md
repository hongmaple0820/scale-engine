---
Phase: DEFINE
Purpose: Clarify vague requirements through structured dialogue
Triggers:
  - Ambiguity score <80%
  - User provides incomplete requirements
Prerequisites:
  - Initial user request captured
---

# Deep Interview

## Question Framework

### Goal Clarification
1. "What is the primary outcome you want?"
2. "What would success look like in concrete terms?"
3. "Who is the primary user of this feature?"

### Constraint Discovery
4. "What's the timeline expectation?"
5. "Are there existing systems this must integrate with?"
6. "What resources are available?"

### Edge Case Exploration
7. "What happens if [extreme scenario]?"
8. "Are there regulatory requirements?"
9. "What failure modes are unacceptable?"

### Trade-off Priorities
10. "Speed vs. quality vs. cost priority?"
11. "What to sacrifice if constraints tighten?"

## Procedure

1. Ask in Order
   - Goal → Constraints → Edge cases → Trade-offs

2. Document Answers
   - Record verbatim when possible
   - Note inferred requirements

3. Re-score
   - Run ambiguity scoring after interview
   - Target: ≥80%

4. Confirm
   - Summarize findings to user
   - Get explicit confirmation

## Verification Gate

- [ ] All 11 questions asked
- [ ] Ambiguity score ≥80%
- [ ] User confirmed summarized requirements
