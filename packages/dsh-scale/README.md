# dsh-scale

SCALE Engine 治理插件 for DeepSeek Harness（DSH）。一个 `apply()` 挂五座桥：

| 桥 | DSH 扩展点 | 作用 |
| --- | --- | --- |
| Shield | `tools/pre-execute`（waterfall） | 危险命令拦截（block→deny）、受保护路径、warn 级命令转 `ask` 用户确认 |
| Cortex | `systemPrompt.context` | 注入 SCALE 证据纪律契约 + 高置信本能（`InstinctStore`/`SessionInjector`） |
| Evidence | `tools/post-execute` | 工具调用落 `.scale/evidence/runtime/`（异步、默认 failures-only） |
| Commands（T2） | `ctx.commands.register` | 6 个治理斜杠命令：`/scale-preflight`、`/scale-gate-quality`、`/scale-verify`、`/scale-shield-status`、`/scale-cortex-metrics`、`/scale-doctor-env`——真实拉起 `scale` CLI（allowlist 固定参数、120–300s 超时、输出截断） |
| Skills（T2） | `ctx.skills.registerProvider` | `.scale/skills/<PHASE>/<name>.md` 阶段工作流技能进 DSH 注册表（名字 kebab-case、正文 get() 懒加载；`skills.json` 的域路由元数据不注册——那些指向全局根的外部技能，DSH 自己的文件发现负责） |

客户端半（T3）：`exports["./client"]`（`dsh.client.platform: "web"`）为 25 个 `mcp__scale__*` 工具注册 `tool.call.toolview` 卡片——纯展示（会话内参数 + 结果），轻量 React（`React.createElement` 全局 + `styles.insert`，无 JSX、无 Vue 混挂——计划 R6 允许的回退路线，U4 就此关闭），不触文件系统。

工具名映射（DSH → SCALE Shield）：`pwsh→Bash`、`write→Write`、`edit→Edit`、`read→Read`；`mcp__scale__*` 前缀自动解包（`shell_run` 按 Bash 语义判定）。

## 配置（cordis.patch.yml config）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `projectDir` | `''`（用 DSH 会话 cwd） | `.scale/` 所在项目根 |
| `enableShield` / `enableCortex` / `enableEvidence` / `enableCommands` / `enableSkills` | `true` | 五座桥单独开关 |
| `evidenceMode` | `'failures-only'` | `'all'` 记录全部工具调用（写盘量未压测，plan U8） |

## 本地开发

```bash
# 1. 构建主包（插件类型与运行时都依赖 dist/）
npm run build                        # repo root

# 2. 插件依赖 + 构建（file: 链接主包）
cd packages/dsh-scale
npm install
npm run build

# 3. 独立 profile 验证（desktop 被 Electron 独占，不能用）
dsh --profile scale-dev --from-default-profile web   # 建一次
dsh --profile scale-dev --patch packages/dsh-scale/dev.patch.yml --dump-config
SCALE_DSH_SELFTEST=1 dsh --profile scale-dev --patch packages/dsh-scale/dev.patch.yml --help
```

`SCALE_DSH_SELFTEST=1` 触发 §5.6 式零 API 自测（BLOCK/PROTECT/ALLOW 三用例）。

## 安装（正式）

```bash
dsh plugin --profile <profile> add @hongmaple0820/dsh-scale
dsh --profile <profile> --dump-config   # 确认 scale-governance 层未被跳过
```

发布须知：`files` 只含 `lib/`（预构建，含 client.js）+ `cordis.patch.yml`，避免 git 安装的 build 授权陷阱（plan §2.11）。

## 边界

- 不构造 `SQLiteArtifactStore`/`MemoryBrain` —— DSH 的 Electron ABI（MODULE_VERSION 149）与主包原生模块（137）不兼容；本插件只走 `InMemoryArtifactStore`/纯函数路径（plan R1）。
- 多项目：`projectDir` 固定值在多工作区场景会保护错项目；Shield 逐次按 `exec.agent.session.header.cwd` 解析。Skills/Commands 按进程 cwd（`projectDir` 配置优先）。
- `SessionInjector` 的 `.scale/specs` 按 `process.cwd()` 解析（主包既有行为），会话 cwd ≠ projectDir 时 specs 段缺省。
- 斜杠命令的 CLI 参数是 allowlist 固定的，`rawInput` 不透传（v1 安全取舍）；需要带参命令时先扩 allowlist。
- 客户端卡片对 props 做防御式消费（第三方卡片的载荷形状不是稳定公开契约），缺字段时降级为仅显示工具名。

