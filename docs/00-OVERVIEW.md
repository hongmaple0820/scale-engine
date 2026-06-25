# 00 — 施工图纸总览
> 这是 SCALE Engine 的"建造蓝图"。读完这一篇你应该知道：**整个系统由什么构成、为什么这么设计、从哪里开始动工。**
---
## 一、为什么要做 SCALE Engine
### 1.1 我们要解决的问题
当前 AI 编码助手共有 5 个根本病：
| 病灶 | 表现 | 根因 |
|------|------|------|
| 幻觉式合规 | 没跑测试就声称"测试通过" | 没人盯着 → 提示词无强制力 |
| 暴力重试 | 同一命令跑 3 次然后说"无法解决" | 不知道自己在原地打转 |
| 甩锅 | "建议手动处理" / "可能是环境问题" | 没有外部观察机制约束 |
| 上下文崩塌 | 长会话越跑越差，最后跑不完 | 把整个项目历史塞进窗口 |
| 零经验复利 | 每次从零开始，犯过的错继续犯 | 没有结构化记忆机制 |
**关键洞察：这 5 个病不是"模型不够聪明"，而是"环境信息不到位 + 没有约束系统"造成的。**
### 1.2 我们的核心主张
> **不要再加提示词。提示词是建议，建议救不了 AI。要做工程系统。**
```
提示词:  "你应该跑测试"               ← AI 可以忽略
Hook:    跑测试前必须先 lint，否则拒绝   ← 系统不允许跳过
状态机:  Spec 未 FROZEN 不能产出 Plan   ← 越权操作直接报错
事件流:  每个动作落盘 + 模式检测         ← 暴力重试自动被发现
```
---
## 二、系统组成
```
+-----------------------------------------------------------------+
|                  SCALE Engine (Headless Core)                   |
|                                                                 |
|  L6  Evolution     失败模式 -> 规则提议 -> 人审 -> Hook         |
|  L5  Memory        KnowledgeBase + 向量召回 + 知识图谱          |
|  L4  Orchestration TaskEngine + Role + 模型路由                 |
|  L3  Observability EventBus + BehaviorTracker + Telemetry       |
|  L2  Guardrails    Hook Gateway + Role 权限 + 强制验证          |
|  L1  Context       ContextBuilder + 分层加载 + Token 预算       |
|                                                                 |
|  +----------+  +----------+  +----------+                       |
|  |   CLI    |  |   MCP    |  |   HTTP   |                       |
|  +----------+  +----------+  +----------+                       |
+-----------------------------------------------------------------+
        v             v             v
   Claude Code     Cursor        Web UI / CI
   Codex CLI       OpenCode      Gemini CLI
```
**核心抽象：**
- 横向 6 层，自下而上依赖
- 纵向 3 协议，覆盖所有 Agent
- 所有层共享一个真相之源：Artifact + Event Log（详见 02-DATA-MODEL）
---
## 三、技术选型
| 关注点 | 选型 | 理由 |
|--------|------|------|
| 语言 | TypeScript | 复用 cc-code 70% |
| 运行时 | Bun (开发) / Node 22+ (生产) | 启动快、原生 TS |
| 持久化 | SQLite + better-sqlite3 | 单文件零运维 |
| 事件流 | JSONL append-only | git 友好 |
| ORM | Drizzle | 类型安全 |
| 状态机 | 自实现 200 行 | XState 太重 |
| 向量库 | Qdrant 单机 | Rust 性能好 |
| 代码图谱 | tree-sitter + ast-grep | 离线、跨语言 |
| MCP | @modelcontextprotocol/sdk | 官方 |
| HTTP | Hono | 轻 |
| CLI | Citty | 类型友好 |
| Eval | Vitest 自实现 | 定制成本低 |
| 日志 | Pino | 性能 |
---
## 四、施工顺序
```
W1-2:  地基   -> src/artifact/ + src/core/   (类型 + FSM + EventBus)
W3:    存储   -> src/artifact/store.ts        (SQLite + JSONL)
W4:    任务   -> src/tasks/TaskEngine.ts
W5:    护栏   -> src/guardrails/Gateway.ts    (5 种检测器)
W6:    上下文 -> src/context/ContextBuilder.ts
W7:    知识   -> src/knowledge/* (4 道 Gate)
W8:    接入   -> src/adapters/* + CLI
W9:    MCP    -> src/api/mcp.ts
W10:   行为   -> src/evolution/BehaviorTracker.ts
W11:   Eval   -> evals/* + 20 个 benchmark
W12:   联调   -> 在 3d-car-mall 真实跑通端到端
```
详见 `05-ROADMAP.md`。
---
## 五、读图指引
只有 30 分钟：本文 -> 02-DATA-MODEL -> 03-CORE-MODULES §3.5 Guardrails  
有 2 小时：再补 01-ARCHITECTURE + 04-INTEGRATION + 06-DECISIONS
---
## 六、和现有方案的关系
| 项目 | 借鉴 | 改进 |
|------|-----|------|
| cc-code | 7 个模块的接口 | 剥离为 Headless、加状态机、SQLite |
| Spec Kit | spec->plan->tasks | 加状态机和反馈回路 |
| BMAD | 角色分工 | Role 网关替代多 Agent 对话 |
| Superpowers | TDD/验证强制 | Hook 而不是提示词 |
| GSD | 任务文件化 | 加生命周期状态机 |
| Temporal | 长任务持久化 | 事件流 + Checkpoint |
| DDD/ES | Artifact + Event | 直接采用 |
