# SCALE Engine → DeepSeek Harness (DSH) 插件接入方案

- 日期：2026-10-15
- 任务等级：L（跨模块、新增宿主平台、触及打包与分发）
- 状态：T0/T1 已实机验收（2026-10-24，见 §11）；T2/T3 未开工
- 目标版本：0.56.0（minor，新增宿主平台）
- 结论：**可做，且 DSH 的扩展点与 SCALE 三件套高度契合；但必须分层接，不能整体搬迁。**

---

## 0. 结论先行

DSH 是「一切皆插件」的 Cordis 运行时。它的 `tools/pre-execute` 瀑布、`systemPrompt` 注册表、`session/event` 订阅、`skills.register`、`commands.register`，几乎是为 SCALE 的 Shield / Cortex / Evidence 三件套预留的接口形状。

**真正的阻塞不在架构，而在七处工程现实**（R1–R5 已实测，R6/R7 已确认未实测，见 §5）：

| # | 现实 | 影响 | 结论 |
| --- | --- | --- | --- |
| R1 | DSH 跑在 Electron 44（`MODULE_VERSION 149`），SCALE 的 `better-sqlite3@11.10.0` 编译于 `137` | 原生模块**无法**在 DSH 进程内加载 | **可绕过**：原生 addon 是惰性加载，且 MCP/Shield/Cortex 都不触碰它 |
| R2 | `ScaleMCPServer` **没有 stdio 启动代码** | `node dist/api/mcp.js` 只加载后退出 | **需补 stdio wrapper**（T0 唯一新增代码） |
| R3 | **DSH 工具名是 `pwsh`/`write`/`edit`（全小写），SCALE 判的是 `Bash`/`Write`/`Edit`** | 不映射则 Shield **静默全放行**、无任何报错 | **必须加映射层** —— §5.6 已端到端验证映射有效 |
| R4 | 无 `.scale/` 向上探测；插件是 profile 级、治理文件是项目级 | 多项目场景定位歧义 | 需显式设计 `projectDir` 解析策略 |
| R5 | **`desktop` profile 被 Electron 独占，CLI 无法对它操作** | 不能直接改 desktop 配置；插件开发须用独立 profile | **开发/验收一律用独立 profile + `--patch`**（T0/T1 命令已更正） |
| R6 | DSH 客户端是 React，SCALE Dashboard 是 Vue 3 | 面板不能直接复用【已确认，未实测】 | T3 前必须做混挂 spike，否则 React 重写 |
| R7 | DSH 处于 `0.2.0-rc.2`，仍在 rc | 接口可能漂移【已确认】 | peerDependencies 写范围；豁免走 profile 的 `compatibility.json` |

按 4 阶段推进：**T0 MCP 桥接（零改造）→ T1 Host 插件三钩子 → T2 命令与 Skills → T3 客户端面板**。

---

## 1. 调研方法与证据边界

**证据来源分三类，可靠度递减：**

| 类别 | 来源 | 可靠度 |
| --- | --- | --- |
| A. 运行时自省 | DSH 的 `cordis_inspect_*`（Host Service / Event / Config / client Slots / Builtins） | 权威（运行时真实契约） |
| B. 本机实测 | 在 DSH 的 Electron 运行时下 `require` SCALE 模块并调用 | 权威（可复现） |
| C. 官方文档 | `raw.githubusercontent.com/deepseek-ai/deepseek-harness` 的 md | 权威但可能与本机 rc 版本有偏差 |
| D. 第三方插件实读 | 本机 24 个已装插件的 `package.json` / `cordis.patch.yml` / `lib/*.js` | 强（真实作者实践） |

**已排除的错误来源：** 本轮调研中，一个子代理基于官方 `packages/util/package-manifest/src/types.ts` 断言 `dsh.compatibility.dshReleases` 不存在。我最初认为该断言错误（因为本机 `dsh-context` / `dsh-free-search` 的 manifest 里确实有这个字段）。**复核后确认子代理是对的**：

- 二进制扫描 `app.asar`：`dshReleases` 出现 **0 次**；`compatibility.json` 出现 **5 次**。
- 官方 `DshManifest` 只有 `manifestVersion` / `bundle` / `profile` / `client` 四字段。
- 真实机制是 **profile 自己的 `compatibility.json`** 精确豁免表（`app.asar` 原文：*"Exact-version exemptions live in the profile's own `compatibility.json`, not in its `package.json`"*）。
- 故 `dsh-context` 等包里的 `dsh.compatibility` 是**无人读取的装饰性字段**。

> 教训：第三方包写了什么 ≠ 运行时读了什么。凡涉及版本/兼容机制，一律以运行时自省或二进制扫描为准。

---

## 2. DSH 插件系统事实（权威契约）

### 2.1 打包模型：bundle 与 profile 是两个东西

- **bundle**：npm 包 + `dsh.bundle.patch`，回答「这个包贡献什么」。
- **profile**：`$DSH_HOME/profiles/<name>` 目录 + `dsh.profile.bundles`，回答「哪些 bundle 按什么顺序组合」。
- **没有东西同时是两者。**

**层叠加顺序**（后者按行胜出）：

1. profile 的 `bundles` 列表顺序（`@deepseek-ai/dsh-base` 第一）
2. profile 自己的 `cordis.patch.yml`
3. **home 级 `$DSH_HOME/cordis.patch.yml`**（优先级**高于** per-profile）
4. 每个 `--patch <path>`，按 argv 顺序

> ⚠️ patch **替换整行 `config`**，不是深合并。覆盖一行时必须重述该行需要的**每个**键。

### 2.2 manifest 字段（唯一权威来源）

```ts
interface DshManifest {
  manifestVersion?: 1
  bundle?: { patch: string | string[] }   // 相对声明它的包根
  profile?: { bundles?: string[] }
  client?: {
    platform: string                       // Web 消费者选 'web'
    inject?: string[]                      // 信息性依赖，非 Cordis 注入
    immediately?: boolean                  // 第一阶段注册屏障
    external?: string[]                    // 精确模块表请求，含 <pkg>/client 子路径
  }
}
```

`engines.dsh` 是**声明性**的——官方明确 installers/loaders 不强制执行。

### 2.3 插件生命周期与清理

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

- `inject` 声明的服务未就绪则等待；服务消失则自动卸载并在其回归时重载。
- `ctx.on` / `ctx.tools.register` / `ctx.llm.registerAdapter` 自动撤销；`ctx.effect(() => cleanup)` 返回 disposer。
- ⚠️ **多个异步 disposer 并发执行、无串行保证**。顺序相关的清理必须放进**同一个 `ctx.effect()` 的单个 disposer** 里串行 await。

### 2.4 事件模式

| 模式 | await | 有返回 | 语义 |
| --- | --- | --- | --- |
| `emit` | ✗ | ✗ | 广播 |
| `waterfall` | ✗ | ✓ | 管道；**listener 必须调 `next()`，否则短路**（设计意图） |
| `serial` | ✓ | ✓ | 顺序，首个非空返回即停 |
| `bail` | ✗ | ✓ | 短路 |
| `parallel` | ✓ | ✗ | 并发，全部 await |

### 2.5 工具管道（顺序固定）

```
tools/pre-execute → guards → tools/execute → projectContent
                  → tools/post-execute → finalizeContent → tools/result
```

```ts
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; info?: ToolErrorInfo }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { en: string; [loc: string]: string } }

type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
```

**关键约束：**

- `ask` 仅在 approval 返回 `allowed-once` 时执行，否则一律 denial。
- `ToolGuard` 返回类型**故意无 `allow`** —— 只能减少权限，无法把 denial 变回许可（单调）。
- **参数不可重写**（历史/审计/UI/执行必须一致）。
- `pre-execute` / `execute` / `post-execute` / `result` 都是 **scope-filtered**：agent-scoped listener 只收该 agent 的调用。
- content 替换是**呈现策略不是保密策略**——要隐藏 value 必须 `block` 或替换 value。

### 2.6 `defineTool` 契约

```ts
interface ToolDefinition extends ToolSchema {
  readonly output: { schema: JsonSchemaNode; render(args, value): ContentBlock[]; presentationMeta?(args, value): JsonValue }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>   // 只返回 canonical lossless-JSON value
  projectContent?(...): ContentBlock[] | undefined
  finalizeContent?(...): ContentBlock[] | undefined                // 必须 total、不 throw、每 outcome 恰好一次
  timeoutMs?: number                                               // 永不发给模型
  isConcurrencySafe?(args): boolean                                // 仅精确 true 才并行
  presentCall?(args): ToolCallView | undefined                     // 必须纯函数
  presentResult?(args, result): ToolResultView | undefined         // 必须纯函数
}
```

> ⚠️ `presentCall` / `presentResult` **必须是纯函数**：live streaming 与 replay 都会调用，禁 I/O、禁读 session 状态、禁时钟/随机。

### 2.7 其它可用扩展点

| 扩展点 | 契约要点 |
| --- | --- |
| `ctx.systemPrompt.section/context/variable/tools` | section 按 order 升序；同层重名抛错；`complete:true` 多于一个会让装配失败 |
| `system-prompt/assemble` | waterfall，返回值即权威 |
| `ctx.skills.register` / `registerProvider` | provider 注册**同步**；远程初始化必须在 `list()` 内 await；名字 kebab-case；不支持递归 `**/SKILL.md` |
| `ctx.commands.register` | **不进入模型**；生命周期落 `command/run` + `command/done` |
| `ctx.webServer.register` | exact → 最长 prefix → fallback；重复 `(kind,path)` 抛错；handler 抛错→400，永不退进程 |
| `ctx.slots.register` | 向**未声明**的 slot 注册会在激活时失败；组件**永不接收 ctx** |
| `ctx.llm.registerAdapter` | 服务不含重试/缓存/限流；供 GUI 用的 adapter **必须实现 `listModels`** |

### 2.8 客户端半：React + Slot 树

`listBuiltins` 权威结果：客户端插件可用的全局符号是 `ctx`（受限）/ `React`（`createElement`，**无 JSX 转换**）/ `host.call` / `styles.insert` / `console`。

- 客户端是 **React 18**，不是 Vue。SCALE 的 Dashboard 是 Vue 3 + naive-ui → **不可直接复用**。
- 有 `tool.call.toolview` 按 wire 工具名 keyed 注册的卡片插槽（已占用约 55 个工具名，含 `bash`/`read`/`write`/`edit`/`web_search` 等）。
- 有 `settings.section`、`sidebar.panellist`、`conversation.session.header.actions` 等大量增量插槽。

### 2.9 MCP 接入（纯配置，零代码）

```yaml
- id: mcp-scale
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: scale
    transport: stdio
    command: <可执行文件>
    args: [...]
    cwd: <工作目录>
```

- 工具名固定为 `mcp__<serverName>__<rawName>`，与 Claude Code / Codex 同形态。
- 命名空间是**本地配置**，永不使用远端 `serverInfo.name`；有损归一化附 12 位 SHA-256。
- generation 原子换：fetch 失败保留前一代，注册冲突**回滚整个尝试**。
- **stdio 子进程 env 会被 scrub**：匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*` 的变量被丢弃；显式 `env:` 覆盖可存活。
- **不支持**：MCP prompt 模板、resource 订阅、task-based execution（要求 task 扩展的工具**调用时被拒绝**）、human-input elicitation。
- 启动/发现超时继承 SDK 的 60s，无独立设置。

### 2.10 版本兼容的真实机制

- `manifestVersion` 与 `engines.dsh` **不被强制执行**。
- 真实机制：① `peerDependencies` 上 `@deepseek-ai/dsh*` 范围检查（app-boot 导入前强制，预发布参与匹配）② profile 自己的 `compatibility.json` **精确配对**豁免表（不跨升级继承）。
- bundle 不兼容且无豁免时**像不可读一样被跳过**，列入 `skippedBundles`；`--dump-config` 里被拒绝的插件行**仍会出现**，被拒绝的 bundle **不贡献任何行**。

### 2.11 分发与安装

- `dsh plugin --profile X add <pkg>` 转发 pnpm；成功后 reconcile `dsh.profile.bundles`。**增删改 bundle 后必须重启 profile**（普通 patch 编辑走热重载）。
- **git 安装陷阱**：拉源码不跑 build → TS 包无 `lib/` 加载失败。作者须提供自包含 `prepare`；用户须在 profile 的 `pnpm-workspace.yaml` 写 `allowBuilds:` 授权。
  - 官方警告：这是**安装时在你机器上执行代码、不在 agent 沙箱内**。
  - 规避方式：**发布预构建产物**（npm 带 `lib/`，或 `pnpm pack` 的 tarball），两者都不需要 build 授权。
- `peerDependencies` 约定：需与宿主共享实例的 dsh 包**同时**放 `peerDependencies` 与 `devDependencies`；独立版本第三方依赖与无状态 dsh 工具包放 `dependencies`。
- linked checkout 解析：普通 linked import 走 Node 祖先顺序，**更近的物理包先于更高的 peer 声明胜出**；**不校验 peer 版本范围、不使已加载模块失效**。

### 2.12 致命项（app-boot）

`apply()` 之外脱离的 unhandled rejection、以及同步回调（stream `'data'`、timer）抛出的未捕获异常，**在任何生命周期点都是致命**（dispose 整个 app 并非零退出），**无视条目 id**。

---

## 3. SCALE 侧事实（只读审计）

### 3.1 Shield —— 判定逻辑可进程内复用 ✅

`src/shield/ProtectedPaths.ts` 导出纯函数，无 `process.exit`、无 stdout 写入：

| 签名 | 位置 |
| --- | --- |
| `checkToolInput(input: ShieldInput): ShieldDecision` | `src/shield/ProtectedPaths.ts:146` |
| `checkCommand(command: string): CommandBlockRule[]` | `src/shield/ProtectedPaths.ts:132` |
| `checkProtectedPath(targetPath, cwd?, toolName?): PathCheckResult` | `src/shield/ProtectedPaths.ts:106` |
| `verifyScaleIntegrity(cwd): { intact, missing }` | `src/shield/ProtectedPaths.ts:199` |

输入是普通对象（非 stdin），与 DSH 的 `ToolExecution` 可直接桥接。

**不可复用的部分**（hook 专用）：`allow()` `:126` / `block()` `:136` 都直接 `process.exit`；`parseShieldInput()` `:150` 读 stdin。

> ⚠️ **两套 blocklist 不一致（重要缺陷）**：`ProtectedPaths.ts:47-90` 有 **37 条**（30 block + 7 warn，带 `category`）；而编译出的 hook 模板 `PolicyCompiler.ts:584-603` 硬编码 **18 条**。`generateCombinedPreToolScript` 虽接收 `policy` 参数，实际只用来算哈希与规则数，**拦截清单是写死的**。同理 `registerStopHook` `:817` 用的是 `DEFAULT_POLICY.rules` 而非项目加载的策略。
>
> 另：`checkToolInput` **当前只被测试引用**，CLI 与 hook 都没用它。

**退出码协议**：`EXIT_ALLOW=0` / `EXIT_BLOCK=2`（`ShieldProtocol.ts:11-12`）；**失败即放行**（解析异常也 `exit 0`）。

### 3.2 RuntimeEvidenceLedger —— 可长驻复用 ✅

| 成员 | 签名 | 位置 |
| --- | --- | --- |
| `constructor` | `(options?: { projectDir?, scaleDir?, now?, createDirs? })` | `:73` |
| `record` | `(input: RuntimeEvidenceInput): RuntimeEvidenceRecord` | `:83` |
| `list` / `get` / `summary` | 见源码 | `:104` / `:121` / `:125` |

- 落盘：`<scaleRoot>/evidence/runtime/<id>.json`，一条记录一个文件。
- `id`：`RTE-${Date.now()}-${randomUUID().slice(0,8)}`。
- `status`：`'passed' | 'failed' | 'skipped'`；`kind`：`command|gate|tool|skill|mcp|browser|desktop|manual|final-report`。
- **无全局单例、无文件锁**；`writeFileSync` 到唯一文件名，并发写不同 id 安全。
- ⚠️ `sequence` 是**实例级计数器、不持久化**，跨进程会重复；排序应以 `createdAt` 为准。

### 3.3 Cortex —— 零原生依赖 ✅

- `InstinctStore`：`constructor(baseDir = join(cwd,'.scale','instincts'), options?)` `:56`。落盘 `.scale/instincts/<domain>/<id>.yaml` + 审计 `.audit.jsonl`。注入阈值默认 `minConfidence = 0.7` `:207`。
- `Instinct`：`confidence` 只有四档 `0.3 | 0.5 | 0.7 | 0.9`，由 `computeConfidence(count, rootCauseCount)` `:198` 产出。`scope` 由置信度决定（`≥0.7 → 'global'`）。
- `SessionInjector`：`constructor(instinctStore)` `:44`；`build(projectId?, priorSessions?)` `:51` / `buildMinimal(projectId?)` `:118`。
- 注入产物是**一段 Markdown 文本**，放 `SessionInjection.content`：证据纪律 → 项目 specs → 高置信本能 → 历史会话（带防重放哨兵）→ 尾注。
- ⚠️ `loadScopedSpecs` 默认路径是**相对** `'.scale/specs'` `:182`，按 cwd 解析，**不随 `build()` 的 `projectId` 变化**。

### 3.4 Skills

- `.scale/skills.json` 顶层：`version` / `policy` / `skillSources` / `domains`（实测 **20 个域**）。
- 实际路由入口是 `SkillRegistry`（`src/skills/SkillRegistry.ts:96`）：`register` / `recommend` / `evaluateTriggers` / `checkConflicts`；`recommend` 阈值 `score > 0.3`，返回前 5。
- 另有 `evaluateSkillRadar` `SkillRadar.ts:175`、`loadSkillRoutingPolicy` `routing/SkillPolicy.ts:347`。

### 3.5 MCP Server

- `ScaleMCPServer` `src/api/mcp.ts:63`；`constructor(scaleDir = '.scale')` `:71`。
- 协议方法：`initialize`（`protocolVersion: '2024-11-05'`）/ `tools/list` / `tools/call`。
- **注册 27 个工具**：`scale_create`、`scale_transition`、`scale_list`、`scale_show`、`scale_available_actions`、`scale_context`、`scale_stats`、`scale_detect_changes`、`scale_review_context`、`scale_code_intelligence_status`、`task_create`、`task_start`、`task_status`、`task_checkpoint`、`task_resume`、`complete_task`、`capability_list`、`capability_map`、`bridge_register`、`bridge_heartbeat`、`shell_plan`、`shell_run`、`delegation_delegate`、`delegation_review`、`cortex_promotion_propose`、`cortex_promotion_hit`、`cortex_promotion_approve`。
- ⚠️ **无 stdio bootstrap**：`src/api/mcp.ts` 与 `dist/api/mcp.js` 均无 `readline` / `createInterface` / `process.stdin` / `listen()`。文件头注释与 `package.json:70` 的 `"mcp": "node dist/api/mcp.js"` **与实现矛盾**。
- 仓库内唯一入口 `bridge-http.mjs` 硬编码容器绝对路径 `/workspace/core/scale-engine/...`，本机不可直接运行。
- CLI **没有 `mcp` 子命令**。

### 3.6 原生依赖的精确边界

| 文件 | 形式 |
| --- | --- |
| `src/artifact/sqliteStore.ts:15,27` | type-only + 惰性 `createRequire` |
| `src/dashboard/DashboardServer.ts:14` | 静态 import |
| `src/knowledge/SQLiteKnowledgeBase.ts:5` | 静态 import |
| `src/memory/MemoryBrain.ts:1` | 静态 import |

**关键事实**：`better-sqlite3` 的原生 addon **只在 `new Database()` 时才加载** —— `node_modules/better-sqlite3/lib/database.js:48` 的 `require('bindings')('better_sqlite3.node')` 位于 `function Database` 内部。顶层 require 只有 `fs/path/util/sqlite-error`。

- `loadBetterSqlite3`（`sqliteStore.ts:26-29`）**无 try/catch、无降级**；构造点 `:130` 同样无。binding 缺失直接抛错。
- `InMemoryArtifactStore`（`store.ts:41`）是契约等价替代品（实现 `IArtifactStore`），但缺 `queryEvents` / `stats` / `close`（三者不在接口内）。
- **`mcp.ts` 正是用 `InMemoryArtifactStore`** —— 这是 MCP server 不触碰原生 addon 的直接原因。

### 3.7 配置边界

- `SCALE_DIR` / `SCALE_PROJECT_DIR` 环境变量或 `process.cwd()`（`src/cli/engineBootstrap.ts:27-29`）。
- **无向上遍历父目录寻找 `.scale/` 的逻辑**（全仓 grep 确认）。
- `.scale/` 含 20 个顶层文件 + 18 个子目录；`evidence/{command-runs,runtime,tool-runs}` 已存在。

---

## 4. 映射矩阵

| SCALE 能力 | DSH 对接点 | 可行性 | 阶段 |
| --- | --- | --- | --- |
| MCP Server 27 工具 | `@deepseek-ai/dsh-mcp-client`（stdio） | ✅ 零改造，仅需 stdio wrapper | **T0** |
| Shield 危险命令拦截 | `tools/pre-execute`（waterfall → `PreToolDecision`） | ✅ 纯函数可直接桥接 | **T1** |
| Shield 受保护路径 | `tools/pre-execute` + `fs/write-intent` | ✅ | **T1** |
| Shield 门禁前置 | `tools.guard()`（单调，只能减少权限） | ✅ 语义天然契合 | **T1** |
| Cortex 本能注入 | `systemPrompt.context` / `system-prompt/assemble` | ✅ | **T1** |
| Cortex 会话启动 | `agent/created` | ✅ | **T1** |
| RuntimeEvidenceLedger | `tools/post-execute` + `session/event` | ✅ 最大差异化点 | **T1** |
| Skill 路由 | `ctx.skills.register` / `registerProvider` | ⚠️ 需适配层（`.scale/skills.json` → `SkillRegistration`） | **T2** |
| CLI 门禁命令 | `ctx.commands.register` | ⚠️ 需适配（90 个顶层命令需筛选） | **T2** |
| Agent 编排 / 多角色 | `ctx.subagents` / `agentTeams` | ⛔ 能力重叠，**不建议重做** | — |
| Dashboard（Vue + naive-ui） | `webServer` + client slots | ⛔ 前端栈不同，需 React 重写 | **T3** |
| Scale Orchestrator daemon | — | ⛔ DSH 有自己的调度，**不建议接** | — |

---

## 5. 关键风险实测结论

以下全部在**本机 DSH 的真实运行时**下实测（`ELECTRON_RUN_AS_NODE=1` + `DeepSeek Harness.exe`）。

### R1 —— 原生模块 ABI 不兼容【已实锤】

```
DSH 运行时：node v24.18.1 / electron 44.0.0 / MODULE_VERSION 149
系统 Node ：v24.14.1 / MODULE_VERSION 137

require('better-sqlite3') 在 DSH 运行时下：
  The module '...better_sqlite3.node' was compiled against a different Node.js version
  using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 149.
```

**但影响面比预想小得多**，实测确认：

| 模块 | 在 DSH 运行时下加载 | 说明 |
| --- | --- | --- |
| `dist/api/mcp.js`（27 工具） | ✅ OK | 用 `InMemoryArtifactStore` |
| `dist/shield/ProtectedPaths.js` | ✅ OK | 纯函数，判定正确 |
| `dist/runtime/RuntimeEvidenceLedger.js` | ✅ OK | record/list/summary 正常 |
| `dist/cortex/InstinctStore.js` | ✅ OK | |
| `dist/cortex/SessionInjector.js` | ✅ OK | `buildMinimal()` 正常产出 |
| `dist/skills/SkillRadar.js` | ✅ OK | |
| `dist/artifact/sqliteStore.js` | ✅ 可加载 | **仅 `new` 时才触碰原生 addon** |
| `new SQLiteArtifactStore()` | ❌ 会失败 | 插件必须避免 |

**结论**：只要插件路径**不构造 `SQLiteArtifactStore` / `MemoryBrain` 的 Database 实例**，原生 ABI 问题不构成阻塞。

> 可选加固：为插件单独 `pnpm rebuild better-sqlite3 --runtime=electron --target=44.0.0`。但**不推荐作为 T1 前置条件**——它会引入构建工具链依赖，且与 T0 无关。

### R2 —— MCP server 无 stdio 入口【已实锤】

`dist/api/mcp.js` 末尾只有 `//# sourceMappingURL`，无自启动；grep `readline|createInterface|process.stdin|listen(` 零命中。

**实测端到端仍成功**（直接驱动类，不经 stdio）：

```
initialize: scale-engine 0.55.3
tools/list count: 27
tools/call capability_list → {"version":1,"projectDir":"E:\\project\\scale-engine","ok":true,...}
```

**结论**：T0 需要新增 `src/api/mcpStdio.ts`，**用仓库已有的 `@modelcontextprotocol/sdk`（1.29.0）的 `Server` + `StdioServerTransport`** 挂 `ScaleMCPServer.handleRequest`（原估计「~30 行手写帧循环」低估了帧协商成本，U6 的风险点，已改用 SDK）。这是 T0 唯一的代码新增。

### R3 —— 工具名不匹配导致 Shield 静默失效【已实锤，最危险】

DSH 实际工具名与 SCALE 期望名不一致（详见 §6 T1.1 映射表）。实测：直接喂真实名 → 三条规则**全部 `allow`**；加映射 → 全部 `block`。

**为什么最危险**：不报错、不崩溃、看起来"已接入"。正向验收用例能发现它，但若只做冒烟测试（"插件加载成功"）则完全漏掉。

### R4 —— 治理文件定位【已实锤】

无向上探测；`checkToolInput` 的 `cwd` 参数需显式传入。DSH 插件是 profile 级，而 `.scale/` 是项目级 → **必须在插件 Config 里显式声明项目根策略**（见 §6 T1.4）。

### R5 —— `desktop` profile 被 Electron 独占【已实锤，更正了本方案早期错误】

本方案早期版本在 T0/T1 验收命令里写了 `dsh --profile desktop --dump-config`。**这是错的**：

```
$ dsh --profile desktop --patch ./probe.patch.yml --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

**结论**：插件的开发、`--dump-config` 验证、MCP 配置注入，**一律走独立 profile + `--patch` 覆盖层**，不能直接操作 `desktop`。对 `desktop` 的改动只能经由 GUI 的插件管理页，或改 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 后重启应用。

### R6 —— 前端栈不一致【已确认，未实测】

DSH 客户端是 React（`React.createElement`，无 JSX 转换），SCALE Dashboard 是 Vue 3 + naive-ui。**混挂方式未验证**，T3 前必须做 spike。

### R7 —— 版本漂移【已确认】

DSH 当前 `0.2.0-rc.2`，仍处 rc。`peerDependencies` 应写范围；`engines.dsh` 写了不生效；豁免只能通过 profile 的 `compatibility.json`。

---

## 5.5 插件加载链路已实跑验证【新增，2026-10-15】

本方案早期版本的 U1 是「插件能否真的在 DSH 内加载并触发钩子 —— 未验证」。**该空白已用真实实验填补**：

**实验方法**：在 `C:\Users\Administrator\dsh-plugin-probe\` 建探针插件 + patch 覆盖层，用独立 profile 引导。

**实测结果**：

| 验证项 | 命令 / 方法 | 结果 |
| --- | --- | --- |
| dsh CLI 可用 | `dsh.cmd --version` | ✅ `0.2.0-rc.2` |
| 插件进入组合树 | `--dump-config` | ✅ 出现 `# == probe.patch.yml` 层与 `- id: scale-probe` |
| **`apply` 真的被调用** | 引导 profile | ✅ `[scale-probe] plugin loaded!` |
| `ctx.effect` disposer 生效 | 同上 | ✅ `effect registered` → `effect cleaned up` |
| **SCALE 模块能在插件内 import** | 插件内 `import` 真实 `dist/shield/ProtectedPaths.js` | ✅ `checkShield: checkToolInput is function` |
| `tools/pre-execute` 注册成功 | `inject = ['tools']` | ✅ 无报错 |

**这推翻了早期版本的核心保留意见**：DSH 插件确实能加载，SCALE 的真实模块（含 Shield 判定函数）确实能在 DSH 进程内被 import 并保持可用。

**同时暴露的三条实跑细节**：

1. patch 里写的 `name: 'C:/.../index.mjs'` 在 `--dump-config` 中显示为 `file:///C:/...` —— 路径会被规范化，**不影响加载**。
2. `headless` 子命令**不接受额外参数**：`dsh ... headless "run: ls"` 报 `Expected 0 arguments but got 2`。
3. 因此**触发钩子的真实工具调用必须走 web/tui 会话**，不能靠 headless 单命令。

**仍未验证（诚实边界）**：无。**钩子端到端链路已完整验证**，见 §5.6。

---

## 5.6 Shield 钩子端到端验证【新增，2026-10-15，零 API 消耗】

§5.5 只证明「注册成功」。本节用**自驱动探针**填补了「拦截是否真的生效」这一最后空白。

**方法**：插件在 `apply` 时注册 `tools/pre-execute` 钩子，并在启动 500ms 后**自己调用 `ctx.tools.execute()`**，走完整管道（pre-execute → guards → execute → post-execute）。这比跑真实模型会话更便宜且可复现。

**实测输出（原样）**：

```
[selftest] apply() running; checkToolInput = function

[selftest] driving BLOCK
[selftest] HOOK FIRED: pwsh -> Bash => block
[selftest] BLOCK RESULT isError=true
[selftest] BLOCK CONTENT [{"type":"text","text":"Error: [destructive] Recursive force delete (rm -rf) — data loss risk"}]

[selftest] driving PROTECT
[selftest] HOOK FIRED: write -> Write => block
[selftest] PROTECT RESULT isError=true
[selftest] PROTECT CONTENT [{"type":"text","text":"Error: [Protected Path] .scale/ governance infrastructure — run scale shield compile to apply — target: .scale\\policy.yaml"}]

[selftest] driving ALLOW
[selftest] HOOK FIRED: selftest_echo -> selftest_echo => allow
[selftest] ALLOW RESULT isError=false
[selftest] ALLOW CONTENT [{"type":"text","text":"echo:scale-ok"}]
```

**三用例结论**：

| 用例 | 输入 | 期望 | 实际 | 判定 |
| --- | --- | --- | --- | --- |
| BLOCK | `pwsh` + `rm -rf` | 拦截 | `isError=true`，reason 含 `[destructive]` | ✅ |
| PROTECT | `write` + `.scale/policy.yaml` | 拦截 | `isError=true`，reason 含 `[Protected Path]` | ✅ |
| ALLOW | 安全调用 | 放行 | `isError=false`，正常返回 | ✅ 无误报 |

**这证明了 R3 的映射层是有效的，也证明了整个 T1 架构成立**：DSH 的 `tools/pre-execute` 能被触发，SCALE 的 `checkToolInput` 能在钩子里正确判定，`{kind:'deny'}` 能真正阻断工具调用。

**顺带发现的四条实现细节**：

1. **`--help` 会执行 `apply`**，但会在定时器触发前退出 —— 适合验证「插件加载」，不适合验证「运行时行为」。
2. **`--dump-config` 不挂载插件**，只组合配置树，不会执行 `apply`。
3. **profile 本身就是 app**：`dsh --profile web` 之后不能再传 `web` 位置参数（会报 `too many arguments`）；app 参数直接跟在 launcher flags 后面，如 `--no-open --port 0`。
4. **顶层 `await import` 会阻止插件加载**（`apply` 不被调用且无报错）；改用 `createRequire` 同步加载即正常。**这是写 T1 时的实际陷阱**。

---

## 6. 分阶段实施方案

### T0 —— MCP 桥接（零改造验证）

**目标**：27 个 SCALE 工具进入 DSH 模型工具表，**不写任何插件代码**。

**工作项**

1. 新增 `src/api/mcpStdio.ts`：用仓库已有的 `@modelcontextprotocol/sdk`（`package.json` 已依赖 1.29.0）的 `Server` + `StdioServerTransport` 挂 `ScaleMCPServer.handleRequest`，**不手写帧循环**（原「~30 行手写」低估了帧协商，U6 的风险点）。
   - 必须处理 `initialize` / `tools/list` / `tools/call`；对未知方法回 `-32601`。
   - 需支持 DSH 的 `2026-07-28` 协议协商（SDK 会优先选它，失败回落旧版）。
2. **工具面收窄（评审新增，堵安全回归）**：`mcpStdio.ts` 内默认**省略 `shell_run` 与 `shell_plan`**，提供 `SCALE_MCP_EXPOSE_SHELL=1` 显式开关。
   - ⚠️ 为什么必须收窄：27 个工具里的 `shell_run` 是 SCALE 自己的受管 shell 执行（`src/api/mcp.ts:397`）。若原样注册，模型可把危险命令改走 `mcp__scale__shell_run`，**完全绕过 T1.1 的 Shield 桥**（映射表只覆盖 `pwsh/write/edit/read`，`checkToolInput` 对它直接返回 allow）；且该通道是 `dsh-mcp-client` 拉起的子进程，在 DSH 审批/沙箱体系之外。
   - ⚠️ 为什么在 wrapper 内过滤而不是改 `getTools()`：`getTools()` 是所有 MCP 客户端（Claude Code、Cursor 等）的公共面，改它**外溢到其他平台**。wrapper 是 DSH 专属入口，过滤只影响 DSH。
   - `shell_run` 收窄后，接受治理的 shell 需求由 T1 装好后的 `pwsh`（已被 Shield 桥覆盖）承接。
3. 在 `package.json` 增加 `"mcp:stdio": "node dist/api/mcp-stdio.js"`，并把它加入 `files`。
4. 建独立 profile（**不能用 `desktop`**，见 R5）：

   ```bash
   dsh --profile scale-dev --from-default-profile web
   dsh plugin --profile scale-dev add @deepseek-ai/dsh-mcp-client   # 当前未安装
   ```

5. 在该 profile 的 `cordis.patch.yml`（或 `--patch` 覆盖层）加一行：

```yaml
- id: mcp-scale
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: scale
    transport: stdio
    command: node
    args: ['E:/project/scale-engine/dist/api/mcp-stdio.js']
    cwd: E:/project/scale-engine
    toolCallTimeoutMs: 60000
    failOnStartupError: false
```

> ⚠️ stdio 子进程 env 会被 scrub（`DSH_*` 与含 `KEY|PASSWORD|SECRET|TOKEN` 的变量被丢弃）。SCALE 若需环境变量，必须走显式 `env:` 字段。
> ⚠️ `cwd` 决定 `.scale/` 定位（因无向上探测）。

**验收标准**

- [ ] `dsh --profile scale-dev --patch <overlay> --dump-config` 显示 `# == @deepseek-ai/dsh-mcp-client` 层且 `mcp-scale` 行未被跳过
- [ ] DSH 会话里 `mcp__scale__capability_list` 调用成功并返回 JSON
- [ ] `mcp__scale__scale_stats` 返回 artifactCount / eventCount
- [ ] **`mcp__scale__shell_run` 与 `mcp__scale__shell_plan` 不出现在工具表中**（默认收窄生效；`SCALE_MCP_EXPOSE_SHELL=1` 后出现）
- [ ] **其他 MCP 客户端不受影响**：Claude Code/Cursor 等看到的 `tools/list` 仍含 `shell_run`（过滤只发生在 DSH wrapper 内）—— 用仓库外独立 MCP 客户端抽查一次
- [ ] 启动日志无 `configured web provider ... is not registered` 类悬挂引用
- [ ] 关闭 DSH 后无残留子进程

**预计**：0.5 天。

---

### T1 —— Host 插件三钩子（核心价值）

**目标**：Shield 拦截 + Cortex 注入 + 证据链，全部跑在 DSH 进程内。

**开发方式（已实跑验证）**：插件用独立 profile + `--patch` 覆盖层迭代，**不碰 `desktop`**（R5）。

```bash
dsh --profile scale-dev --from-default-profile web     # 建一次
dsh --profile scale-dev --patch ./packages/dsh-scale/dev.patch.yml --help   # 每次验证
```

`--help` 会完整引导 profile 并执行 `apply`，因此可用它验证插件加载与 `ctx.effect` 注册（实跑确认）。**但真实工具调用触发钩子必须走 web/tui 会话**。

**包结构**

```
packages/dsh-scale/                 # 新建，独立于主包发布
├── package.json                    # dsh.bundle.patch
├── cordis.patch.yml                # - insert: [{ id: scale-governance, name: dsh-scale }]
├── dev.patch.yml                   # 本地开发用覆盖层（指向 src，不进发布）
├── src/index.ts                    # apply(ctx, config)
├── src/shieldBridge.ts
├── src/cortexBridge.ts
├── src/evidenceBridge.ts
└── lib/                            # 预构建产物（避免 git 安装的 build 授权陷阱）
```

**T1.1 Shield 拦截**（`tools/pre-execute` waterfall）

```ts
ctx.on('tools/pre-execute', async (exec, next) => {
  const decision = await next()          // 必须调 next()
  if (decision.kind !== 'allow') return decision   // 不覆盖其它拦截器

  // projectDir 按 exec 逐次解析（不是 apply 时固定）：
  // config.projectDir → exec.agent.session.header.cwd → process.cwd()
  // 固定值会在多工作区场景保护错项目
  const projectDir = resolveProjectDir(config, exec)
  const result = checkToolInput(toShieldInput(exec, projectDir))

  if (result.decision === 'block') {
    return { kind: 'deny', reason: result.reason, info: { name: 'SCALE_SHIELD', code: 'shield-block', reason: result.reason } }
  }

  // warn 级规则 → ask（评审新增，堵功能退化）：
  // checkToolInput 会静默丢弃 warn 匹配（ProtectedPaths.ts:176 只取 severity==='block'），
  // hook 模式下至少还有 [SCALE SHIELD WARN] stderr 提示，进 DSH 桥不能比它更差。
  // 用 checkCommand 直接检测 warn 级，映射成一次用户确认，对齐 blockMode: warn 语义。
  const warnHits = detectWarnLevel(exec)   // 内部调 checkCommand，取 severity==='warn'
  if (warnHits.length > 0) {
    return { kind: 'ask', displayReason: { en: `[SCALE SHIELD WARN] ${warnHits[0].reason}`, zh: `【SCALE 盾警告】${warnHits[0].reason}` } }
  }

  return { kind: 'allow' }
})
```

> ⚠️ `ask` 的行为语义：仅在 approval 返回 `allowed-once` 时放行，否则一律 denial（§2.5）。即 warn 级命令在 DSH 里变成「用户明确点一次确认才执行」，比 hook 模式的纯提示更强、但比 block 宽松——恰好是 warn 的位置。

**MCP 工具名解包兜底（评审新增）**：若用户开了 `SCALE_MCP_EXPOSE_SHELL=1`，`mcp__scale__shell_run` 会出现在工具表里。映射层需要**同时**处理它：

```ts
// 解包 mcp__<server>__<tool> 前缀：取原始工具名与参数做判定
function toShieldInput(exec, projectDir) {
  if (exec.name.startsWith('mcp__scale__')) {
    const raw = exec.name.slice('mcp__scale__'.length)
    // shell_run 的 arguments.command 按 Bash 输入判定，其余 MCP 工具按 Write/Edit 语义判定 file_path
    return { /* ... tool_name: raw === 'shell_run' ? 'Bash' : raw, tool_input: exec.arguments */ }
  }
  return { session_id: exec.agent?.id ?? 'unknown', cwd: projectDir, tool_name: TOOL_NAME_MAP[exec.name] ?? exec.name, tool_input: exec.arguments ?? {} }
}
```

映射要点：

| DSH | SCALE `ShieldInput` |
| --- | --- |
| `exec.agent.id` | `session_id` |
| `projectDir`（来自 Config） | `cwd` |
| `exec.name` → **必须映射**（见下表） | `tool_name` |
| `exec.arguments` | `tool_input` |

**工具名映射表（T1 的必要前置，已实测验证）**

本机 `listTools` 实测 DSH 共 **107 个工具**，其中与 Shield 相关的：

| DSH 实际工具名 | SCALE 期望名 | 说明 |
| --- | --- | --- |
| **`pwsh`** | `Bash` | ⚠️ **DSH 没有 `bash` 工具**；shell 是 `pwsh`。`checkToolInput` 的 `toolName === 'Bash'` 分支（`ProtectedPaths.ts:172`）**永不命中** |
| `write` | `Write` | 大小写不匹配（`ProtectedPaths.ts:152`） |
| `edit` | `Edit` | 同上 |
| `read` | `Read` | `checkProtectedPath` 的只读白名单（`:112`） |

**实测证据（决定性）**：直接喂 DSH 真实工具名给 `checkToolInput`，三条规则**全部静默放行**：

```
--- AS-IS (DSH real names, unmapped) ---
pwsh rm -rf  : allow     ← 应 block
write .scale : allow     ← 应 block
edit .scale  : allow     ← 应 block

--- MAPPED (via adapter) ---
pwsh rm -rf  : block  ✅
write .scale : block  ✅
edit .scale  : block  ✅
read .scale  : allow  ✅ (只读按设计放行)
pwsh ls      : allow  ✅ (无误报)
```

> ⚠️ **这是 T1 最大的静默失败风险**：若不映射，`checkToolInput` 会走完所有分支后返回 `{ decision: 'allow' }`（`:193`），Shield 看似已接入、实则完全不拦截，且**没有任何报错**。上表左列即未映射的真实后果。
> ⚠️ 参数名已核对：DSH 的 `write`/`edit` 用 `file_path`，与 `checkToolInput` 读取的 `toolInput.file_path`（`:153`）一致，**无需映射**。
> ⚠️ 注意当前 profile 的 `tool-bash` 与 `tool-pwsh` 条目在 `cordis.yml` 里都是 `enabled: false`，但 `pwsh` 工具实际可用（由 agent preset / bundle override 提供）。**映射必须按运行时 `exec.name` 实际值判断，不能按配置条目判断。**
> ⚠️ `checkToolInput` 用的是 37 条 blocklist，而 hook 模板是 18 条。接 DSH 时以 **37 条**为准，并在文档中标注这个既有不一致（属 T1 之外的技术债，建议单独开任务收敛）。

**T1.1 的验收必须包含映射断言**：正向用例（拦截 `rm -rf`）本身就能暴露映射错误，但为防"静默失效"被误判为"策略宽松"，应额外加一条单测：

```ts
// 必须通过，否则 Shield 在 DSH 里等于没接
assert(checkToolInput({ tool_name: 'pwsh', tool_input: { command: 'rm -rf /' } }).decision === 'block')
// warn 级（rmdir / docker rm -f / --no-gpg-sign / bypass 等 7 条）必须走 ask 分支，
// 不允许静默放行 —— 这是评审发现的功能退化点
assert(detectWarnLevel({ name: 'pwsh', arguments: { command: 'git checkout -- src/' } }).length > 0)
// MCP 前缀解包（shell 收窄开关打开时的兜底）
assert(toShieldInput({ name: 'mcp__scale__shell_run', arguments: { command: 'rm -rf /' } }, '/proj').tool_name === 'Bash')
```

**T1.2 Cortex 注入**（`system-prompt/assemble` 或 `systemPrompt.context`）

```ts
const store = new InstinctStore(join(projectDir, '.scale', 'instincts'))
const injector = new SessionInjector(store)
ctx.systemPrompt.context({
  name: 'scale-cortex',
  order: <从 ctx.systemPrompt.getContextOrder 取或自定义>,
  text: () => injector.buildMinimal()?.content ?? '',
})
```

> ⚠️ `SessionInjector.loadScopedSpecs` 按 **cwd** 解析 `.scale/specs`，不随参数变化。若插件要支持多项目，需在 `apply` 时 `process.chdir` 之外的办法——建议**先只支持单项目**（`projectDir` 固定），多项目留 T2。

**T1.3 证据链**（`tools/post-execute` + `session/event`）

```ts
const ledger = new RuntimeEvidenceLedger({ projectDir, scaleDir: '.scale' })

ctx.on('tools/post-execute', async (exec, result, next) => {
  const decision = await next()
  ledger.record({
    sessionId: exec.agent?.id,
    kind: 'tool',
    title: exec.name,
    status: decision.kind === 'block' ? 'failed' : (result.isError ? 'failed' : 'passed'),
    summary: summarize(result),
    artifacts: extractPaths(exec),
  })
  return decision
})
```

> ⚠️ 用 `tools/post-execute`（waterfall，可观察最终结果）而非 `tools/result`（emit，无返回）。`result` 是**冻结的快照**。
> ⚠️ 这是**最高频路径**——每次工具调用都写一个 JSON 文件。**`writeFileSync` 跑在 DSH host 进程（Electron 主进程）里，同步写盘会卡整个 harness**：T1 必须改异步（`fs/promises` 或队列批写），不能直接复用 `RuntimeEvidenceLedger` 的同步 `writeFileSync` 路径——这需要给 Ledger 加异步入口或插件侧包一层写队列。建议 T1 先做**仅失败与门禁类工具落盘**，全量留 T2。

**T1.4 治理边界（R4 的解法）**

插件 Config 声明：

```ts
export const Config = Schema.object({
  projectDir: Schema.string().default(''),      // 空 = 用 DSH 会话 cwd
  scaleDir: Schema.string().default('.scale'),
  shield: Schema.object({ enabled: Schema.boolean().default(true) }).default({}),
  cortex: Schema.object({ enabled: Schema.boolean().default(true) }).default({}),
  evidence: Schema.object({ enabled: Schema.boolean().default(true), mode: Schema.union(['failures-only','all']).default('failures-only') }).default({}),
})
```

`projectDir` 解析优先级（**在每次 `tools/pre-execute` 触发时按 `exec` 逐次解析**，不在 `apply` 时固定——多工作区下固定值会保护错项目）：`config.projectDir` → `exec.agent.session.header.cwd` → `process.cwd()`。**不实现向上探测**（与 SCALE 现状一致，避免行为分歧）。

**验收标准**

- [ ] DSH 里执行 `rm -rf /tmp/x` 被 `tools/pre-execute` 拒绝，reason 含 `[destructive]`
- [ ] 写 `.scale/policy.yaml` 被拒绝，reason 含 `[Protected Path]`
- [ ] `ls -la` 正常放行（无回归）
- [ ] **warn 级命令（如 `git checkout -- src/`）触发 ask**：用户确认后执行、拒绝则不执行——不允许静默放行
- [ ] **开 `SCALE_MCP_EXPOSE_SHELL=1` 后，`mcp__scale__shell_run` 里的 `rm -rf` 同样被拦**（解包兜底生效）
- [ ] 新会话的 system prompt 含 `证据纪律` 段落
- [ ] 一次失败工具调用后，`.scale/evidence/runtime/` 新增一条 `RTE-*` JSON，`status: 'failed'`
- [ ] **37 条 blocklist 穷举覆盖**：每条规则用一个触发样例在 `tools/pre-execute` 自测里跑通（当前只抽测了 2 条 block + 1 条 warn 路径）
- [ ] **双写并发检查**：DSH 插件会话与 `scale` CLI 同时操作同一仓库时，`InstinctStore.save`（读-改-写 YAML）不产生丢更新——这是既有风险（两个 CLI 并发同样触发），非本方案引入，但 DSH 新增了一个并发写者，验收时确认
- [ ] 插件卸载（`ctx.effect` disposer）后，上述三个钩子全部失效、无残留
- [ ] 无 unhandled rejection（§2.12 致命项）

**预计**：3–4 天。

---

### T2 —— 命令与 Skills

**T2.1 `ctx.commands.register`**：把治理门禁暴露为 DSH 斜杠命令。

- 候选（从 90 个顶层命令中筛选）：`preflight`、`gate-quality`、`verify`、`shield status`、`cortex metrics`、`doctor env`。
- ⚠️ 命令**不进入模型**，生命周期落 `command/run` + `command/done`。
- ⚠️ 不要把长驻类（`open` / `dashboard daemon` / `orch start`）接进来——DSH 有自己的调度。

**T2.2 `ctx.skills.register`**：把 `.scale/skills/` 暴露给 DSH skills 注册表。

- `.scale/skills.json` 的 20 个域 → `SkillRegistration[]`。
- ⚠️ provider 注册必须**同步**；远程初始化放 `list()` 内 await。
- ⚠️ 名字必须 kebab-case；不支持递归 `**/SKILL.md`。
- ⚠️ `.scale/skills.json` 的 `domains[].requiredVerification` 等字段在 DSH `SkillSummary` 里无对应位置 → 需决定是丢弃还是塞进 `metadata`。

**验收标准**

- [ ] DSH 里 `/scale-preflight` 可执行并回显 SCALE 输出
- [ ] `skills` 列表中出现 SCALE 的 skill，且能 `get` 到完整 body
- [ ] 命令失败不导致 app 退出

**预计**：2–3 天。

---

### T3 —— 客户端面板（投入产出比最低，最后做）

**目标**：把 SCALE 治理可视化接进 DSH Web GUI。

- **必须先做 spike**：验证 Vue 3 组件能否挂进 React slot（`React.createElement` 包装 + 生命周期桥接）。若不可行，则重写为轻量 React 组件。
- 候选插槽：`tool.call.toolview`（按 SCALE 工具名渲染卡片）、`settings.section`（治理配置页）、`sidebar.panellist`（治理面板）。
- ⚠️ 客户端组件**永不接收 ctx**；业务组件不得含订阅机制。
- ⚠️ 必须发布**已构建**的 `lib/client.js`（`dsh.client.platform: 'web'`），否则大声失败。

**验收标准**

- [ ] 刷新 GUI 后新面板出现，无 console 错误
- [ ] 面板数据来自 Host 半（经 `host.call`），不直连文件系统
- [ ] 插件禁用后面板干净消失

**预计**：5–8 天（含 spike）。

---

## 7. 全局验收与回归

**发布前必须跑**（对齐 AGENTS.md 的交付要求）：

```bash
make preflight
make gate-workflow
make gate-quality
npm run typecheck
npm run lint
npm test
npm run smoke:setup
```

**DSH 侧**（⚠️ 用独立 profile，`desktop` 被 Electron 独占，见 R5）：

```bash
dsh --profile scale-dev --patch <overlay> --dump-config   # 确认层叠加与未跳过
dsh --profile scale-dev --patch <overlay> --help          # 引导并确认 apply 执行
# 增删 bundle 后必须重启 profile；普通 patch 编辑走热重载
```

**真实会话补验**（钩子链路已由 §5.6 自测证明；真实会话补验的是**模型可观察行为**，需消耗 API）：

```bash
# 启动 web/tui 会话，让模型调用一次 shell 工具，观察：
#   1) 终端出现 [scale-shield] pwsh -> Bash : block
#   2) 工具调用被拒绝，reason 含 [destructive]
# 注意：--dump-config / --help 只能证明"注册成功"；自驱动探针（§5.6 方法）可零 API
# 证明"拦截生效"；真实会话再确认模型收到 deny 后不会绕道其他工具。
```

**必须覆盖的回归点**：

1. `scale install` / `scale init` 在**未装 DSH** 的机器上行为不变。
2. 新增的 `dist/api/mcp-stdio.js` 不破坏 `npm run smoke:package`。
3. 插件包不进主包 `files`（避免体积膨胀）——它是独立包。
4. SCALE 的 23 个既有 adapter 不受影响（插件路径与 adapter 体系正交）。

---

## 8. 未验证项（如实标注）

| # | 未验证内容 | 为什么 | 建议验证方式 |
| --- | --- | --- | --- |
| ~~U1~~ | ~~插件能否真的在 DSH 内加载~~ | **已验证**（2026-10-15 实跑）：`apply` 执行、`ctx.effect` disposer 生效、SCALE 模块可 import、钩子注册成功。见 §5.5 | — |
| ~~U2~~ | ~~`tools/pre-execute` 能否覆盖 Shield 判定~~ | **已验证**（§5.6 三用例）：BLOCK/PROTECT 拦截生效，ALLOW 无误报 | 剩余：37 条 blocklist 的逐条覆盖未穷举 |
| ~~U3~~ | ~~DSH 工具名与 SCALE 的 `Bash/Write/Edit` 映射是否完备~~ | **已验证**：DSH 无 `bash`，shell 是 `pwsh`；`write`/`edit`/`read` 全小写。已写入 §6 T1.1 映射表 | — |
| U4 | Vue 组件能否挂进 React slot | 未做 spike | T3 第一步 |
| U5 | `systemPrompt.context` 的 order 取值是否合法 | 未查 `CONTEXT_ORDERS` 常量 | 读 `@deepseek-ai/dsh-system-prompt` 的导出 |
| U6 | MCP stdio 帧格式与 DSH SDK 的协商细节 | 未实现 wrapper | T0 实现后实测 |
| U7 | `dsh plugin add` 在本机的实际行为（网络/权限） | 未执行安装 | T0 第 3 步 |
| U8 | 证据全量落盘的性能影响 | 未压测 | T1 用 `failures-only` 起步，再评估 |

---

## 9. 建议的下一步

**推荐顺序：T0 → T1，但两者的理由已与方案早期不同。**

T0 仍是好的第一步（0.5 天、当天见效），但**理由从"证伪"改为"即时价值"**：T1 的核心风险（钩子能否触发、映射能否命中）已由 §5.6 零 API 自测排除，所以"T0 不通则 T1–T3 全不成立"这条证伪链**不再成立**——T1 依赖的是 hooks 与 tools registry，不依赖 MCP 客户端安装。若 T0 因 MCP 客户端安装受阻（U7），可直接跳到 T1，不必阻塞。

**开工前先做两件事（评审新增，合计约 0.5 天）**：

1. **T0 工具面收窄**：`mcpStdio.ts` 内默认省略 `shell_run`/`shell_plan`，开关 `SCALE_MCP_EXPOSE_SHELL=1`（堵安全回归，见 §6 T0 工作项 2）。
2. **T1.1 warn→ask 映射**：7 条 warn 级规则不能静默丢弃（堵功能退化，见 §6 T1.1）。

**T1 落地时注意 §5.6 列出的四条实现陷阱**，尤其是「顶层 `await import` 会静默阻止插件加载」。

---

## 10. 跨平台影响面（评审新增，回答"会不会影响其他平台"）

**结论：不会。** 改动天然分三层，前两层碰不到其他平台；唯一会外溢的第三层已有零外溢替代。

| 改动层 | 内容 | 对其他平台的影响 |
| --- | --- | --- |
| ① 插件包 `packages/dsh-scale/` | T1 三钩子 + T2 命令/Skills + T3 面板；warn→ask、`mcp__scale__` 解包都在这一层 | **零**：不装即不存在，且不进主包 `files` |
| ② 主包新增 `src/api/mcpStdio.ts` | DSH 专属 MCP stdio 入口（新代码路径） | **零**：Claude Code/Cursor 等不经这个入口 |
| ③ 主包现有代码 | 仅当缺口一选「改 `getTools()` 过滤工具」才会发生 | **会外溢**：`shell_run` 是 MCP 协议层工具，改它所有 MCP 客户端都看得到 |

> ⚠️ 因此缺口一的正确修法是 **wrapper 内过滤**（层②）或 T1.1 解包（层①），**不是**改 `getTools()`（层③）。本方案已按此修订（见 §6 T0 工作项 2）。

**为什么天然隔离**：DSH 走的是**插件路线**，不是 adapter 路线。ZCode 接入要动 `src/adapters/` 注册表（12 个注册点），而 DSH 插件是独立 npm 包、独立 profile。

**明确不碰的清单**：

- `src/adapters/` 全部 25 个适配器、`ADAPTER_MAP`、`AgentPlatform` 联合类型
- `PolicyCompiler` 与各平台 hook 注册（`.claude/settings.json`、`.codex/hooks.json` 等）
- 两套 blocklist 收敛（37 vs 18）——已明确排除在 T1 之外，建议单开任务
- `scale install` / `scale init` 在未装 DSH 的机器上零变化（§7 回归点 1 覆盖）

**唯一真实的跨平台交互：共享 `.scale/` 状态目录。** DSH 插件与 `scale` CLI 会写同一批文件：

| 路径 | 写者 | 并发安全 |
| --- | --- | --- |
| `.scale/events/*.jsonl` | EventBus `appendFileSync` 追加 | 基本安全（追加写，唯一交错点在极罕见场景） |
| `.scale/artifacts/` | ArtifactStore | 不同 id 安全 |
| `.scale/evidence/runtime/*.json` | RuntimeEvidenceLedger，唯一文件名 | 安全 |
| `.scale/instincts/**/*.yaml` | `InstinctStore.save` 读-改-写 | ⚠️ 理论上 last-writer-wins 丢更新 |

⚠️ 但**这不是本方案引入的回归**：两个 `scale` CLI 并发今天就有同样问题。DSH 只是新增了一个并发写者。建议 T1 验收补一条双写并发检查（已写入 §6 T1 验收）。

---

## 附：本次调研的权威证据索引

| 事实 | 证据 |
| --- | --- |
| 插件加载链路（`apply`/`ctx.effect`/SCALE 模块 import） | §5.5 实跑：独立 profile + `--patch` 探针插件 |
| **Shield 钩子端到端拦截** | §5.6 实跑：`pwsh`+`rm -rf` → `isError=true`；`write`+`.scale/policy.yaml` → `isError=true`；安全调用 → `isError=false` |
| `desktop` profile 独占 | 实跑报错 `profile "desktop" is managed exclusively by the Electron application` |
| dsh CLI 版本 | `dsh.cmd --version` → `0.2.0-rc.2` |
| DSH 工具名映射风险 | `listTools` 实测 107 工具；`checkToolInput` 对照实验（未映射→全 allow，映射→全 block） |
| DSH 运行时 ABI | `DeepSeek Harness.exe` + `ELECTRON_RUN_AS_NODE=1` → `node v24.18.1 modules 149 electron 44.0.0` |
| better-sqlite3 不兼容 | 实测报错 `NODE_MODULE_VERSION 137 ... requires 149` |
| 27 工具可加载 | `require('./dist/api/mcp.js')` → `tool count: 27` |
| Shield 判定可用 | `checkToolInput` 四用例：BLOCK/BLOCK/BLOCK/ALLOW |
| Cortex 可注入 | `SessionInjector.buildMinimal()` → content 含「证据纪律」 |
| 证据账本可用 | `ledger.record/list/summary` → `{total:1,passed:1,ok:true}` |
| 客户端是 React | `cordis_inspect_query(client, Builtin, listBuiltins)` → `React.createElement` |
| `dshReleases` 无人读 | `app.asar` 二进制扫描：`dshReleases` 0 次，`compatibility.json` 5 次 |
| manifest 权威字段 | 官方 `packages/util/package-manifest/src/types.ts` |
| MCP 契约与限制 | 官方 `packages/mcp/mcp-client/README.md` |
| 生命周期/事件/服务 | 官方 `docs/user/develop/framework/{index,events,service}.md` |
| 打包与分发 | 官方 `docs/user/develop/basic/{publish,config}.md` |
| Shield/Evidence/Cortex API | 子代理只读审计（带 `文件:行号`） |

---

## 11. T0/T1 实机验收记录【2026-10-24】

环境：dsh CLI `0.2.1-rc.2`（比调研时的 0.2.0-rc.2 新一版），独立 profile `scale-dev`（from web）。

### T0 —— 全绿

| 验收项 | 结果 |
| --- | --- |
| `mcp-scale` 层进入 `--dump-config` | ✅（`packages/dsh-scale/mcp-dev.patch.yml` 覆盖层，line 1230+） |
| stdio initialize | ✅ `scale-engine 0.55.3` |
| `tools/list` 收窄 | ✅ 25 个工具，`shell_run`/`shell_plan` 不在表中 |
| `SCALE_MCP_EXPOSE_SHELL=1` | ✅ 27 个工具，两个 shell 工具恢复 |
| `tools/call capability_list` | ✅ 返回真实 JSON（ok:true, projectDir 正确） |
| ~~`dsh plugin add @deepseek-ai/dsh-mcp-client`~~ | ⚠️ **R7 应验**：npm latest `0.0.1-rc.1` 被 0.2.1-rc.2 拒装（peer 不匹配）→ 装精确匹配版 `@0.2.1-rc.2` 成功 |

### T1 —— 安全关键路径通过

| 验收项 | 结果 |
| --- | --- |
| 插件在真实 DSH 内加载 | ✅（修复三个静态检查不可见的加载期阻塞，见下） |
| BLOCK：`pwsh` + `rm -rf` | ✅ `isError=true`，reason `[destructive] Recursive force delete (rm -rf)` |
| PROTECT：`write` + `.scale/policy.yaml` | ✅ `isError=true`，reason `[Protected Path]` |
| 证据落盘 | ✅ 两次被拦调用各落一条 `RTE-*.json`（`source: dsh-scale`, `mode: failures-only`） |
| ALLOW 无误报 | 🔶 单测覆盖；实机探针受限（见「遗留」） |
| warn→ask 交互确认 | 🔶 单测覆盖；需真实会话（ask 走审批 UI） |
| 37 条 blocklist 穷举 | ❌ 未做（遗留） |

### 实机暴露的三个加载期阻塞（静态检查全部不可见）

1. **`Config` 必须是 schemastery `Schema.object`**——普通对象在 Cordis 加载时抛 `Cannot read properties of undefined (reading 'validate')`（§5.5 探针是独立探针插件、无 Config，没暴露这条）。
2. **必须声明 `export const inject = ['tools', 'systemPrompt']`**——不声明则 `apply` 里访问 `ctx.systemPrompt` 直接抛 `cannot get property "systemPrompt" without inject`（教程「坑 2」的运行时实锤）。
3. **`tools.execute()` 签名（0.2.1-rc.2）**：接一个 exec 对象 `{name, arguments, signal}`——`signal` 必填（`callerCancelled` 直接读 `signal.aborted`）；返回 `{isError, content[]}`（不是 `{isError, result}`）。且必须以 `tools.execute({...})` 方法调用形式调用（解构会丢 `this`）。0.2.0→0.2.1 的漂移实锤。
4. （附）**§2.12 致命项实锤**：定时器回调里的未捕获异常 → `dsh: fatal load failure` 整个 app 退出。自测驱动器已按契约全包 try/catch。

### 遗留（进入后续任务）

- ALLOW/warn→ask 的**真实会话**补验（需 web 会话 + API；启动期无上下文探针看不到会话级工具如 `read`，且首调后工具服务在最小 profile 下会重建）。
- 37 条 blocklist 穷举覆盖（T1 验收项，未完成）。
- Shield 既有盲区：blocklist 只匹配 POSIX 形态（`/\brm\s+-rf\b/`），PowerShell 原生 `Remove-Item -Recurse -Force` 不命中任何规则——建议单开 blocklist 任务（连同既有的 37 vs 18 不一致）。
- `systemPrompt.context(id, content, {order})` 的真实签名以「best-effort + try/catch」注册，未实机确认（U5 仍开放）——真实会话补验时顺带确认。

---

## 12. T2/T3 实施记录【2026-10-24】

环境同 §11（dsh 0.2.1-rc.2，scale-dev profile）。开工前先从 npx 缓存的 DSH 真实源码核对了三份契约（dsh-commands / dsh-skill / dsh-client-ui-skill 客户端半），T1 时代「签名靠实测踩坑」的教训这次全部前置消化。

### T2 —— 命令与 Skills

| 验收项 | 结果 |
| --- | --- |
| 插件带 `inject=['tools','systemPrompt','commands','skills']` 正常加载 | ✅ 实机（profile 内两服务均存在） |
| 6 个斜杠命令注册 | ✅ 实机输出 `registered 6 slash commands (scale-*)` |
| `/scale-preflight` 回显 SCALE 输出 | 🔶 单测覆盖（handler 真跑 `scale doctor env` 并 settle 在 CommandResult 契约内）；命令执行需 agent 上下文，实机执行归入「真实会话补验」 |
| Skills 出现在列表且可 get 全文 | 🔶 单测覆盖（provider list/get + kebab 名 + 正文懒加载）；DSH 侧 skills 查询发生在会话内，同上归入补验 |
| 命令失败不退出 app | ✅ 按契约设计（handler 不抛、错误走 `kind:'error'`） |

实现要点：CLI 定位不用 `require.resolve`（主包 exports 仅 `import` 条件，CJS 解析必炸 `ERR_PACKAGE_PATH_NOT_EXPORTED`——单测抓到的真 bug），改为从插件自身位置向上探测 `node_modules` 并 realpath 穿透符号链接；命令参数 allowlist 固定，`rawInput` 不透传（v1 安全取舍）。

### T3 —— 客户端面板（范围收窄 + 路线决策）

**U4 关闭（spike 结论）**：不做 Vue 混挂。理由：客户端半只能用受限全局（`React.createElement`、`styles.insert`），Vue 需要整体内联进浏览器包且要手写生命周期桥，而治理卡片的复杂度根本用不上——走计划 R6 明确允许的「轻量 React 组件」回退。

**本轮交付**：`tool.call.toolview` 按 wire 工具名 keyed 注册 25 张 `mcp__scale__*` 卡片（shell 对已被 T0 收窄不出现在工具表），纯展示（会话内参数+结果），防御式消费 props（第三方卡片载荷不是稳定公开契约）。

**明确推迟（含理由）**：`sidebar.panellist` / `settings.section` 动态数据面板——需要宿主侧新建 typert Remote 服务（Zod schema + Remote 装饰器体系，版本脆弱且对第三方插件无公开构建支持），或借道 `ctx.remote.commands.execute`（需 agent 上下文，形状未验证）。投入产出比不成立，等 DSH 把第三方客户端 RPC 通道稳定后再做。

**GUI 内的实际渲染未验证**（无浏览器会话）——客户端 manifest 形状逐字段对照 dsh-client-ui-skill 官方包，注册/清理/无 React 降级由单测覆盖。
