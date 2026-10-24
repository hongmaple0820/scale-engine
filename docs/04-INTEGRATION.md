# 04 — Agent 集成方案

本篇回答：SCALE Engine 如何接入 Codex、Claude Code、Cursor、Gemini、OpenCode、Aider、Windsurf、Cline、Kilo Code、Antigravity、Qoder、Kiro 等 Agent。

完整逐项教程见：[22 种 Agent 安装与使用教程](start/agent-installation-guide.md)。

## 当前支持范围

当前源码中的 `SUPPORTED_AGENTS` 共 23 个：

```text
claude-code, codex, opencode, cursor, gemini, openclaw, hermes, trae,
workbuddy, zcode, vsc, qcoder, deepseek-tui, aider, windsurf, kimi, doubao,
kiro, qoder, jcode, cline, kilocode, antigravity
```

统一初始化入口：

```bash
scale install --agent AGENT-ID --pack core --dir .
scale open --dir .
scale smoke --dir .
```

已有项目先跑升级检查：

```bash
scale upgrade check --dir . --lang zh
scale upgrade plan --dir . --html --lang zh
```

## 集成原则

SCALE 采用 Headless Engine + Adapter 的方式接入不同 Agent：

| 接入面 | 作用 | 例子 |
| --- | --- | --- |
| CLI | 所有 Agent 都能显式调用的通用入口 | `scale verify`、`scale ai-os status`、`scale workflow effectiveness` |
| Agent settings/hooks | 在支持 hooks 的 Agent 中拦截或记录关键生命周期 | `.claude/settings.json`、`.codex/hooks.json`、`.agents/hooks.json` |
| Rules/instructions | 在不支持强 hooks 的 Agent 中提供项目级约束 | `AGENTS.md`、`CLAUDE.md`、`.clinerules/SCALE.md`、`.windsurf/rules.md` |
| Evidence/runtime | 把执行结果沉淀为可检查证据 | `.scale/evidence`、runtime ledger、AI OS run report |
| Dashboard/API | 给用户和团队看状态、空态原因和导出结果 | Vue dashboard、`/api/dashboard/*` |

## 为什么不是只写提示词

只写提示词会遇到几个问题：

- Agent 可以声称验证通过，但没有命令证据。
- 长任务中间失败后，用户很难知道是否恢复闭环。
- 多 Agent 使用不同规则文件，团队规范容易漂移。
- 记忆、知识库、图谱、token、发版状态分散在不同工具里。
- 面板如果不展示来源和空态原因，用户无法判断系统是否真的工作。

SCALE 的集成目标是让这些信息进入同一套可验证工作流：

```bash
scale ai-os plan --task "..." --level M --budget 8000 --json
scale agent plan --task "..." --level L --budget 12000 --json
scale workflow effectiveness --json
scale ai-os status --json
scale ship TASK-ID-FROM-BUILD --no-commit --json
```

## 22 个 Adapter 的主要产物

| Agent id | Settings | Knowledge/rules | Skills |
| --- | --- | --- | --- |
| `claude-code` | `.claude/settings.json` | `CLAUDE.md` | `~/.claude/skills` |
| `codex` | `.codex/hooks.json` | `AGENTS.md` | `~/.omx/skills` |
| `opencode` | `~/.config/opencode/hooks.json` | `AGENTS.md` | `~/.config/opencode/skills` |
| `cursor` | `.cursor/settings.json` | `.cursorrules` | `.cursor/skills` |
| `gemini` | `.gemini/settings.json` | `GEMINI.md` | `.gemini/skills` |
| `openclaw` | `.openclaw/settings.json` | `AGENTS.md` | `.openclaw/skills` |
| `hermes` | `.hermes/settings.json` | `.hermes.md` | `.hermes/skills` |
| `trae` | `.trae/settings.json` | `TRAE.md` | `.trae/skills` |
| `workbuddy` | `.workbuddy/settings.json` | `WORKBUDDY.md` | `.workbuddy/skills` |
| `zcode` | `.zcode/config.json`（hooks.events 嵌套格式） | `AGENTS.md`（幂等 merge） | `.zcode/skills` |
| `vsc` | `.vscode/scale.json` | `VSC.md` | `.vscode/skills` |
| `qcoder` | `.qwen/settings.json` | `QWEN.md` | `.qwen/skills` |
| `deepseek-tui` | `.deepseek/config.toml` | `.deepseek/instructions.md` | `~/.deepseek/skills` |
| `aider` | `.aider.conf.yml` | `AIDER.md` | `.aider/commands` |
| `windsurf` | `.windsurf/settings.json` | `.windsurf/rules.md` | `.windsurf/skills` |
| `kimi` | `.kimi/settings.json` | `.kimi/rules.md` | `.kimi/skills` |
| `doubao` | `.doubao/settings.json` | `.doubao/rules.md` | `.doubao/skills` |
| `kiro` | `.kiro/settings.json` | `.kiro/rules/SCALE.md` | `.kiro/skills` |
| `qoder` | `.qoder/settings.json` | `.qoder/rules/SCALE.md` | `.qoder/skills` |
| `jcode` | `.jcode/settings.json` | `JCODE.md` | `.jcode/skills` |
| `cline` | `.cline/settings.json` | `.clinerules/SCALE.md` | `.cline/skills` |
| `kilocode` | `.kilocode/settings.json` | `AGENTS.md` | `.kilocode/skills` |
| `antigravity` | `.agents/hooks.json` | `.agents/rules/SCALE.md` | `.agents/skills` |

## 多 Agent 并行使用

同一项目可以接入多个 Agent：

```bash
scale init --agent codex --dir .
scale init --agent claude-code --dir .
scale init --agent cursor --dir .
scale init --agent cline --dir .
```

建议搭配 runtime session：

```bash
scale runtime start --session-id 2026-06-14-auth --task-id 2026-06-14-auth --level M --agent codex
scale runtime doctor --level M
scale runtime final-check --session-id 2026-06-14-auth --task-id 2026-06-14-auth --level M
```

## 面板入口

在 `scale-engine` 仓库内：

```bash
npm run build
$env:SCALE_DASHBOARD_PORT="auto"
npm run serve
```

使用全局 npm 包：

```powershell
$scaleRoot = Join-Path (npm root -g) '@hongmaple0820/scale-engine'
$env:SCALE_DASHBOARD_PORT = 'auto'
node "$scaleRoot/dist/api/http.js"
```

多项目：

```powershell
$env:SCALE_DASHBOARD_PROJECTS = 'api=E:\work\api;web=E:\work\web'
$env:SCALE_DASHBOARD_PORT = 'auto'
node "$scaleRoot/dist/api/http.js"
```

服务会打印具体 URL。Vue 面板默认挂在根路径 `/`。

## DeepSeek Harness（DSH）插件接入

DSH 走的是**插件路线**，不经过本仓库的 adapter 体系（`src/adapters/`、`AgentPlatform`、hook 注册全部不碰）——详见 [接入方案](../docs/plans/2026-10-15-dsh-plugin-integration-plan.md)。两个交付物：

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| MCP stdio 入口 | `src/api/mcpStdio.ts`（`npm run mcp:stdio`） | 27 个 SCALE 工具进 DSH 工具表；默认收窄 `shell_run`/`shell_plan`（`SCALE_MCP_EXPOSE_SHELL=1` 恢复），过滤只发生在该 DSH 专属入口，其他 MCP 客户端不受影响 |
| 治理插件 | `packages/dsh-scale/`（独立 npm 包 `@hongmaple0820/dsh-scale`） | `tools/pre-execute`（block→deny、warn→ask、`pwsh→Bash` 等工具名映射、`mcp__scale__` 解包）、`systemPrompt.context`（InstinctStore/SessionInjector 注入）、`tools/post-execute`（异步证据落盘，默认 failures-only） |
| 插件 T2 | 同上 | 6 个治理斜杠命令（`/scale-preflight` 等，真实拉起 scale CLI，参数 allowlist 固定）+ `.scale/skills/` 阶段工作流技能进 DSH skills 注册表（provider 懒加载正文） |
| 插件 T3 | 同上（`exports["./client"]`） | 25 张 `mcp__scale__*` 工具的 `tool.call.toolview` 卡片（轻量 React，纯展示，不触文件系统）；动态数据面板（sidebar/settings）已评估并推迟——需宿主 typert Remote 通道 |

验证入口：

```bash
cd packages/dsh-scale && npm install && npm run build   # 主包先 npm run build
dsh --profile scale-dev --patch packages/dsh-scale/dev.patch.yml --dump-config
SCALE_DSH_SELFTEST=1 dsh --profile scale-dev --patch packages/dsh-scale/dev.patch.yml --help
```

注意：`desktop` profile 被 Electron 应用独占，开发/验收一律用独立 profile；插件不得构造 `SQLiteArtifactStore`/`MemoryBrain`（Electron ABI 与原生模块不兼容，plan R1）。

## MySpec（SDD）规范摄取

MySpec 等 SDD 工作台做的是「编码前的架构契约与验收标准建模」；SCALE 做的是「编码中的治理、验证与证据闭环」。两者通过规范摄取打通——前置建模产物直接成为 SCALE 的治理对象：

```bash
# MySpec 导出 ZIP 先解压成目录（4 个 md：constitution/requirements/solution/tasks）
scale spec import-myspec ./unzipped-bundle --name "Checkout Flow"

# 门禁可用的可追溯性审计：每条 EARS+ 验收标准必须被任务引用、
# 任务不得引用不存在的需求号、未完成任务默认判 FAIL（--allow-open-tasks 放宽）
scale spec conformance
```

摄取落点（两层）：`.scale/specs/myspec/<slug>/` 存原件 + 注册表；`.scale/specs/<slug>.md` 生成会话可注入的摘要（SessionInjector 自动拾取）；同时创建 Spec→Plan→Task 工件链（FSM 治理，`--no-artifacts` 跳过）。宪法不变量（`[INV-xx]`/MUST）映射为 spec `constraints`，EARS+ 标准（`WHEN/WHILE/IF … THEN … SHALL`）映射为 `successCriteria` 与 `verificationSurface`，错误分支标准额外进 `edgeCases`。

`scale spec conformance` 退出码语义对齐门禁（不合格=1），并在 `.scale/evidence/runtime/` 落一条 gate 证据——可直接作为命令接进任何验证链。

## 维护要求

- 新增或删除 Agent adapter 时，同步更新本页、[22 种 Agent 安装与使用教程](start/agent-installation-guide.md)、README 徽章和相关测试。
- CLI 参数变化时，同步更新 `docs/start/quickstart.md`。
- 不再使用旧的复数 agent 初始化参数或 add-agent 参数示例；当前入口是重复执行 `scale init --agent <id>`。
- 写横向对比时区分三类系统：Agent/IDE、Agent SDK/编排框架、SCALE repo 工作流 OS。
