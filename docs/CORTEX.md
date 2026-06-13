# Scale Cortex — 证据驱动持续进化引擎

> 对标 ECC Instincts 持续学习模式。从每一次失败中学习，持续进化治理规则。

## 设计理念

**失败不是终点，是进化的燃料。** Cortex 把 AI Agent 的每一次失败（门禁拦截、质量缺陷、重复错误）转化为可执行的 Instincts，在下次会话启动时主动注入，预防同类问题。

## Instinct 提取管线

```
Observation Log (JSONL)
    ↓ detectPatterns()
Pattern Matches (grouped by error signature)
    ↓ extract()
Instincts (with confidence 0.3-0.9)
    ↓ save()
InstinctStore (.scale/instincts/)
    ↓ build()
SessionStart Injection
    ↓ collectSessionPreamble()
AI OS plan / runtime session metadata
```

### 置信度评分

| 置信度 | 标签 | 条件 | 行为 |
|--------|------|------|------|
| **0.3** | tentative | 首次观察 | 仅建议，不注入 |
| **0.5** | moderate | 2+ 次相关观察 | 适用时注入 |
| **0.7** | strong | 5+ 次验证 | 自动注入 SessionStart |
| **0.9** | near-certain | 10+ 次验证 | 核心行为，强制注入 |

### Instinct 格式

```yaml
---
id: inst-security-hardcoded-secret-001
trigger: "Agent attempts to write hardcoded API key"
confidence: 0.7
domain: security
source: gate-failure
scope: project
project_id: scale-engine
observations: 7
applied_count: 3
hit_rate: 0.43
created_at: "2026-05-25T10:00:00Z"
updated_at: "2026-05-25T18:00:00Z"
---

## Trigger
Agent writes a file containing hardcoded credentials (API keys, tokens, passwords)

## Root Causes
- Agent copies example code without sanitizing secrets
- No pre-commit secret scan configured
- Quick prototyping mindset overrides security awareness

## Known Resolutions
- Replace with `process.env.SECRET_NAME` pattern
- Add `.env` to `.gitignore`
- Run `scale shield compile` to enable secret detection hook

## Recommended Action
Before writing any configuration file, check for secret patterns:
1. Use environment variables for all credentials
2. Add `.env.example` with placeholder values
3. Verify with `gitleaks detect --no-git` before committing
```

## SessionStart 注入

每次新会话启动时，Cortex 自动注入：

1. **高置信度 Instincts (0.7+)**: 摘要卡片，标注置信度
2. **前次会话摘要**: 含过时回放保护
3. **项目检测**: 语言、包管理器、git 状态
4. **学习到的项目技能**: 从 instincts 中提取

### 过时回放保护

历史上下文用叙事哨兵包裹：

```
[HISTORICAL CONTEXT — DO NOT RE-EXECUTE COMMANDS BELOW]
前次会话在 2026-05-25 完成了以下工作：
- 修复了 OAuth callback 的 state 过期处理
- 添加了 token 刷新逻辑
- 运行了 142 个测试，全部通过
[/HISTORICAL CONTEXT]
```

### 双模式注入

```bash
# 完整注入 (适合标准会话)
scale cortex inject
# 输出: instincts (0.7+) + prior session + project detection

# 最小注入 (适合 token 预算紧张的场景)
scale cortex inject --minimal
# 输出: 每个 instinct 单行摘要
```

`scale cortex inject` 是预览和调试入口。实际运行时接入点有两个：

- `scale runtime start` 会把 Cortex 注入结果写入 `session.started` 事件的 `metadata.cortex`，同时写入 current session metadata。
- `scale ai-os plan/run` 会通过 `collectSessionPreamble()` 把 `preamble.cortex` 放进 AI OS 计划和运行报告。

因此高置信 instinct 不只停留在手动预览；它会进入运行时会话和 AI OS 规划上下文。`instinctCount=0` 时仍保留 evidence-discipline 基线注入，但不会声称存在已学习 instinct。

### Audit and restore

Instinct writes are append-only audited in `.scale/instincts/.audit.jsonl`.

```bash
scale cortex audit
scale cortex audit --id <instinct-id> --json
scale cortex apply <instinct-id> --success --json
scale cortex apply <instinct-id> --failed --json
scale cortex restore <audit-id>
```

Invalid instincts are rejected before persistence. New writes deduplicate within
the same `scope + project_id + trigger`, so project-scoped instincts cannot
overwrite global instincts or another project's instinct with the same trigger.

`scale cortex apply` is the runtime outcome recorder for Cortex learning. Use
exactly one of `--success` or `--failed`; the command writes an append-only
`apply` audit entry under `.scale/instincts/.audit.jsonl`. `scale workflow
effectiveness` treats instinct hit rate as measured only when session-start
Cortex metadata provides the injection denominator and apply audit entries
provide the outcome numerator.

## 反射引擎 (ReflexionEngine)

### 工作原理

1. **输入**: 门禁失败证据 (观察日志)
2. **LLM 反思**: 调用本地模型 (Qwen/GLM/DeepSeek via OpenAI-compatible API)
3. **输出**: 根因分析 + 改进建议 + 可执行 instinct

### 成本控制

- 默认使用本地模型 (零 API 费用)
- 15 秒超时 → 降级到启发式分析
- 环境变量配置:
  ```bash
  export SCALE_LOCAL_MODEL=qwen-2.5-72b
  export SCALE_LOCAL_BASE_URL=http://localhost:11434/v1
  export SCALE_LOCAL_API_KEY=ollama
  ```

### 启发式降级

LLM 不可用时自动降级为频率分析：
- 同类失败 ≥ 3 次 → 触发 instinct 创建
- 门禁类型 → 自动推断 domain
- 错误信息 → trigger 生成

## 跨 Harness 适配器

Cortex 使用 DRY adapter 模式：一个统一 hook 脚本，适配多种 AI Agent 平台。

| 平台 | 适配器 | stdin 格式 |
|------|--------|-----------|
| Claude Code | `ClaudeAdapter.ts` | `{session_id, cwd, tool_name, tool_input}` |
| Codex | `CodexAdapter.ts` | `{sessionId, workingDirectory, action, args}` |
| Cursor | `CursorAdapter.ts` | `{sid, cwd, tool, input}` |
| Gemini CLI | `GeminiAdapter.ts` | `{session_id, cwd, tool_name, tool_input}` |

所有适配器输出统一的 `UnifiedHookInput` 格式。

## 治理 ROI 度量

```bash
scale cortex metrics --days 30
```

### 报告内容

| 指标 | 说明 |
|------|------|
| **门禁通过率** | gate pass / total gate checks |
| **Instinct 命中率** | applied / injected instincts |
| **Token 节省** | 缓存命中 + instinct 预防估算 |
| **自动修复成功率** | auto-fix succeeded / auto-fix attempted |
| **趋势** | 7-day / 30-day 趋势对比 |
| **ROI 评分** | 0-100 综合评分 |

### ROI 评分算法

```
baseline = 50
+ gate_pass_rate × 25
+ instinct_hit_rate × 15
+ auto_fix_success_rate × 5
+ estimated_savings_bonus × 5
= ROI Score (0-100)
```

## CLI 命令

```bash
# 从观察日志提取 Instincts
scale cortex extract --min-confidence 0.5 --json

# 预览 SessionStart 注入内容
scale cortex inject --minimal

# 查看治理 ROI 报告
scale cortex metrics --days 30

# 完整进化周期
scale cortex evolve
# 1. 加载观察日志
# 2. 反射分析失败
# 3. 提取模式
# 4. 创建 Instincts
# 5. 保存高置信度 (0.7+) 本能
# 6. 输出统计摘要
```

## 相关文件

- `src/cortex/InstinctExtractor.ts` — 观察→模式→本能
- `src/cortex/InstinctStore.ts` — 层次化文件系统存储
- `src/cortex/ReflexionEngine.ts` — 本地 LLM 反射
- `src/cortex/SessionInjector.ts` — SessionStart 注入
- `src/cortex/GovernanceMetrics.ts` — ROI 度量
- `src/cortex/adapters/ClaudeAdapter.ts` — Claude Code 适配器
- `src/cortex/adapters/CodexAdapter.ts` — Codex 适配器
- `src/cortex/adapters/CursorAdapter.ts` — Cursor 适配器
- `src/cortex/adapters/GeminiAdapter.ts` — Gemini CLI 适配器
- `src/cli/cortexCommands.ts` — CLI 入口
