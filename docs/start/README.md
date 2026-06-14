# SCALE Engine 入门路径

这个目录面向新用户。目标是先跑通一条最小路径，再理解完整体系，不要求一开始掌握所有命令。

## 推荐阅读顺序

1. [npx 与交互式安装指南](npx-interactive-install.md)
   先用 `npx` 临时执行 SCALE，不全局安装也能跑 `onboard`、`init --interactive` 和 `setup`。

2. [3 分钟快速开始](quickstart.md)
   从空目录初始化治理工作流，看到 `.scale`、模板、验证 profile 和状态输出。

3. [22 种 Agent 安装与使用教程](agent-installation-guide.md)
   按 Codex、Claude Code、Cursor、Cline、Windsurf 等 22 个 adapter 学会初始化、验证、开面板和多 Agent 使用。

4. [Artifact 生命周期](artifact-lifecycle.md)
   完整走一遍 Need → Spec → Plan → Task → Change → Evidence → Release，理解 FSM 和 Guard 如何用物理约束替代提示词建议。

5. [官方 Demo Walkthrough](agent-governance-demo.md)
   用一个 OAuth state 加固任务演示：上下文对齐、诊断计划、TDD 切片、HTML artifact、资源治理和工程规范扫描。

6. [工作流能力与横向对比](../workflow/competitive-comparison.md)
   对比 LangGraph、AutoGen、CrewAI、gstack、Superpowers、ECC、GitHub Agentic Workflows，理解 SCALE 的定位、优势和短板。

7. 回到根目录 [README](../../README.md)
   理解 SCALE Engine 的核心能力和 governance pack 选择。

8. [工作流升级指南](workflow-upgrade.md)
   理解工作流更新、第三方 skills/MCP/CLI 更新时如何先检查、生成计划、自动刷新干净受管文件，并避免覆盖本地改动。

9. 查看 [文档地图](../README.md)
   区分哪些文档是用户指南、哪些是参考资料、哪些是历史规划和过程记录。

如果你要开发的是 `scale-engine` 仓库本身，而不是把 SCALE 接入别的项目，改看：

- [../guides/GETTING_STARTED.md](../guides/GETTING_STARTED.md)
- [../guides/DEVELOPMENT_WORKFLOW.md](../guides/DEVELOPMENT_WORKFLOW.md)
- [../workflow/README.md](../workflow/README.md)

## 15 分钟学习路径

```bash
mkdir scale-demo && cd scale-demo
npx -y @hongmaple0820/scale-engine@latest quickstart --dir . --profile standard
npx -y @hongmaple0820/scale-engine@latest setup --dir .
npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .
```

跑完后先回答三个问题：

- `.scale/verification.json` 里定义了哪些验证 profile？
- `docs/workflow/templates/` 里有哪些任务产物模板？
- `scale status` 建议下一步做什么？

如果这三个问题答不上来，先不要继续看高级命令。

## 你应该先看到什么

跑完 quickstart 后，至少应该能看到：

- `preflight --preflight-profile quick` 可以执行。
- `status` 能告诉你当前项目下一步该做什么。
- `.scale/verification.json` 存在，并描述本地验证 profile。
- `docs/workflow/templates/` 存在，并包含 Mini-PRD、plan、verification、review、summary 等模板。
- `scale artifact render` 可以把任务 Markdown 证据渲染成 HTML。

如果其中任何一步失败，先看命令输出，不要假设是环境问题。SCALE 的原则是：没有真实命令结果，就不声称通过。

## 场景选择

下表的 `scale ...` 是全局安装后的简写；未全局安装时，用 `npx -y @hongmaple0820/scale-engine@latest ...` 替换 `scale ...`。

| 场景 | 推荐入口 |
| --- | --- |
| 不想全局安装，先试用 | [npx 与交互式安装指南](npx-interactive-install.md) |
| 第一次试用 | [3 分钟快速开始](quickstart.md) |
| 不知道自己的 Agent 怎么接入 | [22 种 Agent 安装与使用教程](agent-installation-guide.md) |
| 想看 Agent 治理闭环 | [官方 Demo Walkthrough](agent-governance-demo.md) |
| 想知道 SCALE 和其他工作流差异 | [工作流能力与横向对比](../workflow/competitive-comparison.md) |
| 前端项目 | `scale init --governance-pack frontend-app` |
| Node/TypeScript 包 | `scale init --governance-pack node-library` |
| Go 多服务后端 | `scale init --governance-pack go-service-matrix` |
| 多仓库/MOE 工作区 | `scale init --governance-pack moe-workspace` |
| 文档、报告、截图、脚本混乱 | `scale init --governance-pack resource-governance` |
| 工作流或第三方能力要升级 | `scale upgrade --lang zh` |
| 已有项目接入 AI OS runtime | `scale ai-os adopt --task "接入 AI OS runtime" --lang zh` |


## 工作流升级短路径

已有项目先看 [SCALE 工作流升级指南](workflow-upgrade.md)。它说明 `scale init --interactive`、`scale upgrade` 默认向导、`scale upgrade check/plan/apply/rollback` 高级入口、`scale ai-os adopt`、`--lang zh/en` 双语输出、仓库本地 `make workflow-upgrade-*` / `make workflow-aios-adopt` 入口，以及生成文件更新和项目级验证之间的边界。
