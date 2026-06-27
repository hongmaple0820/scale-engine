# 3 分钟快速开始

目标：在一个项目里安装 SCALE 工作流，完成依赖检查，并看到可验证的治理产物。

如果你只是想让 Agent 接管，不想先读完命令教程，直接把 [Agent 满血工作流一键接入](agent-full-workflow.md) 里的提示词发给当前 coding agent。Agent 应该先跑 full setup verify，确认 gbrain、CodeGraph、Graphify、rtk、浏览器/E2E 和飞书消息通道是否可用，再给你安装计划和验证结果。

## 前置条件

- Node.js 22+
- npm
- Git
- Windows PowerShell、Git Bash、macOS/Linux shell 均可

Python、Bun、Rust/Cargo、uv/pipx 不是启动 SCALE 的硬要求。只有启用 Graphify、GBrain、RTK 等第三方能力时，安装器才会提示缺少哪些运行时以及可执行的修复命令。

## 1. 选择运行方式

首次试用推荐 `npx`，不需要全局安装：

```bash
npx -y @hongmaple0820/scale-engine@latest --version
npx -y @hongmaple0820/scale-engine@latest onboard --lang zh
```

长期高频使用再安装全局 CLI：

```bash
npm install -g @hongmaple0820/scale-engine
scale --version
```

本仓库开发时也可以直接运行源码入口：

```bash
node --import tsx E:/project/scale-engine/src/api/cli.ts --help
```

## 2. 初始化项目

```bash
mkdir scale-demo
cd scale-demo
npx -y @hongmaple0820/scale-engine@latest init --interactive --dir .
```

初始化会生成 `.scale/`、`docs/`、`scripts/` 以及对应 Agent 入口文件。已有项目升级不要盲目重复 `init`，优先使用升级向导：

如果你已经确定主要 Agent，建议显式指定，避免 auto-detect 选错入口：

```bash
npx -y @hongmaple0820/scale-engine@latest init --agent codex --governance-pack standard --dir .
npx -y @hongmaple0820/scale-engine@latest init --agent claude-code --governance-pack standard --dir .
npx -y @hongmaple0820/scale-engine@latest init --agent cursor --governance-pack standard --dir .
```

22 个 adapter 的逐项说明见 [22 种 Agent 安装与使用教程](agent-installation-guide.md)。如果目标是“少操作、让 Agent 自己判断”，优先使用 [Agent 满血工作流一键接入](agent-full-workflow.md)。

```bash
scale upgrade --dir .
```

向导会生成升级计划、写入 HTML 报告，并在安全时询问是否应用。CI 或高级用户仍可使用分步命令：

```bash
scale upgrade check --dir . --lang zh
scale upgrade plan --dir . --html --lang zh
scale upgrade apply --dir . --confirm --lang zh
```

## 3. 交互式安装第三方能力

默认语言是中文。需要英文时加 `--lang en`，也可以设置 `SCALE_LANG=en`。

直接进入交互式安装：

```bash
npx -y @hongmaple0820/scale-engine@latest setup --dir .
```

交互式安装会询问：

- 语言：默认中文。
- 安装包：标准、前端/UI、AI OS、完整、自定义。
- 记忆供应商：默认且推荐只使用 `gbrain`。
- 记忆路由模式：默认 `external-first`。
- 是否执行安装：可跳过、全量安装、或只安装选中的第三方项。

只查看计划：

```bash
npx -y @hongmaple0820/scale-engine@latest setup --pack full --memory-provider gbrain --memory-mode external-first --dir .
```

确认后执行安装：

```bash
npx -y @hongmaple0820/scale-engine@latest setup --pack full --memory-provider gbrain --memory-mode external-first --apply --yes --dir .
```

机器可读输出：

```bash
npx -y @hongmaple0820/scale-engine@latest setup --pack full --memory-provider gbrain --memory-mode external-first --dir . --json
```

`setup` 会输出 `runtimeChecks`。如果机器缺少 `python`、`bun`、`cargo`、`uv/pipx`、`node/npm/npx`，会先显示缺失项和修复建议，再决定是否执行 `--apply --yes`，避免安装中途卡住。

记忆供应商在安装入口显式固定为 `gbrain`，不需要手改 `.scale/memory-providers.json`：

```bash
npx -y @hongmaple0820/scale-engine@latest setup --pack memory --memory-provider gbrain --memory-mode external-first --dir . --json
```

更多 `npx`、固定版本、国内镜像和 CI 用法见 [npx 与交互式安装指南](npx-interactive-install.md)。

## 4. UI Skills 默认策略

| 能力 | 默认定位 | 安装方式 | 关键验证 |
| --- | --- | --- | --- |
| `impeccable` | Required UI anti-pattern gate | `npx -y @hongmaple0820/scale-engine@latest setup --pack ui --include impeccable --apply --dir .` | `npx impeccable --version` |
| `taste-skill` | Recommended UI direction and aesthetic parameters | `npx -y @hongmaple0820/scale-engine@latest setup --pack ui --include taste-skill --apply --dir .` | `scale skill doctor --json` |
| `awesome-design-md` | Supporting brand, visual language, and `DESIGN.md` source | `npx -y @hongmaple0820/scale-engine@latest setup --pack ui --include awesome-design-md --apply --dir .` | 生成 `~/.agents/skills/awesome-design-md/SKILL.md`，同步 `~/.scale/vendor/awesome-design-md` |
| `ui-ux-pro-max` | Supporting UX, state, accessibility, and responsive acceptance | `npx -y @hongmaple0820/scale-engine@latest setup --pack ui --include ui-ux-pro-max --apply --dir .` | 生成 `~/.agents/skills/ui-ux-pro-max/SKILL.md`，同步 `~/.scale/vendor/ui-ux-pro-max` |
| `frontend-design` | 可选实现陪跑，不再是 UI 默认必装项 | `npx -y @hongmaple0820/scale-engine@latest setup --pack ui --include frontend-design --apply --dir .` | 需要时显式安装 |

安装器会按每个 skill 的接入方式选择 npx installer 或受治理的 vendor adapter。缺少所需运行时或包管理器时不会硬跑失败，会在安装计划里标记为需要人工处理并给出下一步。

## 5. 其他第三方能力边界

| 能力 | 默认定位 | 关键验证 |
| --- | --- | --- |
| `rtk` | CLI proxy/token 节省能力 | `rtk gain` 和 `rtk init -g --codex` |
| `gbrain` | 默认记忆供应商 | 检查 brain 是否已配置且连接/schema 可用；未初始化会提示 `gbrain init --pglite` |
| `graphify` | 知识图谱产物供应商 | `graphify install --platform codex` 和 `graphify-out/graph.json` |
| `codegraph` | 代码结构索引供应商 | `codegraph init -i` 和 `.codegraph/` |

高级维护者可以单独检查安装计划：

```bash
npx -y @hongmaple0820/scale-engine@latest setup --pack external-cli,memory,knowledge,ui --memory-provider gbrain --memory-mode external-first --dir . --json
npx -y @hongmaple0820/scale-engine@latest setup --verify --pack full --dir . --json
```

## 6. 验证闭环

```bash
npx -y @hongmaple0820/scale-engine@latest doctor --dir .
npx -y @hongmaple0820/scale-engine@latest setup --verify --pack full --dir . --json
npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .
npx -y @hongmaple0820/scale-engine@latest status --dir .
npx -y @hongmaple0820/scale-engine@latest assets scan --dir .
npx -y @hongmaple0820/scale-engine@latest standards scan --dir .
npx -y @hongmaple0820/scale-engine@latest runtime doctor --level S --dir .
npx -y @hongmaple0820/scale-engine@latest memory provider status --dir . --json
npx -y @hongmaple0820/scale-engine@latest codegraph status --dir . --json
```

需要图形化控制 Agent 时，启动常驻面板：

```bash
npx -y @hongmaple0820/scale-engine@latest dashboard daemon ensure --dir . --port 3210 --json
```

然后打开 `http://127.0.0.1:3210/#agents`。Agent Control 是默认配置入口：选择 agent 平台、模型、消息通道、会话队列和飞书 route。面板空白时先检查 `http://127.0.0.1:3210/api/health` 和 `scale dashboard daemon status --dir . --json`。

未运行验证，不要声称通过。`setup --json` 只代表依赖计划可解析，不等于第三方服务已经可用；需要再跑 `setup --verify --pack full --json` 或对应 smoke。

真实第三方能力需要单独跑回放验证。默认命令会把未配置的远端能力标记为 `blocked`，但不会让本地发布门禁误失败；需要作为强制门禁时使用对应 npm script 或加 `--require-*`。

```bash
npm run smoke:providers
npm run smoke:gbrain
npm run smoke:graphify -- --large-project /path/to/large-project
```

验证语义：

- `smoke:gbrain` 会先确认 gbrain 已配置且关键健康检查可用，通过后写入一个临时记忆页，再用独立 CLI 进程 `get/query/search` 回放，证明不是本地 mock。
- `smoke:graphify` 默认对真实项目执行 `graphify update <project> --no-cluster`，走 AST/Python 无模型路径，检查 `graph.json`，再执行 `graphify query`；只有显式 `--semantic-extract` 才允许语义模型提取。
- `graphify-out/` 是生成产物，不应该提交到 Git；长期知识沉淀应进入经过评审的 `memory/`、`docs` 或规则文件。

## 7. 建立任务上下文

```bash
scale context init --name "Scale Demo"
scale runtime start --session-id 2026-05-18-oauth-hardening --task-id 2026-05-18-oauth-hardening --level M --agent codex
scale context grill --task-id 2026-05-18-oauth-hardening --task "加固 OAuth callback"
scale diagnose plan --task-id 2026-05-18-oauth-hardening --symptom "callback 在 state 过期时返回 500"
scale tdd slice --task-id 2026-05-18-oauth-hardening --behavior "拒绝过期 OAuth state" --public-interface "GET /oauth/callback" --failing-test "expired state returns 401" --test-file tests/oauth.test.ts --impl-files src/oauth.ts
```

任务完成后记录验证证据并沉淀候选经验：

```bash
scale runtime record --title "quick preflight" --kind command --status passed --command "scale preflight --preflight-profile quick" --exit-code 0 --summary "quick preflight passed"
scale runtime final-check --task-id 2026-05-18-oauth-hardening --session-id 2026-05-18-oauth-hardening --level M
scale memory pack --task-id 2026-05-18-oauth-hardening --session-id 2026-05-18-oauth-hardening --task "继续加固 OAuth callback" --level M --budget 4000
scale memory settle --task-id 2026-05-18-oauth-hardening --session-id 2026-05-18-oauth-hardening --task "继续加固 OAuth callback" --level M
```

`memory settle` 默认只生成学习候选，不会自动把一次会话判断提升成长线规则。存在失败证据时，候选会要求先解决失败，避免把未闭环问题沉淀成经验。

## 8. MOE/多仓工作区

多仓项目使用：

```bash
npx -y @hongmaple0820/scale-engine@latest init --governance-pack moe-workspace --dir .
```

MOE 默认把子工程配置为兄弟仓库或绝对路径，不建议把独立 Git 子工程放在主工程根目录下。`.scale/workspace.json` 中的典型写法：

```json
{
  "workspace": {
    "type": "moe",
    "repositories": [
      { "name": "api", "path": "../api", "role": "service" },
      { "name": "web", "path": "../web", "role": "frontend" }
    ]
  }
}
```
