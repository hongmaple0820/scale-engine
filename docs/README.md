# SCALE Engine 文档地图

这个目录同时包含用户指南、治理能力说明、架构参考、历史规划和推广素材。新用户应优先阅读入门入口和当前治理能力文档，历史规划仅作为背景材料。

## 新用户入口

| 文档 | 说明 |
| --- | --- |
| [start/README.md](start/README.md) | 入门路径总览 |
| [start/npx-interactive-install.md](start/npx-interactive-install.md) | npx 临时执行、交互式安装、固定版本和国内镜像 fallback |
| [start/quickstart.md](start/quickstart.md) | 3 分钟快速开始 |
| [start/agent-installation-guide.md](start/agent-installation-guide.md) | 22 种 Agent 安装、初始化、验证、面板和多 Agent 使用教程 |
| [start/agent-governance-demo.md](start/agent-governance-demo.md) | 官方 demo walkthrough |
| [start/artifact-lifecycle.md](start/artifact-lifecycle.md) | Artifact 生命周期完整 walkthrough |
| [../README.md](../README.md) | 项目主页和能力总览 |

## 仓库维护入口

| 文档 | 说明 |
| --- | --- |
| [guides/GETTING_STARTED.md](guides/GETTING_STARTED.md) | `scale-engine` 仓库维护者的 15 分钟上手路径 |
| [guides/DEVELOPMENT_WORKFLOW.md](guides/DEVELOPMENT_WORKFLOW.md) | 本仓库日常开发工作流 |
| [workflow/README.md](workflow/README.md) | 仓库门禁、分支策略和 workflow 命令面 |

## 当前治理能力

| 文档 | 说明 |
| --- | --- |
| [SHIELD.md](SHIELD.md) | **Scale Shield** — 退出码钩子拦截引擎，YAML 策略编译，40+ 危险命令阻断 |
| [ORCHESTRATOR.md](ORCHESTRATOR.md) | **Scale Orchestrator** — 声明式编排守护进程，git worktree 隔离，协调循环 |
| [CORTEX.md](CORTEX.md) | **Scale Cortex** — 证据驱动持续进化，Instincts 提取，SessionStart 注入，治理 ROI |
| [RESOURCE_GOVERNANCE.md](RESOURCE_GOVERNANCE.md) | 文档、报告、媒体、脚本、临时产物的生命周期治理 |
| [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md) | 日志、安全、ORM、框架、测试、部署等工程规范 |
| [BACKGROUND_HUNTER.md](BACKGROUND_HUNTER.md) | Background Hunter 只读主动巡检、诊断交接和 ignore baseline |
| [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md) | 供应链依赖审计、G7 dependency 子门禁和 dependency policy |
| [TOOL_ORCHESTRATION.md](TOOL_ORCHESTRATION.md) | skills、MCP、CLI、浏览器、桌面自动化的编排策略 |
| [RUNTIME_EVIDENCE.md](RUNTIME_EVIDENCE.md) | 会话 ledger、运行时证据和最终交付检查 |
| [MEMORY_FABRIC.md](MEMORY_FABRIC.md) | Runtime evidence、session events、knowledge recall 和 graph status 的预算化上下文包 |
| [MEMORY_BRAIN.md](MEMORY_BRAIN.md) | 证据驱动的长期记忆、矛盾检测、dream 整理和 failure replay 沉淀 |
| [CONTEXT_BUDGET.md](CONTEXT_BUDGET.md) | Context Budget、Progressive Governance、Lazy Loading 和 Governance ROI |
| [CODE_INTELLIGENCE.md](CODE_INTELLIGENCE.md) | CodeGraph、Graphify 和显式 fallback 的代码智能与探索 ROI |
| [WORKFLOW_EVAL.md](WORKFLOW_EVAL.md) | Workflow Eval、pass@k 指标、Failure Replay 和改进候选 |
| [SKILL_RADAR.md](SKILL_RADAR.md) | Skill Radar、能力置信度、证据要求和供应链安全检查 |
| [AI_ENGINEERING_OS_POSITIONING.md](AI_ENGINEERING_OS_POSITIONING.md) | Agent Governance Runtime / AI Engineering OS 方向、`scale ai-os plan/run/status/dashboard/benchmark/migrate/adopt/doctor` runtime 入口、`0.28.0` 可用闭环增强和 3-12 个月远景路线 |
| [THIRD_PARTY_SKILLS.md](THIRD_PARTY_SKILLS.md) | 第三方 skill 致谢、授权边界、引用方式和 vendoring 策略 |
| [EXTERNAL_REFERENCES.md](EXTERNAL_REFERENCES.md) | 外部项目、skills、MCP、CLI 和适配器引用的完整清单 |
| [UPGRADE_MANAGEMENT.md](UPGRADE_MANAGEMENT.md) | SCALE CLI、governance pack、skills、MCP 和 CLI 工具的安全升级流程 |
| [GOVERNANCE_DASHBOARD.md](GOVERNANCE_DASHBOARD.md) | Runtime、eval、memory、resource、HTML artifact 的统一治理面板 |
| [RELEASE_READINESS.md](RELEASE_READINESS.md) | 发版前质量门槛、官方 demo 和真实项目落地验收 |
| [DOCUMENT_STANDARDS.md](DOCUMENT_STANDARDS.md) | 文档编写与维护规范 |
| [GITLAB_FLOW.md](GITLAB_FLOW.md) | GitLab Flow 分支、发版、tag 和临时 worktree 生命周期规范 |
| [SKILL-REPOSITORY.md](SKILL-REPOSITORY.md) | 受治理 skill repository 和安装安全策略 |
| [VIBE-TEMPLATES.md](VIBE-TEMPLATES.md) | 可复制的 Vibe Coding 提示词模板 |
| [LEADERSHIP-PRESETS.md](LEADERSHIP-PRESETS.md) | CEO、CTO、PM、Architect 等内置领导者角色预设 |
| [workflow/competitive-comparison.md](workflow/competitive-comparison.md) | 工作流能力、实际效果、短板和与 LangGraph/AutoGen/CrewAI/gstack/Superpowers/ECC 等横向对比 |

## 当前规划与执行蓝图

这些文档描述计划中的架构演进，不代表当前 CLI 已全部实现。进入实现前应按文档中的验收标准和红线逐项拆分任务。

| 文档 | 说明 |
| --- | --- |
| [plans/2026-05-20-scale-engine-v2-final-architecture-plan.md](plans/2026-05-20-scale-engine-v2-final-architecture-plan.md) | SCALE Engine V2.0 最终架构落地方案：Prompt Cache、Dashboard 聚合、Background Hunter、供应链门禁、动态/视觉验证和 Evolution Shadow Mode |

## 架构与参考

| 文档 | 说明 |
| --- | --- |
| [architecture/README.md](architecture/README.md) | **架构总览** — Mermaid 图解系统架构、核心引擎、数据流 |
| [reference/cli.md](reference/cli.md) | **CLI 参考** — 完整命令列表和用法示例 |
| [migration/v0.38-to-v0.44.md](migration/v0.38-to-v0.44.md) | **迁移指南** — v0.38 到 v0.44 的破坏性变更和升级步骤 |
| [00-OVERVIEW.md](00-OVERVIEW.md) | 系统概览 |
| [01-ARCHITECTURE.md](01-ARCHITECTURE.md) | 架构设计 |
| [02-DATA-MODEL.md](02-DATA-MODEL.md) | 数据模型 |
| [03-CORE-MODULES.md](03-CORE-MODULES.md) | 核心模块 |
| [04-INTEGRATION.md](04-INTEGRATION.md) | 平台与集成 |
| [06-DECISIONS.md](06-DECISIONS.md) | 架构决策记录 |

## 历史规划和过程记录

这些文档是历史上下文，不一定代表当前产品入口：

| 文档 | 说明 |
| --- | --- |
| [05-ROADMAP.md](05-ROADMAP.md) | 路线图 |
| [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md) | 历史优化计划 |
| [WEEK1-2-REPORT.md](WEEK1-2-REPORT.md) | 阶段报告 |
| [TASK_GUARD_SUMMARY.md](TASK_GUARD_SUMMARY.md) | Task Guard 总结 |
| [TASK_GUARD_WORKFLOW_DEMO.md](TASK_GUARD_WORKFLOW_DEMO.md) | 早期 workflow demo |
| [plans/2026-05-19-agent-engineering-os-upgrade-plan.md](plans/2026-05-19-agent-engineering-os-upgrade-plan.md) | Agent Engineering OS 升级审核稿：Context Budget、CodeGraph、Memory Brain、Skill Radar、HTML Artifact 和 Eval Harness |
| [plans/](plans/) | 规划方案和技术方案归档 |
| [superpowers/](superpowers/) | 外部方法论对照和计划归档 |

## 推广和素材

| 文档 | 说明 |
| --- | --- |
| [promote-article-v2.md](promote-article-v2.md) | 推广文章草稿 v2 |
| [promote-article-v2.html](promote-article-v2.html) | 推广文章 HTML v2 |
| [promote-article-v3.md](promote-article-v3.md) | 推广文章草稿 v3 |
| [promote-article-v3.html](promote-article-v3.html) | 推广文章 HTML v3 |
| [imgs/](imgs/) | 社群二维码和推广图片 |

## 维护规则

- 面向新用户的文档优先放在 `docs/start/`。
- 面向本仓库维护者的 workflow 文档优先放在 `docs/guides/` 和 `docs/workflow/`。
- 当前可执行能力放在根 README 和当前治理能力文档中。
- 历史规划不要混入新手教程，避免用户把旧计划当成当前事实。
- 如果 CLI 行为变化，必须同步更新 `README.md`、`docs/start/quickstart.md` 和相关 reference 文档。
- 如果新增 governance pack，必须同时更新 `README.md`、`docs/start/README.md` 和对应测试。
