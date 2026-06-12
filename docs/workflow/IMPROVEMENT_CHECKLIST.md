# SCALE Engine 改进实施清单

**版本**: 1.0  
**生成日期**: 2026-06-03  
**用途**: 逐项追踪改进项目的实施进度  

---

## 快速导航

- [短期任务（3个月）](#短期任务3个月)
- [中期任务（6个月）](#中期任务6个月)
- [长期任务（1年）](#长期任务1年)
- [进度追踪](#进度追踪)

---

## 短期任务（3个月）

### 🚀 P0-1: Fast-lane 模式 (第 1-2 周)

**目标**: S 级任务可在 < 2 分钟通过验证（跳过 G9-G22）

#### 具体任务
- [ ] **任务卡**: 创建 GitHub Issue #XXX "Implement fast-lane profile"
- [ ] **分析**: 调查现有 profile 实现（verification.json 结构）
- [ ] **设计**: 草稿 fast-lane profile 配置
  - [ ] 文档: `.scale/verification.json` 中的 profiles schema
  - [ ] 决策: 哪 4 个 gate (G0, G3, G4, G5)?
  
- [ ] **实现**:
  - [ ] 修改 `.scale/verification.json` 新增 fast-lane
  - [ ] 更新 `scripts/gates/all.sh` 支持 `--profile fast-lane`
  - [ ] 新增 `scripts/gates/fast-lane-verify.sh`
  
- [ ] **测试**:
  - [ ] 手工测试: typo 修复用 fast-lane
  - [ ] 手工测试: 注释改动用 fast-lane
  - [ ] 验证耗时 < 2 分钟
  
- [ ] **文档**:
  - [ ] 创建 `docs/guides/FAST_COMMIT_GUIDE.md`
  - [ ] 更新 `DEVELOPMENT_WORKFLOW.md` 章节 3
  - [ ] 更新 README 快速开始部分
  
- [ ] **审查**: 代码审查 + 文档审查
- [ ] **发版**: 纳入 v0.47.0 release

**交付件**:
```
✓ FAST_COMMIT_GUIDE.md
✓ .scale/verification.json (fast-lane 配置)
✓ scripts/gates/fast-lane-verify.sh
✓ 单元测试 + 集成测试
✓ PR with evidence.md
```

**验证方式**:
```bash
make new-task NAME=typo LEVEL=S
make gate-workflow --profile fast-lane
# 期望: ✓ 通过，耗时 < 120s
```

---

### 🚀 P1-5: 学习路径与视频教程 (第 3-4 周)

**目标**: 新手 15 分钟掌握基础，30 分钟学会日常使用

#### 具体任务
- [ ] **制定学习分级**:
  - [ ] Level 1 (15 min): preflight / verify 概念
  - [ ] Level 2 (30 min): new-task / explore / plan
  - [ ] Level 3 (45 min): gate-workflow / gate-quality
  - [ ] Level 4 (60 min): scale orch / scale shield
  - [ ] Level 5 (90 min): scale cortex / scale ai-os

- [ ] **编写 LEARNING_PATH.md**:
  - [ ] 每级的学习目标
  - [ ] 对应文档链接
  - [ ] 3-5 个代码示例
  - [ ] FAQ 常见问题

- [ ] **制作视频** (各 5-10 分钟):
  - [ ] 视频 1: 新手 15 分钟快速开始
  - [ ] 视频 2: 常见故障排查 (gate 失败、升级卡壳)
  - [ ] 视频 3: Cortex 完整演示
  
  **发布平台**: YouTube / Bilibili / GitHub Discussions

- [ ] **开发交互式向导**:
  - [ ] 新增 `src/commands/onboard.ts`
  - [ ] 实现 `scale onboard --interactive`
  - [ ] 3-5 个问题判断工作流需求
  - [ ] 推荐 profile + 学习路径

- [ ] **更新首页文档**:
  - [ ] README.md 新增"快速开始"→ 链接到 LEARNING_PATH
  - [ ] 添加评分表: 易用性从 6/10 → 7/10

**交付件**:
```
✓ docs/guides/LEARNING_PATH.md
✓ 3 个视频教程 (YouTube/Bilibili 链接)
✓ src/commands/onboard.ts
✓ 对应单元测试
✓ README.md 更新
```

**验证方式**:
```bash
# 测试交互式向导
scale onboard --interactive
# 输出: 3-5 个问题，推荐 profile

# 测试新手文档
# 邀请 3 个新手，记录完成时间
# 目标: avg time to first success < 30 min
```

---

### 🚀 P1-7: 性能基准与文档 (第 5-6 周)

**目标**: 发布 gate 耗时基线，证明工作流可接受的开销

#### 具体任务
- [ ] **建立性能测试环境**:
  - [ ] 清洁 workspace（无其他后台进程）
  - [ ] 标准化测试项目（repo size 固定）
  - [ ] 测试机器配置固定 (CPU/RAM/网络)

- [ ] **逐个 gate 测量**:
  - [ ] G0 (Build): 运行 5 次，记录平均/最小/最大
  - [ ] G1 (Explore): 检查逻辑，无测试，记录 check time
  - [ ] G3 (Test coupling): 检查逻辑，记录
  - [ ] G4 (Lint): ESLint 扫描，记录
  - [ ] G5 (Tests): vitest 运行，记录
  - [ ] G6-G8: 分别测量
  - [ ] G9-G22: 新增 gate，首次测量

- [ ] **生成基准文档**:
  ```markdown
  # Gate Latency Baseline
  测试环境: MacBook Pro M1, 16GB RAM, clean workspace
  项目: scale-engine (当前)
  
  | Gate | 说明 | 平均耗时 | 最小 | 最大 | P95 |
  |------|------|--------|------|------|------|
  | G0 | Build | 45s | 42s | 52s | 50s |
  | G1 | Explore | <1s | - | - | - |
  | G4 | Lint | 8s | 6s | 11s | 10s |
  | G5 | Tests | 120s | 100s | 150s | 140s |
  | Total | 全量(G0-G8) | 200s | 180s | 230s | 220s |
  ```

- [ ] **性能优化建议**:
  - [ ] 识别最慢的 gate
  - [ ] 建议并行化机制
  - [ ] 评估异步 evidence 录制的收益

- [ ] **创建持续监控**:
  - [ ] 新增 GitHub Actions workflow: performance-baseline.yml
  - [ ] 每个 release 自动测量
  - [ ] 记录性能 trend

**交付件**:
```
✓ docs/PERFORMANCE_BASELINE.md
✓ scripts/performance/measure-gates.sh
✓ .github/workflows/performance-baseline.yml
✓ performance trend 数据 (CSV)
```

**验证方式**:
```bash
bash scripts/performance/measure-gates.sh
# 输出: baseline.json
#   {
#     "G0": {"avg": 45, "min": 42, "max": 52},
#     ...
#   }

# 对比预期: total < 220s
```

---

### ✅ P3-10/11/12: 小改进 (第 7-8 周)

三个小改进项，并行实施：

#### P3-10: Token 预算 (G21) 强制化
- [ ] 修改 `.scale/verification.json`: G21.blocking = true (L/CRITICAL)
- [ ] 更新 `scripts/gates/G21-verify.sh`: 增强阻断逻辑
- [ ] 文档说明
- **交付**: 1 个文件改动 + 1 个脚本更新

#### P3-11: Session 健康 (G22) 细粒度信号
- [ ] 新增信号:
  - [ ] context window utilization trend
  - [ ] memory growth rate
  - [ ] 清理建议
- [ ] 更新 `scripts/gates/G22-verify.sh`
- **交付**: G22 脚本 + 文档

#### P3-12: 文档链接卫生 (G17) 强制化
- [ ] 修改 `.scale/verification.json`: G17.blocking = true
- [ ] 增强 `scripts/gates/G17-verify.sh`: 检查变更文件中的链接
- **交付**: 脚本更新 + 测试

---

### 🔬 P0-3: Cortex 验证 Phase A (第 9-12 周, 并行)

**目标**: 5 个真实项目运行 Cortex 完整周期 2 个月，收集数据

#### 项目选择
- [ ] **项目 1**: 小规模 (< 10K loc) 单个 Agent
- [ ] **项目 2**: 中规模 (10-50K) 多 feature
- [ ] **项目 3**: 大规模 (50K+) 多 Agent
- [ ] **项目 4**: 快速迭代 (daily tasks)
- [ ] **项目 5**: 规范严格 (L/CRITICAL focus)

#### 数据收集
- [ ] 建立 baseline（无 Cortex，前 2 周）
  - [ ] 记录每日 gate fail rate
  - [ ] 记录失败模式分布
  
- [ ] 启用 Cortex (后 8 周)
  - [ ] `scale cortex evolve --project <name> --observe-mode on`
  - [ ] 每周收集 Instinct 数量
  - [ ] 记录应用情况
  
- [ ] 生成报告
  - [ ] 每个项目 1 份报告 (BEFORE/AFTER 对比)
  - [ ] 综合报告 (5 个项目汇总)

**交付件**:
```
✓ docs/case-studies/CORTEX_VALIDATION_REPORT.md (总结)
✓ docs/case-studies/cortex-project-{1..5}-report.md
✓ cortex_metrics_raw.json (原始数据)
```

**验证方式**:
```bash
scale cortex metrics --days 60 --projects 5 --compare-baseline
# 期望输出:
# - gate fail rate: avg 12% → 8% (↓33%)
# - common patterns: Top 5 identified
# - Instinct applications: N times
```

---

## 中期任务（6个月）

### 🚀 P0-2: 升级自动化 (第 1-2 月)

**目标**: upgrade-check → recommend → apply → verify 全自动化

#### 新增命令
- [ ] `scale upgrade recommend`
  - [ ] 分析 breaking changes
  - [ ] 计算风险分数
  - [ ] 生成自动应用计划
  
- [ ] `scale upgrade apply --auto-backup`
  - [ ] 自动创建 backup branch
  - [ ] 记录升级前后 git state
  
- [ ] `scale upgrade verify --compare-baseline`
  - [ ] 升级后性能对标
  - [ ] 超阈值自动 rollback

#### 实现
- [ ] 新文件: `src/commands/upgrade-recommend.ts`
- [ ] 更新: `src/commands/upgrade-apply.ts` 添加 --auto-backup
- [ ] 更新: `src/commands/upgrade-verify.ts` 添加 --compare-baseline
- [ ] 集成测试 (mock 升级场景)

**交付件**:
```
✓ src/commands/upgrade-recommend.ts
✓ src/commands/upgrade-*.ts (更新)
✓ docs/guides/UPGRADE_AUTOMATION.md
✓ 升级故障排查清单
✓ 集成测试
```

---

### 🚀 P0-3: Cortex 验证 Phase B (第 1-2 月, 并行)

**目标**: 量化 Cortex 改进效果 (期望 >20%)

#### 对标实验设计
- [ ] 对照组: 100 个 tasks (无 Cortex)
- [ ] 实验组: 100 个 tasks (有 Cortex)
- [ ] 随机分组
- [ ] 统计指标:
  - [ ] gate fail rate
  - [ ] 首次成功时间
  - [ ] 迭代次数
  
- [ ] 发布论文初稿 (可选)

**交付件**:
```
✓ docs/case-studies/CORTEX_EFFECTIVENESS_STUDY.md
✓ cortex_ab_test_data.csv
✓ 统计分析结果 (效果量化)
```

---

### 🚀 P1-6: 跨平台统一 (第 3-4 月)

**目标**: 废弃 PowerShell，全量 Node.js + Bash

#### 迁移工作
- [ ] 迁移脚本:
  - [ ] `scripts/workflow/verify.ps1` → `src/commands/verify.ts`
  - [ ] `scripts/bootstrap-scale.ps1` → `src/commands/bootstrap.ts`
  - [ ] `scripts/gates/*.sh` → Node.js modules
  
- [ ] 测试矩阵:
  - [ ] Linux (GitHub Actions)
  - [ ] macOS (GitHub Actions)
  - [ ] Windows (WSL2)
  
- [ ] 性能对标

**交付件**:
```
✓ Node.js 版脚本集
✓ CI/CD 测试矩阵 (3 平台)
✓ 迁移文档 + 性能对标
```

---

### 🚀 P1-4: 统一配置 DSL (第 5-6 月)

**目标**: 7 个 JSON 配置 → 1 个 governance.yaml

#### 设计与实现
- [ ] Schema 设计: `src/schema/governance.schema.json`
- [ ] 自动迁移工具: `src/commands/config-migrate.ts`
- [ ] 反向兼容性: 旧 JSON 文件仍可读 (过渡期 6 个月)
- [ ] 完整测试: 迁移后功能等价性

**交付件**:
```
✓ src/schema/governance.schema.json
✓ .scale/governance.yaml (新模板)
✓ src/commands/config-migrate.ts
✓ docs/guides/GOVERNANCE_DSL.md
✓ 迁移脚本 + 完整测试
```

---

## 长期任务（1年）

### 🚀 P1-3: Cortex 完全闭合 (第 7-12 月)

**目标**: 观察 → 反思 → 提取 → 保存 → 应用 全自动化

#### 里程碑
- [ ] 6 月: Phase A/B 数据完整，发布案例
- [ ] 8 月: 论文初稿，投会议
- [ ] 10 月: 发布生产级 Cortex
- [ ] 12 月: 社区反馈、持续改进

---

### 🚀 学术论文发表 (第 8-12 月)

**目标**: 发表工程化最佳实践论文

#### 论文方向
- [ ] "SCALE Engine: AI Agent Governance with Evidence-Driven Workflow"
- [ ] 主要贡献:
  - [ ] 23 个门禁体系设计
  - [ ] 证据链持久化方案
  - [ ] 多 Agent 协调框架
  - [ ] 大规模验证数据 (500+ agents)

#### 投稿目标
- [ ] FSE / ICSE / ICSME (一流会议)
- [ ] 预计 8-10 月完成投稿

---

### 🚀 插件生态建设 (第 6-12 月)

**目标**: 开放 3-5 个三方 skill 插件

#### 插件示例
- [ ] Slack 通知 skill
- [ ] Jira 集成 skill
- [ ] GitHub 议题自动化 skill
- [ ] 报告生成 skill
- [ ] 知识库集成 skill

#### 基础设施
- [ ] 开放 skill API
- [ ] Skill 市场 (registry)
- [ ] 文档 & 示例
- [ ] 社区招募 (RFC)

---

### 🚀 分析 Dashboard (第 9-12 月)

**目标**: 实时展示工作流健康度

#### 指标展示
- [ ] Gate pass rate by type
- [ ] Task score 分布
- [ ] Cortex ROI trend
- [ ] 平均 cycle time
- [ ] Defect 率趋势

#### 实现
- [ ] 后端: Node.js API
- [ ] 前端: React dashboard (可选)
- [ ] 数据源: evidence store

---

## 进度追踪

### 短期进度表 (3 个月)

| 周次 | 改进项 | 状态 | 负责人 | 备注 |
|------|--------|------|-------|------|
| W1-W2 | #1 Fast-lane | ⏳ 未开始 | ? | Priority: P0 |
| W3-W4 | #5 学习路径 | ⏳ 未开始 | ? | Priority: P1 |
| W5-W6 | #7 性能基准 | ⏳ 未开始 | ? | Priority: P1 |
| W7-W8 | #10-12 小改 | ⏳ 未开始 | ? | Priority: P3 |
| W9-W12 | #3 Cortex PA | ⏳ 未开始 | ? | Priority: P0 (并行) |

### 关键依赖

```
#1 Fast-lane
  ├─ 需依赖: 理解 .scale/verification.json
  └─ 影响: #2 升级 (需 fast-lane profile)

#5 学习路径
  ├─ 需依赖: 无
  └─ 影响: 整体可用性评分

#7 性能基准
  ├─ 需依赖: 无
  └─ 影响: #2 升级 (性能对标基础)

#3 Cortex PA
  ├─ 需依赖: 5 个项目选定
  └─ 影响: #3 PB / 论文 (12 个月后)
```

### 成功定义

| 改进项 | 完成标志 | 验证方法 |
|--------|--------|--------|
| #1 | S 级任务 < 2 min | `make gate --profile fast-lane` 耗时 < 120s |
| #3PA | 5 项目报告发布 | case-studies 文件夹有 5 份报告 |
| #5 | 新手完成时间 | 邀请 3 位新手，avg time < 30 min |
| #7 | 性能基线文档 | PERFORMANCE_BASELINE.md 发布 |

---

## 风险与缓解

| 风险 | 概率 | 缓解策略 |
|------|------|--------|
| Fast-lane 导致规范松动 | L | 明确的 gate 清单，教育 |
| Cortex 项目不配合 | M | 优先选择内部友好项目 |
| 跨平台性能下降 | M | 提前 benchmark，fallback 方案 |
| DSL 迁移数据丢失 | L | 反向兼容 + 自动化测试 |
| 性能测试不稳定 | M | 多次运行取中位数，控制环境 |

---

## 资源需求

### 人员
- PM 1 人（总协调）
- 工程师 2-3 人（并行实施）
- QA 1 人（测试）
- 社区运营 0.5 人（文档/视频）

**总投入**: ~8-10 人月

### 工具/基础设施
- 性能测试机 (1-2 台)
- 视频录制工具 (开源免费)
- YouTube / Bilibili 账号 (自有)

---

## 批准与激活

- [ ] 技术委员会 Review 和批准
- [ ] 分配资源 & 负责人
- [ ] 创建追踪看板 (GitHub Projects / Jira)
- [ ] 首周 kickoff 会议

---

**文档维护**: @hongmaple0820  
**最后更新**: 2026-06-03  
**下次审视**: 2026-09-03 (短期完成后)
