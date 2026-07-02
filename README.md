<p align="center">
  <img src="https://img.shields.io/badge/version-0.55.1-orange?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/platforms-22-blue?style=flat-square" alt="platforms" />
  <img src="https://img.shields.io/badge/agents-22-blue?style=flat-square" alt="agents" />
  <img src="https://img.shields.io/badge/tests-verified-brightgreen?style=flat-square" alt="tests" />
  <img src="https://img.shields.io/badge/npm-0.55.1-cb3837?style=flat-square&logo=npm" alt="npm" />
</p>

[![RepoStars](https://repostars.dev/api/embed?repo=hongmaple0820%2Fscale-engine&theme=copper)](https://repostars.dev/?repos=hongmaple0820%2Fscale-engine&theme=copper)

# SCALE Engine v0.55.1

## 客户安装入口

首次接入项目时，优先使用一条主命令：

```bash
cd your-project
npx -y @hongmaple0820/scale-engine@latest install --dir .
```

已全局安装时：

```bash
cd your-project
scale install --dir .
```

`scale install` 会统一完成项目检测、标准化编号选择、工作流初始化、第三方能力规划/确认、安装进度显示、异常反馈和验收摘要。底层的 `scale init`、`scale setup`、`scale setup --verify` 仍保留给高级维护和 CI 拆分步骤。

CI 或团队模板推荐显式参数：

```bash
scale install --agent recommended --profile standard --governance-pack frontend-app --pack core --lang zh --dir . --json
```

SCALE Engine 让 AI Agent 不再只靠"自觉"遵守工程规范。它把探索、规划、实现、验证、评审、发版这些要求变成可执行的命令、门禁和证据文件，让人类可以看见 Agent 做了什么、跳过了什么、为什么能交付或不能交付。

源码仓库：https://github.com/hongmaple0820/scale-engine
国内镜像：https://gitee.com/hongmaple/scale-engine
npm：https://www.npmjs.com/package/@hongmaple0820/scale-engine
语言：[中文](README.md) | [English](README.en.md)
更新记录：[CHANGELOG.md](CHANGELOG.md)

## 给 Agent 的最短用法

如果用户反馈“文档太多、看不到重点”，先不要让用户逐条执行命令。打开项目后，把 [Agent 满血工作流一键接入](docs/start/agent-full-workflow.md) 里的提示词发给当前 coding agent，让 Agent 自己检查 SCALE、gbrain、CodeGraph、Graphify、rtk、浏览器/E2E 和飞书消息通道状态，再输出安装计划和验证证据。

核心命令是：

```bash
npx -y @hongmaple0820/scale-engine@latest install --agent recommended --pack core --lang zh --dir .
npx -y @hongmaple0820/scale-engine@latest setup --pack full --memory-provider hrain --memory-mode local-only --apply --yes --dir .
npx -y @hongmaple0820/scale-engine@latest open --dir .
npx -y @hongmaple0820/scale-engine@latest smoke --dir .
```

面板默认走常驻守护模式。打开 `http://127.0.0.1:3210/#agents` 后，用户在 Agent Control 里配置 agent 平台、模型、消息通道、会话队列和飞书 route；Agent runtime 通过 `scale agent-control inbox/reply` 消费队列，不需要用户手写 JSON。

## 它解决什么问题

| 常见问题 | SCALE 的处理方式 |
| --- | --- |
| Agent 没验证却说"测试通过" | 通过 verification profile 和 evidence store 记录真实命令与结果 |
| Agent 跳过需求澄清、设计、TDD 或 review | 通过 `scale context`、`scale diagnose`、`scale tdd`、`scale status` 生成下一步动作 |
| Agent 攒代码不提交，最后难以分段 | 通过 Commit Discipline 监控 git 状态，双阈值告警，自动分组建议 |
| Agent 误提交无关文件或跨仓库改错位置 | 通过 review-gated ship、MOE workspace 和子仓库 blocker 控制边界 |
| 多会话并行开发产生冲突 | 通过 Session Coordinator 文件重叠检测、冲突记录、依赖拓扑排序 |
| 多仓库项目 Git 工作流混乱 | 通过 Cross-Repo Orchestrator 协调分支、合并计划、ship 流水线 |

## 3 分钟看到效果

```bash
mkdir scale-demo && cd scale-demo
npx -y @hongmaple0820/scale-engine@latest install --agent recommended --pack core --lang zh --dir .
npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .
```

你会得到一套可提交到项目里的治理文件：

- `.scale/verification.json`：服务矩阵和验证 profile
- `.scale/skills.json`：skill 路由、统一来源和证据要求
- `.scale/skills/`：随仓库提交的通用 workflow skills 主来源；旧 `skills/` 仅作为兼容 fallback
- `.scale/tools.json`：CLI/MCP/browser/desktop 工具编排规则
- `docs/workflow/templates/`：Mini-PRD、plan、verification、review、summary 模板
- `docs/standards/`：工程规范、Git 协作、资源治理规则

继续体验完整闭环：

```bash
scale context grill --task-id TASK-001 --task "加固 OAuth callback"
scale diagnose plan --task-id TASK-001 --symptom "callback 在 state 过期时返回 500"
scale tdd slice --task-id TASK-001 --behavior "拒绝过期 OAuth state" --failing-test "expired state returns 401"
```

完整教程见 [Agent 满血工作流一键接入](docs/start/agent-full-workflow.md)、[npx 与交互式安装指南](docs/start/npx-interactive-install.md)、[3 分钟快速开始](docs/start/quickstart.md)、[22 种 Agent 安装与使用教程](docs/start/agent-installation-guide.md) 和 [官方 Demo Walkthrough](docs/start/agent-governance-demo.md)。如果你在评估 SCALE 和其他工作流的差异，先看 [工作流能力与横向对比](docs/workflow/competitive-comparison.md)。

## 安装

首次试用推荐 `npx`，不需要全局安装：

```bash
npx -y @hongmaple0820/scale-engine@latest install --dir .
```

长期高频使用再安装全局 CLI：

```bash
npm install -g @hongmaple0820/scale-engine
scale --version
```

需要 Node.js 22 或更高版本。

如果你希望把 UI skills、RTK、记忆/知识图谱这类第三方能力一起补齐，使用显式 bootstrap，而不是依赖静默自动安装：

```bash
scale setup --pack full --memory-provider hrain --memory-mode local-only --json
scale setup --pack full --memory-provider hrain --memory-mode local-only --apply --yes
scale setup --verify --pack full --json
```

`setup` 默认先出计划；只有显式加 `--apply --yes` 才会执行安装命令。默认记忆供应商是本地 `hrain`，不依赖外部线上服务；知识/代码图谱能力由 knowledge 包验证 CodeGraph 和 Graphify 的真实可用性。

安装入口变更后，先跑安装烟测：

```bash
npm run smoke:setup
make setup-smoke
```

它会验证中英文安装输出、运行时依赖诊断、记忆供应商切换，以及 Graphify/CodeGraph 状态路径；不会执行真实第三方安装。

如果用户机器出现 Windows/Unix 命令差异、PATH 不对、缺 Python/Bun/Cargo/RTK 等问题，先跑：

```bash
scale doctor env --json
```

## 适合谁

- 正在用 Codex、Claude Code、Cursor、Gemini CLI、OpenCode、Aider 等 Agent 写真实项目的团队。
- 有多服务、多仓库、MOE workspace、前后端分离需求的团队。
- 希望 Agent 主动使用 skills、MCP、CLI、浏览器、E2E，但又需要安全边界和证据闭环的团队。
- 经常遇到"AI 改得快，但难审、难验、难维护"的项目负责人。

## 核心能力

| 能力 | 说明 |
|------|------|
| **Workflow Engine** | `define → plan → build → verify → review → ship` 阶段化交付状态机 |
| **Gate System** | build、lint、test、coverage、security、TDD、review 门禁 |
| **AI OS Runtime** | `scale ai-os plan/run/status` — 任务规划、受控运行、治理仪表盘 |
| **Commit Discipline** | 监控 git 状态，双阈值告警，自动分组未提交文件 |
| **Session Coordinator** | 多会话并行协调，文件重叠检测，冲突记录 |
| **Cross-Repo Orchestrator** | 多仓库 Git 工作流编排，协调分支/合并/ship |
| **Task Dependency Graph** | DAG 依赖声明，拓扑排序，环检测 |
| **Ship Pipeline** | 8 步 ship 闭环，支持 dry-run、skip、version bump |
| **Security Audit** | OWASP Top 10 + STRIDE 安全审计引擎 |
| **Role Skills** | 6 个角色化审查视角（eng-manager、security-reviewer、qa-lead 等） |
| **Memory Intelligence** | 6 信号质量评分，跨 provider 冲突检测，新鲜度衰减 |
| **Governance ROI** | 端到端治理 ROI 度量 — token 成本 vs 质量 vs 门禁摩擦 |
| **Scale Shield** | 退出码钩子拦截引擎 — YAML 策略 → hook 脚本编译，40+ 危险命令阻断，退出码协议 |
| **Scale Orchestrator** | 声明式编排守护进程 — SCALE_POLICY.md 策略驱动，git worktree 隔离，协调循环 |
| **Scale Cortex** | 证据驱动持续进化 — 本能提取 (Instincts 0.3-0.9)，SessionStart 注入，跨 harness 适配器 |

## SCALE 2.0 三引擎架构

SCALE 2.0 引入三层引擎，对齐业界前沿项目的核心模式：

| 引擎 | 对标项目 | 核心能力 |
|------|---------|---------|
| **Scale Shield** | agent-hooks-in-depth | 退出码阻断 (exit 0/2)、stdin/stdout JSON 协议、40+ 危险命令拦截、`.scale/` 完整性保护 |
| **Scale Orchestrator** | Symphony WORKFLOW.md | 声明式策略驱动、git worktree 隔离、协调循环、多轮 Worker |
| **Scale Cortex** | ECC Instincts | 观察→模式→本能提取 (置信度 0.3-0.9)、SessionStart 注入、跨 harness (Claude/Codex/Cursor/Gemini) |

```bash
# Shield: 编译策略并安装 hook
scale shield compile
scale shield status

# Orchestrator: 启动声明式编排守护进程
scale orch start
scale orch status

# Cortex: 从失败中学习
scale cortex evolve
scale cortex metrics --days 30
scale cortex inject --minimal
```

## AI OS Runtime

Agent role planning is available through `scale agent plan --task "<task>" --json` and the dashboard Prompt Studio; the generated `agentCollaboration` plan includes selected agent profiles, DAG edges, handoff contracts, review gates, and per-role token budget. The dashboard Agent Control page is the visual entry for remote coding control: choose the agent platform, switch models, bind dashboard/Feishu message channels, queue messages, and expose the agent inbox/reply APIs. Use `scale open --dir .` to keep that control surface resident with health checks, restart count, PID files, and logs, then run `scale smoke --dir .` for one-command acceptance. The same plan is embedded in `scale ai-os plan/run`; guarded runs with verification commands now add `agentExecution` settlement evidence, and `scale ai-os status --json` reports both through the `agent-collaboration` intelligence signal.

AI OS Runtime 是 SCALE 的核心运行时规划层。`scale ai-os plan` 在一次命令里生成风险治理模式、Context Compiler 预算、Memory Provider 召回、Skill Routing 执行计划和 Governance ROI，让 Agent 在开始任务前就知道应该加载什么上下文、调用什么能力、补什么证据。

```bash
scale ai-os plan \
  --task-id TASK-123 \
  --task "修复 OAuth callback auth token 并验证浏览器回调流程" \
  --level L \
  --files src/auth/oauth.ts,src/ui/callback.tsx \
  --budget 8000 \
  --json
```

详细命令见 [AI OS Runtime 文档](docs/AI_ENGINEERING_OS_POSITIONING.md)。

## 学习路径

| 目标 | 入口 | 你应该学会什么 |
| --- | --- | --- |
| 让 Agent 直接接管 | [Agent 满血工作流一键接入](docs/start/agent-full-workflow.md) | 复制提示词，让 Agent 检查 full setup、gbrain、CodeGraph、Graphify、rtk、浏览器/E2E 和飞书消息通道 |
| 无全局安装试用 | [npx 与交互式安装指南](docs/start/npx-interactive-install.md) | 用 `npx` 跑 `onboard`、`init --interactive`、`setup` |
| 先跑起来 | [3 分钟快速开始](docs/start/quickstart.md) | 安装 CLI、初始化治理文件、运行 preflight |
| 接入具体 Agent | [22 种 Agent 安装与使用教程](docs/start/agent-installation-guide.md) | Codex、Claude Code、Cursor、Cline、Windsurf 等 22 个 adapter 的初始化、验证和面板入口 |
| 看完整闭环 | [官方 Demo Walkthrough](docs/start/agent-governance-demo.md) | 任务上下文、诊断、TDD、artifact 和验证证据如何串起来 |
| 横向评估 | [工作流能力与横向对比](docs/workflow/competitive-comparison.md) | 与 LangGraph、AutoGen、CrewAI、gstack、Superpowers、ECC、GitHub Agentic Workflows 的定位差异 |
| 接入已有项目 | [SCALE 工作流升级指南](docs/start/workflow-upgrade.md) | `init`、`upgrade check/plan/apply`、本地 `make` 包装入口 |
| 选择治理包 | [Governance Pack 文档](docs/start/README.md) | 不同项目形态应该选哪个 pack |
| 维护或扩展 SCALE | [docs/README.md](docs/README.md) | 文档地图、内部模块和长期维护资料 |
| 开发本仓库 | [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md) | `scale-engine` 仓库自身的工程化工作流 |

## 更新工作流

```bash
scale upgrade check --dir . --lang zh
scale upgrade plan --dir . --html --lang zh
scale upgrade apply --dir . --confirm --lang zh
```

SCALE 把升级分成三层：CLI 自身、已生成到项目里的 governance pack 文件、第三方 skills/MCP/CLI 能力。默认只检查和生成计划，不自动覆盖用户改过的文件。详见 [SCALE 工作流升级指南](docs/start/workflow-upgrade.md)。

## 开发本仓库

```bash
make preflight
make gate-workflow
make gate-quality
make verify PROFILE=default
```

入口文档：
- [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md) — 15 分钟上手
- [docs/guides/DEVELOPMENT_WORKFLOW.md](docs/guides/DEVELOPMENT_WORKFLOW.md) — 日常开发闭环
- [docs/workflow/README.md](docs/workflow/README.md) — 门禁、分支策略和升级入口

## 社区与推广

| 平台 | 链接 | 说明 |
|------|------|------|
| GitHub | https://github.com/hongmaple0820/scale-engine | 源码、Issues、PR |
| Gitee | https://gitee.com/hongmaple/scale-engine | 国内镜像与反馈 |
| npm | https://www.npmjs.com/package/@hongmaple0820/scale-engine | CLI 包下载 |
| QQ 群 | 628043364 | 国内用户交流、问题反馈 |
| 邮箱 | 2496155694@qq.com | 合作、反馈、建议 |

<p align="center">
  <img src="image/wechat-public.jpg" alt="SCALE Engine 微信公众号" width="220" />
  &nbsp;&nbsp;
  <img src="image/wechat-id-qr.webp" alt="个人微信" width="220" />
  &nbsp;&nbsp;
  <img src="image/feishu-group-qr.webp" alt="飞书交流群" width="220" />
</p>

## 赞赏与支持

如果 SCALE Engine 节省了你的工程治理时间，或帮助你的团队把 AI Agent 工作流落到可验证、可复盘、可发版的闭环里，欢迎赞赏支持。赞赏用于持续维护、示例项目、文档、测试矩阵和社区支持。

<p align="center">
  <img src="image/wxPay.jpg" alt="微信赞赏" width="220" />
  &nbsp;&nbsp;
  <img src="image/zfb.jpg" alt="支付宝赞赏" width="220" />
</p>

## License

[MIT](LICENSE)
