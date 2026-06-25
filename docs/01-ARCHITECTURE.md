# 01 — 架构设计

> 系统的"骨架"。本篇回答：6 层每层做什么、为什么这样切、数据怎么流动、控制怎么传递。

---

## 一、设计原则（先立规矩）

### 原则 1：环境塑造行为（Environment shapes behavior）

不要试图说服 AI 自律。**让 AI 物理上做不到错的事。**

- ❌ 提示词说"你应该跑测试" → AI 可以装作跑了
- ✅ Stop Hook 检查"未跑测试不允许 stop" → AI 物理无法跳过

### 原则 2：状态机硬约束（FSM as ground truth）

每个 Artifact 的状态迁移必须走状态机引擎。**不允许任何代码绕过 FSM 直接改 status 字段。**

### 原则 3：事件溯源（Event sourcing as truth）

**SQLite 里的 Artifact 状态只是"投影 (projection)"，真相在 JSONL 事件流里。** 任何状态都可以通过重放事件重建。

### 原则 4：Headless 优先

引擎不假设运行在哪个 Agent 里。**Agent 是客户端，引擎是服务端。**

### 原则 5：渐进可用（Progressive enhancement）

每周交付物必须独立可用。第 1 周就有 CLI 能创建 Artifact，不需要等到第 12 周才能用。

### 原则 6：失败优于错误（Fail loud over silent）

任何不确定都立即抛错。**绝不悄悄降级、绝不静默重试 → 否则反惰性机制就形同虚设。**

---

## 二、SCALE 2.0 三引擎架构

v0.42.0 引入三引擎架构，在六层基础之上增加三个专用引擎，各司其职：

```
┌─────────────────────────────────────────────────┐
│                  Scale Cortex                     │
│         (证据驱动持续进化 / 跨 harness)            │
│   Instincts → SessionStart 注入 → 治理 ROI        │
├─────────────────────────────────────────────────┤
│               Scale Orchestrator                  │
│        (声明式编排 / git worktree 隔离)            │
│   SCALE_POLICY.md → Daemon → Reconciliation Loop  │
├─────────────────────────────────────────────────┤
│                 Scale Shield                      │
│          (退出码钩子拦截 / 零信任阻断)             │
│   YAML 策略 → Hook 脚本 → exit 0/2 协议           │
└─────────────────────────────────────────────────┘
```

### Engine 1: Scale Shield — 钩子确定性拦截

**对标**: agent-hooks-in-depth 退出码阻断模式

**职责**: 在任何 AI 工具调用前执行确定性拦截。不可绕过，不可协商。

**核心机制**:
- **退出码协议**: exit 0 = 允许, exit 2 = 阻断 (带 stderr 原因)
- **stdin/stdout JSON**: `{session_id, cwd, tool_name, tool_input}` → `{decision, reason}`
- **策略编译器**: `.scale/policy.yaml` (人类可读) → 运行时 hook 脚本 (注入到 Claude/Codex/Cursor settings.json)
- **受保护断言**: `.scale/` 目录完整性、门禁通过链、命令阻断表 (40+ 危险命令)
- **跨 Hook 状态共享**: `.hook-state/` 目录，文件系统为管道

**涉及模块**: `src/shield/PolicyCompiler.ts`, `src/shield/ShieldProtocol.ts`, `src/shield/ProtectedPaths.ts`

### Engine 2: Scale Orchestrator — 声明式编排守护进程

**对标**: Symphony WORKFLOW.md 协调循环模式

**职责**: 声明式策略驱动的自治多仓库工作循环。

**核心机制**:
- **声明式策略**: `SCALE_POLICY.md` (YAML frontmatter + Markdown body)，6-key schema (tracker/polling/workspace/hooks/agent/codex)
- **协调循环**: Poll(IssueTracker) → Filter(active candidates) → Isolate(git worktree) → Dispatch(agent) → Reconcile(state) → Notify
- **Git Worktree 隔离**: 3 安全不变量 (workspace⊆root, sanitized name, agent cwd⊆workspace)
- **状态机**: Unclaimed → Claimed → Running → RetryQueued → Released
- **启动恢复**: 无持久化 orchestrator 状态，从 tracker 重新拉取

**涉及模块**: `src/orchestrator/OrchestratorDaemon.ts`, `src/orchestrator/PolicyLoader.ts`, `src/orchestrator/WorkspaceManager.ts`, `src/orchestrator/ReconciliationLoop.ts`, `src/orchestrator/TrackerAdapter.ts`

### Engine 3: Scale Cortex — 证据驱动持续进化

**对标**: ECC Instincts 持续学习模式

**职责**: 从每一次失败中学习，持续进化治理规则。

**核心机制**:
- **Instinct 提取管线**: Observation Log → Pattern Detection → Instinct Creation
- **置信度评分**: 0.3 tentative (首次), 0.5 moderate (2+次), 0.7 strong (5+次, 自动注入), 0.9 near-certain (10+次)
- **SessionStart 注入**: 高置信度 Instincts + 前次会话摘要 (含过时回放保护)
- **跨 Harness 适配器**: Claude Code / Codex / Cursor / Gemini CLI 统一 stdin 格式
- **治理 ROI 度量**: 门禁通过率、Instinct 命中率、成本节省、自动修复成功率

**涉及模块**: `src/cortex/InstinctExtractor.ts`, `src/cortex/InstinctStore.ts`, `src/cortex/ReflexionEngine.ts`, `src/cortex/SessionInjector.ts`, `src/cortex/GovernanceMetrics.ts`, `src/cortex/adapters/`

### 三引擎集成

```
Scale Shield (实时阻断)
    ↓ 证据推送
Scale Cortex (学习改进)
    ↓ 本能注入
Scale Orchestrator (自治循环)
    ↓ 状态回流
Scale Shield (策略更新)
```

---

## 三、六层架构详解

### L1 — Context Layer（上下文层）

**职责：** 在 AI 每轮交互前，组装出"既精准又精简"的上下文。

**核心原则：** Token 预算管理。永远不超 50% 窗口给"非工作区内容"。

**关键组件：**
```
ContextBuilder
  ├── 加载策略 (lazy / eager)
  ├── 优先级排序 (north_star > current_task > parent_artifact > lessons)
  ├── Token 预算分配
  └── 模板渲染 (按 Role 切换不同 system prompt 片段)
```

**数据流：**
```
Agent 请求上下文
  → ContextBuilder.build(roleId, currentArtifactId)
  → 1. 拉取常驻规则 (3K tokens)
  → 2. 拉取当前 Artifact (5K)
  → 3. 拉取父 Artifact 摘要 (3K)
  → 4. 向量召回相关 Lesson top3 (3K)
  → 5. 注入 north_star (1K)
  → 总计 ~15K，留给工作区 ~150K (按 200K 窗口算)
```

### L2 — Guardrails Layer（护栏层）

**职责：** 在 AI 调用工具前/后/结束时强制执行约束。这是反幻觉、反惰性的核心。

**关键组件：**
```
Gateway
  ├── PreToolUseGate    (工具调用前拦截)
  │     ├── 危险命令检测 (rm -rf, DROP TABLE, ...)
  │     ├── Role 权限检查 (Implementer 才能 Edit)
  │     └── 暴力重试检测 (3min 内同命令 ≥3 次)
  ├── PostToolUseGate   (工具调用后强制验证)
  │     ├── Edit 后自动 lint/typecheck
  │     ├── Bash 失败时 inject 错误回上下文
  │     └── 写入硬编码密钥扫描
  ├── StopGate          (AI 想结束 turn 时)
  │     ├── 声称 done 必须先跑 test
  │     └── 未关闭的 Defect 不允许 stop
  └── 5 个 LazinessDetector
        ├── BruteRetryDetector
        ├── IdleToolDetector
        ├── BusyLoopDetector
        ├── PrematureDoneDetector
        └── BlameShiftDetector
```

**控制流：**
```
Agent 调用 Bash("rm -rf /")
  → Hook 触发 PreToolUseGate
  → DangerousCommandDetector.check() → MATCH
  → 返回 exit code 2 + 错误消息
  → Agent 收到拒绝，必须改方案
```

### L3 — Observability Layer（观察层）

**职责：** 让"看不见的 AI 行为"变成"结构化数据"。

**关键组件：**
```
EventBus           (内存中的 pub/sub + 持久化到 JSONL)
BehaviorTracker    (订阅 EventBus，统计行为指标)
Telemetry          (导出 Prometheus 格式的指标)
```

**事件分类：**
```
artifact.*        → created, updated, transitioned
tool.*            → called, blocked, succeeded, failed
gate.*            → passed, failed
behavior.*        → brute_retry, idle_tool, busy_loop
session.*         → started, ended, cleared
```

### L4 — Orchestration Layer（编排层）

**职责：** 长时任务的拆分、调度、检查点、跨会话恢复、模型路由。

**关键组件：**
```
TaskEngine
  ├── 任务分解 (大 Task 自动拆为子 Task)
  ├── Checkpoint (定期 git commit + 状态序列化)
  ├── Resume    (启动时从最近 Checkpoint 恢复)
  └── 超时熔断  (单步超 30min 自动 kill)
RoleManager
  ├── Role 切换协议
  ├── 工具白名单
  └── system prompt 片段加载
ModelRouter
  ├── 任务复杂度评估 (基于 BehaviorTracker 历史)
  └── 选择 Haiku / Sonnet / Opus / 本地模型
```

### L5 — Memory Layer（记忆层）

**职责：** 沉淀、检索、淘汰知识。

**关键组件：**
```
KnowledgeBase
  ├── 8 种 KnowledgeType (lesson/pattern/decision/anti_pattern/...)
  ├── relevance/accessCount/lastAccessedAt 衰减算法
  └── verified 标记 (人审过的才能被强制注入)

LessonExtractor
  ├── Gate 1: 触发事件类型必须在白名单
  ├── Gate 2: 非 Google 可得 (检索互联网，>3 个结果就拒绝)
  ├── Gate 3: 上下文特定 (必须引用具体 Artifact ID)
  └── Gate 4: 不重复 (向量相似度 > 0.85 拒绝)

VectorRetriever
  ├── Qdrant 单机部署
  ├── 召回策略：top-K + relevance 加权
  └── 上下文注入预算控制
```

### L6 — Evolution Layer（自进化层）

**职责：** 把"反复出现的失败"逐级固化成系统约束。

**4 级演化路径：**
```
Level 1: 失败被记录 (Defect)
   ↓ 同类失败出现 ≥3 次
Level 2: 提炼为 Lesson (待人审)
   ↓ 人审通过 + 7 天内未失败
Level 3: 升级为 Rule (写入 .scale/rules/)
   ↓ Rule 仍被违反 ≥2 次
Level 4: 升级为 Hook (强制执行，AI 物理无法绕过)
```

**关键组件：**
```
RuleProposer       (扫描 Lesson，提议规则)
RuleApprover       (人工审核 UI / 命令)
HookGenerator      (从 Rule 自动生成 Hook 脚本)
```

---

## 四、控制流（一个完整请求的生命周期）

以"用户让 Claude Code 写一个新 API"为例：

```
[1] 用户输入 -> Claude Code
[2] Claude Code session start hook -> scale session start
    -> SCALE 为本次会话分配 sessionId，初始化事件流
[3] Claude Code 加载 CLAUDE.md (其中 SCALE 注入 100 行核心规则)
[4] Claude 开始推理，决定要先 Read 一个文件
[5] PreToolUse hook -> scale gate pre-tool Read src/api.ts
    -> Role=Explorer, 允许 Read -> 通过
    -> EventBus.emit("tool.called", {tool:"Read", ...})
[6] Read 完成 -> PostToolUse hook -> scale event tool-result
    -> 落入 events.jsonl
[7] Claude 决定 Edit -> PreToolUse hook
    -> Role=Explorer 不允许 Edit (按 Role 网关)
    -> 返回错误："Role 切换为 Implementer 才能 Edit"
[8] Claude 内部切换 Role: scale role activate Implementer
    -> SCALE 检查：当前 Spec=FROZEN? Plan=APPROVED? -> 都满足
    -> 切换成功，Edit 工具解锁
[9] Edit 完成 -> PostToolUse 自动跑 lint
    -> 失败 -> 错误 inject 回 Claude 上下文
[10] Claude 修复后再 Edit -> lint 通过
[11] Claude 想结束 (claim done)
     -> Stop hook -> scale gate before-stop --hook-safe
     -> 不初始化完整引擎，避免 agent hook 上下文卡住
     -> 完整 premature-done 阻断通过 scale gate before-stop --enforce / preflight 执行
[12] Claude 跑测试并记录证据 -> preflight / enforce gate 才允许发布
[13] Session end -> scale session end
     -> 触发 BehaviorTracker 的批量分析
     -> 触发 LessonExtractor (如有 Defect 关闭)
```

**这就是"提示词建议"vs"工程约束"的差别——每个★点都是物理约束，AI 跳不过。**

---

## 五、依赖关系（避免循环依赖）

```
api/         -> orchestration, memory, observability, guardrails, context
context/     -> memory, orchestration
guardrails/  -> observability, orchestration
orchestration/ -> observability, artifact
memory/      -> observability, artifact
observability/ -> artifact, core
artifact/    -> core
core/        -> (没有依赖)
```

**规则：上层只能依赖下层。** 用 ESLint 规则 + import-cycle 检测器强制。

---

## 六、关键非功能需求

| NFR | 目标 | 措施 |
|-----|------|------|
| 启动时间 | < 200ms | Bun + lazy import + 预编译 |
| Hook 延迟 | < 50ms p99 | 内存缓存 Role/Rule，避免每次读盘 |
| 事件落盘 | < 5ms | append-only JSONL，不走 fsync |
| Artifact 查询 | < 10ms p99 | SQLite 索引 + WAL |
| 并发安全 | 多进程读写不腐败 | SQLite WAL + EventLog append-only |
| 跨平台 | Windows/Mac/Linux | Node 原生 API，避免 shell 依赖 |
| 离线可用 | 无网络也能用 | 向量召回降级为关键词检索 |

---

## 七、设计权衡（明确取舍）

| 选择 | 取 | 舍 |
|-----|----|----|
| SQLite vs PostgreSQL | 取零运维 | 舍多机部署 |
| JSONL vs Kafka | 取简单可读 | 舍高吞吐 |
| 自实现 FSM vs XState | 取轻量 | 舍可视化工具 |
| 内存 EventBus vs 消息队列 | 取低延迟 | 舍跨进程 |
| Headless 引擎 vs 嵌入 Agent | 取通用 | 舍深度集成 |
| Role 网关 vs 多 Agent 对话 | 取低成本 | 舍真正"团队感" |
| 文件存储 Artifact 内容 vs DB | 取 git 友好 | 舍查询能力 |

每一项的详细决策见 `06-DECISIONS.md`。
