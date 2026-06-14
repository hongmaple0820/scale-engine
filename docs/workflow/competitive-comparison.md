# SCALE 工作流能力与横向对比

本文用于回答三个问题：

1. SCALE 工作流到底做什么。
2. 它对幻觉、长任务、记忆、门禁、技能使用、多 Agent 协同和发版质量有什么实际效果。
3. 它和主流 Agent SDK、IDE Agent、技能工作流、CI 型 Agentic Workflow 相比，优势和短板在哪里。

## 一句话定位

SCALE 是 repo-native AI Engineering OS，不是单个 Agent、不是 Agent SDK、也不是只靠提示词的流程包。它把 Agent 工作从“聊天窗口里的承诺”变成“项目仓库里的计划、规则、证据、门禁、记忆、知识库、图谱、token 和面板”。

## 能力地图

| 能力 | 当前入口 | 预期效果 | 证据来源 |
| --- | --- | --- | --- |
| 阶段化交付 | `scale define/plan/build/verify/review/ship` | 任务从需求到发版有明确状态，不靠 Agent 自述 | artifact、workflow state、ship report |
| 真实验证 | `scale verify`、`scale preflight`、verification profile | 降低“没跑测试却说通过”的幻觉 | `.scale/evidence`、命令 exit code |
| Agent Loop | `scale ai-os plan/run/status`、`scale workflow effectiveness` | 观察、决策、工具执行、反馈、终止/恢复可度量 | runtime ledger、agentLoop 指标 |
| 多 Agent 协同 | `scale agent plan --json` | 角色、DAG、handoff、review gate、预算可见 | `agentCollaboration`、`agentExecution` |
| 记忆 | `scale memory ...` + gbrain | 把已验证经验沉淀为可召回记忆 | gbrain、memory candidates、memory export |
| 知识库 | docs、`.scale/knowledge/imports/`、Graphify/CodeGraph | 项目知识可预览、可导入、可导出、可维护 | docs、knowledge imports、graph status |
| Token/成本 | `scale token record/report`、`scale cost-report` | 真实用量可追踪，长任务能做预算控制 | `.scale/model-usage/usage.jsonl` |
| 面板 | Vue dashboard HTTP server | 用户不用翻 JSON，也能看到工作流状态和空态原因 | `/api/dashboard/*` |
| 发版门禁 | `scale ship`、release/check 脚本 | ship 前把验证、review、边界、版本信息收束 | ship report、git diff、tag/release evidence |

## 对关键指标的实际作用

| 指标 | SCALE 如何处理 | 仍需注意 |
| --- | --- | --- |
| 幻觉 | 要求验证命令、evidence、runtime ledger；`workflow effectiveness` 暴露 missing signals | 没有接入项目测试时，SCALE 只能报告缺证据，不能替代测试 |
| 长时间任务 | AI OS plan、预算、fallback、多 Agent DAG、runtime final-check | 长任务仍需要用户或 CI 提供可运行环境 |
| 记忆 | 新项目推荐 gbrain；失败经验先进入候选，不能自动变成长线规则 | 记忆质量取决于证据质量，不能把一次失败结论直接固化 |
| 规范约束 | governance pack、工程规范、gate catalog、Shield/Orchestrator | 规则越强，初期摩擦越高，需要按项目等级调 profile |
| 门禁 | build/lint/test/security/TDD/review/preflight/ship 分层 | `dry-run` 只证明入口可调度，不代表质量通过 |
| 技能使用 | skill routing、tool strategy、Prompt Studio、vibe templates | 第三方 skill/CLI 需要供应链和可用性检查 |
| 可编排工作流 | Orchestrator、agent plan、AI OS run、multi-project dashboard | SCALE 当前更偏 repo/CLI 编排，不是完整 hosted SaaS |

## 与论文和方法论的关系

| 参考 | 核心思想 | SCALE 的落点 |
| --- | --- | --- |
| [ReAct](https://arxiv.org/abs/2210.03629) | 推理与行动交错，用外部环境反馈降低错误传播 | `ai-os plan/run/status`、runtime evidence、工具执行证据 |
| [Reflexion](https://arxiv.org/abs/2303.11366) | 从任务反馈形成语言反思和 episodic memory | `memory settle/ingest/query`、gbrain、失败闭环 |
| [SWE-agent](https://swe-agent.com/latest/) | 让模型自主使用工具修复真实 GitHub issue，重视可配置 agent-computer interface | verification profile、tool strategy、preflight、ship gates |
| [SWE-bench](https://www.swebench.com/) | 用真实软件工程 issue 衡量 Agent 修复能力 | `workflow eval`、failure replay、pass@k 思路 |

SCALE 的区别是：它不只描述 Agent loop，而是把 loop 的证据投到仓库、CLI、面板和发版流程里。

## 与 Agent SDK / 编排框架对比

| 项目 | 更擅长什么 | SCALE 更擅长什么 | 关系 |
| --- | --- | --- | --- |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) | 构建长运行、有状态、可持久化的人机协同 Agent runtime | 约束真实代码仓库里的 Agent 工作、门禁、证据、发版 | 可互补：LangGraph 构建 Agent app，SCALE 管工程交付 |
| [AutoGen](https://microsoft.github.io/autogen/stable/) | Python 多 Agent 应用、事件驱动框架、AgentChat/Core/Studio | 项目级治理、跨 Agent 适配、verification evidence | 可互补：AutoGen 管 agent 程序，SCALE 管 repo 工作流 |
| [CrewAI](https://docs.crewai.com/) | crews、flows、memory、knowledge、observability 的多 Agent 自动化 | 工程仓库接入、git/CI/发版门禁、22 Agent adapter | 可互补：CrewAI 做业务自动化，SCALE 管研发流程 |
| [GitHub Agentic Workflows](https://githubnext.com/projects/agentic-workflows/) | 把自然语言工作流编译到 GitHub Actions，偏 CI/云端自动化 | 本地/仓库内 Agent 治理、知识库、gbrain、面板、阶段任务 | 可互补：GitHub 侧跑周期任务，SCALE 侧管本地和发版证据 |

结论：LangGraph/AutoGen/CrewAI 是“做 Agent 应用”的框架，SCALE 是“让 Agent 参与软件工程交付”的工作流 OS。

## 与 Coding Agent / IDE 对比

| 工具 | 更擅长什么 | SCALE 补什么 |
| --- | --- | --- |
| [Codex CLI](https://github.com/openai/codex) | 本地终端 coding agent、读写代码、执行命令 | 项目级 hooks、证据、preflight、token/report、22 Agent 统一入口 |
| [Claude Code hooks](https://code.claude.com/docs/en/hooks) | 生命周期 hooks、工具调用拦截、项目 settings | 跨 Agent 一致治理、workflow effectiveness、dashboard、gbrain/knowledge |
| [Cursor Rules](https://cursor.com/docs/rules) | IDE 内持久规则、项目/团队/user 规则 | CLI 门禁、runtime ledger、ship 阶段、跨 IDE/CLI 复用 |
| [Cline Rules](https://docs.cline.bot/customization/cline-rules) | Cline 会话内 rules、AGENTS.md 兼容 | 统一 evidence、preflight、memory/knowledge/export、multi-agent planning |

结论：IDE Agent 让模型“会写代码”，SCALE 让团队“知道它是否按流程写、验证、复盘、可交付”。

## 与技能工作流对比

| 项目 | 公开定位 | SCALE 的差异 |
| --- | --- | --- |
| [gstack](https://github.com/garrytan/gstack) | 面向 Claude Code 的角色化工具/工作流集合 | SCALE 不绑定单一 Agent，提供 22 adapter、CLI 门禁、证据和面板 |
| [Superpowers](https://github.com/obra/superpowers) | brainstorming、worktree、plans、TDD、subagent、review、finish branch 的技能方法论 | SCALE 把类似方法进一步落到 `.scale/`、verification profile、runtime ledger、dashboard、release gates |
| [ECC](https://github.com/affaan-m/ecc) | 跨 harness operator system，强调 skills、instincts、memory、security、research-first | SCALE 的竞争点是 npm CLI、repo governance pack、知识库/图谱/面板和发版闭环的一体化 |

结论：技能工作流擅长“教 Agent 怎么做”，SCALE 进一步要求“做完留下可检查证据，并进入项目门禁”。

## SCALE 的优势

- 22 个 Agent adapter：覆盖 Codex、Claude Code、Cursor、Gemini、OpenCode、Aider、Windsurf、Cline、Kilo Code、Antigravity、Qoder、Kiro 等。
- repo-native：治理文件、证据、文档、知识库、规则都能进仓库审查。
- 分层门禁：quick preflight、verification profile、ship、release check 可以按任务风险调强度。
- 证据优先：失败、resolved、pass、token、memory recall、knowledge source、graph status 都能被面板和 CLI 读取。
- 对团队友好：不是只服务单个 Agent 会话，而是服务多人、多 Agent、多仓库、CI 和发版。
- 可解释：空态也要说明来源缺失，而不是面板空白或虚假 ready。

## SCALE 的短板

- 不是完整 hosted SaaS：部署、权限、团队账号、云端长期任务还需要外部平台或企业封装。
- 对项目基线有要求：没有测试、没有文档、没有可运行环境时，SCALE 只能暴露缺口，不能凭空制造质量。
- 初始学习成本高：workflow、memory、knowledge、dashboard、agent plan、preflight 需要一条清晰教程串起来。
- UI 仍应继续产品化：面板需要持续提升实时刷新、知识库编辑、图谱交互、token 成本、导入导出和多项目体验。
- 外部 Agent 能力差异大：有的 Agent 支持 hooks，有的只支持规则文件，强治理能力不能完全一致。

## 提升空间

1. 把 dashboard server 暴露成正式 `scale dashboard serve` CLI，而不是主要依赖 `npm run serve` 或直接运行 `dist/api/http.js`。
2. 增强知识库：导入、编辑、复制、下载、版本历史、批量导出、图谱节点跳转和预览。
3. 增强 gbrain 可视化：记忆节点、证据来源、冲突、过期、候选提升、导出。
4. 增强 token 成本闭环：自动从常见 Agent usage payload 采集，按 task/session/agent/role 归因。
5. 增强多 Agent 执行：从 `agent plan` 走到更完整的 role execution、handoff settlement、review gate replay。
6. 增强横向基准：用固定 demo repo 跑 pass/fail、recovery、hallucination、cost、latency、ship readiness 指标。

## 选型建议

| 用户场景 | 建议 |
| --- | --- |
| 只想构建一个 Agent 应用 | 优先看 LangGraph、AutoGen、CrewAI |
| 只想在 IDE 里更快写代码 | 先用 Codex、Claude Code、Cursor、Cline、Windsurf |
| 想让 Agent 参与真实项目交付，并且要可验证、可复盘、可发版 | 引入 SCALE |
| 已有 gstack/Superpowers/ECC 方法论 | 用 SCALE 承接证据、门禁、面板、发版和多 Agent 适配 |
| 已有 GitHub Actions 自动化 | 用 SCALE 在本地和 repo 内补任务证据，用 GitHub Agentic Workflows 跑云端定时/触发任务 |

## 对外表达

可以把 SCALE 描述为：

> SCALE Engine is a repo-native AI Engineering OS for coding agents. It does not replace Codex, Claude Code, Cursor, Cline, or agent frameworks; it gives them shared workflow gates, evidence, memory, knowledge, token accounting, dashboards, and release discipline.

中文表达：

> SCALE Engine 不是另一个聊天式 Agent，而是让各种 Agent 在真实项目里按工程流程工作、留下证据、经过门禁、能被面板观察并可发版复盘的工作流 OS。
