# SCALE Engine 仓库工作流

这里描述的是 `scale-engine` 仓库自身的工程化工作流，不是终端用户如何使用 `scale` CLI。

## 入口

- 新维护者先读 [GETTING_STARTED.md](../guides/GETTING_STARTED.md)
- 日常开发读 [DEVELOPMENT_WORKFLOW.md](../guides/DEVELOPMENT_WORKFLOW.md)
- 机器可读分支策略看 [../../.scale/workspace.json](../../.scale/workspace.json)

## 最小命令面

```bash
make preflight
make new-task NAME=workflow-adaptation LEVEL=M
make plan NAME=workflow-adaptation LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md package.json' MSG='main contradiction'
make gate-workflow
make gate-quality
make verify PROFILE=default
scale gates status --json
scale score task --changed --json
scale prompt optimize --input "raw coding request" --json
scale vibe-index
npm run serve
```

`npm run build` now builds the TypeScript CLI/runtime and builds the Vue 3 dashboard as the default UI. For daily agent operation, start the resident control plane with `scale dashboard daemon ensure --dir . --port 3210 --json` and open `http://127.0.0.1:3210/#agents`. The daemon keeps the Vue dashboard, Agent Control APIs, Feishu/Lark route panel, health endpoint, PID files, restart count, and logs online. `npm run serve` remains available for temporary previews and prints the concrete dashboard URL, normally `http://localhost:3210/`. If the port is already occupied, either stop the stale process or set `SCALE_DASHBOARD_PORT=auto`.

### SCALE 2.0 引擎命令

```bash
# Scale Shield — 钩子拦截
scale shield compile          # 编译策略 + 安装 hook
scale shield status           # 验证 hook 注册 + .scale/ 完整性
scale shield test             # 运行 allow/block 测试

# Scale Orchestrator — 编排守护进程
scale orch start              # 启动 daemon
scale orch status             # 查看状态 + workspace 列表

# Scale Cortex — 持续进化
scale cortex evolve           # 完整进化周期
scale cortex extract          # 提取 Instincts
scale cortex inject --minimal # 预览 runtime/AI OS 会消费的 SessionStart 注入
scale cortex metrics --days 30 # 治理 ROI 报告
```

PowerShell:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/verify.ps1 -Profile default
```

See [GATES_AND_SCORE.md](GATES_AND_SCORE.md) for gate catalog visibility, architecture standards gate scope, and deterministic task scoring.

## Documentation and Artifact Health

`docs-health` is a blocking governance gate for maintained documentation, workflow configuration, and generated artifacts. It checks:

- maintained entry docs for merge markers, mojibake, replacement characters, and secret-like literals
- JSON syntax and duplicate keys in `package.json`, `.agent/project.json`, `.scale/verification.json`, and related governance files
- source/workflow/config changes that do not update any entry, workflow, guide, or start document
- root-level runtime artifacts such as screenshots, logs, traces, videos, and archives
- changed files that exceed `.scale/resource-policy.json` size limits
- internal Markdown links in maintained and changed docs

Run it directly with:

```bash
make verify-docs-health
node scripts/workflow/docs-health.mjs --json
```

`learning-health` is the companion gate for self-learning governance. It checks that repo-local reusable skills live under `.scale/skills/`, release packages include those skills and the learning gate script, memory provider routing still requires evidence, and default/CI verification profiles run the learning gate.

Storage and disk-cleanup requests route through the bundled `storage-analyzer` skill under `.scale/skills/storage-analyzer`. The workflow treats it as a recommended capability with required read-only scan evidence, generated report evidence, and an explicit cleanup-confirmation boundary; destructive cleanup remains a user-confirmed action, not an automatic workflow step.

Hook-sensitive CLI commands must stay safe in agent hook contexts. `scale gate before-stop` defaults to a hook-safe fast path that does not initialize the artifact engine; use `scale gate before-stop --enforce` only in explicit verification flows such as preflight or manual release checks.

`G8` runs the full docs-health gate and writes `.agent/logs/docs-health/g8-docs-health-report.json`. `G17` runs the link-health subset and writes `.agent/logs/docs-health/g17-link-health-report.json`. `npm run release:check` runs `npm run learning:health` and `npm run docs:health` before typecheck, lint, tests, smoke checks, build, package smoke, audit, diff hygiene, and package dry-run.

`npm run smoke:package` verifies that npm pack includes critical `dist/cli/*` command modules and that hook-sensitive commands such as `scale gate before-stop` and `scale meta-governance` start from the built package without creating `scale.db`.

GitHub source CI, published-package gate checks, and tag-based publish workflows also run `npm run learning:health` and `npm run docs:health` so Linux/macOS CI and release automation enforce the same documentation, artifact, skill-source, and memory-evidence policy as local verification.

### GitHub Actions CI Policy

Repository GitHub Actions follow the `dev -> master` branch policy from `.scale/workspace.json`. Source and package gate workflows run on pull requests and pushes to `dev` or `master`; no workflow should target a non-existent primary branch.

Every workflow must define explicit `permissions` and `concurrency`. Push and pull request checks cancel older in-progress runs for the same ref, while release and scheduled baseline jobs do not cancel in-progress runs because they publish or write baseline evidence.

Source CI runs learning health, docs health, lint, typecheck, build, tests, a high-severity production dependency audit, and the source fast-lane preflight before changes can land. The workflow is split into fan-out jobs: `check` gives the first lint/typecheck signal, `build` uploads the source `dist/` artifact, `test` and source `gate` consume that artifact on the OS matrix, and `audit` runs independently after `check`.

Coverage enforcement is a separate PR and `master` workflow. It runs `npm run coverage`, relies on Vitest coverage thresholds, appends a coverage table to the step summary, and uploads the generated coverage report as evidence.

Published-package gates install the package version declared in `package.json` first, then fall back to `@latest` only when that exact version is not yet published.

The deployment QA workflow fails fast when `deployment_status.target_url` is missing and caches Chromium browser downloads for Playwright-backed QA.

The performance baseline workflow uses typed `workflow_dispatch` inputs, emits warnings when gate timing regresses by more than 20% within the current measurement sample, and pushes baseline updates to the explicit `origin HEAD:master` ref.

Dependabot opens weekly non-major npm dependency updates and monthly GitHub Actions updates so dependency maintenance stays visible without automatically taking major-version risk.

The npm publish workflow runs on Node.js 22, uses npm cache, publishes with `NODE_AUTH_TOKEN`, and keeps npm provenance enabled with `npm publish --provenance`.

Gitee release metadata sync is intentionally local-only. The tag workflow does not require or read a GitHub Actions `GITEE_TOKEN`; maintainers who need the Gitee release page mirrored run `npm run release:sync-gitee` locally with a process-scoped Gitee API token after npm and GitHub Release publication.

See [PROMPT_OPTIMIZATION.md](PROMPT_OPTIMIZATION.md) for the deterministic prompt rewrite layer used by `scale prompt optimize` and `scale define`.

See [../VIBE-TEMPLATES.md](../VIBE-TEMPLATES.md) for built-in vibe coding templates. The default live dashboard is the Vue 3 + Naive UI app at the server root `/`. The Vue dashboard includes Overview, Workflow, Topology, Monitoring, Token/Cost, Documents, Knowledge, Agent Control, Integrations, and Prompt Studio pages. Agent Control is the main product surface for remote coding control: it manages project-scoped agent sessions, platform selection, model selection, dashboard/Feishu message routing, queued/claimed/completed messages, agent replies, and runtime inbox API commands. Integrations is the connector control surface: it manages Feishu/Lark routes, Tencent ima knowledge provider config, and the Agent Connect workflow for cc-connect-style channel matrix, Bridge protocol, Management API, Webhook, Cron, Heartbeat, Provider presets, Skill presets, and daemon hooks; see [../guides/AGENT_CONNECT_WORKFLOW.md](../guides/AGENT_CONNECT_WORKFLOW.md). The Dashboard service card keeps this product surface operational by showing resident watchdog state, supervisor/server PIDs, heartbeat, restart count, OS login-task state, and log paths, with one-click ensure/restart actions. Prompt Studio covers templates, packs, custom prompts, copy/download/export, deterministic optimization, and safe one-click agent planning. The built-in Vibe packs include Agentic company flow, multi-agent governed delivery, and budget-aware long-task autopilot prompts that connect agent profiles, role reviews, runtime evidence, gbrain, repository knowledge, token budgets, and gates. For machine-readable orchestration, use `scale agent plan --task "<task>" --json`, `scale ai-os plan --task "<task>" --json`, or the dashboard `/api/agent/plan` action; all emit `agentCollaboration` with selected roles, DAG edges, handoffs, review gates, and per-role token budget. Agent runtimes can also use `scale agent-control inbox --session <session-id> --claim-first --json` and `scale agent-control reply --session <session-id> --message <message-id> --text "<result>" --json`, or call `GET /api/agent-control/sessions/<session-id>/inbox`, `POST /api/agent-control/sessions/<session-id>/messages/<message-id>/claim`, and `POST /api/agent-control/sessions/<session-id>/messages/<message-id>/complete`, so CLI automation and the visual dashboard stay in one loop. Guarded AI OS runs with verification commands add `agentExecution` settlement evidence for roles, handoffs, and review gates, and `scale ai-os status --json` reports the `agent-collaboration` intelligence signal. The Knowledge page separates repo knowledge base, gbrain memory, and graph visualization instead of treating memory as the whole knowledge system. Documents and knowledge documents support preview, copy, single-file download, and governed online editing; the Knowledge page can import new files into `.scale/knowledge/imports/`. The graph view uses an Apache ECharts graph workbench with a large canvas, force layout, wheel zoom, drag pan, draggable nodes, node-count limiting for large graphs, node inspector, document jump, and graph export.

For end users, start with [../start/agent-full-workflow.md](../start/agent-full-workflow.md) and paste the prompt into the active coding agent. See [../start/agent-installation-guide.md](../start/agent-installation-guide.md) for the 22-agent installation and usage guide, and [competitive-comparison.md](competitive-comparison.md) for SCALE's positioning against Agent SDKs, IDE agents, skill workflows, and GitHub Agentic Workflows.

The dashboard reads `GET /api/dashboard/capabilities` before rendering capability claims. Empty panels should have an explicit source and reason: missing model usage means no `.scale/model-usage/usage.jsonl`; missing knowledge base means no knowledge docs, `.scale/knowledge.db`, or `graphify-out/graph.json`; missing gbrain memory means no `.scale/memory/brain.sqlite` nodes; missing dashboard service means `scale dashboard daemon ensure --dir . --port 3210 --json` has not been started; partial Agent Control means no ready platform/message route has been selected; partial realtime/workflow transitions mean the HTTP serve path has not been started with EventBus/FSM/store injection. Agent Control conversation history is first-class workflow evidence: use `scale agent-control transcript`, `scale agent-control search`, and `scale agent-control summary` or the `/#agents` History/Summary tabs to review, export, and import long-running agent conversations into the knowledge base.

## 模板与示例

- 不知道一个任务该用哪些模板、模板和哪个门禁挂钩，先读 [TEMPLATE_GUIDE.md](TEMPLATE_GUIDE.md)（按等级 + 按改动类型的选择矩阵，含模板↔门禁映射）。
- 想看从 `make new-task` 到提交的完整一遍真实命令，读 [E2E_EXAMPLE.md](E2E_EXAMPLE.md)。
- FSM Guard（物理阻止「未验证就 COMPLETE」）的状态机示例见 [../TASK_GUARD_WORKFLOW_DEMO.md](../TASK_GUARD_WORKFLOW_DEMO.md)。

## 门禁说明

SCALE 2.0 共 23 个门禁，分三层：核心门禁（G0-G8）、元治理门禁（G9-G15）、增强门禁（G16-G22）。

### 核心门禁（G0-G8）

| Gate | 作用 | 默认 | 阻断 |
| --- | | --- | --- |
| G0 | 构建命令或配置的验证命令必须通过 | ✅ | ✅ |
| G1 | 探索是否记录到状态文件，且至少读了 3 个文件 | ✅ | — |
| G2 | 计划是否包含边界、异常、回滚、现实校验 | ✅ | — |
| G3 | `src/` 行为改动是否伴随测试改动 | ✅ | ✅ |
| G4 | lint 命令必须通过 | ✅ | ✅ |
| G5 | 测试命令必须通过 | ✅ | ✅ |
| G6 | 覆盖率、任务证据和 diff hygiene 必须满足当前 profile | profile | ✅ |
| G7 | 安全和依赖风险检查必须通过 | profile | ✅ |
| G8 | 产品冒烟命令必须通过 | profile | ✅ |

### 元治理门禁（G9-G15）

| Gate | 作用 | 默认 | 阻断 |
| --- | | --- | --- |
| G9 | 知识库和 recall 能力是否被使用 | ✅ | — |
| G10 | 改进候选是否有证据支撑 | — | — |
| G11 | 护栏结果是否可见且可操作 | ✅ | — |
| G12 | 工作流阶段和制品是否完整 | ✅ | — |
| G13 | 多 Agent 协作是否有协调证据 | — | — |
| G14 | 必需 skill 是否被选择和验证 | — | — |
| G15 | 经验教训是否安全进入学习循环 | — | — |

### 增强门禁（G16-G22）

| Gate | 作用 | 默认 | 阻断 |
| --- | | --- | --- |
| G16 | 未提交文件数量和大文件阈值检查 | ✅ | ✅ |
| G17 | 变更的文档链接有效性检查 | ✅ | — |
| G18 | 运行时证据记录和退出码匹配 | ✅ | ✅ |
| G19 | L/CRITICAL 任务需要代码审查记录 | profile | ✅ |
| G20 | 无 CRITICAL/HIGH 漏洞；lock 文件一致性 | ✅ | ✅ |
| G21 | 上下文 token 预算检查（advisory） | ✅ | — |
| G22 | 会话健康检查：worktree 泄露和状态一致性 | ✅ | — |

## 分支策略

当前仓库采用 GitLab Flow 风格：

```text
feature/fix/docs/chore/codex -> dev -> master
```

约束：

- `dev` 是集成分支。
- `master` 是生产基线。
- `release/*` 只在必须从生产基线隔离发版时使用。
- `hotfix/*` 用于生产紧急修复，并要求回流 `dev`。

## 升级入口

如果要把仓库工作流继续升级到更新的 `scale-engine` 版本，先跑：

```bash
make bootstrap-scale
make workflow-upgrade-check
make workflow-upgrade-plan
make workflow-aios-adopt
```

先审计划，再决定是否 `make workflow-upgrade-apply`。如果计划提示 AI OS runtime 尚未接入，使用 `make workflow-aios-adopt` 生成运行态目录、首份 dry-run、benchmark 和 doctor 报告。
