# SCALE Engine 学习路径

**目标**: 从零到精通，5 个级别，每级 <1 小时

---

## Level 1: 体验者 (Explorer)

**目标**: 跑通第一个 gate，理解 SCALE 是什么
**耗时**: 15 分钟
**前置**: 已安装 Node.js 20+

### 步骤

```bash
# 1. 无全局安装试用 SCALE Engine
npx -y @hongmaple0820/scale-engine@latest onboard --lang zh

# 2. 进入你的项目
cd your-project

# 3. 交互式初始化
npx -y @hongmaple0820/scale-engine@latest init --interactive --dir .

# 4. 跑一次 preflight
npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .
```

### 你会学到
- SCALE 的门禁系统是什么
- `.scale/` 目录的作用
- `preflight` 和 `verify` 的区别

### 通关标准
- [ ] `npx -y @hongmaple0820/scale-engine@latest preflight --preflight-profile quick --dir .` 输出 PASS
- [ ] 能解释 G0/G4/G5 分别检查什么

---

## Level 2: 使用者 (User)

**目标**: 日常开发中使用 SCALE 管理任务和门禁
**耗时**: 30 分钟
**前置**: 完成 Level 1

### 步骤

```bash
# 1. 创建第一个任务
scale create "fix: typo in README" --level S

# 2. 使用 fast-lane 提交 S 级改动
make gate-fast-lane

# 3. 创建 M 级任务，体验完整流程
scale create "feat: add user auth" --level M

# 4. 运行完整验证
make gate-workflow
make gate-quality
```

### 你会学到
- 任务分级 (S/M/L/CRITICAL)
- Fast-lane vs 标准流程
- 如何读 gate 报告

### 通关标准
- [ ] 成功用 fast-lane 提交一个 S 级任务
- [ ] 成功用标准流程完成一个 M 级任务
- [ ] 能说出 S/M/L 级的区别

---

## Level 3: 配置者 (Configurator)

**目标**: 自定义 SCALE 行为，适配项目需求
**耗时**: 45 分钟
**前置**: 完成 Level 2

### 步骤

```bash
# 1. 查看当前配置
scale config show

# 2. 切换 profile
scale config profile standard

# 3. 配置验证命令
# 编辑 .scale/verification.json
# 添加自定义 services 和 commands

# 4. 设置第三方能力
npx -y @hongmaple0820/scale-engine@latest setup --pack full --memory-provider gbrain --memory-mode external-first --dir . --json

# 5. 运行 doctor 检查配置健康
npx -y @hongmaple0820/scale-engine@latest doctor --dir .
```

### 你会学到
- 4 种 profile (minimal/standard/advanced/china-local)
- verification.json 的结构
- 如何配置 skills、memory、knowledge providers
- doctor 诊断工具

### 通关标准
- [ ] 修改 verification.json 添加自定义 service
- [ ] `npx -y @hongmaple0820/scale-engine@latest doctor --dir .` 输出 healthy
- [ ] 理解 profile 和 governance pack 的关系

---

## Level 4: 治理者 (Governor)

**目标**: 掌握高级治理功能，包括 meta-governance 和 evolution
**耗时**: 60 分钟
**前置**: 完成 Level 3

### 步骤

```bash
# 1. 查看所有门禁状态
scale gates status

# 2. 启用 meta-governance (G9-G15)
scale governance mode --task "governance setup" --files ".scale/*"

# 3. 运行 Cortex 进化
scale cortex evolve --project .

# 4. 查看 evolution 报告
scale evolution stats

# 5. 配置 resource policy
# 编辑 .scale/resource-policy.json
# 设置模块 owner 和权限

# 6. 运行完整 meta-governance
bash scripts/gates/all.sh --all
```

### 你会学到
- 23 个门禁的完整体系 (G0-G22)
- Meta-governance 的作用
- Cortex 进化循环 (observe → reflect → extract → inject)
- Resource policy 和模块治理

### 通关标准
- [ ] 能解释 G9-G15 各检查什么
- [ ] 运行过 cortex evolve 并理解输出
- [ ] 配置过 resource-policy.json

---

## Level 5: 贡献者 (Contributor)

**目标**: 为 SCALE Engine 本身贡献代码
**耗时**: 60 分钟
**前置**: 完成 Level 4

### 步骤

```bash
# 1. 克隆 SCALE Engine 仓库
git clone https://github.com/hongmaple0820/scale-engine.git
cd scale-engine

# 2. 阅读开发者指南
cat docs/guides/GETTING_STARTED.md
cat docs/guides/DEVELOPMENT_WORKFLOW.md

# 3. 跑通开发环境
make preflight
make verify PROFILE=default

# 4. 理解门禁系统源码
# src/workflow/GateCatalog.ts — 门禁定义
# src/workflow/GateSystem.ts — 门禁执行
# scripts/gates/all.sh — Shell 入口

# 5. 提交你的第一个 PR
# 遵循 DEVELOPMENT_WORKFLOW.md 的 5 阶段流程
```

### 你会学到
- SCALE Engine 的架构
- 如何添加新门禁
- 如何添加新 CLI 命令
- 贡献流程和规范

### 通关标准
- [ ] 能解释 GateCatalog.ts 的结构
- [ ] 成功运行 `make gate` 并理解输出
- [ ] 提交过至少一个 PR

---

## 快速参考

| 级别 | 名称 | 耗时 | 核心技能 |
|------|------|------|----------|
| L1 | 体验者 | 15min | 安装、初始化、跑 preflight |
| L2 | 使用者 | 30min | 任务分级、fast-lane、标准流程 |
| L3 | 配置者 | 45min | profile、verification、doctor |
| L4 | 治理者 | 60min | meta-governance、cortex、resource policy |
| L5 | 贡献者 | 60min | 源码、架构、PR 流程 |

**总耗时**: ~3.5 小时从零到贡献者

---

## 常见问题

### Q: 我应该从哪个级别开始？

如果你是第一次接触 SCALE，从 Level 1 开始。如果你已有 CI/CD 经验，可以跳到 Level 2。

### Q: 每个级别可以跳过吗？

不建议。每个级别建立在前一级的基础上。跳级可能导致配置错误或误解门禁含义。

### Q: 学完后我能做什么？

- Level 1-2: 日常开发中使用 SCALE
- Level 3: 为团队定制 SCALE 配置
- Level 4: 管理多项目治理
- Level 5: 为 SCALE Engine 贡献代码

---

## 相关文档

- [GETTING_STARTED.md](GETTING_STARTED.md) - 开发者快速上手
- [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) - 完整开发流程
- [FAST_COMMIT_GUIDE.md](FAST_COMMIT_GUIDE.md) - S 级快速提交
- [MIGRATION.md](MIGRATION.md) - 版本迁移指南
