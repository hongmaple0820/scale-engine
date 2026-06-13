---
name: frontend-design
version: 1.0.0
description: Production frontend design workflow
triggers:
  - "frontend"
  - "ui"
  - "ux"
  - "responsive"
agents:
  - designer
  - implementer
---

# Frontend Design

Use this skill when a task changes user-facing screens, layout, navigation, visual hierarchy, interaction states, or responsive behavior.

## Workflow

1. Identify the primary user workflow and the first screen the user should see.
2. Reuse the existing design system, spacing, typography, and component patterns.
3. Define empty, loading, error, disabled, hover, focus, and success states.
4. Keep operational tools dense and scannable; avoid marketing-style hero layouts unless the task is explicitly a landing page.
5. Verify desktop and mobile viewports with screenshots or browser evidence.

## Evidence

- Screenshot or browser snapshot for changed screens.
- Notes for responsive constraints and state coverage.
- Console/network check when the page is interactive.

## Anti-Patterns

- No decorative card nesting.
- No text that explains how to use obvious controls.
- No single-hue visual theme unless it is already the product system.
- No final UI claim without viewport evidence.
