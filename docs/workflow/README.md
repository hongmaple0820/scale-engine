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

`npm run build` now builds the TypeScript CLI/runtime and builds the Vue 3 dashboard as the default UI. `npm run serve` prints the concrete dashboard URL, normally `http://localhost:3210/`. If the port is already occupied, either stop the stale process or set `SCALE_DASHBOARD_PORT=auto`.

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
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/verify.ps1 -Profile default
```

See [GATES_AND_SCORE.md](GATES_AND_SCORE.md) for gate catalog visibility, architecture standards gate scope, and deterministic task scoring.

See [PROMPT_OPTIMIZATION.md](PROMPT_OPTIMIZATION.md) for the deterministic prompt rewrite layer used by `scale prompt optimize` and `scale define`.

See [../VIBE-TEMPLATES.md](../VIBE-TEMPLATES.md) for built-in vibe coding templates. The default live dashboard is the Vue 3 + Naive UI app at the server root `/`. The Vue dashboard includes Overview, Workflow, Topology, Monitoring, Token/Cost, Documents, Knowledge, and Prompt Studio pages. Prompt Studio covers templates, packs, custom prompts, copy/download/export, and the deterministic optimizer. The Knowledge page separates repo knowledge base, gbrain memory, and graph visualization instead of treating memory as the whole knowledge system.

The dashboard reads `GET /api/dashboard/capabilities` before rendering capability claims. Empty panels should have an explicit source and reason: missing model usage means no `.scale/model-usage/usage.jsonl`; missing knowledge base means no knowledge docs, `.scale/knowledge.db`, or `graphify-out/graph.json`; missing gbrain memory means no `.scale/memory/brain.sqlite` nodes; partial realtime/workflow transitions mean the HTTP serve path has not been started with EventBus/FSM/store injection.

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
