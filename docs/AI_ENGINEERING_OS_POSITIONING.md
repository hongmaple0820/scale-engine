# SCALE Engine Strategic Positioning

> Date: 2026-05-20  
> Status: strategic direction with a v0.27.0 runtime baseline
> Audience: maintainers, contributors, roadmap reviewers, and product-facing documentation owners

SCALE Engine should be positioned as an **Agent Governance Runtime** evolving toward an **AI Engineering OS**.

The project is no longer best described as a prompt toolbox. Its durable value is the runtime layer around AI coding agents:

- workflow state machines
- hard gates and verification evidence
- hook-based tool interception
- role and permission boundaries
- artifact persistence
- context budgets
- memory provider routing
- skill, MCP, CLI, and adapter orchestration
- machine-readable agent collaboration plans for role selection, handoffs, review gates, and token budgets
- Agent Loop readiness evidence for observe-decide-act-recover-stop workflows

The core thesis is:

> Use system constraints, evidence, and runtime gates to replace agent self-discipline.

This positioning is intentionally stronger than "prompt engineering", but it must stay evidence-backed. SCALE can describe the direction as AI Engineering OS; it should only describe measurable gains after benchmark, eval, or runtime evidence exists.

## Reference Inputs

This document consolidates:

- the current SCALE Engine architecture and documentation surfaces
- maintainer review of SCALE as an Agent Governance Runtime
- the external Harness Engineering framing in [SCALE OS v10.0: AI 编码的认知操作系统](https://segmentfault.com/a/1190000047756584)

External performance claims from ecosystem articles are positioning inputs, not SCALE Engine release claims. Public SCALE claims should still be backed by local evals, runtime evidence, or release reports.

## 1. Market Category

SCALE sits between four emerging categories:

| Category | SCALE relationship |
| --- | --- |
| AI Engineering OS | Long-term positioning: one governed operating layer for agent-driven engineering |
| Agent Governance Runtime | Current strongest fit: gates, hooks, evidence, role boundaries, and policy enforcement |
| Workflow Orchestration Runtime | Current fit: FSM, phase commands, artifacts, verification, and ship flow |
| Harness Engineering Infrastructure | Methodology fit: constraints + feedback + workflow + continuous improvement |

SCALE should avoid being framed as only:

- prompt templates
- agent rules
- a Claude/Cursor/Codex config generator
- an AutoGPT-style chain executor
- a generic skills catalog

Those may exist around the project, but they are not the core defensible layer.

## 2. Problem Definition

AI coding failures are not only model-quality failures. They are engineering runtime failures:

| Failure mode | Typical prompt-only response | SCALE response |
| --- | --- | --- |
| Fake completion | "Please verify before finishing" | verification gates and final evidence checks |
| Skipped tests | reminder text | FSM and verification status before completion |
| Repeated blind retries | "try a different approach" | retry and behavior detectors |
| Context overload | longer instructions | context budgets, lazy loading, scoped packs |
| Agent drift | more rules | persisted workflow state and phase boundaries |
| Hallucinated delivery | review prompt | runtime evidence ledger and ship gates |
| Lost learning | chat history | memory artifacts, failure replay, lessons, rule candidates |
| Multi-agent confusion | role descriptions | role gateway and tool permission boundaries |
| Tool overreach | trust agent judgment | hook interception and policy gateway |

The strategic target is not to make the model "more obedient". The target is to make non-compliant behavior observable, blockable, and recoverable.

## 3. Current Strengths

### 3.1 Runtime Constraints

SCALE already has the right architectural instinct: lower critical rules from prompt text into runtime checks.

Relevant surfaces:

- `docs/ENGINEERING_STANDARDS.md`
- `docs/RUNTIME_EVIDENCE.md`
- `docs/DEPENDENCY_AUDIT.md`
- `src/workflow/gates/GateSystem.ts`
- `src/guardrails/Gateway.ts`
- `src/artifact/fsm.ts`

This is the primary moat. Prompt rules can be ignored; runtime gates can block progress.

### 3.2 Workflow State Machine

The workflow is driven by artifact state, not by chat momentum.

Strategic value:

- prevents premature completion
- forces phase-specific evidence
- makes stalled or skipped phases visible
- supports resume and handoff across long sessions
- gives agent platforms a shared lifecycle model

The FSM should remain strict at phase boundaries and flexible inside each phase.

### 3.3 Hook and Gateway Layer

Hooks, pre-tool checks, post-tool checks, stop checks, and role-aware gateway decisions form the AI runtime interceptor layer.

Strategic value:

- agents do not receive raw, unlimited tool authority
- unsafe operations can be blocked before execution
- tool output can be converted into evidence
- repeated failure patterns can be detected outside the model

This layer makes SCALE closer to an admission controller than a prompt pack.

### 3.4 Evidence-Backed Delivery

SCALE's strongest anti-hallucination capability is engineering hallucination control:

- no test evidence means no verified claim
- no runtime evidence means no product-smoke claim
- no reviewed file scope means no governed ship
- no dependency audit evidence means weaker security confidence

This reduces fake completion more reliably than instruction text.

It does not fully solve reasoning hallucination. Architecture decisions, root-cause analysis, and technical tradeoffs still need evaluator intelligence.

### 3.5 Adapter and Platform Surface

The agent-platform adapters let SCALE act as a shared governance layer for different coding agents.

Strategic value:

- one governance model across Claude Code, Codex, Cursor, Gemini, Windsurf, Kiro, Cline, and related tools
- fewer duplicated rule files
- lower switching cost between agents
- consistent evidence and workflow semantics

Adapter expansion should not become the main roadmap by itself. The strategic value comes from shared governance semantics, not from the count of supported agents.

### 3.6 Dashboard and Prompt Studio as an Adoption Surface

SCALE now has a Vue 3 + Naive UI default dashboard at the server root with Prompt Studio for built-in vibe templates, phase prompt registry entries, prompt packs, project/global custom prompts, and deterministic prompt optimization.

Strategic value:

- makes runtime capability gaps visible through an explicit data-source readiness matrix instead of unexplained empty panels
- makes the existing prompt assets discoverable without requiring users to remember CLI flags
- gives vibe coding prompts a copy/download/export surface inside the same dashboard as documents, repo knowledge, gbrain memory, graphs, metrics, and gates
- keeps prompt optimization local and deterministic, so it can be tested and versioned like normal code
- preserves the core boundary: prompts help start and shape work, but gates, evidence, memory, and runtime status decide whether work is complete

This helps adoption, but it should not change the category claim. SCALE is not trying to win by having the largest prompt library. The prompt surface is valuable because it is attached to governed execution, not because prompt text is sufficient by itself.

The dashboard itself must remain evidence-honest. Normal `npm run serve` can show filesystem-backed documents, prompt templates, repo-native knowledge base data, Graphify graph outputs, gbrain memory, command evidence, model usage, topology, monitoring, and runtime ledgers; it should mark EventBus/FSM-backed realtime transitions as partial until those runtime dependencies are actually injected. Knowledge base and memory are separate surfaces: knowledge comes from documents, `.scale/knowledge.db`, LLM/Karpathy guidance, and graph artifacts, while gbrain memory is the evidence-backed recall/review system.

## 4. Honest Capability Assessment

SCALE can already claim:

- stronger engineering governance than prompt-only rules
- structured workflow execution with phase and artifact state
- hard verification gates for delivery claims
- evidence-based runtime reporting
- machine-readable `agentCollaboration` plans in `scale ai-os plan/run`, direct `scale agent plan` output, and dashboard Prompt Studio, plus guarded `agentExecution` settlement evidence in run reports
- Agent Loop readiness reporting from local execution, recovery, guardrail, budget, delegation, and termination evidence
- dashboard Prompt Studio for built-in and custom prompt assets plus deterministic optimization
- first-class supply-chain audit direction
- growing adapter coverage
- memory and skill orchestration foundations

SCALE should not yet overclaim:

- fully autonomous self-evolution
- human-level long-term memory
- guaranteed token reduction percentages
- guaranteed hallucination reduction percentages
- adaptive cognitive planning
- vendor Agent SDK parity or autonomous handoff guarantees
- universal skill routing intelligence

Use target ranges only in roadmap or evaluation documents, not as product claims, until eval evidence supports them.

### 4.1 Horizontal Comparison

This comparison is methodology-level. It is based on repo-native integration points, local skill documentation, and SCALE's current implementation, not on unverified external benchmark claims.

| Workflow / method | Strong at | Weak at | SCALE relationship |
| --- | --- | --- | --- |
| Superpowers brainstorming | upfront clarification, approach comparison, design approval before implementation | intentionally blocks implementation until the spec path is approved; not itself an evidence ledger or release gate | SCALE should borrow the discipline of explicit design approval, then carry the result into executable gates, runtime evidence, and dashboard status |
| gstack-style workflows | practical QA, dogfooding, browser evidence, shipping/review rituals, project learnings | optimized around skill workflows and browser/test execution rather than a project-wide governance runtime | SCALE can interoperate with gstack-style skills while adding persistent gates, multi-project dashboard state, memory routing, and ship blocking |
| ECC Instincts | observation -> pattern -> instinct extraction, session-start injection, repeated-failure learning | instinct existence does not prove runtime application unless hit-rate evidence is recorded | Scale Cortex aligns with this pattern, but must keep proving that instincts actually enter runtime and improve outcomes |
| OMC-style skill/agent methods | agent and skill packaging, deep-interview style demand refinement, portable skill metadata | can become a library of methods without hard workflow completion controls | SCALE treats OMC/gstack/ECC as import/export and inspiration surfaces, while keeping native FSM, gates, and evidence as the source of truth |
| Prompt-only vibe coding packs | fast onboarding, lower activation energy, useful first drafts | weak against hallucinated completion, skipped tests, long-task drift, and stale memory | SCALE now exposes prompts in Prompt Studio, but keeps them subordinate to verification, memory, and governance evidence |

Current advantages:

- stronger anti-fake-completion posture because delivery claims need local evidence
- multi-surface visibility: CLI, dashboard, AI OS status, workflow effectiveness, and runtime ledger
- provider-aware memory strategy with gbrain-only policy support when configured
- prompt assets, documents, knowledge, metrics, and gate evidence can be reviewed in one dashboard

Current disadvantages:

- fewer polished public examples and demo projects than mature workflow ecosystems
- Prompt Studio is visible and now has a safe one-click handoff from selected prompt context to `agentCollaboration` plan generation, while guarded execution intentionally remains in CLI/runtime evidence flow
- the Vue dashboard now explains partial/missing sources, but the normal HTTP serve path is still read-mostly until EventBus, artifact store, and FSM wiring are completed
- comparative quality claims still need repeatable eval datasets and release-to-release trend reports
- external skill ecosystems may have broader community templates, even when they lack hard gates

Highest-leverage improvements:

- add guided "prompt -> plan -> verify" handoff from Prompt Studio into safe plan generation and the normal guarded workflow commands
- publish a small benchmark corpus for hallucination, recovery, memory recall, long-task handling, and gate effectiveness
- add dashboard baseline trends for prompt optimizer use, token usage, verification pass rate, and memory recall usefulness
- keep interop adapters for gstack/OMC/ECC, but avoid letting adapter breadth outrank native governance quality

## 5. Current Gaps

### 5.1 Memory Architecture

Current state is closer to engineering knowledge persistence than true cognitive memory.

Existing strengths:

- artifacts persist decisions and work state
- memory brain stores evidence-backed learnings
- failure replay can preserve incidents
- provider routing gives the right extension point

Missing layers:

| Memory type | Target meaning |
| --- | --- |
| Working memory | short-lived task context with strict token budget |
| Episodic memory | past task episodes, failures, fixes, and outcomes |
| Semantic memory | stable project facts and domain concepts |
| Procedural memory | reusable ways of doing work |
| Strategy memory | learned routing, verification, and recovery strategies |

The next memory work should focus on provider-backed retrieval quality, not more local file accumulation.

### 5.2 Context Compiler

SCALE has context structure and budgets. It does not yet have a full context compiler.

Current capability:

- categorize context
- budget context
- lazy-load selected material
- assemble role/task-specific packs

Target capability:

- rank relevance
- slice semantically
- compress adaptively
- route retrieval by task intent
- explain why each context item was included
- measure token saved vs evidence lost

This is the highest-leverage path for token reduction.

### 5.3 Adaptive Workflow

The current workflow is mostly rule-driven.

The target workflow should adapt based on:

- task risk
- code ownership boundaries
- prior failure rate
- changed-file blast radius
- missing evidence
- tool reliability
- agent capability confidence

The system should not make every task heavy. It should apply stricter gates when risk rises and keep small documentation or config changes lightweight.

### 5.4 Skill Routing Intelligence

SCALE already models skills, MCP, CLI, browser, desktop automation, and evidence requirements.

The missing layer is strategy:

- when to call a skill
- why that skill is preferred
- what evidence it must produce
- what to do when it fails
- when to switch to MCP or CLI
- when to avoid tool use entirely

Skill routing should become a planned execution graph, not an ad hoc recommendation list.

### 5.5 Evaluator Intelligence

Current gates are strong for engineering completion, but weaker for reasoning quality.

Needed evaluator layers:

- critique loop for architecture and root cause
- uncertainty scoring
- adversarial review on high-risk changes
- tradeoff comparison
- failure hypothesis ranking
- "evidence is insufficient" verdicts

This is the path to reducing reasoning hallucination rather than only delivery hallucination.

### 5.6 Self-Optimization Loop

Evolution should mean more than summarizing lessons.

The target loop:

```text
failure evidence
  -> defect record
  -> root-cause classification
  -> lesson candidate
  -> rule candidate
  -> hook or gate proposal
  -> shadow validation
  -> regression check
  -> promoted governance behavior
```

The promotion step must remain evidence-backed. Automatically generating rules without validation risks turning mistakes into permanent friction.

## 6. Roadmap Direction

### 6.1 Planning Principle

The roadmap has release horizons plus a long-range vision:

| Horizon | Purpose | Claim boundary |
| --- | --- | --- |
| 0.27.x baseline | establish the AI OS Runtime primitives and adoption path | "runtime baseline", not "complete AI OS" |
| 0.28.0 closure | make planning, execution, verification, dashboard, benchmark, and adoption usable as a closed loop | "usable closed-loop beta", not "stable final OS" |
| 0.29.0 intelligence | make memory, context, and skill routing measurably smarter | "intelligence beta", not proven long-term cognition |
| 0.30.0 governance maturity | strengthen enterprise governance, upgrade, evaluator, and evolution controls | "governance maturity", not commercial stability |
| 1.0.0 beta | integrate the loop into a public AI Engineering OS beta | "public beta", backed by demos and benchmark evidence |
| Long-range vision | keep SCALE moving toward an AI Engineering OS with memory, context, governance, and tool intelligence | directional until backed by eval data |

The near-term work should be aggressive, but public wording must stay precise. SCALE can ship beta capabilities quickly; it should only claim stable, industry-leading AI OS behavior after repeated project evidence, benchmarks, and upgrade validation.

### 6.2 0.27.0: Cognitive Runtime Layer

Theme: make context, memory, and skill use more intelligent and explainable.

Core work:

| Module | Outcome |
| --- | --- |
| Context Compiler | relevance-ranked, budgeted, explainable context packs |
| Memory Provider Runtime | gbrain, agentmemory, code memory, and local memory as provider choices |
| Skill Routing Engine | task-intent routing with evidence requirements and fallback decisions |
| Governance ROI | quantify token cost, evidence quality, and gate friction |

Implemented baseline in v0.27.0:

```bash
scale ai-os plan \
  --task-id TASK-123 \
  --task "Fix OAuth callback auth token handling and verify browser flow" \
  --level L \
  --files src/auth/oauth.ts,src/ui/callback.tsx \
  --budget 8000 \
  --json
```

The command returns one runtime plan containing:

- `governance`: progressive mode, risk signals, required behaviors
- `context`: Context Compiler ranking, included sections, omitted sections, token savings
- `memory`: provider order, selected providers, fallback status, recalled items, memory context pack
- `skillPlan`: detected intents plus executable skill/artifact/verification steps
- `adaptiveWorkflow`: risk-adaptive gates and exit criteria for the task
- `roi`: benefit and overhead modules for context, memory, skill routing, and governance

Exit criteria:

- each context item has an inclusion reason: baseline implemented by `ContextCompiler`
- memory recall has provider, score, and evidence source: baseline implemented by Memory Provider Router
- skill recommendations include why, when, and required proof: baseline implemented by skill execution plans
- context pack generation reports token budget and omissions: baseline implemented by `context.pack.compiler`

### 6.3 0.27.x: Runtime Baseline and Adoption Path

Theme: make the AI OS Runtime installable, inspectable, and safe to adopt.

Current landing status:

- `scale ai-os plan` exists as the unified planning entry point for governance, context, memory, skill routing, adaptive workflow, and ROI.
- `scale ai-os run --dry-run` exists as the first beta execution slice.
- `scale ai-os run --mode guarded --verify "<command>"` executes explicit verification commands through the safe command runner, records each command as runtime evidence, and blocks the run when verification fails.
- `scale ai-os status --lang zh|en` checks runtime directories, plan/run evidence, guarded verification, dashboard health, benchmark evidence, and adoption evidence in one closed-loop readiness report; when verification evidence is missing, it recommends concrete guarded verification commands from `.scale/verification.json` or `package.json`.
- `scale ai-os dashboard` summarizes persisted run reports into ready/blocked counts, guarded verification health, pending evidence, failure learning candidates, and next recommendations.
- `scale ai-os benchmark` runs fixed beta scenarios and reports context token use, estimated savings, memory recall, skill steps, governance modes, and the current dashboard health snapshot.
- `scale ai-os migrate` creates or verifies the `.scale/ai-os` runtime directories and writes an idempotent migration report.
- `scale ai-os adopt` runs migrate, the first dry-run, benchmark, and doctor as one adoption path, then writes `.scale/ai-os/adoption.json`.
- `scale ai-os doctor --lang zh|en` checks AI OS runtime readiness without mutating the project and blocks adoption when required directories or dashboard health are broken.
- `scale upgrade check/plan` includes AI OS readiness, so existing projects see adoption, migration, and doctor steps through the normal upgrade workflow.
- The upgrade and adoption CLI surfaces now have human-facing Chinese and English output while preserving JSON for scripts, CI, and agent integrations.

Boundary:

- 0.27.x is the baseline. It proves the runtime surface and adoption path, but it does not yet prove autonomous source mutation, PR creation, long-term memory, or stable commercial AI OS behavior.

### 6.4 0.28.0: Usable Closed-Loop Enhancement

Theme: turn `ai-os plan` into a runnable beta loop.

Target timebox: 2-3 weeks.

Core work:

| Module | Outcome |
| --- | --- |
| `scale ai-os run` | execute the unified plan through workflow, context, memory, skill routing, and verification steps |
| Runtime Status | show whether plan, run, verification, dashboard, benchmark, adoption, and doctor evidence exist for the project |
| Verification Recommendation | derive suggested verification commands from task level, changed files, project verification profile, and risk signals |
| Failure Learning Closure | convert failed guarded runs, gate failures, and missing evidence into reviewed lesson/rule candidates |
| Closed-Loop Demo Pack | provide repeatable docs and code task demos that exercise plan -> run -> verify -> dashboard -> benchmark |
| Memory Provider Bridge | keep gbrain, agentmemory, code memory, and local memory selectable through one provider contract |
| Context Compiler v2 | merge task intent, risk level, files, memory recall, and role into one explainable context pack |
| Skill Router v2 | create an execution graph for skills, MCP tools, CLIs, artifacts, and required evidence |
| Adaptive Workflow Profiles | choose light, standard, or strict gates from risk and changed-file signals |
| AI OS Dashboard CLI | summarize gate health, memory hits, context budget, skill evidence, and ROI |
| Upgrade/Migration | migrate older `.scale` state and warn about incompatible local governance files |
| AI OS Adoption and Doctor | keep one-command adoption and readiness checks aligned with the normal upgrade workflow |
| Bilingual DX | keep key CLI help, errors, README guidance, and tutorials readable in Chinese and English |
| Benchmark Pack | run fixed samples for token budget, recall, gate pass rate, and skill-routing evidence |

Exit criteria:

- `scale ai-os run` can complete at least one documentation task and one code task in dry-run or guarded execution mode
- `scale ai-os status` or equivalent doctor output shows what is missing for a closed loop
- verification recommendations are explainable and can be overridden by explicit `--verify` commands
- execution output records context decisions, memory provider choices, skill decisions, gate results, and failure lessons
- benchmark output compares context token budget against a full-load baseline
- beta docs clearly state what is automated, what is proposed, and what still requires human approval

Current implementation status:

- In progress on the post-0.27.1 development branch.
- Runtime baseline, status visibility, verification recommendation, adoption, doctor, dashboard, benchmark, migration, upgrade integration, and bilingual adoption guidance are already landed.
- Remaining 0.28.0 work should focus on failure-learning closure and repeatable end-to-end demo evidence.
- It does not yet create PRs or mutate source files; richer skill execution remains a later implementation slice unless explicitly approved.

Explicitly deferred:

- default automatic PR creation or merge without review
- deep dynamic dependency sandboxing beyond audit, lockfile diff, and high-risk pattern checks
- full VLM visual judgment beyond screenshot capture and interface placeholders
- claims of human-level long-term memory or fully autonomous engineering

### 6.5 0.29.0: Memory, Context, and Skill Intelligence

Theme: make the beta loop measurably smarter rather than only broader.

Target timebox: 4-6 weeks.

Core work:

| Module | Outcome |
| --- | --- |
| Memory Quality Scoring | score recall precision, contradiction risk, accepted memory rate, and stale-memory risk |
| Provider Fallback Policy | choose between gbrain, agentmemory, code memory, local memory, or no memory with an explicit reason |
| Context Compression | summarize low-risk context while preserving high-risk evidence verbatim |
| Skill Strategy Learning | learn preferred tools from successful evidence, failures, and user overrides |
| Workflow Eval Integration | turn benchmark results into release-gate evidence |

Current first slice:

- `scale ai-os status --json` now includes an `intelligence` report with `memory-recall`, `context-savings`, `skill-routing`, and `benchmark-intelligence` signals; memory recall includes a quality score based on confidence, relevance, and evidence-backed items.
- Context intelligence now reports `contextQuality` with omitted sections, total omitted tokens, compression risk, and evidence-loss warnings when runtime evidence is dropped by budget constraints.
- Human `scale ai-os status --lang zh|en` output surfaces the same intelligence readiness summary so release reviewers can see whether 0.29.0 memory/context/skill gains are backed by run and benchmark evidence.

Exit criteria:

- memory recall has acceptance/rejection feedback
- context packs show savings, omissions, and evidence-loss warnings
- skill routing decisions can be compared against outcome quality
- release notes include measured deltas instead of aspirational percentages

### 6.6 0.30.0: Enterprise Governance and Upgrade Maturity

Theme: deepen adaptive governance beyond the v0.27.0 baseline.

Target timebox: 6-10 weeks.

Core work:

| Module | Outcome |
| --- | --- |
| Adaptive Workflow Router | production policy controls for dynamic gate profiles beyond the v0.27.0 planning output |
| Evaluator Intelligence | critique and uncertainty gates for architecture/root-cause work |
| Tool Strategy Planner | cost, retry, fallback, and evidence graph for tools |
| Evolution Shadow Promotion | lessons become rules only after validation |

Current first slice:

- `scale ai-os plan` now emits `evaluator` intelligence with strategy `evaluator-intelligence-v1`, required gates, risk level, uncertainty score, drivers, and recommendations.
- Architecture, root-cause, security, and release-risk tasks can automatically add `architecture-critique`, `root-cause-review`, `security-threat-model`, `release-readiness-review`, and `uncertainty-decision-log` gates to the adaptive workflow.
- `scale ai-os run` carries evaluator gates into the executable step list and evidence requirements, so reasoning-heavy work cannot be represented as a plain low-friction run.
- `scale ai-os status` now includes an `evaluator-intelligence` signal plus evaluator gate count and average uncertainty for release and milestone review.
- `scale ai-os plan` now emits `toolStrategy` with strategy `tool-strategy-v1`, converting skill, artifact, and verification steps into a cost, retry, fallback, side-effect, and evidence graph.
- `scale ai-os status` now includes a `tool-strategy` signal plus tool step count, estimated cost units, high-risk step count, and fallback coverage.
- `scale ai-os plan` now emits `agentCollaboration` with strategy `agent-collaboration-v1`, selected agent profile roles, DAG edges, handoff contracts, review gates, and per-role token budget.
- Dashboard Prompt Studio can generate the same `agentCollaboration` plan through `/api/agent/plan` without executing shell commands, then copy or download the plan JSON.
- `scale ai-os run` carries agent collaboration into the executable step list, so required agent roles, handoffs, and review gates become pending evidence instead of hidden prompt instructions.
- `scale ai-os run --mode guarded --verify "<command>" --json` now writes `agentExecution` with role, handoff, review-gate, and runtime evidence settlement when verification passes.
- `scale ai-os status --json` now includes an `agent-collaboration` intelligence signal plus `agentCollaborationQuality` summary for total roles, settled roles, reviewer roles, review gates, settled runs, handoffs, multi-agent runs, and budget reserve.
- `scale agent plan --task "<task>" --json` exposes the same planner directly for users who want role prediction and multi-agent orchestration before running the full AI OS loop.

Exit criteria:

- small tasks can stay lightweight with evidence
- risky tasks escalate automatically
- reasoning-heavy tasks get critique/evaluator gates
- evolution proposals can be traced to failure evidence and validation results

### 6.7 1.0.0 Beta: AI Engineering OS

Theme: integrate governance, memory, context, and tools into an operating layer.

Target timebox: 8-12 weeks.

Target capabilities:

- unified agent workspace policy
- provider-neutral memory and code intelligence
- cross-agent execution ledger
- adaptive workflow templates
- measurable token and quality reports
- ecosystem-safe skill and MCP lifecycle governance

Release criteria:

- install, upgrade, run, dashboard, benchmark, and migration flows work on clean projects
- at least three representative project types have documented smoke results
- failure learning produces reviewed rule candidates without silently hardening bad rules
- bilingual docs explain the core workflow without requiring maintainer context
- public claims are tied to `WORKFLOW_EVAL`, benchmark output, or release evidence

### 6.8 1.0.0 Stable and Long-Range Vision

This is the strategic north star, not the 0.28.0 closed-loop promise.

| Time horizon | Target state | Evidence required before public claim |
| --- | --- | --- |
| 8-12 weeks | AI Engineering OS beta: usable end-to-end loop across planning, execution, verification, memory, and dashboard | repeatable demo projects and benchmark reports |
| 3-6 months | stable governance runtime: upgrades, adapters, memory providers, and eval gates are reliable in real repositories | release-to-release regression data and field reports |
| 6-12 months | industry-leading agent engineering layer: adaptive workflows, strategy memory, tool intelligence, and cross-agent governance mature together | comparative evals, sustained issue closure, external adoption evidence |

Long-range capability themes:

- Cognitive memory: working, episodic, semantic, procedural, and strategy memory with explicit source and freshness controls.
- Adaptive orchestration: workflows selected by risk, ownership, failure history, and tool reliability instead of one fixed path.
- Tool intelligence: skills, MCP, CLIs, browser automation, and agent adapters treated as governed capabilities with cost, evidence, and fallback policy.
- Evaluator intelligence: critique loops, uncertainty scoring, adversarial review, and evidence insufficiency verdicts for reasoning-heavy tasks.
- Governance economics: token cost, gate friction, verification quality, and maintenance overhead measured as first-class product metrics.
- Ecosystem governance: external skills, memory providers, adapters, and templates integrated through attribution, license, source pinning, and supply-chain checks.

Non-negotiable boundary:

> The long-range vision can guide architecture, but it must not be used as a release claim until the corresponding evidence exists.

## 7. Measurement Plan

Strategic claims must be tied to measurement.

| Claim | Required metric |
| --- | --- |
| Fewer fake completions | final-check failure rate before/after gates |
| Fewer skipped steps | FSM blocked transition count and successful recovery rate |
| Fewer blind retries | repeated-command detector hits and fix iteration count |
| Lower token use | context pack token count vs baseline full-context load |
| Better memory | recall precision, accepted memory rate, contradiction count |
| Better skill use | recommended skill acceptance rate and evidence completion rate |
| Better workflow quality | pass@1, average fix iterations, failure replay closure rate |
| Safer dependencies | dependency audit block count and reviewed baseline count |

Target ranges can be tracked internally, but public claims should use measured values from `WORKFLOW_EVAL`, runtime evidence, or release reports.

## 8. Messaging Rules

Use:

- "Agent Governance Runtime"
- "AI Engineering OS direction"
- "runtime constraints instead of prompt-only discipline"
- "evidence-backed workflow gates"
- "provider-based memory and context orchestration"

Avoid:

- "fully autonomous engineer"
- "guaranteed 90% AI coding rate"
- "eliminates hallucination"
- "zero human governance"
- "universal memory"
- "all tools are safe by default"

The product message should be ambitious, but the engineering message must stay falsifiable.

## 9. Non-Goals

SCALE should not try to own every layer.

Non-goals:

- replacing all agent platforms
- building a full IDE
- becoming a generic automation shell
- implementing every memory backend internally
- copying external skills without attribution
- turning every task into heavyweight enterprise ceremony

The correct posture is:

> Govern agent engineering work, integrate external capability providers, and require evidence at the boundaries.

## 10. Documentation Placement

Recommended documentation split:

| Surface | Content |
| --- | --- |
| `README.md` / `README.en.md` | concise positioning, installation, core value, current capabilities |
| `docs/AI_ENGINEERING_OS_POSITIONING.md` | strategic category, gaps, roadmap, messaging rules |
| `docs/CONTEXT_BUDGET.md` | context budget and compiler mechanics |
| `docs/MEMORY_BRAIN.md` / `docs/MEMORY_FABRIC.md` | memory provider and recall behavior |
| `docs/SKILL_RADAR.md` / `docs/TOOL_ORCHESTRATION.md` | skill and tool routing behavior |
| `docs/WORKFLOW_EVAL.md` | measurable evidence and improvement claims |

README should not absorb this whole strategy. It should link here and keep the first screen user-focused.

## 11. Strategic Summary

SCALE's strongest current differentiator is not more prompts. It is a runtime governance model for AI engineering:

```text
Agent intent
  -> governed workflow state
  -> scoped context
  -> role/tool policy
  -> evidence-producing execution
  -> verification gates
  -> memory and evolution feedback
```

The next stage is to make this runtime more cognitive:

- compile context, do not just load it
- route memory, do not just store it
- plan skill use, do not just recommend it
- adapt workflow, do not just enforce one path
- validate evolution, do not just summarize lessons

If these are implemented with measurable evidence, SCALE can credibly move from "AI workflow engine" to "AI Engineering OS".
