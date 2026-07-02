# 22 种 Agent 安装与使用教程

目标：让用户知道 SCALE 工作流如何接入不同 AI Coding Agent，以及接入后应该如何验证、看效果、开面板和持续维护。

SCALE 不替代 Codex、Claude Code、Cursor、Cline、Windsurf 这类 Agent。SCALE 是一层 repo-native 工作流治理系统：把需求澄清、计划、实现、验证、评审、记忆、知识库、token 统计和发版门禁落到可执行命令、项目文件和证据记录里。

如果用户只想开始远程 coding 或让 Agent 自动检查第三方能力，先使用 [Agent 满血工作流一键接入](agent-full-workflow.md)。这份安装教程保留给需要逐项理解 22 个 adapter 的维护者。

## 先理解接入模型

SCALE 接入 Agent 分三层：

| 层级 | SCALE 做什么 | 用户能看到什么 |
| --- | --- | --- |
| Agent 入口文件 | 为不同 Agent 写入它能识别的规则文件、settings、hooks 或 instructions | `CLAUDE.md`、`AGENTS.md`、`.cursor/`、`.cline/`、`.windsurf/` 等 |
| 工作流命令 | 提供 `define -> plan -> build -> verify -> review -> ship` 和 `ai-os plan/run/status` | 每一步有命令、证据和状态，不只靠口头承诺 |
| 治理能力 | 统一 memory、knowledge、graph、token、runtime evidence、dashboard | 面板、JSON 报告、导出文件、门禁结果 |

不同 Agent 的 hook 能力不完全一致。支持 hooks 的 Agent 可以更强地拦截工具调用；只支持规则文件的 Agent 仍然能通过项目 instructions、显式命令和 preflight 形成闭环。

## 0. 先用 npx 运行 SCALE

```bash
npx -y @hongmaple0820/scale-engine@latest --version
npx -y @hongmaple0820/scale-engine@latest install --dir .
```

要求 Node.js 22+。Agent 本体仍按各自官方方式安装，SCALE 负责把项目接入该 Agent 的治理入口。长期高频使用时再执行 `npm install -g @hongmaple0820/scale-engine`，之后在目标项目目录运行 `scale install --dir .`。

## 1. 新项目 3 分钟接入

```bash
mkdir scale-demo
cd scale-demo
npx -y @hongmaple0820/scale-engine@latest install --agent recommended --pack core --lang zh --dir .
npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .
npx -y @hongmaple0820/scale-engine@latest status --dir .
```

关键点：

- `--agent recommended` 一次写入 Codex、Claude Code、Cursor、Qoder、Cline、Windsurf；`--agent all` 写入全部已支持平台；`--agent codex,claude-code` 写入指定组合。
- 新项目默认推荐 `hrain` 本地记忆供应商；它不要求外部 API key 或线上 embedding 服务。
- full workflow 默认检查 rtk、gbrain、CodeGraph、Graphify、浏览器/E2E；消息提醒或远程控制场景再检查飞书 CLI/消息通道。
- `setup --verify --pack full --json` 是第三方能力可用性检查；如果需要安装，再让 Agent 输出计划并在确认后运行 `setup --pack full --apply --yes`。
- 真正交付前至少跑 `scale preflight --preflight-profile quick` 或项目自己的 build/lint/test。

`0.54.4` 补丁约定：`hrain` 是 SCALE 内置的本地记忆 provider。安装验收通过 `scale memory provider status --json` 检查它，不要求项目或用户目录里额外存在 `hrain/SKILL.md`。

## 2. 已有项目接入

已有项目不要盲目覆盖历史规则，先检查再应用：

```bash
scale upgrade check --dir . --lang zh
scale upgrade plan --dir . --html --lang zh
scale install --agent recommended --pack core --dir .
scale smoke --dir . --json
git diff
```

如果项目已经接入某个 Agent，需要再补第二个 Agent，可以重复运行：

```bash
scale install --agent claude-code,cursor,cline --pack core --dir .
```

每次都应看 `git diff`。SCALE 会尽量合并已存在配置，但团队自定义规则仍需要人工确认。

## 3. 22 个 Agent 接入表

统一命令模板：

```bash
scale install --agent AGENT-ID --pack core --dir .
scale open --dir .
scale smoke --dir .
```

下表为了可读性使用 `scale ...` 简写。没有全局安装时，把 `scale` 替换为 `npx -y @hongmaple0820/scale-engine@latest` 即可。

| Agent id | 面向工具 | SCALE 初始化命令 | 主要生成/维护文件 | 使用方式 |
| --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | `scale init --agent claude-code --dir .` | `.claude/settings.json`、`CLAUDE.md`、`~/.claude/skills` | 在项目目录运行 `claude`，让 Claude 读取项目规则和 hooks |
| `codex` | OpenAI Codex CLI / Codex App | `scale init --agent codex --dir .` | `.codex/hooks.json`、`AGENTS.md`、`~/.omx/skills` | 在项目目录运行 `codex`，或在 Codex App 打开项目 |
| `opencode` | OpenCode | `scale init --agent opencode --dir .` | `~/.config/opencode/hooks.json`、`AGENTS.md`、`~/.config/opencode/skills` | 在 OpenCode 会话中打开该项目 |
| `cursor` | Cursor | `scale init --agent cursor --dir .` | `.cursor/settings.json`、`.cursorrules`、`.cursor/skills` | 用 Cursor 打开项目，让 Project Rules 约束会话 |
| `gemini` | Gemini CLI | `scale init --agent gemini --dir .` | `.gemini/settings.json`、`GEMINI.md`、`.gemini/skills` | 在项目目录运行 Gemini CLI |
| `openclaw` | OpenClaw | `scale init --agent openclaw --dir .` | `.openclaw/settings.json`、`AGENTS.md`、`.openclaw/skills` | 在 OpenClaw 中打开项目并读取 SCALE rules |
| `hermes` | Hermes | `scale init --agent hermes --dir .` | `.hermes/settings.json`、`.hermes.md`、`.hermes/skills` | 在 Hermes 会话里使用项目规则 |
| `trae` | Trae | `scale init --agent trae --dir .` | `.trae/settings.json`、`TRAE.md`、`.trae/skills` | 用 Trae 打开项目工作区 |
| `workbuddy` | WorkBuddy | `scale init --agent workbuddy --dir .` | `.workbuddy/settings.json`、`WORKBUDDY.md`、`.workbuddy/skills` | 用 WorkBuddy 打开项目工作区 |
| `vsc` | VS Code/通用 VSC 入口 | `scale init --agent vsc --dir .` | `.vscode/scale.json`、`VSC.md`、`.vscode/skills` | 适合 VS Code 侧插件或通用编辑器规则承载 |
| `qcoder` | Qwen/QCoder | `scale init --agent qcoder --dir .` | `.qwen/settings.json`、`QWEN.md`、`.qwen/skills` | 在 Qwen/QCoder 工具中打开项目 |
| `deepseek-tui` | DeepSeek TUI | `scale init --agent deepseek-tui --dir .` | `.deepseek/config.toml`、`.deepseek/instructions.md`、`~/.deepseek/skills` | 在项目目录运行 DeepSeek TUI |
| `aider` | Aider | `scale init --agent aider --dir .` | `.aider.conf.yml`、`AIDER.md`、`.aider/commands` | 在项目目录运行 `aider`，用 commands 调用 SCALE |
| `windsurf` | Windsurf | `scale init --agent windsurf --dir .` | `.windsurf/settings.json`、`.windsurf/rules.md`、`.windsurf/skills` | 用 Windsurf 打开项目工作区 |
| `kimi` | Kimi | `scale init --agent kimi --dir .` | `.kimi/settings.json`、`.kimi/rules.md`、`.kimi/skills` | 在 Kimi 工具中读取项目规则 |
| `doubao` | Doubao | `scale init --agent doubao --dir .` | `.doubao/settings.json`、`.doubao/rules.md`、`.doubao/skills` | 在 Doubao coding agent/IDE 中打开项目 |
| `kiro` | Kiro | `scale init --agent kiro --dir .` | `.kiro/settings.json`、`.kiro/rules/SCALE.md`、`.kiro/skills` | 用 Kiro 打开项目工作区 |
| `qoder` | Qoder | `scale init --agent qoder --dir .` | `.qoder/settings.json`、`.qoder/rules/SCALE.md`、`.qoder/skills` | 用 Qoder 打开项目工作区 |
| `jcode` | JCode | `scale init --agent jcode --dir .` | `.jcode/settings.json`、`JCODE.md`、`.jcode/skills` | 在 JCode 工具中打开项目 |
| `cline` | Cline | `scale init --agent cline --dir .` | `.cline/settings.json`、`.clinerules/SCALE.md`、`.cline/skills` | 在 VS Code/Cline 中打开项目，让 Cline Rules 生效 |
| `kilocode` | Kilo Code | `scale init --agent kilocode --dir .` | `.kilocode/settings.json`、`AGENTS.md`、`.kilocode/skills` | 在 Kilo Code 中打开项目 |
| `antigravity` | Google Antigravity | `scale init --agent antigravity --dir .` | `.agents/hooks.json`、`.agents/rules/SCALE.md`、`.agents/skills` | 在 Antigravity 中打开项目，让 `.agents/` 规则生效 |

## 4. 常见组合

### Codex + Cursor

适合一个团队同时使用终端 Agent 和 IDE Agent：

```bash
scale init --agent codex --dir .
scale init --agent cursor --dir .
npx -y @hongmaple0820/scale-engine@latest setup --verify --pack full --memory-provider hrain --memory-mode local-only --dir . --json
```

结果：Codex 读取 `AGENTS.md` 和 `.codex/hooks.json`；Cursor 读取 `.cursor/settings.json` 和 `.cursorrules`；两者共享 `.scale/` 证据、知识库、token 和 gate 配置。

### Claude Code + Cline + Windsurf

适合多 IDE/多 Agent 并行团队：

```bash
scale init --agent claude-code --dir .
scale init --agent cline --dir .
scale init --agent windsurf --dir .
scale runtime doctor --level M
```

建议每个任务开始时用 `scale runtime start` 分配独立 session，避免多个 Agent 同时改同一批文件。

### 多仓库/MOE 项目

```bash
scale init --governance-pack moe-workspace --agent codex --dir .
scale workspace status --dir . --json
scale preflight --service all --preflight-profile quick
```

多仓库场景重点不是“让 Agent 更敢改”，而是让它知道边界：哪个目录是父工作区，哪个目录是独立 Git 仓库，哪些文件不该被跨仓库误提交。

## 5. 工作流怎么用

最小闭环：

```bash
scale define "实现登录失败重试限制" --description "连续失败后临时锁定账号" --success-criteria "失败次数可配置,锁定可测试" --json
scale plan SPEC-ID-FROM-DEFINE --approach "在认证服务中增加失败计数和锁定状态" --rollback "关闭锁定开关并清理新增状态" --json
scale build PLAN-ID-FROM-PLAN --description "实现失败计数、锁定判断和测试" --level M --json
scale verify TASK-ID-FROM-BUILD --profile default --json
scale review TASK-ID-FROM-BUILD --json
scale ship TASK-ID-FROM-BUILD --no-commit --json
```

`SPEC-ID-FROM-DEFINE`、`PLAN-ID-FROM-PLAN`、`TASK-ID-FROM-BUILD` 来自上一步输出。没有真实任务 ID 时不要运行 ship。

AI OS 闭环：

```bash
scale ai-os plan --task "实现登录失败重试限制" --level M --budget 8000 --json
scale ai-os run --task "实现登录失败重试限制" --level M --dry-run --json
scale ai-os status --json
```

多 Agent 协同计划：

```bash
scale agent plan \
  --task "重构支付回调并补浏览器回归验证" \
  --level L \
  --files src/payments/callback.ts,tests/payments/callback.test.ts \
  --budget 12000 \
  --json
```

这会输出 `agentCollaboration`：角色选择、DAG 交接、review gates、每个角色 token 预算和 fallback。

## 6. 如何看效果

| 想确认什么 | 命令 |
| --- | --- |
| 工作流整体效果 | `scale workflow effectiveness --json` |
| AI OS 是否闭环 | `scale ai-os status --json` |
| Agent loop 证据 | `scale runtime doctor --json`、`scale evidence list --json`、`scale runtime final-check ...` |
| 门禁是否真实运行 | `scale preflight --preflight-profile quick`、`scale verify TASK-ID-FROM-BUILD --profile default` |
| token 和成本 | `scale token record ...`、`scale token report --json`、`scale cost-report --format json` |
| gbrain 记忆 | `scale memory provider status --json`、`scale memory query "..." --json` |
| 知识库和图谱 | `scale memory pack --json`、`scale codegraph status --json`、Graphify/CodeGraph 输出 |
| 发版前状态 | `scale ship TASK-ID-FROM-BUILD --no-commit --json`、`scale status` |

不要只看 Agent 的自然语言总结。SCALE 的判断依据应来自 evidence、runtime ledger、verification profile、token usage、memory/knowledge recall 和 dashboard capability report。

## 7. 知识库、记忆和图谱不是一回事

| 系统 | 典型来源 | 用途 |
| --- | --- | --- |
| 知识库 | `docs/`、`.scale/knowledge/imports/`、产品文档、设计文档、标准文档 | 给 Agent 提供可维护、可导入、可预览、可导出的项目知识 |
| 记忆 | gbrain、runtime evidence、memory candidates | 记录“以后不要再犯/以后要优先遵守”的经验和偏好 |
| 图谱 | CodeGraph、Graphify、`graphify-out/graph.json` | 查看代码结构、知识节点、依赖关系和跳转预览 |

新项目推荐：知识库先放可审查文档，记忆只沉淀经过验证的经验，图谱作为检索和结构理解能力，不要把三者混成一个黑盒。

## 8. 启动常驻 Vue 面板

在 `scale-engine` 源码仓库内：

```bash
npm run build
scale open --dir .
scale smoke --dir .
```

`scale open` 会打开 Agent Control 页面。这里可以配置 agent 平台、模型、消息通道、会话队列、飞书 route，并显示 dashboard service 的 supervisor PID、server PID、心跳、重启次数和日志路径。`scale smoke` 会验收面板健康和本地消息闭环。

常驻服务的日常命令：

```bash
scale dashboard daemon status --dir . --json
scale dashboard daemon restart --dir . --port 3210
scale dashboard daemon logs --dir . --lines 120
```

如果只是临时预览，也可以继续使用 `scale serve`。服务会打印 URL，通常是 `http://localhost:3210/`。如果端口被占用，`SCALE_DASHBOARD_PORT=auto` 会自动寻找后续可用端口。

使用全局 npm 包时，可以直接运行包里的 HTTP 入口：

```powershell
$scaleRoot = Join-Path (npm root -g) '@hongmaple0820/scale-engine'
$env:SCALE_DASHBOARD_PORT = 'auto'
node "$scaleRoot/dist/api/http.js"
```

多项目面板：

```powershell
$scaleRoot = Join-Path (npm root -g) '@hongmaple0820/scale-engine'
$env:SCALE_DASHBOARD_PORT = 'auto'
$env:SCALE_DASHBOARD_PROJECTS = 'api=E:\work\api;web=E:\work\web;docs=E:\work\docs'
node "$scaleRoot/dist/api/http.js"
```

面板会按项目分别分配端口并打印 URL。面板数据来自 `.scale/`、runtime evidence、token usage、知识库、gbrain 和图谱产物；如果某个面板为空，应优先看页面里的 empty reason 和 `/api/dashboard/capabilities`。

面板空白页优先检查 `http://127.0.0.1:3210/api/health` 和 `scale dashboard daemon status --dir . --json`。详细守护说明见 [Dashboard Daemon and Watchdog](../guides/DASHBOARD_DAEMON.md)。

## 9. 推荐落地顺序

1. 选一个主 Agent：`scale init --agent AGENT-ID`。
2. 跑 `scale doctor --json` 和 `scale preflight --preflight-profile quick`。
3. 接入本地 hrain：`scale setup --pack memory --memory-provider hrain --memory-mode local-only --json`。
4. 接入知识库：把产品文档、技术方案、规范文档放入 `docs/` 或 `.scale/knowledge/imports/`。
5. 接入 token：让真实模型调用后用 `scale token record` 写入用量，再用 `scale token report` 看成本。
6. 打开面板：确认 Overview、Workflow、Documents、Knowledge、Prompts、Token/Cost 都有明确数据来源或空态原因。
7. 发版前固定跑：`scale workflow effectiveness --json`、`scale ai-os status --json`、`scale ship TASK-ID-FROM-BUILD --no-commit --json`。
