# ZCode Agent 适配方案

- 日期：2026-09-22
- 任务等级：L（跨模块、适配器体系）
- 状态：待评审
- 目标版本：0.56.0（minor，新增平台）

## 0. 结论先行

SCALE Engine 目前支持 23 个 agent 平台（`src/adapters/` 集中式注册表），但 **不支持 ZCode**。
ZCode 的配置面与 Claude Code 同源但有关键差异（hook schema 多一层 `events` 嵌套、配置文件 hook 默认关闭、hook 入参走 stdin、知识文件是通用标准文件 `AGENTS.md`）。
本方案按 4 个阶段接入：P0 核心适配器 → P1 生态注册点 → P2 Shield 支持 → P3 增强与真机验收。
预计新增/修改约 16 个文件，其中 1 个新适配器、1 个新集成测试、其余为注册点清单和文档。

## 1. 现状：SCALE 的 agent 适配层

### 1.1 架构

- **接口**：`src/adapters/ClaudeCodeAdapter.ts` 定义 `IAgentAdapter`（init / getSettingsPath / getKnowledgeDocPath / getSkillsDir / generateSettings / mergeSettings / generateKnowledgeDoc / isInstalled）。
- **注册表**：`src/adapters/index.ts` 的 `ADAPTER_MAP` + `createAdapter()` 工厂 + `SUPPORTED_AGENTS`。
- **平台类型**：`src/artifact/types.ts:906` 的 `AgentPlatform` 联合类型。
- **自动扩展的消费方**（走 `SUPPORTED_AGENTS`，无需逐个改）：`scale init`（`src/cli/initConfigCommands.ts`）、`CustomerInstall`（`src/setup/CustomerInstall.ts`）。
- **手工枚举的注册点**（新平台必须逐个加）：见 1.2。
- **Shield**：`src/shield/PolicyCompiler.ts` 硬编码 claude / codex / cursor 三个 harness 的 settings patch；`ShieldActivation.ts` 同样只认这三个。

### 1.2 新增平台的注册点清单（以 workbuddy 为样板实测）

| # | 文件 | 改什么 |
| --- | --- | --- |
| 1 | `src/artifact/types.ts:906` | `AgentPlatform` 加 `'zcode'` |
| 2 | `src/adapters/ZCodeAdapter.ts` | 新建适配器 |
| 3 | `src/adapters/index.ts` | import + export + `ADAPTER_MAP` |
| 4 | `src/index.ts:136-149` | 补充导出 `ZCodeAdapter` |
| 5 | `src/api/quickstart.ts:139` `detectPlatform()` | 检测路径加 `.zcode/config.json` |
| 6 | `src/skills/SkillDiscovery.ts:107,120,250` | `PROJECT_PLATFORMS`、`PLATFORM_SKILLS_DIRS`、settings 监测路径 |
| 7 | `src/api/doctor.ts:231,247` | doctor 检查清单 + 提示文案 |
| 8 | `src/dashboard/DashboardServer.ts:5095,5129` | 显示名 + settings/doc 配对 |
| 9 | `src/agents/AcpCollaboration.ts:44` | 平台别名映射 |
| 10 | `src/agents/ExternalAgentCatalog.ts:77` | `toolAdapterAliases` |
| 11 | `tests/integration/zcode-adapter.test.ts` | 新建集成测试（对齐 `workbuddy-adapter.test.ts`） |
| 12 | 文档 4 篇 + README | 见 §5.4 |

## 2. ZCode 配置面（官方文档已确认）

来源：ZCode 官方 skill `zcode-configuration-guide` 与 `diagnosing-hooks`（`~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/0.2.0/skills/`）。

| SCALE 概念 | ZCode 资源 | 说明 |
| --- | --- | --- |
| settings.json（hook 注册） | `<repo>/.zcode/config.json`（workspace scope）→ `hooks` 键 | **必须显式 `hooks.enabled: true`**，否则配置 hook 全部静默不执行 |
| hook 事件 | 7 个：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop` | 无 `SessionEnd`；比 Claude 多 `UserPromptSubmit` / `PermissionRequest` / `PostToolUseFailure` |
| hook schema | `{ hooks: { enabled, timeoutMs, maxOutputBytes, events: { <Event>: [ { matcher, hooks: [ { type: 'command'\|'process', ... } ] } ] } } }` | **比 Claude 的扁平结构多一层 `events`**；matcher 是大小写敏感正则，匹配工具名（`Task`↔`Agent`、`Write`/`Edit`←`ApplyPatch` 别名） |
| hook 入参 | **stdin 传 JSON**；模板变量 `${ZCODE_PROJECT_DIR}`、`${CLAUDE_SESSION_ID}` 展开并同时注入环境变量 | `CLAUDE_SESSION_ID` 兼容变量与 `gateInlineCommands.ts:145` 现有 fallback 链兼容 |
| hook 输出 | stdout 严格 JSON schema，或 exit code（0 过 / 2 block / 其他=错误）；`PreToolUse` 可返回 `allow/ask/deny`；`Stop` 可请求继续（**上限 3 次**） | 与 SCALE gate 的 allow/deny 语义匹配 |
| 知识文件 | `<repo>/AGENTS.md`（workspace scope） | **通用标准文件，目标项目通常已存在**，必须 merge 不能跳过/覆盖 |
| skills | `<repo>/.zcode/skills/<name>/SKILL.md` | 项目级，可版本控制，符合 SCALE 治理共享定位 |
| MCP | `.zcode/config.json` → `mcp.servers` | 远期可用 `scale mcp` 注册 |
| 跨平台分发 | plugin：`.zcode-plugin/plugin.json` + skills/hooks/commands | P3 远期选项 |

## 3. 差异分析：ZCode 与已有 23 个适配器的四个关键差异

1. **hook schema 不同**：`hooks.events.<Event>[]` 嵌套结构 + `matcher.hooks[]` 两层，不能复用 Claude 的扁平 merge 逻辑。
2. **`hooks.enabled: true` 是隐性开关**：不写就全部静默失效，且无报错。这是最隐蔽的坑，merge 时必须保证、doctor 必须校验。
3. **hook 入参走 stdin** 而非环境变量：现有 `scale gate pre-tool --args-json "$TOOL_INPUT_JSON"` 模式拿不到 ZCode 的入参。
4. **知识文件是 AGENTS.md**：几乎所有目标仓库都已有该文件且被多工具共享（本仓库自己就有），"不存在才创建"的默认策略对 ZCode 等于"永远不接上"。

## 4. 方案总览

| 阶段 | 交付物 | 验收标准 |
| --- | --- | --- |
| P0 核心适配器 | `ZCodeAdapter` + 平台类型 + 注册表 + 单测 | `scale init --agent zcode` 产出合法 `.zcode/config.json` 与 AGENTS.md 幂等 merge |
| P1 生态注册点 | 检测 / doctor / skills / dashboard / catalog 全链认识 zcode | `detectPlatform` 识别、doctor 不再报"无 agent settings"、dashboard 显示 ZCode |
| P2 Shield | `scale shield compile/status/test` 支持 zcode harness | shield hooks 注册进 `.zcode/config.json` 且 18 用例通过 |
| P3 增强 + 真机 | stdin gate、三态 PermissionRequest、文档、真机验收 | 本仓库自举：ZCode 会话内 SessionStart 注入 / PreToolUse 拦截 / Stop 阻止未验证完成 |

## 5. 详细变更清单

### 5.1 P0 — 核心适配器

**新建 `src/adapters/ZCodeAdapter.ts`**（约 170 行，对齐 WorkBuddyAdapter 体量）：

- `agentType = 'zcode'`
- `getSettingsPath()` → `<project>/.zcode/config.json`
- `getKnowledgeDocPath()` → `<project>/AGENTS.md`
- `getSkillsDir()` → `<project>/.zcode/skills`（项目级，进 `PROJECT_PLATFORMS`）
- `generateSettings()` 返回 ZCode schema（示意）：

```jsonc
{
  "hooks": {
    "enabled": true,
    "events": {
      "SessionStart": [{ "matcher": "startup|resume", "hooks": [
        { "type": "command", "command": "scale context inject --session-id \"$CLAUDE_SESSION_ID\"" } ]}],
      "PreToolUse": [{ "matcher": "^Bash$", "hooks": [
        { "type": "command", "command": "node .scale/hooks/zcode-gate.mjs pre-tool Bash", "timeoutMs": 10000 } ]}],
      "PostToolUse": [{ "matcher": "^(Edit|Write|Bash)$", "hooks": [
        { "type": "command", "command": "node .scale/hooks/zcode-gate.mjs post-tool" } ]}],
      "Stop": [{ "matcher": "", "hooks": [
        { "type": "command", "command": "scale gate before-stop --session-id \"$CLAUDE_SESSION_ID\" --hook-safe" } ]}]
    }
  }
}
```

- **merge 策略（本适配器的核心）**：
  - `mergeSettings()` 只动 `hooks` 子树：按 `events.<Event>[].hooks[].command` 包含 `scale ` / `zcode-gate` 判重后追加；**无条件确保 `enabled: true`**（若用户手动关掉，重新 init 会打开——在 CHANGELOG/文档中声明该行为）；不碰 `mcp.servers` 与其余字段。
  - `generateKnowledgeDoc()` + 新增 `mergeKnowledgeDoc()`：AGENTS.md 已存在时，在文件头部之后插入带 `<!-- SCALE:BEGIN -->` / `<!-- SCALE:END -->` 标记的 "## SCALE Engine Integration" 段落；重复 init 时替换标记内内容（幂等），标记外内容一律不动。
- `init()` 流程对齐基类：建 `.scale/` 目录 → merge config.json → merge AGENTS.md → `.scale/.gitignore`。

**引擎侧配套（stdin 入参）**：

- `scale gate pre-tool` / `post-tool` 增加 `--stdin` 标志（实现位置：`src/cli/gateInlineCommands.ts`）：无 `--args-json` 或带 `--stdin` 时从 stdin 读 ZCode hook JSON，解析 `tool_name` / `tool_input` / `session_id` 后走现有 gate 流程；session id fallback 链已含 `CLAUDE_SESSION_ID`（`gateInlineCommands.ts:145`），零改动兼容。
- 可选 helper 脚本 `.scale/hooks/zcode-gate.mjs`：stdin → 调 `scale gate` → 按约定输出 exit code（0/2），用 node 调用规避 Windows shell 差异（先例：`.claude/hooks/shield-pre-tool.js`）。若 `--stdin` 直连够用则省去该脚本，实施时二选一。

**注册与类型**：`AgentPlatform` 加 `'zcode'`；`src/adapters/index.ts` 注册；`src/index.ts` 导出。

### 5.2 P1 — 生态注册点

| 文件 | 改动 |
| --- | --- |
| `src/api/quickstart.ts` | `detectPlatform()` checks 数组加 `{ platform: 'zcode', paths: [join(projectDir, '.zcode', 'config.json')] }`（放在 claude-code 之后；`suggestions` 兜底列表加 `'zcode'`） |
| `src/skills/SkillDiscovery.ts` | `PROJECT_PLATFORMS` 加 `'zcode'`；`PLATFORM_SKILLS_DIRS['zcode'] = join('.zcode', 'skills')`；settings 监测数组加 `.zcode/config.json` |
| `src/api/doctor.ts` | 检查清单加 `{ agent: 'zcode', path: join(projectDir, '.zcode', 'config.json') }`；报错文案的目录列表补 `.zcode`；**增强：检查 `hooks.enabled === true` 并给出针对性提示** |
| `src/dashboard/DashboardServer.ts` | 显示名 `zcode: 'ZCode'`；配对 `('.zcode/config.json', 'AGENTS.md')` |
| `src/agents/AcpCollaboration.ts` | 别名映射加 `zcode: 'zcode'`（ZCode 是否支持 ACP 会话桥接待验证；不支持则只注册别名占位） |
| `src/agents/ExternalAgentCatalog.ts` | `toolAdapterAliases` 加 `zcode: 'zcode'` |
| `src/shield/PolicyCompiler.ts:47` | `DEFAULT_DIRTY_TREE_ALLOW_PATTERN` 是否加 `\.zcode/` 待定：`.zcode/config.json` 设计上要提交，但 hook/测试运行可能产生临时文件；实施时以真实 dirty-tree 表现为准 |

### 5.3 P2 — Shield 支持

- `src/shield/PolicyCompiler.ts`：`settingsPatches` 加 `zcode` → `.zcode/config.json`；`patchHarnessSettings()` 增加 zcode 分支，写入 `hooks.events.PreToolUse[]` 格式（而非 Claude 扁平格式）并确保 `enabled: true`；hook 脚本复用 `.claude/hooks/shield-pre-tool.js`（node 入口跨平台），验证其读 stdin 的兼容性——Claude 与 ZCode 同为 stdin + exit code 模型，预计直接兼容，不兼容则加薄适配层。
- `src/shield/ShieldActivation.ts:65`：settings 路径数组加 zcode 路径。
- `scale shield test`：18 个 allow/block 用例补 zcode 注册格式断言。

### 5.4 P3 — 增强与文档

- **事件映射增强（ZCode 独有机会）**：
  - `UserPromptSubmit` → 轻量上下文/instinct 注入（接 Cortex `inject --minimal`）；
  - `PermissionRequest` → 返回 `allow/ask/deny` 三态决策（比 Claude 更贴合 SCALE gate 语义）；
  - `PostToolUseFailure` → 失败事件入 `.scale/events/`，喂 brute-retry 检测。
- **文档**：`docs/04-INTEGRATION.md`、`docs/SHIELD.md`、`docs/start/agent-installation-guide.md`、`docs/AGENT_ECOSYSTEM.md`、README 支持列表、CHANGELOG。
- **Skills 分发**：`.scale/skills/` 的核心工作流技能以 `.zcode/skills/scale-*/SKILL.md` 形式随 init 落地（SkillDiscovery 已支持项目级扫描）。
- **远期（不在本期）**：打包为 ZCode plugin（`.zcode-plugin/plugin.json` + hooks + skills + commands），经 marketplace 分发，插件 hooks 可自动启用 hook runner。

## 6. 关键设计决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| AGENTS.md 策略 | **幂等 merge（标记段落）**，不是"不存在才创建" | AGENTS.md 是通用标准文件，几乎必然已存在；跳过=接不上，覆盖=破坏用户内容 |
| hook 入参 | gate 命令加 `--stdin`，而非每个 hook 注环境变量 | ZCode 走 stdin 是协议事实；引擎侧一处改动，未来所有 stdin 型 agent 复用 |
| 命令形态 | node 入口（`node .scale/hooks/...`）或 `type: process`，不用裸 shell 语法 | ZCode 官方明确 POSIX shell 语法在 Windows 会挂；仓库已有 node 入口先例 |
| enabled 开关 | init/shield 写入时强制 `true`，doctor 校验 | 官方：配置文件 hook 默认关闭且静默不执行 |
| Stop 语义 | 直接接 `gate before-stop` | ZCode Stop 可请求继续但上限 3 次，与"未验证不得声称完成"语义兼容；文档注明 3 次上限 |
| scope | workspace（`.zcode/`、`AGENTS.md` 随仓库提交） | SCALE 治理要求团队共享；ZCode workspace scope 自动信任连接 |

## 7. 风险与缓解

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | `hooks.enabled` 被后续流程改回缺失/关闭导致全链静默失效 | merge 强制写 `true`；doctor 校验并告警；单测断言 |
| R2 | AGENTS.md merge 破坏用户内容或重复插入 | 标记段落幂等替换；单测覆盖"已有内容/已有 SCALE 段/无文件"三种场景；`created/skipped` 如实上报 |
| R3 | config.json 是通用配置，merge 误伤 `mcp.servers` 等 | 只操作 `hooks` 子树，JSON 序列化保持 2 空格；单测断言无关字段原样保留 |
| R4 | stdin JSON 结构与 `tool_input` 字段名不匹配（凭官方文档推断，未实测） | P3 首个任务就是真机 hook 探测：最小 echo hook 打印 stdin 到文件，确认字段名后再定 `--stdin` 解析逻辑 |
| R5 | Windows shell 差异 | node 入口 / `type: process`；`verify.ps1` 场景纳入真机验收 |
| R6 | ZCode 不支持 ACP | AcpCollaboration 仅注册别名占位，不做桥接承诺 |
| R7 | detectPlatform 顺序：同时存在 `.zcode` 与 `.claude` 时归属歧义 | 按 checks 数组现有优先级（claude 优先）并在文档说明；用户可用 `--agent zcode` 显式指定 |

## 8. 验证计划

自动化（每阶段）：

```bash
npm run typecheck && npm run lint
npm test -- tests/integration/zcode-adapter.test.ts   # 经 scripts/workflow/run-vitest.mjs
npm run smoke:setup
npm run smoke:package        # 打包物含 .zcode 相关资产时复查 files 白名单
npm test                     # 全量回归
bash scripts/gates/all.sh --quality
```

真机验收（P3，本仓库自举，当前会话本身就是 ZCode）：

1. `scale init --agent zcode --dir .` → 检查 `.zcode/config.json` 合法、`hooks.enabled: true`、AGENTS.md 段落存在且原内容无损。
2. `scale shield compile && scale shield status && scale shield test` → zcode harness 注册成功。
3. 重启 ZCode 会话验证 hook 实际触发（ZCode 日志有 fired/blocked 记录）：SessionStart 注入、PreToolUse 拦截危险命令、Stop 阻止未验证完成、exit code 语义正确。
4. `scale doctor` 显示 zcode 检查项通过。
5. 二次 init 幂等（无重复段落、无重复 hook）。

## 9. 回滚方案

- 单一分支提交（建议 `feat/zcode-adapter`），revert 即完全回滚；`AgentPlatform` 为联合类型，编译期保证无残留引用。
- 已写入目标项目的 `.zcode/config.json`：删除 `hooks` 子树或整个文件即脱离治理（AGENTS.md 段落删除标记区间即可）；`scale shield` 卸载路径不变。
- 发布层：0.56.0 为 minor 新增，无迁移，回滚到 0.55.x 不影响既有项目。

## 10. 与面板整改计划（T1–T4）的关系

面板整改是另一条工作线（把 dashboard 从"只读监控 + CLI 引导"改造为"操作控制台"：T1 聊天闭环、T2 消灭复制命令、T3 补后端能力 UI 入口、T4 交互 bug）。两条线正交、无代码冲突，但有三处明确交集，执行时按下表对齐：

| 交集 | 归属 | 约定 |
| --- | --- | --- |
| 面板 agent 矩阵显示 ZCode（`getAgentPlatformTargets()` 遍历 `SUPPORTED_AGENTS`） | 本方案 P1 | `agentPlatformPaths` 必须显式映射 `.zcode/config.json`（generic 兜底是 `.zcode/settings.json`，会指错）；P1 验收含面板矩阵显示 ZCode 状态 |
| 面板聊天实跑（T1）与 ZCode hooks | 互不替代 | localExecutor 走引擎自身执行链，不经 ZCode hooks；ZCode hooks 管的是用户在 ZCode CLI/App 内干活。ZCode 做成面板派单执行器属未来 T1+ACP 工作，本期仅在 `AcpCollaboration.ts` 注册别名占位 |
| 集成页 `scale init --agent zcode` 复制命令 | T2 | T2 处置该 code-box 时改为真按钮（后端 `detectPlatform` / `adapter.init` 现成，P1 已把 zcode 加入检测链） |

排期不互斥：P0–P1 在 adapter/服务端注册点层，不碰 `App.vue` 交互重构区，可与 T1 并行。

## 11. 不做的事（Out of Scope）

- 不改 `.scale/` 运行时结构与 policy.yaml 语义。
- 不在本期实现 ZCode plugin 打包与 marketplace 分发（P3 远期）。
- 不做 `SessionEnd` 等价物（ZCode 无该事件；`Stop` 已覆盖治理闭环）。
- 不做 MCP 注册（`scale mcp` 与 ZCode `mcp.servers` 的对接另立任务）。

## 12. 实施记录（2026-09-22，P0–P2 + 面板 T1 已落地）

**已实施并验证**：

- P0：`AgentPlatform` 联合类型加 `'zcode'`；新建 `src/adapters/ZCodeAdapter.ts`；注册表/导出接入；`scale gate pre-tool/post-tool` 增加 `--stdin`（解析 `tool_input`/`tool_response`/`session_id`，空对象视为未命中以激活环境变量 fallback 链）；gate 进程内 pino 静音（ZCode 对 hook stdout 做严格 JSON 校验，日志会污染输出）。AGENTS.md merge 实现为"标记段落原位替换 + 无标记时末尾追加"（比计划稿的头部插入更安全，不破坏 frontmatter），init 增量写盘以归一化后的原文件为差异基准（修复了 merge 污染调用方对象导致变更检测失效的真 bug）。
- P1：`detectPlatform`（quickstart 与 SkillDiscovery 双处）、doctor（candidates + `hooks.events` 嵌套收集 + hook 计数修正 + 提示文案）、DashboardServer（显示名 + `.zcode/config.json`↔`AGENTS.md` 配对，P1 验收含面板矩阵）、`AcpCollaboration`、`ExternalAgentCatalog`。
- P2：Shield `patchZcodeSettings`（`hooks.events` 嵌套格式 + 强制 `enabled: true`）+ ShieldActivation 注册检查 + **修复既有隐患**：Shield 生成脚本原只读 `argv[2]`，在 stdin 协议 agent（ZCode，含 Claude Code）下会空转放行，已加 stdin fallback。
- 面板 T1（聊天闭环开闸）：`AgentControlPlane.enableLocalExecution()` + `POST /api/agent-control/sessions/:id/enable-local-executor` 路由 + 前端执行模式警示条一键开闸按钮（zh/en i18n）+ 修复 willExecute 取值错位（`payload.message?.willExecute` → `payload.willExecute`）+ admin model API 补 `localExecutor` 透传。执行→回帖→SSE 推送链路为既有能力，未改动。
- 验证：`typecheck` ✓；`lint` 0 错误；`npm run build`（tsc + vite dashboard 构建）✓；8 个直接受影响的测试文件 82 用例全绿（zcode-adapter 18、agent-platform-expansion 8、workbuddy-adapter 12、shieldE2E 20、agentLocalExecutor 7、agentControlSse 3、agentControlSuccessRate 3、dashboardServer 11）。

**遗留（P3 + 面板 T2–T4）**：

- 真机验证未做：ZCode hook stdin 载荷字段名（`tool_input`/`session_id`）仍基于官方文档推断，需最小 echo hook 探测确认（防御式解析下字段不符只会退化为放行，不会崩溃）；ZCode 会话内 SessionStart/PreToolUse/Stop 实际触发、面板"点按钮→发消息→回复出现"的浏览器端到端体感。
- `npm test` 全量回归未跑（时长考虑，已跑直接受影响套件）；建议交付前跑 `npm run release:check` 或至少 `bash scripts/gates/all.sh --quality`。
- P3 增强（UserPromptSubmit/PermissionRequest/PostToolUseFailure 映射、skills 分发、ZCode plugin 打包）与文档四篇 + README + CHANGELOG 未动；面板 T2–T4 未动。

## 13. 实施记录（2026-09-22 续）：真机验证 + P3 收尾

**真机验证四项全过**（沙箱 `tmp/zcode-verify/`）：

1. `scale init --agent zcode` 一次跑通：config.json 正确、Shield 自动合并、doctor 24 passed / 0 failures、二次 init 幂等。
2. gate stdin：放行 exit 0（stdout 干净）、拦截 exit 2 + stderr 原因。
3. Shield 脚本 stdin：放行 0 / 拦截 2 + `[SCALE SHIELD BLOCKED]`。
4. 面板聊天闭环（真实 HTTP 服务）：enable-local-executor → 发消息 `willExecute:true, status:completed, claimedBy:local-executor`（产出真实 AIOS-RUN 证据）→ transcript 收到 `[local-executor]` 回帖。

**真机验证揪出并修复的既有 bug**：

- Shield 生成脚本 `const protected`（严格模式保留字）在 `type: module` 项目下无法解析（Shield 完全空转）→ 全部生成脚本迁移为 `.cjs`；顺带修复 `compileRule` fileName 漏改导致的 MODULE_NOT_FOUND；SecurityGate 的 shield 豁免正则扩展 `.cjs`；4 个测试文件同步。
- gate 进程内静音 pino（stdout 污染会让 ZCode 判 hook 失败）。
- doctor 对嵌套 `hooks.events` 的收集与计数修正。

**P3 已完成部分**：

- 事件映射：`PermissionRequest` → pre-tool gate（exit 0=放行 / 2=拒绝，纯退出码语义）；`PostToolUseFailure` → post-tool `--exit-code 1` 失败入账（非阻塞）；gate `tool` 位置参数可省略并回退 stdin `tool_name`。三者均真机验证通过。
- `scale context inject` 确认输出 JSON，SessionStart 无 stdout 污染；但 ZCode 对 SessionStart 输出的严格 schema 校验（`additionalContext` 形态）待真机确认，注入效果暂不承诺。
- 文档：`docs/04-INTEGRATION.md`（清单+表格）、`docs/start/agent-installation-guide.md`（23 种）、`docs/SHIELD.md`（.cjs + zcode 注册）、README 徽章/计数、CHANGELOG Unreleased。

**仍未做**：`UserPromptSubmit` 映射（需先确认 ZCode 输出 JSON schema，避免盲发被严格校验拒绝）、skills 分发、ZCode plugin 打包、面板 T2–T4。
