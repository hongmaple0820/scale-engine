# npx 与交互式安装指南

目标：让第一次试用 SCALE 的用户不必先全局安装，也能通过交互式向导完成项目初始化、依赖规划、记忆/知识库选择和验证。

## 为什么先用 npx

`npx` 是 npm 自带的包执行工具。它适合 SCALE 的新用户入口：

| 场景 | 为什么适合 |
| --- | --- |
| 第一次试用 | 不需要 `npm install -g`，不会污染全局 CLI 环境 |
| 临时体验最新版 | 每次可指定 `@latest` 或固定版本 |
| 团队教程 | 用户复制一条命令即可进入同一版本的工作流 |
| 多项目隔离 | 不同项目可以用不同版本的 SCALE 初始化 |

SCALE 生成到项目里的 `.scale/`、`docs/`、`scripts/` 会保留；`npx` 只是临时执行 CLI 包本身。

## 推荐路径

### 1. 无全局安装，直接进入新手向导

```bash
npx -y @hongmaple0820/scale-engine@latest onboard --lang zh
```

`onboard` 会问 4 个问题，并推荐 profile/governance pack。它适合“不知道应该选 standard、frontend-app、node-library 还是 moe-workspace”的用户。

### 2. 交互式初始化项目

```bash
npx -y @hongmaple0820/scale-engine@latest init --interactive --dir .
```

交互式初始化会引导选择：

- Agent 类型：Codex、Claude Code、Cursor、Cline、Windsurf 等。
- 场景强度：sandbox、standard、critical。
- governance pack：standard、frontend-app、node-library、go-service-matrix、moe-workspace 等。
- profile：minimal、standard、advanced。

如果你已经知道要用哪个 Agent，可以直接指定：

```bash
npx -y @hongmaple0820/scale-engine@latest init --agent codex --governance-pack standard --dir .
```

### 3. 交互式安装第三方能力

```bash
npx -y @hongmaple0820/scale-engine@latest setup --dir .
```

`setup` 是交互式依赖安装入口，会先做 runtime checks，再让用户选择是否执行安装。它覆盖：

- `ui`：设计/前端相关 skills。
- `memory`：gbrain 记忆供应商。
- `knowledge`：Graphify/CodeGraph 知识图谱与代码结构能力。
- `external-cli`：RTK、浏览器、桌面自动化等外部工具。
- `full`：完整能力包。

推荐 gbrain-only 记忆策略：

```bash
npx -y @hongmaple0820/scale-engine@latest setup \
  --pack memory,knowledge,external-cli \
  --memory-provider gbrain \
  --memory-mode external-first \
  --dir .
```

### 4. 跑第一次验证

```bash
npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .
npx -y @hongmaple0820/scale-engine@latest status --dir .
```

如果要生成机器可读结果：

```bash
npx -y @hongmaple0820/scale-engine@latest workflow effectiveness --dir . --json
npx -y @hongmaple0820/scale-engine@latest ai-os status --dir . --json
```

## 一条命令快速试用

```bash
mkdir scale-demo
cd scale-demo
npx -y @hongmaple0820/scale-engine@latest quickstart --dir . --profile standard
npx -y @hongmaple0820/scale-engine@latest setup --pack full --dir .
npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .
```

这条路径适合第一次看效果。长期使用或团队 CI 建议固定版本。

## 固定版本复现

```bash
npx -y @hongmaple0820/scale-engine@0.50.4 --version
npx -y @hongmaple0820/scale-engine@0.50.4 init --agent codex --dir .
```

版本固定后，教程、CI 和用户机器更容易复现同一行为。

## 国内网络 fallback

如果 `npx @latest` 下载慢或超时，可以指定镜像：

```bash
npx -y --registry=https://registry.npmmirror.com @hongmaple0820/scale-engine@latest --version
npx -y --registry=https://registry.npmmirror.com @hongmaple0820/scale-engine@latest init --interactive --dir .
```

如果仍然不稳定，改用全局安装：

```bash
npm install -g @hongmaple0820/scale-engine --registry=https://registry.npmmirror.com
scale --version
```

## npx 和 npm 在 SCALE 里的分工

| 工具 | SCALE 中的推荐用途 |
| --- | --- |
| `npx` | 临时运行 SCALE、试用最新版、固定版本初始化、教程复制粘贴 |
| `npm install -g` | 高频使用、离线/弱网环境、团队统一机器镜像 |
| `npm run ...` | 在 `scale-engine` 仓库本身开发、测试、构建、发版 |

不要用 `npx` 直接执行不可信仓库或 gist。SCALE 教程只推荐执行已发布的 npm 包 `@hongmaple0820/scale-engine`，并建议关键项目固定版本。

## 自动化和 CI

交互式命令适合人首次安装；CI 应该使用显式参数和 JSON 输出：

```bash
npx -y @hongmaple0820/scale-engine@latest init \
  --agent codex \
  --governance-pack standard \
  --profile standard \
  --dir . \
  --json

npx -y @hongmaple0820/scale-engine@latest setup \
  --pack memory,knowledge,external-cli \
  --memory-provider gbrain \
  --memory-mode external-first \
  --dir . \
  --json

npx -y @hongmaple0820/scale-engine@latest setup --verify --pack full --dir . --json
```

只有明确要执行第三方安装时才加：

```bash
npx -y @hongmaple0820/scale-engine@latest setup --pack full --apply --yes --dir .
```

## 常见问题

| 问题 | 处理 |
| --- | --- |
| `npx` 下载超时 | 使用 `--registry=https://registry.npmmirror.com` 或全局安装 |
| 每次运行都要下载 | 固定全局安装，或在 CI 中使用 npm cache |
| 不知道选哪个 pack | 先跑 `npx -y @hongmaple0820/scale-engine@latest onboard --lang zh` |
| 不想真的安装第三方工具 | 只跑 `setup --json` 或 `setup --verify`，不要加 `--apply` |
| 已经全局安装了旧版本 | 用 `npx -y @hongmaple0820/scale-engine@latest ...` 临时试最新版本，确认后再升级全局包 |
