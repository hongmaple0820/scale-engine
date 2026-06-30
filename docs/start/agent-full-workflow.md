# Agent 满血工作流一键接入

这份教程主要给用户复制给 Agent 用。用户不需要先学完 SCALE 的全部命令；把下面的提示词发给 Codex、Claude Code、Cursor、OpenCode、Gemini、Aider 或其他 coding agent，让 Agent 自己检查、安装、验证和汇报。

## 用户只做两件事

1. 在项目根目录打开 Agent。
2. 复制下面的提示词发给它。

## 复制给 Agent 的提示词

```text
你现在负责把当前项目接入 SCALE Engine 的满血版 agent 工作流。

目标：
- 让项目拥有 define -> plan -> build -> verify -> review -> ship 的可验证闭环。
- 默认启用第三方能力：rtk、gbrain 记忆、CodeGraph 代码结构索引、Graphify 知识图谱、浏览器/E2E 能力。
- 如果任务涉及远程提醒、手机端控制、项目对话列表或消息通知，再检查飞书 CLI/飞书消息通道；飞书真实发送前必须先 dry-run 并确认目标 chat/user。
- 不要静默降级成无记忆、无知识图谱、无消息通道的简化工作流。

先执行只读检查，并把结果用表格汇报：
1. `node --version`
2. `npx -y @hongmaple0820/scale-engine@latest --version`
3. `npx -y @hongmaple0820/scale-engine@latest setup --verify --pack full --dir . --json`
4. `npx -y @hongmaple0820/scale-engine@latest memory provider status --dir . --json`
5. `npx -y @hongmaple0820/scale-engine@latest codegraph status --dir . --json`
6. 如果存在 UI/web 任务，再检查浏览器/E2E 环境。
7. 如果需要消息通知或远程控制，再检查飞书 CLI 和飞书消息发送 dry-run 能力。
8. 如果项目允许启动本地面板，优先运行常驻守护入口 `scale dashboard daemon ensure --dir . --port 3210 --json`，再打开 `http://127.0.0.1:3210/#agents`。没有守护能力时才临时运行 `scale serve` 或 `npx -y @hongmaple0820/scale-engine@latest serve --dir .`。优先在 Agent Control 页面配置 agent 平台、模型、消息通道、会话队列和飞书 route；不要让用户手写 JSON。Agent runtime 使用 `scale agent-control inbox --session <session> --claim-first --agent-id <agent> --json` 认领任务，再用 `scale agent-control reply --session <session> --message <message> --text "<result>" --agent-id <agent> --json` 回写结果。

如果 SCALE 或第三方能力缺失，先给出安装计划，不要直接修改项目。计划里必须包含：
- 会安装/验证哪些能力。
- 会写入哪些项目文件或全局目录。
- 哪些能力需要用户授权、登录或提供 token。
- 失败后的回滚方式。

用户确认后，优先运行：
`npx -y @hongmaple0820/scale-engine@latest setup --pack full --memory-provider hrain --memory-mode local-only --apply --yes --dir .`

安装后必须再运行：
`npx -y @hongmaple0820/scale-engine@latest setup --verify --pack full --dir . --json`

如果 verification 仍显示 gbrain、CodeGraph、Graphify、rtk 或飞书消息通道不可用，不要说“已接入完成”。请把状态标为 degraded/blocker，并给出下一条可执行修复命令。

正式开发前，请按这个流程工作：
1. 先读项目入口文档和 AGENTS/CLAUDE/Cursor rules。
2. 先定义任务和验收标准。
3. 生成计划，列出风险、验证命令、回滚方式。
4. 再改代码。
5. 改完必须跑真实验证命令。
6. 汇报时列出实际命令、结果、未验证项和原因。
```

## Agent 应该默认检查的能力

| 能力 | 默认要求 | 验证方式 |
| --- | --- | --- |
| SCALE CLI | 必须可运行 | `npx -y @hongmaple0820/scale-engine@latest --version` |
| full setup pack | 必须检查 | `scale setup --verify --pack full --json` |
| rtk | 推荐默认启用 | `rtk gain` 或安装器 runtime check |
| hrain | 默认本地记忆供应商 | `scale memory provider status --json` |
| CodeGraph | 默认代码结构索引 | `scale codegraph status --json` |
| Graphify | 默认知识图谱产物供应商 | `scale setup --verify --pack knowledge --json` |
| 浏览器/E2E | UI/web 任务必须检查 | 项目测试命令或 Playwright smoke |
| 飞书 CLI/消息通道 | 消息提醒、远程控制、手机端场景必须检查 | dry-run 消息计划，确认目标后再真实发送 |
| Dashboard daemon | 面板、Agent Control 和消息通道配置的常驻守护入口 | `scale dashboard daemon ensure --dir . --port 3210 --json` 后检查 `/api/health` 和 `/api/dashboard/service` |
| Agent Control 面板 | Agent 平台、模型、消息通道和会话队列的默认配置入口 | 打开 `/#agents` 查看 Agent Control 和 `/api/agent-control` |
| Agent Control CLI | Agent runtime 消费远程 coding 队列的默认入口 | `scale agent-control inbox --claim-first --json` 和 `scale agent-control reply --message <id> --json` |
| Agent 聊天记录 | 默认保留会话历史、检索、摘要卡片和知识库归档入口 | `scale agent-control transcript --session <id> --json`、`scale agent-control search --query "<keyword>" --session <id> --json`、`scale agent-control summary --session <id> --json` |

## 为什么不让用户自己一步步装

SCALE 的核心使用者是 Agent。用户真正需要的是确认边界、授权安装、看验证证据；检查命令、第三方能力状态、安装计划和失败恢复应该由 Agent 完成。

初始化后生成的 `AGENTS.md`、`CLAUDE.md`、`.cursorrules`、`GEMINI.md`、`AIDER.md` 等 adapter 文档会内置同一段满血工作流 bootstrap，提醒 Agent 在每个项目里主动检查第三方能力并拒绝静默降级。
