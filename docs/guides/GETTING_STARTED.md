# SCALE Engine 仓库上手

这份文档面向要开发 `scale-engine` 仓库本身的人，不是面向安装 CLI 的最终用户。

## 15 分钟路径

1. 先读根目录 [README.md](../../README.md)。
2. 跑本仓库 workflow 预检：

```bash
make preflight
```

3. 看当前可用验证面：

```bash
make verify-list
```

4. 建一个任务骨架并记录探索：

```bash
make new-task NAME=example LEVEL=M
make plan NAME=example LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md package.json' MSG='main contradiction'
make gate-workflow
```

5. 做完改动后跑质量面：

```bash
make gate-quality
make verify PROFILE=default
git diff --check
```

如果改动影响安装、第三方能力、skills、记忆或知识库入口，还要跑安装烟测：

```bash
make setup-smoke
npm run smoke:setup
npm run smoke:providers
```

`smoke:setup` 负责安装入口和配置路径；`smoke:providers` 负责真实 gbrain/graphify 回放。没有远端 gbrain 或大项目 Graphify 环境时，默认报告 `blocked` 并给出修复命令；如果要把它作为强制门禁，使用 `npm run smoke:gbrain` 或 `npm run smoke:graphify -- --large-project <path>`。

准备发版本仓库时，直接跑完整发布门禁：

```bash
npm run release:check
```

如果全量测试卡住或需要定位顺序相关问题，再用 `npm run test:serial` 做排障；不要把它当成默认发布门禁。

如果失败和本机 shell、PATH、Python、Bun、Cargo 或第三方 CLI 有关，先跑：

```bash
scale doctor env --json
```

`scale doctor env` 里有一项 `guardrail-ast`：护栏先跑 regex 预筛，再用 AST 精确确认（排除字符串字面量和注释里的假命中）。AST 需要 `typescript`，它在本包里是**可选 peer**——pnpm 非 hoisted 布局或 `autoInstallPeers: false` 时可能没被装上。这种情况下该项显示 `[WARN] regex-only mode`，检测覆盖面不变（AST 只会收窄 regex 结果，从不新增），但假阳性会变多。想去掉这个告警，在宿主工程里装一下即可：

```bash
npm install typescript   # 或 pnpm add typescript
```

## SCALE 2.0 引擎开发

三引擎开发时的常用命令：

```bash
# Shield: 编译策略 → hook 脚本
scale shield compile
scale shield test

# Orchestrator: 启动编排 daemon (开发调试)
scale orch start
scale orch status
scale orch stop

# Cortex: 从失败日志提取学习
scale cortex extract
scale cortex inject --minimal
```

## 你应该看到什么

- `.scale/workspace.json` 明确了 `dev -> master` 的仓库分支策略。
- `.agent/project.json` 定义了本仓库的 Node/TypeScript 验证命令。
- `scripts/gates/*` 和 `scripts/workflow/*` 不是说明文档，而是可执行入口。
- `.planning/tasks/<date>-<task>/` 用于任务级证据，不再把临时过程写进 `docs/`。

## 常见误区

- `make gate-workflow` 通过，不代表代码质量通过。
- `make gate-quality` 通过，也不代表你已经记录了风险、回滚和未验证项。
- `G8` 会检查改动过的 Markdown 和工作流文档卫生，不替代业务验证。
- `--dry-run` 只能证明入口存在，不能写成“测试通过”。
- 不要把 `.claude/worktrees/`、`.agent/state/`、日志或截图提交进仓库。
