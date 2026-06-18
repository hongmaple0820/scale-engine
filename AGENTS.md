# AGENTS.md

本文件是 `scale-engine` 仓库的工程化工作流入口，面向在本仓库里直接开发 `scale-engine` 本身的 Agent 和维护者。

## 先读

1. `README.md`
2. `docs/guides/GETTING_STARTED.md`
3. `docs/guides/DEVELOPMENT_WORKFLOW.md`
4. `docs/workflow/README.md`
5. `.scale/workspace.json`

## 工作原则

- 先读现状，再改文件；不要把 scaffold 的默认假设直接覆盖到本仓库现实。
- 重要规则优先落到脚本、门禁、配置和模板，不只停留在口头约定。
- 未运行验证，不得声称通过；`dry-run` 只代表入口可调度，不代表质量通过。
- 需要执行 shell 命令时，优先使用 `rtk` 前缀。
- 不覆盖用户已有未提交改动，不把本地 worktree、缓存、日志、截图混进提交。

## 推荐入口

```bash
make preflight
make new-task NAME=workflow-adaptation LEVEL=M
make plan NAME=workflow-adaptation LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md' MSG='main contradiction'
make gate-workflow
make gate-quality
make verify PROFILE=default
make bootstrap-scale
make workflow-upgrade-check
make workflow-upgrade-plan
make workflow-aios-adopt
make setup-smoke
```

## Brain operations

| Trigger | Skill |
| --- | --- |
| api, endpoint, rest | `.scale/skills/api-design/SKILL.md` |
| review, check, quality | `.scale/skills/code-review/SKILL.md` |
| debug, fix, error, bug | `.scale/skills/debugging/SKILL.md` |
| document, readme, doc | `.scale/skills/documentation/SKILL.md` |
| commit, pr, merge | `.scale/skills/git-workflow/SKILL.md` |
| performance, optimize, slow, latency | `.scale/skills/performance/SKILL.md` |
| plan, design, architecture | `.scale/skills/planning/SKILL.md` |
| refactor, clean, improve | `.scale/skills/refactoring/SKILL.md` |
| release, publish, 发版, 发布 | `.scale/skills/release/SKILL.md` |
| security, audit, vulnerability, owasp | `.scale/skills/security-audit/SKILL.md` |
| test, tdd, coverage | `.scale/skills/tdd/SKILL.md` |

## SCALE 2.0 三引擎命令

```bash
# Scale Shield — 钩子拦截引擎
scale shield compile          # 编译 .scale/policy.yaml → hook 脚本
scale shield status           # 验证 hook 注册 + .scale/ 完整性
scale shield test             # 运行 18 个 allow/block 测试用例

# Scale Orchestrator — 声明式编排守护进程
scale orch start              # 启动 orchestration daemon
scale orch stop               # 停止 daemon
scale orch status             # 查看 daemon 状态 + workspace 列表

# Scale Cortex — 证据驱动持续进化
scale cortex evolve           # 完整进化周期: 观察→反思→提取→保存
scale cortex extract          # 从观察日志中提取 Instincts
scale cortex inject --minimal # 预览 SessionStart 注入内容
scale cortex metrics --days 30 # 治理 ROI 报告
```

PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/verify.ps1 -Profile default
```

## 任务等级

| Level | 场景 | 最低要求 |
| --- | --- | --- |
| S | typo、小范围文档、纯注释 | 读相关文件并运行最小相关验证 |
| M | 常规 bug、小功能、脚本或治理优化 | 记录 explore/plan/verification/summary |
| L | 跨模块、跨流程、模板体系或发布链路调整 | 完整计划、风险、回滚、评审证据 |
| CRITICAL | 安全、权限、发布、破坏性操作 | 人工确认、完整验证、安全检查 |

## 交付要求

最终汇报至少说明：

- 改了什么。
- 实际运行了哪些验证命令，结果是什么。
- 哪些地方未验证，为什么。
- 如果工作流规则变了，同步更新了哪些文档和配置。
