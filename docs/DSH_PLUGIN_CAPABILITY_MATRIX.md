# DSH 插件能力矩阵（dsh-scale）

Status: P2-B 评估完成（`scripts/qa/check-dsh-plugin-abi.mjs`）
Scope: 回答「dsh 插件做得如何、是否完整可用、哪些能力满血、哪些降级、为什么」

评估由 `node scripts/qa/check-dsh-plugin-abi.mjs` 生成，2026-11-07 实测输出：

```json
{
  "plugin": "@hongmaple0820/dsh-scale",
  "betterSqlite3Range": "^13.0.3",
  "sqliteMajor": 13,
  "isNapi": true,
  "pluginUsesSqlite": false,
  "pluginMode": "degraded (InMemory / pure-function)",
  "readmeStillClaimsAbiIncompatibility": true,
  "abiAssumptionStale": true
}
```

## 能力矩阵

dsh-scale 通过一个 `apply()` 挂五座桥 + 客户端卡片。按「DSH 进程内是否满血」分：

| 能力 | DSH 内状态 | 依据 |
| --- | --- | --- |
| Shield 工具拦截（tools/pre-execute） | ✅ 满血 | 纯拦截逻辑，无原生依赖 |
| Cortex 本能注入（systemPrompt.context） | ✅ 满血 | 读 InstinctStore/SessionInjector |
| Evidence 运行时证据（tools/post-execute） | ✅ 满血（文件落盘） | 写 `.scale/evidence/runtime/*.json`，纯文件 |
| 6 个治理斜杠命令 | ✅ 满血 | 拉起 `scale` CLI（allowlist 固定参数） |
| Skills 注册（skills.registerProvider） | ✅ 满血 | 读 `.scale/skills/*/SKILL.md` |
| 40 个工具卡片（client toolview） | ✅ 满血 | 纯展示，不触文件系统 |
| Artifact store（SQLite） | ⚠️ 降级 | 插件走 InMemoryArtifactStore，不用 SQLite |
| Memory Brain（gbrain/SQLite） | ⚠️ 降级 | 插件不构造 MemoryBrain |
| Dashboard 面板 | ❌ 不可用 | DSH 内不跑面板，需另起 `scale dashboard serve` |

## 关键发现：ABI 不兼容假设已过时

插件 README 边界节写道：「不构造 SQLiteArtifactStore/MemoryBrain —— DSH 的 Electron ABI
（MODULE_VERSION 149）与主包原生模块（137）不兼容」，因此插件只走 InMemory/纯函数路径。

但**该前提已随主包升级而失效**：主包自 0.58.0-alpha.2 起把 `better-sqlite3` 升到 **13.x 的
N-API 版本**（当前 `^13.0.3`）。N-API（`node-addon-api`）**预编译二进制跨 ABI 稳定**——同一份
`.node` 可在 Node 22 与 Electron（ABI 149）下加载。CHANGELOG 明确记录「DSH 桌面端 Electron 44
运行时 ABI 149 已可用」。

结论：**`abiAssumptionStale = true`**——插件「因 ABI 不兼容而必须降级」的理由不再成立。

## 升级路径（满血化）

把 Artifact store / Memory Brain 从 InMemory 切到 SQLite，需要：

1. **代码改动**（`packages/dsh-scale`）：在 `apply()` 里按 DSH 会话 cwd 构造真实的
   `SQLiteArtifactStore`/`MemoryBrain`（替换当前的 InMemory/纯函数路径）。
2. **真实 Electron 运行时验证**：在本机 DSH 桌面端（Electron 44 / ABI 149）实际 `new Database(':memory:')`
   成功、artifact store CRUD 正常、Cortex 从 SQLite memory 读到节点。**本沙箱无 Electron GUI 运行时，
   这一步无法在此完成**。
3. 更新插件 README 边界节，删除过时的 ABI 不兼容声明。

在完成 (1)(2) 之前，**当前插件仍是降级形态**——但这是「可升级的降级」，不是「永久限制」。本矩阵
诚实地把边界写清楚，避免用户撞墙。

## 结论

- dsh 插件**核心治理能力（拦截/注入/证据/命令/skills/卡片）在 DSH 内全部满血可用**——这些正是插件的主要价值。
- 仅 Artifact store 与 Memory Brain 两处降级，且**技术前提已消除**，升级是明确的工程项（代码 + Electron 验证）。
- 因此对「dsh 插件做得如何」的回答是：**核心功能完整可用，重型存储层为可升级的降级，边界已文档化**。
