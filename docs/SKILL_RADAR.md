# Skill Radar

Skill Radar is the active capability selection layer for SCALE. It does not auto-install or blindly run skills. It scores relevant skills, MCP servers, browser tools, desktop automation, and external CLIs against the current task, then returns:

- why the capability matches
- confidence score
- safety level
- required evidence
- fallback path
- supply-chain checks before installation or promotion

The goal is to make agents actively use useful tools without turning the project into an unsafe prompt or tool bundle.

## Commands

```bash
scale skill radar --task "Design upload UI and run browser E2E checks" --files src/pages/upload.tsx
scale skill radar --task "Automate WPS desktop workflow with CUA" --json
scale skill radar --task "Review release PR" --phase review --level L --output docs/worklog/tasks/release/skill-radar.md
scale skill doctor --supply-chain
scale skill doctor --supply-chain --json
scale ai-os plan --task "Design upload UI and run browser E2E checks" --files src/pages/upload.tsx --json
```

## Safety Levels

| Level | Meaning | Default action |
| --- | --- | --- |
| `trusted` | Official or low-risk capability with policy enabled | May be recommended when confidence is high |
| `review-required` | Third-party or ecosystem capability | Require source, license, scripts, and revision review |
| `restricted` | Browser, desktop, or external execution boundary | Require explicit evidence and side-effect boundaries |
| `blocked` | Disabled by policy or failed safety review | Do not run; use fallback |

## Confidence

Skill Radar combines:

- task keywords and workflow phase
- changed file patterns
- local skill installation
- tool availability
- trust level
- policy status
- frontend/package evidence
- safety penalties

The score is not a promise that the tool will work. It is a routing signal. Any recommendation still needs real evidence before the agent can claim success.

## Default Domains

| Domain | Typical triggers | Recommended capability types |
| --- | --- | --- |
| `ui` | UI, UX, frontend, component, visual, layout | design skills, visual review, screenshot evidence |
| `browserAutomation` | browser, E2E, Playwright, Chrome, DevTools | web access, browser automation, DevTools evidence |
| `desktopAutomation` | desktop, GUI, WPS, WeChat, CUA | disabled by default; manual operator fallback |
| `externalCli` | Codex, Gemini, OpenCode, external agent CLI | disabled by default; dry-run and output evidence |
| `review` | PR, merge, release, code review | reviewer skills, severity findings |
| `docs` | docs, README, ADR, governance asset | doc impact and source-of-truth evidence |
| `planning` | plans, task_plan, findings, progress, long-running work | file-backed planning, progress logs, plan attestation |
| `memory` | memory, recall, knowledge, persistent memory, gbrain | governed memory routing through gbrain with fail-closed readiness checks |
| `discovery` | skill, MCP, tool, capability discovery | find-skills plus safety review |

## Evidence Contract

Each recommendation carries required evidence. Examples:

- UI work: `ui-spec`, `design-rationale`, `screenshot`, `visual-review`
- Browser work: `browser-evidence`, `console-summary`, `network-summary`, `scenario-result`
- Desktop work: `operator-boundary`, `desktop-screenshot`, `affected-app`
- External CLI work: `cli-version-check`, `command`, `exit-code`, `output-summary`
- Review work: `review-report`, `finding-list`, `severity`
- Planning work: `task-plan`, `findings-log`, `progress-log`, `plan-attestation`
- Memory work: `memory-provider-health`, `privacy-boundary`, `data-retention-policy`, `query-result`

If evidence is missing, the final delivery should list the capability as unverified rather than claiming it was used successfully.

## Skill Execution Plan

In v0.27.0, `createSkillPlan` and `scale ai-os plan` return an `executionPlan`:

- `strategy`: currently `intent-evidence-graph-v1`
- `steps`: ordered skill, artifact, and verification actions
- `reason`: why the step was selected from task intents
- `evidenceRequired`: what proof must be recorded
- `fallback`: what to do when the skill, MCP, CLI, or verification path is unavailable

This turns skill routing from a recommendation list into an auditable execution graph. Required steps still need concrete evidence or an explicit skipped/fallback record; recommended steps may be skipped with a reason.

## Supply-Chain Doctor

`scale skill doctor --supply-chain` reviews known skill sources and install commands for:

- HTTPS source requirement
- `curl | bash`, `wget | sh`, `Invoke-Expression`, and `iex` blocking
- destructive install patterns
- npm/npx lifecycle script review
- required source, license, and revision checks
- third-party attribution and NOTICE checks

This is intentionally conservative. Third-party skills should start in review-required mode and be promoted only after inspection.

External skill references and acknowledgements are tracked in [Third-Party Skills and External References](THIRD_PARTY_SKILLS.md) and the full [External Reference Inventory](EXTERNAL_REFERENCES.md). SCALE should not vendor community skill code unless the license text, source revision, copyright notice, and modification notes are preserved.

## Policy Integration

Skill Radar reads `.scale/tools.json` through the Tool Policy layer. Defaults:

- UI and browser capabilities are enabled but evidence-required.
- Desktop CUA is disabled by default.
- External agent CLIs are disabled by default.
- Browser tools require captured evidence and should stay in approved domains.

Use Tool Policy to enable a restricted capability deliberately rather than relying on an agent's assumption.

## Fallback Rule

Every recommendation must include a fallback. This prevents tool theater:

```text
If the capability is missing, unsafe, low-confidence, or policy-blocked,
the agent must use the fallback and record why the capability was not used.
```

## Artifact Lifecycle

Skill Radar reports can be written into task artifacts:

```bash
scale skill radar \
  --task "Refactor upload page and verify browser flow" \
  --files src/pages/upload.tsx \
  --output docs/worklog/tasks/2026-05-19-upload-refactor/skill-radar.md
```

Keep the report when it is evidence for an M/L/CRITICAL task. Do not commit transient local detection output unless it is part of the reviewed task artifact set.
