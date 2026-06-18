---
name: debugging
version: 1.0.0
description: Systematic debugging protocol
triggers:
  - "debug"
  - "fix"
  - "error"
  - "bug"
agents:
  - debugger
---

# Systematic Debugging

Never fix without understanding the root cause.

## Step 1: Reproduce

- Capture exact error message
- Note the inputs that trigger it
- Document the expected vs actual behavior

## Step 2: Isolate

- Find the smallest reproducing case
- Check if issue is deterministic
- Identify affected components

## Step 3: Hypothesize

- List 3 potential root causes
- Rank by probability
- Pick one to investigate

## Step 4: Verify

- Add logging or breakpoints
- Run with minimal change
- Confirm or refute hypothesis

## Step 5: Fix

- Implement targeted fix
- Add regression test
- Verify fix doesn't break elsewhere

## Anti-Patterns

- Never try random changes
- Never silence exceptions
- Never assume environment issue without proof
