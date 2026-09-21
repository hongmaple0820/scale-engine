# SCALE Engine 开发工作流

这份文档说明日常如何在 `scale-engine` 仓库里按最新工程化工作流工作。

## 标准闭环

```text
探索 -> 规划 -> 执行 -> 验证 -> 沉淀
```

## 1. 探索

目标：先弄清真实仓库状态，再动手。

```bash
make new-task NAME=task-slug LEVEL=M
make plan NAME=task-slug LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md package.json src/api/cli.ts' MSG='main contradiction'
make gate-workflow
```

最低要求：

- 至少读 3 个相关文件。
- 写清主矛盾，而不是只列文件名。
- 对不确定项明确标出，不靠猜。

## 2. 规划

在 `.planning/tasks/<task>/plan.md` 里至少补齐这些信息：

- scope / boundary
- acceptance criteria
- exception / failure path
- rollback / fallback
- verification commands

如果任务改动发布、权限、安全、凭据、npm 发版或破坏性行为，按 `CRITICAL` 处理。

## 3. 执行

原则：

- 最小必要修改。
- 优先复用现有脚本和 `npm` 命令，不再发明第二套命令。
- 改 `src/` 行为时，原则上同步改 `tests/`，否则会被 G3 拦下。

## 4. 验证

推荐顺序：

```bash
make gate-workflow     # G1, G2, G3, G16
make gate-quality      # G0, G4, G5, G6, G7, G8, G17, G18, G19, G20
make verify PROFILE=default  # 完整验证
git diff --check
```

门禁分三层（共 23 个），详见 [GATES_AND_SCORE.md](../workflow/GATES_AND_SCORE.md)：

**核心门禁（G0-G8）** — 每次提交必须通过：
- `G0` 构建必须通过
- `G1` 探索至少读 3 个文件并记录主矛盾
- `G2` 计划包含边界、异常、回滚
- `G3` `src/` 行为改动必须伴随测试
- `G4` lint 必须通过
- `G5` 测试必须通过
- `G6` 覆盖率和任务证据（profile 级）
- `G7` 安全和依赖检查（profile 级）
- `G8` 产品冒烟（profile 级）

**元治理门禁（G9-G15）** — 治理有效性检查：
- `G9` 知识库使用、`G11` 护栏有效性、`G12` 工作流完整性（默认启用）
- `G10` 改进证据、`G13` 多 Agent 协调、`G14` skill 使用、`G15` 自我改进（可选）

**增强门禁（G16-G22）** — 提交纪律和运行时质量：
- `G16` 未提交文件阈值和大文件检查（阻断）
- `G17` 文档链接卫生（advisory）
- `G18` 运行时证据记录（阻断）
- `G19` 代码审查（L/CRITICAL 任务阻断）
- `G20` 供应链安全（阻断）
- `G21` 上下文 token 预算（advisory）
- `G22` 会话健康：worktree 泄露检查（advisory）

## 5. 沉淀

应该留下：

- `verification.md`
- `review.md`
- `summary.md`
- 必要的长期规则文档更新

不应该留下：

- 临时日志
- worktree 状态
- 截图、trace、缓存
- 只对一次任务有意义的中间文件

## Agent 边界约束

这是把 [AGENTS.md](../../AGENTS.md) / [CLAUDE.md](../../CLAUDE.md) 的「工作原则」落到日常执行的硬约束，违反基本都会被对应门禁拦下：

- **未验证不得声称**：没有实际运行结果，不说「已通过」；`dry-run` 只代表入口可调度，不代表质量通过。证据写进 `verification.md`（G8）。
- **不确定显式标记**：拿不准的事实标 `[UNCERTAIN]`，不要用猜测填 `reality-check.md` 的 `## Confirmed`（G2 校验该文件分区）。
- **最小必要修改**：只改与任务直接相关的文件，不顺手重构、不扩大 diff。未提交文件过多或有大文件会被 G16 拦下。
- **不覆盖用户改动**：动手前先看 `git status`；不把本地 worktree、缓存、日志、截图混进提交。
- **行为改动配测试**：改 `src/` 行为原则上同步改 `tests/`，否则 G3 阻断。
- **规则优先落到物理层**：重要约定要落到脚本、门禁、配置、模板，不只停留在口头或文档；改模板前先读 [模板选择指南](../workflow/TEMPLATE_GUIDE.md) 的双源说明，避免改错一套。

## GitGuardian 仓库准备与子仓库

R4 新增 GitGuardian（`src/setup/GitGuardian.ts`），提供 `none / repo / nested / submodule / broken` 五种状态检测，并区分关联工作树与独立 gitdir。要求 Git 2.28+。

- `scale git status --dir . --json`：只读汇总主仓和 `.scale/subrepos.json` 中已登记的子仓库，包含分支、脏文件、gitlink 偏移和冲突状态。没有登记的子仓不自动发现。
- `scale install`：生成工作流文件前准备 Git；只有本次新建的仓库在安装结束后尝试初始提交。提交范围是 `.gitignore` 和安装器明确报告的普通文件，不扫描/暂存整个项目，不强加被忽略的运行时文件。
- `scale install --no-git`：完全跳过 GitGuardian；`--git-init-nested` 显式创建独立嵌套仓库，不自动修改父仓库 `.gitignore`。默认沿用父仓库。
- `scale git init --dry-run`：只预览；不带该开关时，新仓初始提交仅包含 `.gitignore`。已有仓库、子模块和关联工作树仅检查，不修改它们的 `.gitignore`、暂存区、Git 配置或提交。
- `scale setup`：计划阶段只检查 Git；仅显式 `--apply` 或 `--yes` 才准备 Git，新仓只提交 `.gitignore`，第三方安装产物留待人工审阅。`--verify` 不调用 GitGuardian，`--no-git` 可跳过。
- 提交不成功不会伪造作者、跳过 hook/签名或自动清理；安装报告通过 `git.committed=false`、`warnings` 和 `nextSteps` 提示人工处理。`git.ok` 表示初始化/复用成功，不等于已提交；独立 `scale git init` 在初始提交失败时返回非零退出码。
- 初始化遇到损坏仓库会停止，不覆盖 `.git`；新提交必须确认仓库归属、初始 HEAD、空暂存区和明确文件清单，禁止目录、链接、越界路径和环境秘密文件。Git 调用清理继承的 `GIT_*` 仓库重定向变量，不修改运行环境的安全保护。

子仓库最小用法：

```bash
# 登记但不联网；重复相同配置幂等，不同配置冲突拒绝覆盖
scale git subrepo add packages/app https://example.com/team/app.git --no-clone --dir .
# 执行真实子模块添加（网络、认证和原有 Git hooks 仍需可用）
scale git subrepo add packages/api git@example.com:team/api.git --dir .
# standalone 仅登记，不克隆；MVP 不支持混合模式或 subtree
scale git subrepo add packages/local https://example.com/team/local.git --strategy standalone --dir .
```

以上为不同配置模式的示例，不应在同一份配置中混用。`--no-clone` 登记后再次执行相同 `add` 不会补做克隆；需要克隆时一开始不加 `--no-clone`。现有目标路径不被覆盖或接管。远端仅允许 HTTPS、SSH、`git@host:path`，拒绝 file/ext 协议、选项注入和秘密 URL 参数。JSON 配置损坏时拒绝写入；部分 Git 操作失败仅报告现场，不自动回滚或删除。

R4 定向验证：

```bash
node node_modules/vitest/vitest.mjs run tests/setup --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=120000
npm run typecheck
npm run docs:health
```

测试创建专用系统临时根，并在后续 Git 写入前验证临时仓库的所有权；安全清理拦截必须报告，不得关闭保护器或提高删除阈值。定向通过不代替全仓库 `npm test`、覆盖率或发布门禁。

## 改动落盘：脏工作区提醒与提交建议（R5）

「一次逻辑改动一个 commit」从口头约定升级为可执行机制：

- **Stop hook 提醒**：`scale shield compile` 会在 settings 的 `Stop` 段注册 `require-clean-worktree`，会话结束时若 `git status --porcelain` 存在非豁免改动，输出提醒并继续（warn 模式，exit 0，不阻断会话）：

  ```
  [SCALE SHIELD WARN] Uncommitted changes detected: 2 changed entries (e.g. src/app.ts).
  Commit your changes or run: scale commit-suggest
  ```

- **默认豁免工具产物**：`.workbuddy/`、`.workbuddy-ai/`、`output/`、`tmp/`、`.scale-test-session/`、`.hook-state/`、`.planning/cache/`、`*.timestamp-<ts>-<hash>.mjs`。这些路径长期未跟踪也不会触发提醒。调整豁免范围改 `PolicyCompiler.DEFAULT_DIRTY_TREE_ALLOW_PATTERN` 后重新 `scale shield compile`。
- **提交建议**：`scale commit-suggest` 按改动推断类型（`docs` / `test` / `chore` / `feat`）与范围，生成 `<type>: <描述>` 草案；`--execute` 精确暂存计划内文件（绝不 `git add -A`）后提交，失败时保留暂存区供重试，不伪造作者、不跳过 hook。
- **提交前门禁**：Shield 仍要求 `scale gate-quality` 通过后才允许 `git commit`；两条规则配合形成「先过门禁、再落 commit」的闭环。
- **强制拦截可选**：把 `require-clean-worktree` 的 `action` 改为 `block` 可让脏工作区以 exit 2 直接拦截收尾；默认保持 warn，先观察误报率再决定是否收紧。

验证入口：

```bash
scale shield test
npx vitest run tests/shield tests/workflow/commitSuggest.test.ts
```

## 长任务检查点模式

跨多次会话、或步骤很多的任务，用检查点把进度落到状态文件，避免上下文丢失后从头再来：

```bash
make checkpoint PHASE=execute   # 记录当前阶段到 .agent/state
make resume                     # 恢复：打印当前任务、阶段、下一步
make status                     # 等价于 make resume
```

实践要点：

- **一个阶段一个检查点**：探索→规划→执行→验证→沉淀，每跨一个阶段 `make checkpoint`。
- **分阶段提交**：长任务拆成多个小提交，别攒成一个巨型提交（同样利于 G16）。
- **状态与计划同步**：`plan.md` 的 `## Steps with Gates` 勾到哪一步，状态就 checkpoint 到哪一步，恢复时一眼对上。
- **恢复先 `make resume`**：新会话开始先读当前状态，再继续，不要凭记忆重做。
