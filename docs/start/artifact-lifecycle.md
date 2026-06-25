<!--
  Version: 1.0
  Last Updated: 2026-05-19
  Scope: Tutorial — Artifact lifecycle from Need to Release
  Maintainer: SCALE Engine Team
-->
# Artifact Lifecycle Walkthrough

This tutorial walks through a **complete Artifact lifecycle**: Need → Spec → Plan → Task → Change → Evidence → Release. It demonstrates how SCALE's FSM, Gates, and Guardrails work together to enforce quality through physical constraints.

## Prerequisites

- SCALE Engine installed (`npm install -g @hongmaple0820/scale-engine`)
- Node.js 22+
- A project directory initialized with `scale init`

## The Scenario

You have a simple calculator library. The user requests: **"Add a multiply function"**. We'll trace this request through the entire SCALE lifecycle.

---

## Step 1: Create a Need

Every request starts as a **Need** — the raw user intent.

```bash
scale create need "Add multiply function to calculator"
```

Output:
```json
{
  "id": "ART-need-20260519-0001",
  "type": "Need",
  "status": "DRAFT",
  "title": "Add multiply function to calculator"
}
```

The Need starts in `DRAFT` state. It's fuzzy — no success criteria, no scope boundaries.

```bash
scale transition ART-need-20260519-0001 clarify \
  --reason "Added success criteria and scope"
```

**FSM Path:** `DRAFT → CLARIFIED`

---

## Step 2: Create a Spec from the Need

A **Spec** is the requirements contract — WHAT to build, not HOW.

```bash
scale create spec "Multiply function spec" \
  --from ART-need-20260519-0001 \
  --payload '{
    "what": "Add multiply(a, b) function that returns the product of two numbers",
    "successCriteria": [
      "multiply(2, 3) returns 6",
      "multiply(-1, 5) returns -5",
      "multiply(0, 100) returns 0",
      "multiply(2.5, 4) returns 10"
    ],
    "outOfScope": ["Division", "Modulo", "Complex numbers"],
    "edgeCases": ["Overflow", "NaN inputs", "Infinity"],
    "northStar": "Reliable basic arithmetic operations"
  }'
```

Output:
```json
{
  "id": "ART-spec-20260519-0002",
  "type": "Spec",
  "status": "DRAFT",
  "parents": ["ART-need-20260519-0001"]
}
```

### Spec State Machine

```
                  ┌──── reject ────┐
                  ▼                │
   DRAFT ──refine──▶ REVIEWING ──approve──▶ FROZEN
```

The Spec must be **FROZEN** before downstream artifacts (Plan, Task) can be created. This prevents building on unstable requirements.

```bash
# Move to review
scale transition ART-spec-20260519-0002 review --reason "Ready for review"

# Approve and freeze
scale transition ART-spec-20260519-0002 approve --reason "Requirements clear, scope defined"
```

**FSM Path:** `DRAFT → REVIEWING → FROZEN`

---

## Step 3: Create a Plan

A **Plan** is the technical approach — HOW to build it.

```bash
scale create plan "Multiply implementation plan" \
  --from ART-spec-20260519-0002 \
  --payload '{
    "approach": "Add multiply function to existing calculator module",
    "techChoices": [
      {
        "decision": "Simple function, not a class method",
        "rationale": "Consistent with existing add/subtract pattern",
        "alternatives": ["Class method", "Operator overloading"]
      }
    ],
    "modules": [
      {"path": "src/calculator.ts", "action": "modify", "reason": "Add multiply export"},
      {"path": "tests/calculator.test.ts", "action": "modify", "reason": "Add multiply tests"}
    ],
    "rollbackStrategy": "Revert git commit",
    "estimatedComplexity": 0.2
  }'
```

```bash
scale transition ART-plan-20260519-0003 approve --reason "Plan is straightforward"
```

**FSM Path:** `DRAFT → APPROVED`

---

## Step 4: Create and Execute a Task

A **Task** is the atomic execution unit.

```bash
scale create task "Implement multiply function" \
  --from ART-plan-20260519-0003 \
  --payload '{
    "description": "Write multiply function and tests",
    "filesInvolved": ["src/calculator.ts", "tests/calculator.test.ts"],
    "requiredRole": "implementer",
    "requiredCapabilities": ["can_modify_code", "can_run_tests"]
  }'
```

### Task State Machine with Guards

```
PENDING ──schedule──▶ READY ──start──▶ RUNNING ──complete──▶ COMPLETED
                                                        │
                                                        └── BLOCKED by Guards
```

The Task has **physical guards** that prevent false completion:

```bash
# Schedule and start
scale transition ART-task-20260519-0004 schedule --reason "Ready"
scale transition ART-task-20260519-0004 start --reason "Starting implementation"

# Agent writes code (simulated)
# ... src/calculator.ts modified ...

# Agent tries to complete WITHOUT verification
scale transition ART-task-20260519-0004 complete --reason "Done"
```

**Output (BLOCKED):**
```json
{
  "success": false,
  "blockedBy": [
    {
      "guard": "build_passed",
      "message": "Task must pass build verification before completion. Run: scale verify-task <id>"
    },
    {
      "guard": "lint_passed",
      "message": "Task must pass lint before completion. Run: scale verify-task <id>"
    },
    {
      "guard": "tests_passed",
      "message": "Task must pass tests before completion. Run: scale verify-task <id>"
    }
  ]
}
```

**The transition is physically blocked.** The agent cannot claim completion without running verification.

### Run Verification

```bash
scale verifyTask ART-task-20260519-0004
```

Output:
```
Running build...
   Build passed

Running lint...
   Lint passed

Running tests...
   Tests passed

Verification results:
  Build:  success (exit code: 0)
  Lint:   success
  Tests:  passed

All checks passed! Task can now be completed.
```

Now the transition succeeds:

```bash
scale transition ART-task-20260519-0004 complete --reason "Verified and all checks passed"
```

**FSM Path:** `PENDING → READY → RUNNING → COMPLETED`

---

## Step 5: Record the Change

A **Change** tracks the actual code modification (git commit/PR).

```bash
scale create change "Multiply function implementation" \
  --from ART-task-20260519-0004 \
  --payload '{
    "commitSha": "abc123",
    "filesChanged": [
      {"path": "src/calculator.ts", "additions": 8, "deletions": 0},
      {"path": "tests/calculator.test.ts", "additions": 20, "deletions": 0}
    ],
    "diffSummary": "Added multiply function with type safety and edge case handling"
  }'

scale transition ART-change-20260519-0005 commit --reason "Committed"
scale transition ART-change-20260519-0005 verify --reason "Tests pass"
```

**FSM Path:** `DRAFT → COMMITTED → VERIFIED`

---

## Step 6: Record Evidence

An **Evidence** artifact captures verification results.

```bash
scale create evidence "Multiply function test results" \
  --from ART-change-20260519-0005 \
  --payload '{
    "testPlanId": "ART-testplan-...",
    "toolUsed": "pnpm test",
    "passed": true,
    "output": "Tests: 4 passed, 4 total. Coverage: 95%",
    "duration": 1200,
    "artifacts": ["coverage/lcov-report/index.html"]
  }'
```

---

## Step 7: Close the Release

A **Release** bundles everything together. It can only be created when all Defects are closed.

```bash
scale create release "v1.1.0 - Add multiply" \
  --payload '{
    "version": "v1.1.0",
    "includesSpecs": ["ART-spec-20260519-0002"],
    "includesChanges": ["ART-change-20260519-0005"],
    "rolloutStrategy": "all_at_once"
  }'

scale transition ART-release-20260519-0007 prepare --reason "Ready"
scale transition ART-release-20260519-0007 ship --reason "Deploying"
scale transition ART-release-20260519-0007 verify --reason "Deployed and verified"
```

**FSM Path:** `PLANNED → READY → DEPLOYING → DEPLOYED`

---

## The Complete Artifact DAG

```
Need (CLARIFIED)
  └── Spec (FROZEN)
        └── Plan (APPROVED)
              └── Task (COMPLETED)
                    └── Change (VERIFIED)
                          └── Evidence (PASS)
                                └── Release (DEPLOYED)
```

Every arrow represents a parent-child relationship. Every state transition went through the FSM with Guards. The agent **could not skip verification** — it was physically blocked.

---

## Key Takeaways

1. **FSM enforces order** — You can't create a Plan from a non-FROZEN Spec
2. **Guards prevent false completion** — Task completion is blocked without verification
3. **Event sourcing records everything** — Every transition is logged as an immutable event
4. **Defects create feedback loops** — If Evidence fails, a Defect is created and the cycle continues
5. **Lessons are extracted** — After 3+ similar Defects, SCALE proposes a Lesson; after review, it becomes a Rule; after violation, it becomes a Hook

## Next Steps

- [Agent Governance Demo](agent-governance-demo.md) — See a real-world task walkthrough
- [Task Guard Workflow Demo](../TASK_GUARD_WORKFLOW_DEMO.md) — Deep dive into Guard mechanics
- [Data Model](../02-DATA-MODEL.md) — Understand Artifact types, events, and FSM definitions
