# 工具编排治理

SCALE Engine 的技能路由不只推荐 Skills，还要约束 Agent 什么时候必须使用浏览器、联网、桌面自动化、MCP 或外部 CLI，并把证据沉淀到任务产物里。

## 目标

1. 让 Agent 主动选择合适工具，而不是只靠提示词记忆。
2. 让工具使用可审计：为什么选、是否执行、证据在哪里、失败如何降级。
3. 避免高风险自动化静默执行，特别是桌面 GUI、登录态网页、外部 Agent CLI、WPS、微信等场景。
4. 让 `scale init` 生成的项目治理模板继承同一套规则。

## 能力路由

| 场景 | 主能力 | 备选能力 | 必须证据 |
| --- | --- | --- | --- |
| UI/UX 设计与实现 | `impeccable` | `taste-skill`, `awesome-design-md`, `ui-ux-pro-max`, `frontend-design`, `design-review` | `ui-spec.md`, `impeccable-report`, `visual-review.md`, design-system 记录 |
| 登录态网页、动态网页、联网研究 | `web-access` | `agent-browser`, Chrome DevTools MCP | 来源引用、浏览器证据、网络/控制台记录 |
| 浏览器 E2E | `webapp-testing`, Playwright | `agent-browser`, `web-access`, Chrome DevTools MCP | 截图、console、network、E2E 运行结果 |
| 桌面/端侧 GUI 自动化 | CUA/computer-use | 手工验证、只读脚本 | 桌面截图、操作边界、测试账号或人工确认 |
| 外部 Agent CLI 编排 | RTK, Codex CLI, Gemini CLI, OpenCode CLI | 人工 review | 版本检查、完整命令、输出摘要、dry-run 或 safe-mode |

## 安全边界

- 登录态网页默认优先新建独立 tab，不操作用户已有 tab。
- 桌面自动化默认只读或测试账号；涉及真实账号、支付、删除、发送消息、生产数据时必须人工确认。
- 外部 CLI 只允许在明确目录和明确命令下运行，必须记录版本、命令、退出码和输出摘要。
- MCP/CLI 缺失时不能假装执行，必须在 `skill-evidence.md` 记录 skipped/fallback。
- `scale verify --require-installed-skills` 会检查 required skills 是否真实可用。
- `scale tool doctor --json` 会统一检查 skills、RTK、GBrain、CodeGraph、Graphify、浏览器和 MCP 能力，不再要求用户分散记忆多个入口。

## 已沉淀到引擎的契约

- `.scale/skills.json` 默认包含 `webResearch`, `browserAutomation`, `desktopAutomation`, `externalCli` 四类路由。
- UI 任务默认 required skill 包含 `impeccable`；`taste-skill`、`awesome-design-md`、`ui-ux-pro-max` 和 `frontend-design` 作为 recommended 支撑方向、设计系统、UX 验收与实现陪跑。
- Web research 任务默认 required skill 包含 `web-access`。
- Desktop automation 任务默认 required skill 包含 `cua`，并要求 operator-safety 与 side-effect-boundary 证据。
- `docs/workflow/templates/skill-plan.md` 和 `skill-evidence.md` 包含工具编排、浏览器证据、桌面/外部 CLI 证据表。

## 参考来源

- [pbakaus impeccable](https://github.com/pbakaus/impeccable)
- [LeonxlnX taste-skill](https://github.com/LeonxlnX/taste-skill)
- [VoltAgent awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
- [nextlevelbuilder ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [vercel-labs agent-browser](https://github.com/vercel-labs/agent-browser)
- [eze-is web-access](https://github.com/eze-is/web-access)
- [trycua/cua](https://github.com/trycua/cua)
