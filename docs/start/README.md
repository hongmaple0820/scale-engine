# SCALE Engine 入门路径

这个目录面向新用户。推荐先跑通一条最小路径，再理解完整体系。

## 推荐阅读顺序

1. [npx 与交互式安装指南](npx-interactive-install.md)
   不全局安装也能用 `npx` 跑 `scale install`。
2. [3 分钟快速开始](quickstart.md)
   从客户项目里安装 SCALE 工作流，并完成基础验收。
3. [客户冒烟测试](customer-smoke.md)
   安装后只跑 `scale open` 和 `scale smoke`，确认面板、健康检查和消息闭环。
4. [22 种 Agent 安装与使用教程](agent-installation-guide.md)
   查看 Codex、Claude Code、Cursor、Qoder、Cline、Windsurf 等 adapter 的细节。
5. [Artifact 生命周期](artifact-lifecycle.md)
   理解 Need、Spec、Plan、Task、Change、Evidence、Release 的状态流转。
6. [官方 Demo Walkthrough](agent-governance-demo.md)
   看一条真实任务如何走完诊断、TDD、证据和治理闭环。
7. [工作流能力与横向对比](../workflow/competitive-comparison.md)
   理解 SCALE 与 LangGraph、AutoGen、CrewAI、gstack、Superpowers、ECC 的定位差异。

如果你要开发 `scale-engine` 仓库本身，而不是把 SCALE 接入别的项目，请看：

- [开发者 Getting Started](../guides/GETTING_STARTED.md)
- [开发工作流](../guides/DEVELOPMENT_WORKFLOW.md)
- [工作流模板说明](../workflow/README.md)

## 15 分钟学习路径

```bash
mkdir scale-demo
cd scale-demo
npx -y @hongmaple0820/scale-engine@latest install --dir .
scale open --dir .
scale smoke --dir .
```

跑完后先确认：

- `.scale/config.yaml` 是否存在。
- `AGENTS.md` 或对应 Agent 规则文件是否存在。
- `scale open --dir .` 是否能打开 Agent Control 面板。
- `scale smoke --dir .` 是否能生成通过/失败原因清晰的验收报告。

如果这些问题答不上来，先不要继续看高级命令。SCALE 的原则是：没有真实命令结果，就不要声称通过。

## 场景选择

未全局安装时，用 `npx -y @hongmaple0820/scale-engine@latest ...` 替换下面的 `scale ...`。

| 场景 | 推荐入口 |
| --- | --- |
| 第一次试用 | `scale install --dir .` |
| 只安装工作流本体 | `scale install --pack core --dir .` |
| Codex 项目 | `scale install --agent codex --dir .` |
| 前端项目 | `scale install --governance-pack frontend-app --dir .` |
| Node/TypeScript 包 | `scale install --governance-pack node-library --dir .` |
| Go 多服务后端 | `scale install --governance-pack go-service-matrix --dir .` |
| 多仓库/MOE 工作区 | `scale install --governance-pack moe-workspace --dir .` |
| 安装推荐第三方能力 | `scale install --pack recommended --apply --yes --dir .` |
| 维护已有底层步骤 | `scale init`, `scale setup`, `scale setup --verify` |
| 工作流或第三方能力升级 | `scale upgrade --lang zh` |

已有项目先看 [SCALE 工作流升级指南](workflow-upgrade.md)，再决定使用 `scale install`、`scale upgrade` 还是底层命令拆分执行。
