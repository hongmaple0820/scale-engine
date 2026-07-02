# 04 — Agent 集成方案

本篇回答：SCALE Engine 如何接入 Codex、Claude Code、Cursor、Gemini、OpenCode、Aider、Windsurf、Cline、Kilo Code、Antigravity、Qoder、Kiro 等 Agent。

完整逐项教程见：[22 种 Agent 安装与使用教程](start/agent-installation-guide.md)。

## 当前支持范围

当前源码中的 `SUPPORTED_AGENTS` 共 22 个：

```text
claude-code, codex, opencode, cursor, gemini, openclaw, hermes, trae,
workbuddy, vsc, qcoder, deepseek-tui, aider, windsurf, kimi, doubao,
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

## 维护要求

- 新增或删除 Agent adapter 时，同步更新本页、[22 种 Agent 安装与使用教程](start/agent-installation-guide.md)、README 徽章和相关测试。
- CLI 参数变化时，同步更新 `docs/start/quickstart.md`。
- 不再使用旧的复数 agent 初始化参数或 add-agent 参数示例；当前入口是重复执行 `scale init --agent <id>`。
- 写横向对比时区分三类系统：Agent/IDE、Agent SDK/编排框架、SCALE repo 工作流 OS。
