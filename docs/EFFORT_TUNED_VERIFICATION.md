# Effort-Tuned Verification（受治理的验证深度）

Status: P1-A implemented (clean-context 独立审查); P1-B/C/D roadmap
Scope: SCALE Engine v0.59+ / P1 阶段

---

## 为什么需要「验证深度随任务等级变化」

2026 年业界共识（Cognition《Multi-Agents: What's Actually Working》2026-04、CMU/Google SDD 实证研究 arXiv 2608.25202、GitLab 自治阶梯 2026-10）：**自主度只应在验证强度跟得上的地方提高**。对 1 行改动的 typo 跑全套隔离审查是浪费；对 CRITICAL 变更只跑一次 lint 是失职。

SCALE 的做法：把验证深度做成**任务等级（S/M/L/CRITICAL）的函数**，而不是一刀切。这条路线正好落在 spec-kit 开放需求 [#4916](https://github.com/github/spec-kit/issues/4916)（per-step reasoning-effort / context-size 控制）所描述、但尚未解决的空白上。

## 四级验证矩阵

| 等级 | 验证深度 | clean-context 审查 | fresh-gate |
| --- | --- | --- | --- |
| **S**（typo/注释） | 最小相关验证 | 不要求 | off |
| **M**（常规 bug/小功能） | 记录 explore/plan/verification/summary | 可选 | off 或 warn |
| **L**（跨模块/流程调整） | 完整计划 + 风险 + 回滚 + 评审证据 | **建议** | **建议 block** |
| **CRITICAL**（安全/权限/发布/破坏性） | 人工确认 + 完整验证 + 安全检查 | **建议强制** | **建议 block** |

`scale review` 在任务为 L/CRITICAL 且未使用隔离审查时，会在输出里主动建议：
```
[建议] 此任务为 L 级，建议运行独立审查：scale review <task-id> --isolated --fresh-gate block
```

## P1-A：clean-context 独立审查

### 问题

构建 agent 审自己的代码时，会把「我为什么这么写」的自我合理化带进评审——一个误解从 spec 传到代码再传到测试。Cognition 实测：**无共享上下文的 reviewer 平均每 PR 揪出 ~2 个 bug（58% 严重级）**；CMU 研究把「实现者不得验证自己」列为 SDD 工具的设计原则。

### 命令

```bash
# 隔离审查（等价 --mode fresh-subagent，但语义更直白）
scale review <task-id> --isolated

# 高等级任务：让未通过的隔离结论阻止 ship
scale review <task-id> --isolated --fresh-gate block

# 只提示不阻断（中等风险）
scale review <task-id> --isolated --fresh-gate warn
```

### 隔离保证（可审计）

独立 verifier 的输入**只有三样**，构建 agent 的对话历史与自我评估被显式排除：

```json
{
  "contextIsolation": {
    "fedFields": ["verificationSurface", "diffSummary", "gateSummary"],
    "excludedFields": ["buildAgentConversationHistory", "buildAgentSelfAssessment", "taskPayloadNotes"],
    "diffHash": "sha256:…(16)",
    "surfaceCount": 4,
    "gateSummaryIncluded": true
  }
}
```

这条 `contextIsolation` 记录随 review 证据落盘 `.scale/reviews/<id>.json`，可被审计：证明「这次独立审查确实没看到作者的解释」。

### 三级处置（fresh-gate，纯确定性可单测）

| 模式 | unverified 的结果 | 是否阻断 ship |
| --- | --- | --- |
| `off`（默认） | 仅记录 advisory，不改 passed | 否 |
| `warn` | 追加一条 LOW finding，pass 不变 | 否 |
| `block` | 追加 CRITICAL finding，`passed=false` | **是**（经既有 review 证据门禁） |

`verified` 永不阻断；`uncertain`（未声明验证面）也不阻断——那说明 spec 本身没给出可验证的契约，应回去补 spec，而不是让 verifier 背锅。

### 离线可用

无 `SCALE_LOCAL_MODEL` 时，`FreshContextVerifier` 走**确定性启发式**：把每条 verificationSurface 拆 token，检查是否在 diff 里出现；有未覆盖项即 `unverified`。无网络、无模型也能给出可复现的结论。

## Roadmap（同属 P1）

- **P1-B 验收标准 → 可执行检查**：把 EARS+ 句式（`WHEN/IF … SHALL`）编译为 verification.json 条目（复用 `specCommands.ts` 既有解析），让「至少一句能让测试失败的验收标准」变成机器可校验的 check。
- **P1-C drift 持续检测**：代码变更触及 spec 引用模块而 spec/check 未变时，post-tool hook 输出**草拟的** spec 更新建议（append-only，人工确认）。
- **P1-D evals-in-CI 金数据集**：50–500 条版本化金案例，PR 跑确定性层、合并跑 model-in-loop 层，复用 `RuleMaturity` 的 shadow→candidate 门控做灰度。

## 与 spec-kit 的差异

spec-kit 的 `/speckit.analyze` 是**只读跨产物一致性**检查（spec↔plan↔tasks），仍然由同一个 agent 上下文执行；SCALE 的 P1-A 提供的是**独立上下文 + 可审计隔离证明 + 可配置门禁**——这正是 CMU 研究与 Cognition 实测共同指向、而 spec-kit 尚未覆盖的一层。
