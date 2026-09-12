# Git 治理闭环 + MVP 小步迭代治理方案

- 日期：2026-09-12
- 状态：草案（待评审）
- 任务等级：L（跨模块、涉及发布链路与门禁体系）
- 关联分支：`codex/release-0.54.2-installer`

---

## 0. 背景与问题定义

近期调研确认了四个治理缺口，本方案逐一给出落地方案：

| # | 问题 | 现状核实结论 |
| --- | --- | --- |
| 1 | 项目初始化不创建/管理 git，也无子仓库管理 | `scale install`（`src/cli/installCommands.ts`、`src/setup/CustomerInstall.ts`）全流程 **零 git 操作**：不检测 `.git`、不 `git init`、不处理 submodule/subtree。对有无 `.git` 的目录处理完全相同 |
| 2 | 改动后未强制创建对应 commit，难以跟踪回滚 | Shield（`src/shield/PolicyCompiler.ts:393-404`）只拦"未过 gate 就 commit"，方向相反；`ShipPipeline` 的 commit 仅在 ship 阶段触发；`git-workflow` skill 只是约定，无强制机制 |
| 3 | 改动未强制配套测试，交付前未强制全量验证通过 | vitest 已有 80%/75% 覆盖率门禁（`vitest.config.ts`），`scripts/gates/` 有 22 个 gate，但"每改动必带测试"和"交付前全绿"没有形成可执行闭环 |
| 4 | 近期工作重心需聚焦排期 | dashboard Agent app 闭环 S0-S5 已落地（`d3a201c`），但 S5 虚拟滚动（D7）疑似未覆盖；`scale open`/`scale smoke`/端口 fallback/hrain 安装线均已有实现，需收口验收 |

**总原则**（与 AGENTS.md 一致）：重要规则落到脚本、门禁、配置和模板，不停留在口头约定；未运行验证不得声称通过。

---

## 1. 问题 1：初始化 Git 管理（GitGuardian）

### 1.1 目标

`scale install` / `scale setup` 在目标目录：

1. **检测** git 仓库状态（无 `.git` / 有 `.git` / 处于父级 git 仓库中 / 是 submodule）。
2. 无 git 时**主动创建**（`git init` + 初始 commit + 合理的 `.gitignore`）。
3. 提供**子仓库管理**：monorepo 多包场景下支持"一个主仓 + 可选子仓"的声明式配置。

### 1.2 方案设计

新增模块 `src/setup/GitGuardian.ts`（纯函数核心 + CLI 薄壳，便于测试）：

```
GitGuardian
├─ detect(dir): GitStatus        # 'none' | 'repo' | 'nested'(父级有仓) | 'submodule' | 'broken'
├─ ensureInit(dir, opts): InitResult
│    # 'none' → git init（默认分支 main）+ 写 .gitignore + 首次 commit "chore: init scale-engine workspace"
│    # 'nested' → 提示并询问：a) 在当前目录 init（推荐，加 .git 到父级 ignore）b) 沿用父仓
│    # 'submodule'/'repo' → 只读检查工作区是否干净，脏时给出提示，不阻塞安装
├─ ensureIgnore(dir, entries)    # 幂等合并 .gitignore：.scale/artifacts/、node_modules/、dist/、.planning/cache/ 等
└─ configSubrepos(dir, cfgPath)  # 读写 .scale/subrepos.json
```

集成点：

- `CustomerInstall.ts` 安装序列的**第一步**调用 `GitGuardian.detect + ensureInit + ensureIgnore`（安装产物本身也应有首个 commit 保护，呼应问题 2）。
- `--no-git` CLI 开关保留逃生口（CI/容器场景）。

子仓库管理（`.scale/subrepos.json`，最小可用版）：

```json
{
  "mode": "none",            // none | submodule | standalone
  "repos": [
    { "path": "packages/app", "remote": "...", "strategy": "submodule" }
  ]
}
```

- MVP 只做两件事：`scale git subrepo add <path> <remote>`（内部执行 `git submodule add` 并登记）与 `scale git status`（聚合主仓+子仓状态）。不做 subtree（复杂度高、可后置）。

### 1.3 交付物与验收

- `src/setup/GitGuardian.ts` + `tests/setup/gitGuardian.test.ts`（临时目录覆盖 5 种 GitStatus 分支）。
- CLI 子命令 `scale git status` / `scale git subrepo add`（挂到 `src/cli/`）。
- install 集成 + 更新 `tests/setup/` 相关用例与 README 安装章节。

---

## 2. 问题 2：改动后必须 commit（Dirty-Tree 门禁）

### 2.1 目标

任何一次功能性改动结束时，工作区必须处于"已 commit（或明确豁免）"状态，使跟踪与回滚始终可行。

### 2.2 方案设计（三层防线）

**第一层：Shield 新策略（强制拦截）**

在 `src/shield/PolicyCompiler.ts` 的策略集中新增 `dirty_tree` 检查点（与现有 `gate_required` 同机制）：

- 拦截时机：Stop/SubagentStop hook（会话收尾）时检测 `git status --porcelain` 非空 → 输出 `[SCALE SHIELD] 工作区有未提交改动` 并 exit 2，提示运行 `scale commit-suggest`。
- 豁免通道：`.scale/policy.yaml` 中 `allow_dirty_paths`（如 `tmp/`、`output/`、`.workbuddy/`——当前 git status 里就存在这三类未跟踪目录，必须可豁免）。

**第二层：`scale commit-suggest`（引导工具）**

新增命令：生成符合 `git-workflow` skill 约定（`<type>: <description>`）的 commit message 草案 + 自动 `git add` 相关文件（排除 ignore 路径），流程为：

```
scale commit-suggest
  → 展示变更分组（按文件类型推断 type）
  → 确认后: gate-quality 通过 → git commit
```

复用现有 gate 链（`scripts/gates/all.sh --quality`），不重复造轮子。

**第三层：会话/工作流模板约定**

- 更新 `docs/guides/DEVELOPMENT_WORKFLOW.md` 与 `git-workflow` skill：明确"一次逻辑改动一个 commit 是硬性要求，Shield 在会话结束时会拦截脏工作区"。
- ShipPipeline 不变（ship 阶段的 commit 语义保留）。

### 2.3 交付物与验收

- PolicyCompiler 支持 `dirty_tree` 规则 + `scale shield test` 增加 2 个用例（脏树拦截 / 豁免路径放行）。
- `scale commit-suggest` 命令 + `tests/` 用例。
- 文档同步：DEVELOPMENT_WORKFLOW.md、docs/SHIELD.md、git-workflow skill。

---

## 3. 问题 3：改动必带测试 + 交付前全绿

### 3.1 目标

以"最新 MVP 完整功能实现、交互流畅"为准绳的小步迭代：每个改动有测试，交付时全量验证通过。

### 3.2 方案设计

**3.2.1 改动-测试绑定检查（新 gate：G23 `test-coverage-delta`）**

- 位置：`scripts/gates/` 新增 G23，纳入 `all.sh --quality` 链。
- 逻辑：
  1. 对比 `git diff --name-only <base>` 的源码改动；
  2. 若 `src/**` 有实质改动（非注释/文档）而 `tests/**` 无对应改动 → **block**，提示补测试或显式 `--skip-tests <reason>`（记录进 `.scale/verification.json`）。
- 基准：merge-base 到 HEAD。

**3.2.2 交付前全量验证（强化现有 verify，不新建）**

现有 `make verify PROFILE=default` + vitest 覆盖率门禁（lines/functions/statements ≥80%，branches ≥75%）已是正确骨架，补三件事：

1. **profile 增加 dashboard 档**：把 `verify-dashboard.mjs` / `verify-dashboard-browser.mjs`（目前游离在 Makefile 主链外）纳入 default profile 的 service 检查（`.agent/project.json` 登记）。
2. **交付检查清单命令化**：新增 `make gate-delivery`（封装：gate-quality + G23 + vitest run + verify PROFILE=default + `npm run build`），作为"交付给用户前"的单一入口；发布链 `release:check` 引用它。
3. **PRD 对齐 MVP 验收口径**：在 `docs/workflow/templates/` 的 verification 模板中加"交互流畅性"人工验收项（dashboard 场景记录操作路径、首屏时间、SSE 实时性主观评分），避免只测单测不测体验。

**3.2.3 小步迭代节奏（写入工作流模板）**

每个功能切片（slice）固定循环：

```
slice: define(≤10min) → plan → build(含测试) → gate-delivery → commit → 下一片
```

- 切片粒度：单个 slice ≤ 1 天、可独立交付、可独立回滚（呼应问题 2 的 commit 粒度）。
- 用现有 `tdd slice` 命令承载，不新造流程。

### 3.3 交付物与验收

- `scripts/gates/G23-test-coverage-delta.sh` + 注册进 all.sh；`scale shield test`/gate 测试更新。
- `.agent/project.json` profile 更新 + Makefile `gate-delivery` 目标。
- verification 模板更新（交互验收项）。

---

## 4. 问题 4：近期工作重心排期（迭代路线图）

基于现状：S0-S5 已落地（`d3a201c`），`scale open` 就绪等待、端口 fallback（`DashboardHttpConfig.findAvailablePort`）、`scale smoke`（`smokeCommands.ts`）、hrain 安装验证路径（`SetupVerification.ts:246`）均已有实现。重心是**收口与验收**，而非铺新摊子。

### 4.1 迭代切片（按优先级）

| 迭代 | 内容 | 验收标准 | 依赖 |
| --- | --- | --- | --- |
| **R1（1-2 天）** | hrain 安装线收口：`setup --pack full --memory-provider hrain --memory-mode local-only` 全链路冒烟（含离线场景）；补 `SetupVerification` 边界用例 | 干净 Win/macOS 环境一次命令成功；smoke 报告全 pass | 无 |
| **R2（2-3 天）** | `scale open` + `scale smoke` 客户开箱验收打磨：端口 fallback 在 3210-3219 全被占用场景的实测；smoke 报告增加"客户视角"摘要（非技术可读） | 占用场景自动换端口并正确提示新地址；smoke 报告含 fix-it 建议 | 无 |
| **R3（2 天）** | dashboard 集成工作台闭环补漏：S5 遗留的虚拟滚动（D7）；successRate/avgLatencyMs 等 KPI 在面板可见性核对 | 千条消息列表滚动流畅（无卡顿告警）；KPI 展示与 `metricsAggregator` 数据一致 | 无 |
| **R4（2-3 天）** | 问题 1 落地：GitGuardian（init + detect + ignore + subrepo MVP） | 见 §1.3 | 无 |
| **R5（2-3 天）** | 问题 2 落地：dirty_tree Shield 策略 + `scale commit-suggest` | 见 §2.3 | R4（.gitignore 基础） |
| **R6（2 天）** | 问题 3 落地：G23 + gate-delivery + profile/dashboard 验证纳入 | 见 §3.3 | R5 |

> R1-R3 是当前分支（0.55.x 发布线）的收尾，优先做；R4-R6 是治理基建，按序推进。每个迭代即一个 commit 单元（问题 2 的粒度要求）。

### 4.2 回滚预案

- 每个 R 独立分支（`codex/` 前缀，遵循 `.scale/workspace.json` GitLab flow），独立 PR，可单独 revert。
- Shield dirty_tree 策略默认先以 **warn 模式**上线一个迭代周期，观察误拦率后再切 block。

---

## 5. 风险与开放问题

| 风险 | 缓解 |
| --- | --- |
| dirty_tree 拦截误伤（如 `.workbuddy/`、`output/` 这类工具产物） | `allow_dirty_paths` 豁免 + 先 warn 后 block |
| G23 对纯文档/重构改动误报 | `--skip-tests <reason>` 显式豁免并留痕 verification.json |
| Windows 下 submodule/换行符问题 | 测试矩阵覆盖 win32（本仓库主力环境即 Windows） |
| 虚拟滚动（D7）与现有 SSE 乐观消息的交互回归 | R3 先补 e2e 再动实现 |

## 6. 验证方式（本方案自身的验收）

1. `make gate-workflow`：本文档通过工作流门禁（文档健康、模板合规）。
2. 各迭代落地后按对应章节验收标准执行并记录到 `.planning/tasks/<id>/verification.md`。
3. 最终统一跑 `make verify PROFILE=default` + `make gate-delivery`（R6 交付后）。
