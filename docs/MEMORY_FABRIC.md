# Memory Fabric

Memory Fabric 是 SCALE 用来降低长会话 token 消耗、提升 Agent 记忆质量的上下文压缩层。它不会把所有历史文档都塞回提示词，而是按任务范围生成一个可审计的 context pack。

它聚合四类信息：

- Runtime Evidence：真实运行过的命令、工具、浏览器、skill、MCP 和人工验证证据。
- Session Events：当前会话的阶段、工具使用和证据写入事件。
- Knowledge Recall：从项目知识库召回已验证经验、规则和历史教训。
- Project Graph：检测 `graphify-out/graph.json`、`graphify-out/GRAPH_REPORT.md` 或 `.scale/graph/manifest.json`，只引用图谱状态和摘要，不把大型图谱全文塞进上下文。

## 基本命令

生成上下文包：

```bash
scale memory pack \
  --task-id 2026-05-18-runtime-evidence \
  --session-id 2026-05-18-runtime-evidence \
  --task "继续实现 runtime evidence 与最终交付检查" \
  --level M \
  --files src/runtime,src/api/cli.ts \
  --budget 4000
```

输出 JSON，便于其他 Agent、CLI 或评审工具读取：

```bash
scale memory pack \
  --task "修复 OAuth callback state 过期处理" \
  --level M \
  --budget 4000 \
  --json
```

检查上下文预算：

```bash
scale memory doctor \
  --task "跨模块权限重构" \
  --level L \
  --budget 3000
```

把完成任务后的运行证据沉淀成学习候选：

```bash
scale memory settle \
  --task-id 2026-05-18-runtime-evidence \
  --session-id 2026-05-18-runtime-evidence \
  --task "继续实现 runtime evidence 与最终交付检查" \
  --level M \
  --budget 4000
```

`settle` 会写入：

```text
.scale/memory/learning-candidates/<candidate-id>.json
.scale/memory/learning-candidates/<candidate-id>.md
```

这些文件是本地运行时学习候选，默认不应该直接提交到 Git。它们的作用是让人类或评审 Agent 判断“这条经验是否值得进入长期知识库、工程规范或模块文档”。

## 预算策略

Memory Fabric 使用估算 token 预算控制上下文规模。优先级从高到低：

1. Runtime Evidence：失败证据和通过证据优先保留。
2. Session Events：最近会话事件优先保留。
3. Knowledge Recall：按任务描述和文件范围召回 Top K 知识。
4. Project Graph：只保留图谱报告路径和短摘要。

当预算不足时，低优先级 section 会被标记为 omitted，并写入原因。这样 Agent 能知道哪些上下文被刻意裁剪，而不是误以为项目没有相关信息。

## 与知识库和自我进化的关系

Memory Fabric 不替代知识库。它是知识库、运行证据和图谱之间的读取层：

- Runtime Evidence 记录“这次实际做过什么”。
- Knowledge Base 记录“长期可复用的经验和规则”。
- Graphify 或项目图谱记录“模块之间的结构关系”。
- Memory Fabric 在每次任务开始、恢复、评审或发版前，生成本次最相关的上下文包。

任务完成后，应该把真正稳定的经验沉淀到知识库或长期维护文档中；`.scale/events/` 和 `.scale/evidence/` 仍然是本地运行时产物，不应默认提交到 Git。

新的推荐闭环是：

```text
runtime evidence -> memory pack -> memory settle -> 人审 -> knowledge/docs/rules
```

也就是说，Memory Fabric 先把证据和上下文压缩成候选，不会自动把一次会话里的判断升级成长期规则。存在失败证据时，候选会标记为 `resolve-failures-first`，避免把未闭环问题沉淀成“经验”。

## 推荐使用场景

- 长会话恢复前：先生成 context pack，避免重复读大量文档。
- 多 Agent 协作前：把 context pack 交给审查 Agent 或测试 Agent。
- 发版前：用 runtime evidence 和 session events 检查是否存在未闭环失败。
- 任务结束后：用 `memory settle` 生成学习候选，再决定是否进入知识库、模块文档或工程规范。
- 大型项目治理：结合 service matrix、resource governance 和 engineering standards，生成任务相关而不是全仓库噪声上下文。

## 当前边界

- 当前版本不内置向量数据库；如果项目配置了 SQLite knowledge base，会使用现有召回接口。
- 当前版本只检测 Graphify 产物是否存在并生成摘要，不主动运行 Graphify。
- HTML 可视化报告适合后续加在 context pack 之上；Memory Fabric 的核心产物先保持 JSON/Markdown，方便 diff、测试和 CLI 集成。

## Memory Provider Router

SCALE now treats strong memory systems as providers instead of rebuilding them inside the workflow engine.

Default provider order:

```text
gbrain
```

Commands:

```bash
scale memory provider init
scale memory provider status --json
scale memory provider use gbrain --json
scale tool doctor --tools gbrain --json
scale memory provider recall "OAuth callback Redis state" --json
scale ai-os plan --task "Fix OAuth callback Redis state" --files src/auth/oauth.ts --json
```

Provider rules:

- `gbrain` is the default external-first provider. SCALE treats CLI existence as insufficient: `scale memory provider status --json` requires a configured brain with working connection/schema checks before marking it available. Full `gbrain doctor --json` warnings that are unrelated to recall, such as local skill resolver issues, are reported as degraded health but do not block read-only recall. If the CLI exists but no brain is configured, the status remains unavailable and points to `gbrain init --pglite`.
- The preferred remote production path is the official thin-client flow: run `gbrain serve --http` on the host, then configure the local CLI with `gbrain init --mcp-only` so SCALE can keep calling `gbrain query` through the thin client instead of inventing a separate ad-hoc REST contract.
- This repository's checked-in provider routing is intentionally gbrain-only. Additional providers are not part of the default workflow contract unless a project explicitly opts into a separate provider policy.
- `memory provider use <id>` is the fast path for switching the default route without hand-editing `.scale/memory-providers.json`.
- External providers are read-only by default. Writes require an explicit provider policy change.
- `scale-local` remains an explicit local Memory Brain mode for projects that choose it, but it is not the default route for this repository's provider policy.
- `memory pack` automatically includes a `provider-memory` section when provider recall returns relevant active memories.
- `ai-os plan` includes both the provider recall summary and the Memory Fabric context pack, so agents can route memory before planning without pretending external memory is always available.

This keeps agents flexible: they can ask the router for memory before planning, verification, review, or release, while SCALE still records which provider was used and why fallback was required.

Setup shortcut:

```bash
scale setup --pack memory
scale setup --pack memory --memory-provider gbrain --memory-mode external-first --json
scale memory provider status --json
```

`setup --memory-provider` is the preferred UX for provider switching during onboarding. It writes the same routing file as `scale memory provider use`, returns `memoryProviderSwitch` in JSON, and keeps external writes disabled unless `--allow-external-write` is explicitly passed.

For local gbrain usage, a provider can declare `homeDir` such as `.scale/memory/gbrain-home`. SCALE passes that path as `GBRAIN_HOME` and defaults `GBRAIN_AUDIT_DIR` to `<homeDir>/audit` for provider status and recall queries, keeping project recall independent from a broken or incompatible global gbrain database.

Remote replay validation:

```bash
npm run smoke:gbrain
node scripts/workflow/provider-rehearsal.mjs --skip-graphify --require-gbrain
```

This is intentionally stronger than `scale memory provider status --json`: it requires a real configured gbrain, writes a temporary page, then reads and queries it through separate CLI processes. If no remote/thin-client brain is configured, the rehearsal must report `blocked` or fail under `--require-gbrain`; falling back to `scale-local` is not a valid substitute for cross-session provider validation.
