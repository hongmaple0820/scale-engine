# Workflow Eval Harness

Status: implemented baseline
Since: v0.22 development branch

Workflow Eval Harness 用来证明工作流是否真的提升了 Agent 的工程交付质量，而不是只依赖主观感觉。它会运行轻量 eval suite，记录 pass@k、修复迭代、工具调用、token 估算、人类纠偏次数，并在失败时保留 Failure Replay。

## Commands

初始化默认基线套件：

```bash
scale eval init
scale eval init --suite workflow-baseline --json
```

运行套件：

```bash
scale eval run --suite workflow-baseline
scale eval run --suite workflow-baseline --json
scale eval run --suite workflow-baseline --publish-benchmark
```

`--publish-benchmark` keeps the normal eval run artifact and also writes a
BenchmarkPublisher-compatible JSON file under `.scale/benchmarks/eval/`.

对比两次运行：

```bash
scale eval compare --baseline <run-id> --candidate <run-id>
scale eval compare --baseline <run-id> --candidate <run-id> --json
```

生成 Markdown 报告：

```bash
scale eval report --run <run-id>
scale eval report --run <run-id> --output docs/worklog/eval-report.md
```

查看和提升失败重放：

```bash
scale eval failures --since 30d
scale eval replay <failure-id>
scale eval replay --task-id <task-id>
scale eval promote-failure <failure-id>
```

## Failure Replay To Memory

Failure Replay is local eval evidence first. When a failure pattern is useful for future work, ingest it into Memory Brain as an `incident` candidate:

```bash
scale memory ingest --from failure --failure-id <failure-id>
scale memory query "missing verification evidence"
scale memory promote <memory-node-id>
```

This does not auto-change standards or hooks. It only makes the failure queryable and evidence-backed so repeated mistakes can be promoted deliberately after review.

## Storage

```text
.scale/evals/
├── suites/
├── runs/
├── failures/
└── improvements/
```

These files are local runtime evidence by default. Commit only curated summaries or intentional benchmark fixtures.

## Suite Shape

```json
{
  "version": "1.0",
  "id": "workflow-baseline",
  "name": "SCALE workflow baseline",
  "cases": [
    {
      "id": "governance-command-smoke",
      "type": "bugfix",
      "title": "Command evidence smoke",
      "task": "Verify that a local command can produce concrete eval evidence.",
      "phase": "verify",
      "successCriteria": ["command exits 0"],
      "attempts": [
        {
          "id": "attempt-1",
          "command": "node -e \"console.log('scale-eval-ok')\"",
          "expectedExitCode": 0,
          "outputContains": "scale-eval-ok"
        }
      ]
    }
  ]
}
```

## Metrics

| Metric | Meaning |
| --- | --- |
| `passAt1Rate` | 一次完整尝试就通过的比例 |
| `passAt3Rate` | 三次以内通过的比例 |
| `averageFixIterations` | 首次失败后的平均修复循环 |
| `totalToolCalls` | eval attempts 数量，可近似衡量工具调用成本 |
| `estimatedTokens` | task 与输出摘要的估算 token 成本 |
| `humanCorrections` | 人类纠偏次数 |
| `failureReplayCount` | 失败重放记录数量 |

## Failure Replay

失败不只记录最终失败状态，还会保存：

- task and success criteria
- phase
- wrong turn
- evidence
- correction
- prevention
- replay command
- redaction status

Failure category 当前包括：

- `wrong-exploration-path`
- `hallucinated-project-fact`
- `missing-codegraph-or-graph-fallback`
- `over-broad-context-load`
- `bad-skill-recommendation`
- `missing-verification-evidence`
- `failed-security-or-resource-gate`
- `human-correction-after-agent-confidence`
- `command-failure`
- `unknown`

`scale eval promote-failure` 会把失败重放提升为 improvement candidate，但不会自动修改项目规范。是否进入长期标准仍需要人工或后续 review 确认。

## Governance Use

- v0.22 的默认 suite 是轻量 smoke baseline，用来验证 eval 管线可运行。
- 真实项目应逐步增加 bugfix、feature、security、frontend、release、resource 类型案例。
- Failure Replay 应与 Resource Governance 配合：默认本地保留，只有总结、基准或明确要长期维护的案例才提交。
- Workflow Eval 的数据可以进入后续 Governance ROI，用来判断某个治理模块是否真的减少 rework、tool calls、token 或人类纠偏。

## Policy

- 不允许用 eval 通过率替代真实项目验证。
- 失败记录中的命令输出会做基础脱敏，但仍应避免把敏感原始日志写入 suite。
- 低成本 smoke suite 可以频繁运行；重型项目 suite 应按需运行。
- 没有 eval 证据时，不应宣称工作流能力已经提升。
