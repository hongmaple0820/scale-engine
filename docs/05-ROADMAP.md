# 05 — 12 周实施路线图

> 每周一个里程碑，每周交付可独立运行的能力。**严禁跳步**。

---

## 总体节奏

```
W1-W4:    地基期 - 数据模型 + FSM + 持久化 + 任务引擎
W5-W8:    护栏期 - Guardrails + Context + Knowledge + Adapters
W9-W12:   进化期 - MCP + Evolution + Eval + 真实联调
```

## 当前治理模板落地计划

`scale-engine` 作为工作流治理源头，`project-scaffold` 作为可生成的实践脚手架，`netdisk-project` 作为 Go 多服务真实验证样本。详细执行计划见：

- `docs/plans/governance-template-pack-landing-plan.md`

### MOE workspace upgrade

`scale-engine` now treats MOE-style workspaces as an explicit project topology instead of an implicit cleanup edge case.

- `.scale/workspace.json` records root, sibling/external repository, and intentional submodule relationships; MOE defaults avoid nested independent Git repositories under the root checkout.
- `scale init --governance-pack moe-workspace` generates MOE governance docs and starter topology.
- `scale workspace map --write --topology moe` creates a topology file for existing complex workspaces.
- `scale workspace finish --json` uses the topology to block unsafe cleanup when child repositories are dirty or unpushed.
- MOE finish policy requires reviewing root pointers, lock files, integration metadata, or docs after child repository changes.

每周输出：
1. 代码 + 单元测试 + 文档更新
2. 一个可演示的 demo
3. 周报 (本周做了什么、下周做什么、阻塞点)

---

## Week 1 — 类型系统与 EventBus

### 目标
搭建 SCALE Engine 的"骨骼"：所有类型定义 + 事件总线。

### 交付物
- `src/artifact/types.ts` — 11 种 Artifact + Event 完整类型 (~400 行)
- `src/core/eventBus.ts` — 事件总线 + JSONL 持久化 (~250 行)
- `src/core/container.ts` — 简单 DI (~80 行)
- `src/core/logger.ts` — Pino 封装 (~50 行)
- 单元测试覆盖率 ≥ 80%

### Demo
```bash
$ bun src/examples/event-demo.ts
> Created Need: NEED-20260421-0001
> Event emitted: artifact.created
> Event persisted to .scale/events/2026-04-21.jsonl
> 1 handler executed
```

### 验收标准
- [ ] `eventBus.emit() → handler 收到`
- [ ] 事件落入 JSONL，重启后能 `replay()`
- [ ] 类型在 IDE 内完整提示

### 风险
- **风险**: 类型设计错了，后期改成本巨大
  **缓解**: W1 末邀请同事 review 类型设计

---

## Week 2 — FSM 引擎

### 目标
让"状态机硬约束"真正生效。

### 交付物
- `src/artifact/fsm.ts` — FSM 引擎核心 (~300 行)
- `src/artifact/fsmDefinitions/` — 11 种 Artifact 的状态机定义
- `src/artifact/store.ts` — 内存版 Store (W3 升级到 SQLite)

### Demo
```bash
$ bun src/examples/fsm-demo.ts
> Created Spec in DRAFT
> transition('refine') → REVIEWING ✓
> transition('approve') → blocked: ambiguity_score (0.4) > 0.2
> Updated payload, ambiguity_score = 0.15
> transition('approve') → FROZEN ✓
> transition('challenge') → REVISING ✓
> Effect executed: invalidate_downstream_plans (no plans yet)
```

### 验收标准
- [ ] 非法迁移抛 `InvalidTransition`
- [ ] Guard 失败返回详细原因
- [ ] Effect 异步执行不阻塞主流程
- [ ] 11 种 Artifact 的 FSM 定义齐全

---

## Week 3 — 持久化层

### 目标
SQLite + JSONL 的双写持久化，崩溃恢复。

### 交付物
- `src/artifact/store.ts` — SQLite 版 ArtifactStore (~400 行)
- `src/migrations/` — schema 迁移脚本
- `src/core/db.ts` — Drizzle 封装
- 索引重建工具 `scale rebuild-index`

### Demo
```bash
$ scale create spec "测试需求" --json
$ kill -9 $$        # 强制 crash
$ scale list spec   # 数据无丢失
$ scale rebuild-index   # 重建 SQLite 投影
$ scale list spec   # 仍然正确
```

### 验收标准
- [ ] 创建/查询 1000 个 Artifact < 1s
- [ ] crash 后数据无丢失
- [ ] `rebuild-index` 能从纯事件流重建 SQLite

---

## Week 4 — 任务引擎

### 目标
长时任务 + Checkpoint + Resume。

### 交付物
- `src/tasks/TaskEngine.ts` — 任务引擎 (~500 行)
- `src/tasks/checkpoint.ts` — Checkpoint 管理 (~200 行)
- `src/tasks/runtime.ts` — 任务运行时 (~150 行)

### Demo
```bash
$ scale create task "重构 OrderService" --steps step1,step2,step3
$ scale task start TASK-...
> Step 1/3: ... (执行中)
$ scale task pause TASK-...      # 模拟异常退出
$ scale task list --status paused
> TASK-... (paused at step 2/3, last checkpoint: CKP-...)
$ scale task resume TASK-...
> Restored from checkpoint, continuing step 2/3
```

### 验收标准
- [ ] 任务暂停后状态完整保存
- [ ] resume 后从暂停点继续
- [ ] git commit 自动 checkpoint（可配置）

---

## Week 5 — Guardrails 与 5 检测器

### 目标
**最关键的一周。** 真正实现"反幻觉/反惰性"的工程约束。

### 交付物
- `src/guardrails/Gateway.ts` — Hook 网关 (~250 行)
- `src/guardrails/roles.ts` — 6 个 Role 定义 (~150 行)
- `src/guardrails/detectors/` — 5 个检测器
  - BruteRetryDetector (~80 行)
  - IdleToolDetector (~100 行)
  - BusyLoopDetector (~120 行)
  - PrematureDoneDetector (~100 行)
  - BlameShiftDetector (~80 行)

### Demo
```bash
# 模拟 Claude Code 调用 Hook
$ scale gate pre-tool Bash --args-json '{"command":"rm -rf /"}' --json
{"decision":"deny","reason":"Dangerous command 'rm -rf' blocked"}

$ scale gate pre-tool Bash --args-json '{"command":"ls"}' --session-id S1
> 重复 3 次：
{"decision":"deny","reason":"Brute retry detected: ls 在 3 分钟内运行 3 次"}

$ scale gate before-stop --session-id S2 --enforce
{"decision":"block","reason":"已修改代码但未运行测试..."}
```

### 验收标准
- [ ] 5 个检测器都能在压测中正确触发
- [ ] Hook 延迟 p99 < 50ms
- [ ] Role 越权工具直接拒绝

---

## Week 6 — Context Builder

### 目标
分层上下文加载 + Token 预算。

### 交付物
- `src/context/ContextBuilder.ts` — 核心 (~300 行)
- `src/context/templates/` — 6 个 Role 的 prompt 模板
- `src/context/tokenizer.ts` — Token 估算

### Demo
```bash
$ scale context build --role Implementer --artifact TASK-... --json
{
  "system": "...精简后的 system prompt...",
  "metadata": {
    "totalTokens": 14523,
    "layers": ["system_rules", "role_prompt", "current_artifact",
               "north_star", "parent_summary", "recalled_lessons"]
  }
}
```

### 验收标准
- [ ] 总 Token 数永远 ≤ 配置预算
- [ ] North Star 必须包含
- [ ] 召回 Lesson 仅当 verified=true

---

## Week 7 — KnowledgeBase

### 目标
知识库 + 4 道 Gate + Qdrant 集成。

### 交付物
- `src/knowledge/KnowledgeBase.ts` (~350 行)
- `src/knowledge/extractor.ts` — LessonExtractor (~250 行)
- `src/knowledge/retriever.ts` — VectorRetriever (~200 行)
- `src/knowledge/embedder.ts` — embedding 封装

### 依赖
- 启动 Qdrant：`docker run -p 6333:6333 qdrant/qdrant`

### Demo
```bash
# 触发 Lesson 提取
$ scale event record defect.closed_with_root_cause --artifact-id DEF-...
> Proposing lesson...
> Gate 1: trigger ✓
> Gate 2: googleability ✓ (only 23 hits)
> Gate 3: context-specific ✓ (refs ART-...0007)
> Gate 4: deduplication ✓ (max similarity 0.42)
> ✓ Lesson proposed: LSN-...

$ scale lesson recall "JPA 性能优化" --top-k 3
> 1. LSN-... (relevance 0.87): 批量插入用 saveAll 而不是循环 save
> 2. LSN-... (relevance 0.72): N+1 查询用 @EntityGraph
> 3. LSN-... (relevance 0.65): ...
```

### 验收标准
- [ ] 4 道 Gate 全部生效，垃圾 Lesson 被过滤
- [ ] 召回结果按 (相似度 × relevance) 排序
- [ ] decay 任务能正确衰减老 Lesson

---

## Week 8 — Adapters + CLI

### 目标
完成多 Agent 接入 + 完整 CLI。

### 交付物
- `src/adapters/claude-code.ts` — 生成 .claude/settings.json + CLAUDE.md
- `src/adapters/codex.ts`
- `src/adapters/cursor.ts`
- `src/adapters/gemini.ts`
- `src/api/cli.ts` — Citty 入口
- `scale init` 命令完整可用

### Demo
```bash
$ cd /tmp/test-project && git init && touch package.json
$ scale init --agent claude-code --dir .
$ scale init --agent codex --dir .
✓ Claude Code settings/rules configured
✓ Codex hooks/rules configured
✓ CLAUDE.md and AGENTS.md generated

$ cat .claude/settings.json | jq '.hooks | keys'
["SessionStart", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"]
```

### 验收标准
- [ ] `scale init` 后 Claude Code 启动正常
- [ ] PreToolUse hook 在真实 Claude Code 调用中能拦截
- [ ] 卸载命令能干净恢复

---

## Week 9 — MCP Server

### 目标
让 AI 主动调用 SCALE。

### 交付物
- `src/api/mcp.ts` — MCP Server (~300 行)
- 工具：scale_create_artifact / scale_transition / scale_recall_lesson / ...

### Demo
在 Claude Code 中：
```
> scale_recall_lesson({query: "JPA 性能", topK: 3})
< [3 lessons returned]
> scale_create_artifact({type: "Plan", parentId: "SPEC-...", payload: {...}})
< {id: "PLAN-...", status: "DRAFT"}
```

### 验收标准
- [ ] Claude Code 能列出 SCALE 工具
- [ ] 调用任意工具不报错
- [ ] 工具调用也被记录到事件流

---

## Week 10 — BehaviorTracker

### 目标
全量行为统计 + 模式发现。

### 交付物
- `src/evolution/BehaviorTracker.ts` (~300 行)
- `src/evolution/patternDetector.ts` (~200 行)
- `scale stats` 命令输出可视化

### Demo
```bash
$ scale stats
> Sessions: 142 (this week)
> Tool calls: 3,847
> Brute retries detected: 12
> Premature done blocked: 8
> Top failure patterns:
>   - Recurring defect: jpa_n_plus_one (7 times)
>   - Unstable spec: SPEC-... (5 versions)
> Top recalled lessons:
>   - LSN-... (recalled 23 times, 19 helpful)
```

### 验收标准
- [ ] 行为指标正确
- [ ] 模式发现能找出真实问题
- [ ] 不影响主流程性能

---

## Week 11 — Eval 框架

### 目标
**没有 eval 的"自进化"都是自欺。** 建立 benchmark。

### 交付物
- `evals/runner.ts` — Eval 跑批引擎 (~250 行)
- `evals/cases/` — 20 个 benchmark case (各种类型)
  - 10 个修 bug 类
  - 5 个写新 API 类
  - 3 个重构类
  - 2 个根因分析类

### Eval Case 格式

```yaml
# evals/cases/001-fix-jpa-n+1.yaml
id: "001-fix-jpa-n+1"
description: "修复 OrderRepository 的 N+1 查询"
setup:
  repo: file:./fixtures/order-service-n+1
  initialState:
    - {file: "src/repo/OrderRepository.java", contains: "findAll()"}
task: "订单列表 API 响应慢，请分析并修复"
successCriteria:
  - {type: "code", file: "src/repo/OrderRepository.java", contains: "@EntityGraph"}
  - {type: "test", command: "mvn test -Dtest=OrderRepoTest"}
  - {type: "perf", command: "k6 run perf/order-list.js", maxP95: 100}
budget:
  maxTokens: 50000
  maxDurationSec: 600
  maxCostUsd: 0.50
```

### Demo
```bash
$ scale eval run --baseline none --candidate "scale-v0.1"
Running 20 cases...
[1/20] 001-fix-jpa-n+1 ... PASS (3.2s, $0.18, 12K tokens)
[2/20] 002-add-export-api ... FAIL (timeout, 600s, $1.20, 80K tokens)
...
Results:
  Passed: 14/20 (70%)
  Avg duration: 187s
  Avg cost: $0.42/case
  Total cost: $8.40
```

### 验收标准
- [ ] 20 个 case 全部能自动跑
- [ ] 通过/失败判定准确
- [ ] 输出可对比的 baseline 报告

---

## Week 12 — 真实联调 + 文档完善

### 目标
在 `3d-car-mall` 真实项目跑通完整周期。

### 任务
1. 在 3d-car-mall 跑 `scale init`
2. 选一个真实需求（如"订单导出 Excel"）
3. 走完 Need → Spec → Plan → Task → Change → Evidence → Lesson 全流程
4. 让 Claude Code 实际接入、被 Hook 约束、产生 Defect、提炼 Lesson
5. 收集所有 pain point，记录为 v0.2 待办

### 交付物
- 完整的端到端 demo 录屏
- 一份《SCALE v0.1 验收报告》
- 一份《v0.2 改进 backlog》
- 文档（00-06）全部更新到与代码一致

### 验收标准
- [ ] 一个真实需求从 Need 走到 Release
- [ ] 至少 1 个 Defect 被自动提炼为 Lesson
- [ ] 至少 3 次 Hook 阻断了 AI 错误行为
- [ ] 团队 ≥3 人能用，无重大阻塞

---

## 资源估算

| 阶段 | 工时 | 主要成本 |
|------|------|---------|
| W1-W4 地基 | 80h | 无外部成本 |
| W5-W8 护栏 | 80h | 启动 Qdrant，几乎免费 |
| W9-W12 进化 | 80h | Eval 跑批 ~$50 (LLM 费用) |
| 总计 | 240h | < $100 |

按 1 人全职 60h/周，4 周可完成；按 1 人兼职 20h/周，12 周可完成。

---

## 关键里程碑节点（必须停下来评审）

```
W4 末:  数据模型冻结评审 ★★★★★
        如果数据模型有问题，越后改代价越大
        必须邀请 ≥2 人 review

W8 末:  端到端最小闭环 ★★★★
        能在测试环境跑通"创建 Need → Hook 拦截"

W12 末: v0.1 全功能验收 ★★★★★
        在真实项目跑通才能宣布 v0.1 ready
```

---

## v0.42.0 — SCALE 2.0 三引擎架构 ✅

**已交付 (2026-05-25)**

三引擎架构对齐业界前沿项目核心模式：

| 引擎 | 对标 | 交付物 |
|------|------|--------|
| **Scale Shield** | agent-hooks-in-depth 退出码阻断 | PolicyCompiler, ShieldProtocol (exit 0/2), ProtectedPaths (40+ 命令), `.hook-state/` 跨 hook 共享, CLI: `scale shield compile/status/test` |
| **Scale Orchestrator** | Symphony WORKFLOW.md 声明式编排 | SCALE_POLICY.md 解析器, OrchestratorDaemon, WorkspaceManager (git worktree), ReconciliationLoop, TrackerAdapter (GitHub/Mock), CLI: `scale orch start/stop/status/log` |
| **Scale Cortex** | ECC Instincts 持续学习 | InstinctExtractor (0.3-0.9 置信度), InstinctStore (YAML 存储), ReflexionEngine (本地 LLM 反思), SessionInjector (SessionStart 注入), GovernanceMetrics (ROI), 4 harness adapters, CLI: `scale cortex extract/inject/metrics/evolve` |

**验证状态**: TypeScript 零错误, 8/8 新模块测试通过, 23 文件 +4574 行提交, 已发布 GitHub + Gitee。

---

## 之后

## v0.2 与之后

v0.1 ready 后再考虑：

- **v0.2** (Q3): Web UI 看板、团队协作、PostgreSQL 多机
- **v0.3** (Q4): 模型路由完善、本地小模型集成、更多 Adapter
- **v1.0** (来年): Eval-driven 自演化、Lesson 数据集微调
