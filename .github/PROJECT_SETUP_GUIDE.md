# 📊 GitHub Project 看板设置指南

## 快速开始

本指南说明如何在 GitHub 上创建 SCALE Engine 改进项目看板。

### 前提条件
- GitHub 账户有 scale-engine 仓库的管理权限
- 使用最新版 GitHub (项目 v2.0+)

---

## 方法 1: 使用 CSV 导入（推荐）

### 步骤 1: 创建新的 Project

1. 进入 GitHub: https://github.com/hongmaple/scale-engine
2. 点击顶部菜单 **"Projects"** → **"New Project"**
3. 选择模板: **Table**
4. 项目名称: `SCALE Engine Improvements Roadmap`
5. 描述: `12-month improvement roadmap: Fast-lane, Cortex, DSL & more`
6. 点击 **"Create"**

### 步骤 2: 配置字段

在项目设置中，添加以下自定义字段：

```
字段名        | 类型           | 选项
─────────────┼────────────────┼──────────────────
Title         | Text (default) | -
Status        | Single Select  | 📋 Backlog, 🚀 Ready, 🔨 In Progress, ✅ Done, ❌ Blocked
Priority      | Single Select  | P0 Critical, P1 High, P2 Medium, P3 Low
Phase         | Single Select  | Short-term (Q3), Mid-term (Q4-Q1), Long-term (Q2-Q3)
Effort        | Single Select  | S (Small), M (Medium), L (Large), XL (Extra Large)
Epic          | Single Select  | P0-1, P0-2, P0-3a, P0-3b, P0-4, P1-5, P1-6, P1-7, P1-8, P1-9, P3-10/11/12, P3-13, Long-term
Week          | Text           | -
Start Date    | Date           | -
Target Date   | Date           | -
```

### 步骤 3: 导入任务

1. 下载 CSV 文件: `.github/project-import.csv`
2. 在 Project 中，点击菜单 ⋯ → **"Import from CSV"**
3. 选择下载的 CSV 文件
4. 映射字段（应该自动对齐）
5. 点击 **"Import"**

### 步骤 4: 创建视图

项目设置 → 添加以下视图：

#### 视图 1: **Roadmap Timeline**
- 布局: Roadmap (如果支持)
- 按 Target Date 排序
- 筛选: Status != Done

#### 视图 2: **By Priority**
- 布局: Table
- 分组: Priority
- 排序: Start Date

#### 视图 3: **Short-term Tasks (Q3)**
- 布局: Table
- 筛选: Phase = "Short-term (Q3)" AND Status != Done
- 排序: Week, Priority

#### 视图 4: **In Progress**
- 布局: Table
- 筛选: Status = "🔨 In Progress"
- 排序: Priority, Start Date

#### 视图 5: **Completed**
- 布局: Table
- 筛选: Status = "✅ Done"
- 排序: Target Date (desc)

---

## 方法 2: 手动创建（如需细微调整）

如果 CSV 导入不完美，可手动创建任务：

### 短期任务 (Q3 2026)

**Issue 1: #1 Fast-lane Profile MVP**
```markdown
## Task
- [ ] Analyze profile structure
- [ ] Design fast-lane config
- [ ] Implement scripts
- [ ] Testing (<120s latency)
- [ ] Documentation
- [ ] Code review & merge

## Acceptance Criteria
- Gate execution <120s for S-level tasks
- FAST_COMMIT_GUIDE.md created
- Unit + integration tests pass
- PR merged with evidence.md
```

**Issue 2: #5 Learning Path**
```markdown
## Task
- [ ] Design 5 skill levels
- [ ] Write LEARNING_PATH.md
- [ ] Record 3 videos
- [ ] Interactive onboard command
- [ ] README updates

## Acceptance Criteria
- 5 learners complete in <30 min (avg)
- 3+ videos published
- scale onboard --interactive works
```

... (其他任务类似)

---

## 自动化配置

### GitHub Actions 工作流

创建 `.github/workflows/project-sync.yml`:

```yaml
name: Sync Issues to Project

on:
  issues:
    types: [opened, labeled]
  pull_request:
    types: [opened]

jobs:
  add-to-project:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/add-to-project@v0.5.0
        with:
          project-url: https://github.com/hongmaple/scale-engine/projects/1
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 标签自动化

在项目中启用规则 (Automation):

```
当 Priority = "P0 Critical" 时
  → 添加到 "Ready" 视图
  → 自动分配给对应所有者

当 Status = "Done" 时
  → 移至完成视图
  → 自动生成 metrics 报告
```

---

## 看板最佳实践

### 列管理 (Status)

```
📋 Backlog      → 已分类但未分配资源
🚀 Ready        → 资源已分配，等待 W1 启动
🔨 In Progress  → 正在开发中
✅ Done         → 已完成，交付件已验收
❌ Blocked      → 卡住，需要排除阻力
```

### 优先级管理

- **P0 Critical**: 直接影响项目成败，必做
  - 例: Fast-lane, Cortex, Upgrade Auto, DSL
- **P1 High**: 显著改善体验或市场地位
  - 例: Learning Path, Performance, Cross-platform
- **P2 Medium**: 可选改进，提升竞争力
  - 例: Multi-Agent, i18n
- **P3 Low**: 锦上添花，可后移
  - 例: Small improvements, ROI Dashboard

### 更新频率

- **周**: 每周一更新 In Progress 任务
- **周五**: 更新完成任务，计算周进度
- **月初**: 计划下个月任务，更新时间表
- **月末**: 生成月度报告，识别风险

---

## 关键指标

### 追踪指标

在 Project README 中维护:

```markdown
### 项目进度

**总体**: 14 / 14 任务 (0% 完成)
- P0 Critical: 5 / 5 (0%)
- P1 High: 5 / 5 (0%)
- P2 Medium: 2 / 2 (0%)
- P3 Low: 2 / 2 (0%)

### 阶段进度

**Short-term (Q3)**:
- 目标评分: 7.4 → 8.0
- 计划周数: 12 周 (W1-W12)
- 开始: 2026-06-17
- 目标: 2026-09-17

**Mid-term (Q4-Q1)**:
- 目标评分: 8.0 → 8.4
- 计划周数: 26 周 (M1-M6)
- 开始: 2026-09-18
- 目标: 2027-02-03

**Long-term (Q2-Q3)**:
- 目标评分: 8.4 → 8.5
- 计划周数: 18 周 (Q2-Q3)
- 开始: 2027-02-04
- 目标: 2027-06-03
```

### 风险指标

监控以下风险:

```markdown
| 风险 | 信号 | 阈值 | 行动 |
|------|------|------|------|
| 延期 | 4+ 项任务 >1 周延期 | - | 调整时间表 |
| 质量 | 3+ Review 复查 | - | 增强测试 |
| 人力 | PM/工程师 > 80% 忙碌 | - | 请求支持 |
| Cortex | 改进 < 15% | 20% | 扩展试点 |
```

---

## 与文档同步

### 相关文档

- 📄 `docs/workflow/EXECUTIVE_SUMMARY.md` - 决策级摘要
- 📄 `docs/workflow/IMPROVEMENT_ROADMAP.md` - 技术细节
- 📄 `docs/workflow/IMPROVEMENT_CHECKLIST.md` - 逐项清单
- 📄 `docs/workflow/ASSESSMENT_INDEX.md` - 文档导航

### 定期同步

- 每月: Project 进度 → IMPROVEMENT_CHECKLIST.md
- 每季度: 重新评估 → EXECUTIVE_SUMMARY.md
- 重大变化: Issue → GitHub Discussions

---

## 导出与报告

### 生成周报

```bash
# 导出本周 In Progress 任务
gh project list --assignee @me --status "In Progress" --format md > weekly-report.md
```

### 生成月报

```bash
# 导出本月完成任务 + 待做项
gh project view 1 --format json | jq '.items[] | select(.status=="Done")' > monthly-done.json
```

### 导出甘特图

GitHub Project 原生支持 Roadmap 视图（Timeline），可直接导出 PNG。

---

## 常见问题

### Q: CSV 导入失败？
A: 确保字段名称精确匹配。如有特殊字符，用双引号包围。

### Q: 如何关联 PR？
A: 在 PR 描述中添加 `Closes #123` 或 `Related #123`，Project 会自动同步。

### Q: 如何批量更新状态？
A: 选中多个任务 → 右键 → "Bulk edit" → 更新状态。

### Q: 如何分配所有者？
A: 在项目中添加 "Assignees" 字段，或在 GitHub Issue 中分配。

---

## 后续步骤

1. ✅ 创建 Project
2. ✅ 配置字段
3. ✅ 导入 CSV 任务
4. ✅ 创建 5 个视图
5. ✅ 设置自动化规则
6. ✅ 分配所有者
7. ✅ W1 (2026-06-17) 正式启动
8. ✅ 建立周会查看时间表

---

**下载 CSV**: `.github/project-import.csv`  
**配置文件**: `.github/project-config.json`  
**维护者**: @hongmaple0820  
**最后更新**: 2026-06-03
