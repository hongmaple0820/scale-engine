# External Reference Inventory

This inventory is the source of truth for external projects, community skills, MCP servers, CLIs, and adapter targets referenced by SCALE. It complements [Third-Party Skills and External References](THIRD_PARTY_SKILLS.md).

The inventory is intentionally conservative:

- A row here is an acknowledgement and governance record, not a claim that upstream code is vendored.
- License is only marked when it has been explicitly reviewed in this repository. Unknown or unverified projects stay `review-required`.
- Any future vendoring, source copying, modified redistribution, bundled assets, logos, examples, or generated derivatives must preserve upstream license text, copyright notices, NOTICE files, source URL, pinned revision, and modification notes.
- External services and memory providers remain disabled or read-only by default until privacy, retention, credential, and deletion boundaries are reviewed.

## Current References

| Upstream | Role in SCALE | Usage status | License status | Primary source surface |
| --- | --- | --- | --- | --- |
| [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | File-backed planning workflow reference | adapted concept, not vendored | MIT | `SkillRepository`, README, `THIRD_PARTY_SKILLS` |
| [garrytan/gbrain](https://github.com/garrytan/gbrain) | Default graph-backed memory provider | external provider, default-enabled | MIT | `MemoryProviders`, `SkillRepository`, README |
| [MemTensor/MemOS](https://github.com/MemTensor/MemOS) | Memory Operating System — graph-first 3-layer memory architecture | external provider, optional | Apache-2.0 | `MemoryProviders`, `SkillRepository`, README |
| [safishamsi/graphify](https://github.com/safishamsi/graphify) | Default knowledge graph and semantic recall source | external provider, default-enabled | review-required | `GraphifyKnowledgeBase`, `CodeIntelligence`, docs |
| [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) | AST-based code review with blast radius analysis | external CLI, optional | MIT | `CodeIntelligence`, `SkillRepository`, MCP tools |
| [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) | Upstream code intelligence CLI and MCP server for project-local code graph queries | external CLI and MCP reference | MIT | `CodeIntelligence`, `doctor`, quickstart docs |
| [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus) | Optional GitNexus code intelligence CLI and MCP provider for exploration and impact analysis | external CLI and MCP reference, optional | PolyForm-Noncommercial-1.0.0 | `CodeIntelligence`, `ToolCapabilityRegistry`, docs |
| [anthropics/skills](https://github.com/anthropics/skills) | Frontend and webapp testing skill references | external skill reference | review-required | `SkillRepository`, `SkillCatalog`, `ToolCapabilityRegistry` |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | Graphify and playwright-interactive skill references | optional discovery reference | review-required | `SkillDiscovery` |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Deterministic UI anti-pattern gate and design refinement skill | external skill reference | review-required | `SkillCatalog`, `SkillInstaller`, `SkillRepository`, `ToolCapabilityRegistry` |
| [LeonxlnX/taste-skill](https://github.com/LeonxlnX/taste-skill) | UI design-language direction skill | external skill reference | review-required | `SkillCatalog`, `SkillInstaller`, `SkillRepository`, `SkillDiscovery` |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | Design system and DESIGN.md guidance | external skill reference | review-required | `SkillRepository`, `ExternalSkills`, `SkillDoctor` |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | UI/UX design intelligence reference | external skill reference | review-required | `SkillRepository`, `ExternalSkills`, `ToolCapabilityRegistry` |
| [KKKKhazix/khazix-skills](https://github.com/KKKKhazix/khazix-skills) | Storage Analyzer upstream workflow skill reference | external skill reference | review-required | `SkillCatalog`, `.scale/skills/storage-analyzer`, `docs/workflow/README.md` |
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | Governed CLI proxy for output compression and shell wrapping | external CLI reference | review-required | `ToolCapabilityRegistry`, `ToolOrchestrator`, `InstalledSkillsIntegration`, docs |
| [eze-is/web-access](https://github.com/eze-is/web-access) | Web research and browser automation skill | external skill reference | review-required | `SkillRepository`, `ExternalSkills`, `SkillDoctor` |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Browser automation CLI | external CLI reference | review-required | `SkillRepository`, `ExternalSkills`, `ToolCapabilityRegistry` |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Chrome DevTools MCP integration | MCP reference | review-required | `SkillRepository`, `ExternalSkills`, `ToolCapabilityRegistry` |
| [trycua/cua](https://github.com/trycua/cua) | Desktop computer-use automation | restricted external automation reference | review-required | `SkillRepository`, `ExternalSkills`, `ToolCapabilityRegistry` |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Browser automation and validation | optional discovery reference | review-required | `SkillDiscovery` |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | Gemini CLI and community skill examples | external CLI and skill reference | review-required | `SkillRepository`, `SkillCatalog`, adapters |
| [openai/codex](https://github.com/openai/codex) | Codex CLI adapter and external reviewer | external CLI reference | review-required | `SkillRepository`, `ExternalSkills`, adapters |
| [sst/opencode](https://github.com/sst/opencode) | OpenCode CLI reference used by routing | external CLI reference | review-required | `SkillRepository`, `ExternalSkills`, `SkillDoctor` |
| [opencode-ai/opencode](https://github.com/opencode-ai/opencode) | OpenCode adapter source comment | adapter target reference | review-required | `OpenCodeAdapter` |
| [facebook/react](https://github.com/facebook/react) | React fix skill example | external skill reference | review-required | `SkillRepository`, `SkillCatalog` |
| [vercel/next.js](https://github.com/vercel/next.js) | Next.js documentation update skill example | external skill reference | review-required | `SkillRepository`, `SkillCatalog` |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) | Skill discovery example | external skill reference | review-required | `SkillRepository`, `SkillCatalog` |
| [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) | Full-stack agent skill example | external skill reference | review-required | `SkillCatalog` |
| [jnMetaCode/agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | Chinese role preset reference | external preset reference | review-required | `SkillRepository` |
| [run-llama/llamaparse-agent-skills](https://github.com/run-llama/llamaparse-agent-skills) | LiteParse document parsing skill reference | external skill reference | review-required | `SkillCatalog`, `SkillInstaller`, `SkillRepository`, `.scale/skills.json` |
| [terrastruct/d2](https://github.com/terrastruct/d2) | D2 diagram-as-code CLI and skill reference | optional external CLI/skill reference | review-required | `SkillCatalog`, `SkillInstaller`, `SkillRepository`, `.scale/skills.json` |
| [opensquilla/opensquilla](https://github.com/opensquilla/opensquilla) | Optional agent harness and orchestration reference | optional external skill reference | review-required | `SkillCatalog`, `SkillInstaller`, `SkillRepository`, `.scale/skills.json` |
| [yizhiyanhua-ai/fireworks-tech-graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) | Diagram skill discovery and installer reference | optional install reference | review-required | `ExternalSkills`, `SkillDiscovery`, `SkillInstaller` |
| [github/awesome-copilot](https://github.com/github/awesome-copilot) | Excalidraw diagram skill source | optional install reference | review-required | `ExternalSkills`, `SkillInstaller`, installation workflow doc |
| [Cocoon-AI/architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) | Architecture diagram skill reference | optional install reference | review-required | `ExternalSkills`, `SkillDiscovery`, `SkillInstaller` |
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | Video generation CLI reference | optional install reference | review-required | `ExternalSkills`, `SkillDiscovery`, `SkillInstaller` |
| [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) | PPT generation skill reference | optional install reference | review-required | `ExternalSkills`, `SkillDiscovery`, `SkillInstaller` |
| [HughYau/qiushi-skill](https://github.com/HughYau/qiushi-skill) | Materialist dialectics methodology for complex problem analysis | external skill reference | MIT | `ExternalSkills`, `SkillInstaller` |
| [tanweai/pua](https://github.com/tanweai/pua) | High-agency persistent problem-solving skill | external skill reference | review-required | `ExternalSkills`, `SkillInstaller` |
| [alchaincyf/nuwa-skill](https://github.com/alchaincyf/nuwa-skill) | Cognitive framework distillation for perspective skills | external skill reference | MIT | `ExternalSkills`, `SkillInstaller` |
| [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | QCoder adapter target | adapter target reference | review-required | `QCoderAdapter` |
| [Qoder docs](https://docs.qoder.com/) | Qoder adapter target | adapter target reference | review-required | `QoderAdapter` |
| JCode | JCode adapter target; upstream source and license still need review | provisional adapter target reference | review-required | `JCodeAdapter` |
| [Cline docs](https://docs.cline.bot/) | Cline adapter target | adapter target reference | review-required | `ClineAdapter` |
| [Kilo Code docs](https://docs.kilocode.ai/) | Kilo Code adapter target | adapter target reference | review-required | `KiloCodeAdapter` |
| [Google Antigravity docs](https://antigravity.google/docs/) | Antigravity adapter target | adapter target reference | review-required | `AntigravityAdapter` |
| [openclaw-ai/openclaw](https://github.com/openclaw-ai/openclaw) | OpenClaw adapter target | adapter target reference | review-required | `OpenClawAdapter` |
| [hermes-ai/hermes](https://github.com/hermes-ai/hermes) | Hermes adapter target | adapter target reference | review-required | `HermesAdapter` |
| [Hmbown/deepseek-tui](https://github.com/Hmbown/deepseek-tui) | DeepSeek TUI adapter target | adapter target reference | review-required | `DeepSeekTuiAdapter` |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | Aider adapter target | adapter target reference | review-required | `AiderAdapter` |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) | Competitive reference for durable, stateful agent orchestration | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |
| [Microsoft AutoGen](https://microsoft.github.io/autogen/stable/) | Competitive reference for event-driven multi-agent application frameworks | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |
| [CrewAI](https://docs.crewai.com/) | Competitive reference for crews, flows, memory, knowledge, and observability | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |
| [SWE-agent](https://swe-agent.com/latest/) | Research and workflow reference for autonomous software-engineering agents | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |
| [SWE-bench](https://www.swebench.com/) | Benchmark reference for software-engineering agent evaluation | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |
| [GitHub Agentic Workflows](https://githubnext.com/projects/agentic-workflows/) | Competitive reference for natural-language workflows compiled to GitHub Actions | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |
| [garrytan/gstack](https://github.com/garrytan/gstack) | Competitive reference for role-based Claude Code workflow tooling | comparison reference, not integrated | MIT | `docs/workflow/competitive-comparison.md` |
| [obra/superpowers](https://github.com/obra/superpowers) | Competitive reference for agentic skills and software-development methodology | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |
| [affaan-m/ECC](https://github.com/affaan-m/ecc) | Competitive reference for cross-harness operator workflow systems | comparison reference, not integrated | review-required | `docs/workflow/competitive-comparison.md` |

## Required Maintenance

When a new GitHub upstream is referenced from `src/skills`, `src/tools`, `src/adapters`, or current tool orchestration docs, update this inventory in the same change. `tests/docs/externalReferences.test.ts` scans those surfaces and fails if a referenced upstream is missing from this file.

Before promoting any `review-required` item to a declared license status, record:

1. upstream license file and revision
2. upstream copyright and NOTICE obligations
3. whether SCALE vendors code, adapts concepts, or only links to the project
4. modification notes for copied or derived files
5. installation, script, and permission review evidence
