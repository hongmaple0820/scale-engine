# Third-Party Skills and External References

This document records external skill projects that SCALE may learn from, recommend, or integrate with. It is a governance boundary, not a vendoring manifest. The complete cross-repo inventory is maintained in [External Reference Inventory](EXTERNAL_REFERENCES.md).

## Policy

- Do not vendor third-party skill code, images, logos, examples, or marketing copy unless the license review explicitly allows redistribution.
- Preserve upstream license text, copyright notices, NOTICE files, source URL, and source revision before any vendored or modified redistribution.
- Mark modified files and document what changed from upstream.
- Treat optional external services as review-required until privacy, retention, credential, and delete boundaries are reviewed.
- `scale skill doctor --supply-chain` must include license, attribution, script, and pinned-revision checks for third-party skills.
- Community skills start as `review-required`; promotion requires real installation evidence and a recorded safety decision.

## Highlighted External References

| Project | License | Upstream | SCALE usage | Redistribution status |
| --- | --- | --- | --- | --- |
| Planning with Files | MIT | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | Adapt concepts for file-backed plans, findings, progress logs, active-plan routing, and plan attestation. | Not vendored. |
| GBrain | MIT | [garrytan/gbrain](https://github.com/garrytan/gbrain) | Default memory provider route for graph-backed cross-session recall. SCALE verifies that a brain is configured and recall-critical health checks pass; CLI existence alone is not enough. | Not vendored. |
| impeccable | review-required | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Required UI anti-pattern gate in skill routing and tool policy. Used as a deterministic check before visual acceptance. | External skill reference; not vendored. |
| taste-skill | review-required | [LeonxlnX/taste-skill](https://github.com/LeonxlnX/taste-skill) | Recommended UI direction skill for setting visual language before implementation. | External skill reference; not vendored. |
| awesome-design-md | MIT | [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | DESIGN.md catalog for brand, visual language, typography, and design-system direction. `scale setup --pack ui --apply` syncs upstream under `~/.scale/vendor/awesome-design-md` and creates `~/.agents/skills/awesome-design-md/SKILL.md`. | Installed only with explicit setup/apply. |
| ui-ux-pro-max | Upstream project license | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | UX, UI state, accessibility, responsive, and acceptance-review skill. `scale setup --pack ui --apply` syncs upstream under `~/.scale/vendor/ui-ux-pro-max` and creates `~/.agents/skills/ui-ux-pro-max/SKILL.md`. | Installed only with explicit setup/apply. |
| LiteParse | review-required | [run-llama/llamaparse-agent-skills](https://github.com/run-llama/llamaparse-agent-skills) | Recommended document parsing skill for PDF, Office, OCR, screenshots, and batch knowledge ingestion. | External skill reference; not vendored. |
| D2 Diagram | review-required | [terrastruct/d2](https://github.com/terrastruct/d2) | Optional diagram-as-code reference for architecture, flow, sequence, and ER diagrams. | External CLI/skill reference; not vendored. |
| OpenSquilla Harness | review-required | [opensquilla/opensquilla](https://github.com/opensquilla/opensquilla) | Optional orchestration reference for routing, context loading, MetaSkill design, and feedback loops. | External skill reference; not vendored. |
| RTK | Upstream project license | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | Governed CLI proxy for shell-output compression and token savings. SCALE checks `rtk gain` and hook initialization. | External CLI only. |
| Graphify | Upstream project license | [safishamsi/graphify](https://github.com/safishamsi/graphify) | Knowledge graph artifact provider. SCALE expects `graphify-out/graph.json` and Codex hook/skill freshness before relying on it. | Generated artifacts are project-local. |
| CodeGraph | Upstream project license | [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) | Code structure provider for symbol/context exploration. SCALE expects a project `.codegraph/` index. | External CLI/index only. |
| GitNexus | PolyForm-Noncommercial-1.0.0 | [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus) | Optional code intelligence CLI/MCP provider for exploration, process context, and impact analysis. SCALE detects it and records install/init guidance, but does not make it a default required dependency. | External CLI/index only; license review required before commercial default use. |

Other referenced skills, MCP servers, CLIs, discovery candidates, and adapter targets are listed in [External Reference Inventory](EXTERNAL_REFERENCES.md). Unknown licenses stay `review-required`; do not treat a repository link as redistribution permission.

## Acknowledgements

SCALE acknowledges these upstream projects and contributors:

- `OthmanAdi/planning-with-files`, Copyright (c) 2026 Ahmad Adi.
- `garrytan/gbrain` and its upstream contributors.
- All upstream projects listed in [External Reference Inventory](EXTERNAL_REFERENCES.md) according to their licenses and contribution histories.

The current SCALE implementation records these projects as external references or adapted concepts. It does not copy their source code into this repository.

## Vendoring Checklist

If SCALE later vendors or modifies any third-party skill, the change must include:

1. Full upstream license text in the distributed package.
2. Upstream copyright and NOTICE material.
3. Source repository URL and pinned revision.
4. Modification notes for every copied or changed file.
5. Tests or doctor checks proving the attribution metadata is present.
6. README and generated skill repository documentation updates.

## Runtime Boundaries

External memory providers must not be enabled silently. Before use, record:

- provider endpoint and health check evidence
- project data scope
- credential boundary
- retention and deletion policy
- whether data leaves the local machine or team-controlled infrastructure
- whether provider writes are disabled, candidate-only, or explicitly enabled

External planning skills must not replace SCALE task evidence. They can improve the plan artifact shape, but final delivery still requires verification output, changed-file evidence, and explicit unverified-risk notes.

## User-Facing Setup

Use the governed installer instead of asking users to discover every upstream command manually:

```bash
scale setup --pack full
scale setup --pack full --apply --yes
scale setup --pack full --json
```

Default language is Chinese. Running `scale setup` without `--json` starts the interactive wizard: language, dependency pack, memory provider, memory route, and install scope. Use `--lang en` or `SCALE_LANG=en` for English output.

`setup` exposes report-level `runtimeChecks` before any install command runs. Missing `python`, `bun`, `cargo`, `uv/pipx`, or `node/npm/npx` is shown with a targeted install hint, so users can fix the environment before `--yes`/`--apply`.

Memory provider routing is intentionally gbrain-only in the current workflow policy:

```bash
scale setup --pack memory --memory-provider gbrain --memory-mode external-first --json
scale setup --pack memory --memory-provider gbrain --memory-mode external-first --apply --yes
scale setup --verify --pack memory --json
```

Repository maintainers should run the setup smoke before release or after changing installer behavior:

```bash
npm run smoke:setup
make setup-smoke
```

The smoke is intentionally non-destructive: it validates bilingual output, `runtimeChecks`, memory-provider routing writes in a temp `.scale`, and CodeGraph/Graphify status discovery without running third-party installers.

For a real installer smoke in an isolated home directory, verify the required UI gate and any supporting skill adapters you include:

```bash
scale setup --pack ui --apply --yes
npx impeccable --version
test -f ~/.agents/skills/awesome-design-md/SKILL.md
test -d ~/.scale/vendor/awesome-design-md
```

For OS-specific failures, run:

```bash
scale doctor env --json
```

This reports platform, shell discovery, PATH shape, core tools, package managers, and optional third-party runtimes in one machine-readable payload.

`frontend-design` is no longer part of the default UI install path. The default UI routing stack is:

- `impeccable` as the required deterministic UI anti-pattern gate.
- `taste-skill` for product visual direction and aesthetic parameters.
- `awesome-design-md` for brand, visual language, and `DESIGN.md`.
- `ui-ux-pro-max` for UX flow, UI state, accessibility, and responsive acceptance.
- `frontend-design` only when explicitly requested with `--include frontend-design`.
