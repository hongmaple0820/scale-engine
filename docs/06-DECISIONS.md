# 06 — 关键架构决策记录 (ADR)

> 每个 ADR 记录一个关键决策：背景、选项、决定、理由、后果。
> 后人翻看可以理解"为什么是这样"，避免反复争论已经讨论过的事。

---

## ADR-001 — 基于 cc-code 还是从零自造？

### 背景
存在 cc-code 项目（Claude Code v2.1.88 fork），已实现 7 个核心模块约 70% 我们需要的功能。

### 选项
- **A**: 完全 fork cc-code，继续在它上面演化
- **B**: 抽取 cc-code 核心模块，重构为 Headless Engine
- **C**: 完全从零写 Python 版

### 决定
**B**

### 理由
- A 的问题：绑死 Claude Code，跟不上上游升级，无法服务 Codex/Cursor 等
- C 的问题：浪费 cc-code 已验证的设计，至少多花 8-10 周
- B 平衡：复用 70% 设计 + 解决 cc-code 的架构问题（强 fork、JSON 持久化、缺状态机、缺 eval）

### 后果
- 前 4 周大量"参考 + 改写"工作
- 必须明确剥离边界：哪些直接抄、哪些改、哪些抛
- 详见 `00-OVERVIEW.md` §六

---

## ADR-002 — 语言选择：TypeScript 还是 Python

### 背景
SCALE 既要做工程系统（适合 TypeScript），又要对接 ML 工具链（适合 Python）。

### 选项
- **A**: TypeScript（cc-code 同款）
- **B**: Python
- **C**: 双语言（核心 TS + ML 工具 Python）

### 决定
**A**

### 理由
- cc-code 70% 代码可复用
- TypeScript 类型系统对状态机/事件设计更好
- Bun/Node 启动 < 200ms，Python 冷启 1-2s
- ML 集成可通过 HTTP（Qdrant / 本地推理服务）解决，不必同进程
- 团队对 TS 更熟悉

### 后果
- 微调阶段（W36+）需要 Python 子项目
- 不能用 PyTorch / sklearn 直接调用
- 用 Vercel AI SDK / `@xenova/transformers` 做基础 ML

---

## ADR-003 — 持久化：SQLite 还是 PostgreSQL

### 背景
存储 Artifact 元数据 + 索引。

### 选项
- **A**: SQLite + better-sqlite3
- **B**: PostgreSQL
- **C**: 纯文件 + 内存索引

### 决定
**A**（v0.1）；**支持切换 B**（v0.2 多机场景）

### 理由
- 90% 用户单机使用，SQLite 零运维
- WAL 模式支持并发读
- 单文件备份就是 cp
- Drizzle 的同一份代码能切换到 PG 后端

### 后果
- 单机模型下并发写有锁（实际不是瓶颈，每秒 1000+ 写 OK）
- 多机场景必须切 PG（或用 Litestream 同步 SQLite）

---

## ADR-004 — Artifact 内容：DB 字段 vs 文件

### 背景
Spec/Plan 等 Artifact 的实际内容（markdown）放哪？

### 选项
- **A**: SQLite TEXT 字段
- **B**: 文件系统 (.scale/artifacts/spec/xxx.md)
- **C**: Git LFS

### 决定
**B**

### 理由
- git 友好（diff/blame/history 原生支持）
- 编辑器原生打开
- 工具友好（grep/sed）
- 失去 SQL 全文搜索 → 用 SQLite FTS5 单独索引

### 后果
- 文件和 DB 双写，需要崩溃恢复机制（以事件流为真相）
- 内容文件可被外部直接编辑，引擎需要监控变更（用 chokidar）

---

## ADR-005 — 状态机：自实现还是 XState

### 背景
需要状态机引擎管理 Artifact 状态迁移。

### 选项
- **A**: 自实现 (~200 行)
- **B**: XState (React 生态主流)
- **C**: robot3
- **D**: stately/fsm

### 决定
**A**

### 理由
- XState 概念多（actor / spawn / context），调试地狱
- 我们的场景简单：纯状态 + guard + effect
- 自实现 200 行可控，0 依赖
- Guard/Effect 可异步是关键需求，XState 支持但 API 重

### 后果
- 没有 XState 的可视化工具（可后期自建）
- 自己维护测试

---

## ADR-006 — 事件流：JSONL 还是数据库表 还是 Kafka

### 背景
事件溯源是核心架构，事件流存哪？

### 选项
- **A**: JSONL (按天分文件)
- **B**: SQLite events 表
- **C**: Kafka / NATS / Redpanda

### 决定
**A**

### 理由
- 文本可读（生产事故时 cat/grep 直接看）
- git 友好（小项目可入库）
- append-only 不需要事务/索引
- C 太重，单机 overkill
- B 与 SQLite 主库同 IO，影响性能

### 后果
- 长期事件量大时需要归档（每月压缩 + 上传 S3）
- 查询不如 DB 灵活（用 EventBus 内存索引补偿）

---

## ADR-007 — Role 网关 vs 多 Agent 对话

### 背景
BMAD 等方案用"多 Agent 互相对话"实现专业分工。

### 选项
- **A**: Role 网关（同一 Agent 切换权限）
- **B**: 多 Agent 对话（PM Agent → Architect Agent → ...）
- **C**: 混合

### 决定
**A**

### 理由
- B 的成本：每次对话都是一次 LLM 调用，成本 5-10 倍
- B 的问题：Agent 间靠自然语言传递，丢失结构化信息
- B 的问题：调试困难，难复现
- A 的优势：单一上下文，工具权限隔离仍能强制
- A 的优势：成本低，可观测

### 后果
- 失去"团队对话"的故事感
- Role 切换协议需要明确定义（W2 完成）

---

## ADR-008 — 向量库：Qdrant vs pgvector vs Chroma

### 背景
Knowledge 召回需要向量库。

### 选项
- **A**: Qdrant 单机版
- **B**: pgvector
- **C**: Chroma
- **D**: SQLite + sqlite-vss

### 决定
**A**

### 理由
- Rust 写，性能稳定
- 单机 Docker 一行启动
- API 简洁
- B 需要 PG，但我们 v0.1 选 SQLite
- C 性能稍逊，不如 Qdrant 成熟
- D 实验性，文档不足

### 后果
- 多一个 Docker 依赖（可选，关闭 lesson 召回则不需要）
- 备份要单独考虑（Qdrant snapshot）

---

## ADR-009 — Hook 失败的处理：阻断 vs 警告

### 背景
Detector 检测到问题时，是阻断 AI 还是只警告？

### 选项
- **A**: 全部阻断
- **B**: 全部警告
- **C**: 按 Detector 配置

### 决定
**C**，每个 Detector 自己声明 severity

### 理由
- 暴力重试 / 危险命令 / 越权 → 必须阻断
- 甩锅 / 工具闲置 → 警告即可（强制可能误伤）
- 用户可全局覆盖：`guardrails.strict: false` 把所有 block 降为 warn

### 后果
- 配置复杂度上升
- 必须给每个 Detector 写清楚 severity 文档

---

## ADR-010 — 自进化：自动应用 vs 人审

### 背景
SelfEvolution 检测到模式后，是自动调整规则还是人审？

### 选项
- **A**: 自动应用（cc-code 默认）
- **B**: 全部人审
- **C**: 低风险自动 + 高风险人审

### 决定
**B**（v0.1）；**C**（v1.0+）

### 理由
- 自动应用有"AI 自我污染"风险
- v0.1 阶段我们还无法验证规则是否真的更好
- 没有 eval 闭环之前，自动 = 自欺
- v1.0 有 eval 框架后可重新评估

### 后果
- v0.1 进化层"建议多落地少"，主要价值在"暴露问题"
- 用 `scale evolution review` 命令批量审

---

## ADR-011 — Lesson 提炼：AI 主动 vs 触发驱动

### 背景
什么时候提炼 Lesson？

### 选项
- **A**: AI 觉得有用就写
- **B**: 仅在特定事件触发
- **C**: 人工命令触发

### 决定
**B**

### 理由
- A 的问题：AI 倾向多写（看起来勤奋），垃圾爆炸
- C 的问题：人会忘，沉淀不下来
- B 的优势：触发条件明确（defect closed / task retry / release）
- 触发后还有 4 道 Gate 把关，质量可控

### 后果
- 漏掉一些场景（比如"AI 觉得有用但没触发事件"）
- 用户可手动 `scale lesson propose` 补充

---

## ADR-012 — Headless 还是嵌入

### 背景
SCALE 是独立进程还是嵌入到 Agent 里？

### 选项
- **A**: Headless（独立 CLI/MCP/HTTP 服务）
- **B**: 嵌入 Claude Code（cc-code 路径）
- **C**: 双模式

### 决定
**A**

### 理由
- B 绑死特定 Agent
- B 升级 Agent 时 merge 地狱
- A 的"额外进程"成本可忽略（< 200ms 启动 + 50ms hook 延迟）
- A 让我们能服务任何 Agent + Web UI + CI

### 后果
- Hook 调用有 IPC 开销（用 SQLite 共享 + 小心冷启动）
- 需要管理 SCALE 进程（systemd / pm2 / 用户手动）

---

## ADR-013 — TypeScript 运行时：Node vs Bun vs Deno

### 背景
TS 选了，但用什么运行？

### 选项
- **A**: Node 22+
- **B**: Bun
- **C**: Deno
- **D**: 双支持

### 决定
**D**：开发用 Bun（速度），发布用 Node（兼容性）

### 理由
- Bun 启动快、原生 TS、test 框架自带 → 开发体验好
- Node 用户基数大、生态成熟、CI 默认 → 发布安全
- 双支持几乎零成本（避免用 Bun 独有 API）

### 后果
- 不用 Bun 的 SQLite/`Bun.serve` 等独家 API
- CI 同时跑 Node + Bun

---

## ADR-014 — 配置管理：YAML vs TOML vs JSON

### 背景
`.scale/config.yaml` 用什么格式？

### 选项
- **A**: YAML
- **B**: TOML
- **C**: JSON
- **D**: JSON5

### 决定
**A**

### 理由
- 用户最熟悉
- 支持注释（unlike JSON）
- 能写多行字符串（unlike JSON）
- TOML 表头嵌套不直观

### 后果
- YAML 解析有歧义（"yes" 被解析成 boolean）→ 用 strict mode
- 需要 schema 校验（用 zod / valibot）

---

## ADR-015 — 模型路由：规则 vs LLM 判定

### 背景
ModelRouter 怎么决定用哪个模型？

### 选项
- **A**: 纯规则（基于 task.complexity 等字段）
- **B**: LLM 判定（让小模型读任务再决定用大模型还是小模型）
- **C**: 混合

### 决定
**A**（v0.1）；**C**（v1.0）

### 理由
- B 引入额外 LLM 调用，成本+延迟
- A 简单可控，配置即生效
- v1.0 有数据后可训练分类器替代规则

### 后果
- 路由质量取决于 task.complexity 字段准确性
- Planner 需要在 Task payload 里负责评估 complexity

---

## 模板：未来新增 ADR 时使用

```markdown
## ADR-XXX — [一句话标题]

### 背景
[为什么需要做这个决定？]

### 选项
- A: [方案 A]
- B: [方案 B]
- ...

### 决定
[选了哪个]

### 理由
[为什么选这个]

### 后果
[这个决定带来的好处和坏处]
```

