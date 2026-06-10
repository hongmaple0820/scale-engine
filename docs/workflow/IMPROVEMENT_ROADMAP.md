# SCALE Engine 工作流改进路线图

**版本**: 1.0  
**生成日期**: 2026-06-03  
**基于**: 完整评估报告  
**维护者**: @hongmaple0820/scale-engine  

---

## 执行摘要

本文档基于对 SCALE Engine 工作流的深入评估，提出 **13 项核心改进建议**，分三个时间段实施：

- **短期（3个月）**：提升可用性、发布用户案例、性能透明化
- **中期（6个月）**：简化架构、统一配置、强制多代理协调
- **长期（1年）**：构建生态、自进化、学术验证

**综合评分**：7.4/10 → **目标 8.5/10**（12个月内）

---

## 评估基线

| 维度 | 得分 | 状态 |
|------|-----|------|
| 架构设计 | 9/10 | ✅ 领先 |
| 证据驱动 | 9/10 | ✅ 领先 |
| 闭环完整性 | 8/10 | ✅ 完整 |
| 市面对标 | 7.5/10 | ⚠️ 需验证 |
| 可用性 | 6/10 | ❌ 高学习成本 |
| 实际落地 | 6/10 | ❌ 缺用户反馈 |
| **综合** | **7.4/10** | ⚠️ 新兴阶段 |

---

## Tier 1 改进项（严重问题）

### 1. 超门禁疲劳 → Fast-lane 模式
**优先级**: P0 | **工作量**: M | **影响**: 高 | **难度**: 中

#### 问题
- 23个门禁对 S 级任务（typo、注释）过重
- 小改动也需完整跑 G0-G22，开发效率↓30%

#### 方案
```yaml
# 新增 profile: fast-lane
profiles:
  fast-lane:      # S级任务
    gates: [G0, G3, G4, G5]        # 仅验证构建+测试+lint
    skip: [G1, G2, G6-G22]         # 跳过规划、证据、治理
    evidence_required: false
    
  standard:       # M级任务  
    gates: [G0-G8]                 # 核心门禁
    skip: [G9-G22]
    
  comprehensive:  # L级任务
    gates: [G0-G22]                # 全量门禁
    evidence_required: true
```

#### 执行步骤
1. [ ] 修改 `.scale/verification.json` 新增 `fast-lane` profile
2. [ ] 更新 `scripts/gates/all.sh` 支持 `--profile fast-lane`
3. [ ] 在 DEVELOPMENT_WORKFLOW.md 新增"快速提交流程"章节
4. [ ] 更新 Makefile: `make gate --profile fast-lane`
5. [ ] 编写 3 个快速提交案例（文档/注释/配置）

#### 验证
```bash
make new-task NAME=typo-fix LEVEL=S
make gate-workflow --profile fast-lane
# 期望: 仅运行 G0,G3,G4,G5，<2min 完成
```

#### 交付件
- `docs/guides/FAST_COMMIT_GUIDE.md`
- 更新 `DEVELOPMENT_WORKFLOW.md` 第3章

---

### 2. 升级路径脆弱 → 自动化决策
**优先级**: P0 | **工作量**: L | **影响**: 高 | **难度**: 高

#### 问题
```
upgrade-check → [WAIT FOR MANUAL DECISION] → plan → [WAIT] → apply → [RISK]
```
- 人工决策点多（检查后、计划后）
- 失败回滚复杂（rollback可能不完整）
- 升级性能对比缺失

#### 方案
```
scale upgrade check
  ↓ [自动分析风险]
scale upgrade recommend  # 新增：自动推荐
  ↓ [自动生成对标数据]
scale upgrade apply --auto-backup  # 新增：自动备份
  ↓ [异步验证]
scale upgrade verify --compare-baseline  # 新增：性能对标
```

#### 执行步骤
1. [ ] 新增 `scale upgrade recommend` 命令
   - 分析当前版本→目标版本的改动
   - 计算风险分数（基于breaking changes）
   - 生成自动化应用计划
   
2. [ ] 新增 `--auto-backup` 参数
   - apply 前自动创建 backup branch
   - 记录升级前后的 git state
   
3. [ ] 新增 `--compare-baseline` 验证
   - 升级后自动对比性能指标
   - gate latency、test time、build time
   - 超阈值自动触发 rollback
   
4. [ ] 编写升级故障处理文档
   - 常见失败模式
   - 手工回滚步骤
   - 求助入口

#### 验证
```bash
make bootstrap-scale VERSION=next
scale upgrade check --dir .
scale upgrade recommend --auto-apply  # 建议自动执行
# 期望: apply 成功 → verify 通过 → 性能对标OK
```

#### 交付件
- `src/api/commands/upgrade-recommend.ts`
- `docs/guides/UPGRADE_AUTOMATION.md`
- 升级故障排查清单

---

### 3. Cortex 进化未验证 → 补充验证与案例
**优先级**: P0 | **工作量**: L | **影响**: 高 | **难度**: 中

#### 问题
- `scale cortex evolve/extract/inject` 都是概念代码
- 无实战数据、无用户案例、无性能基准
- Tier 1 架构特性无法被信任

#### 方案（分阶段验证）

**Phase A: 实战验证（2个月）**
```
运行 Cortex 完整周期
  ├─ 观察: 5个真实项目的 gate 日志
  ├─ 反思: 提取失败模式（自动化）
  ├─ 提取: 生成 Instincts
  ├─ 保存: 存入 knowledge base
  └─ 应用: 对标新项目的改进效果
```

**Phase B: 效果量化（1个月）**
```
对比
  ├─ 有 Cortex: 平均 gate fail rate
  ├─ 无 Cortex: 对照组 gate fail rate
  ├─ 期望差异: >20% 改进
  └─ 统计: 样本量≥100 tasks
```

#### 执行步骤
1. [ ] 选择 5 个真实项目作为试点
   - 包含不同规模（S/M/L）
   - 记录 baseline（未启用 Cortex）
   
2. [ ] 启用 Cortex 完整周期（2个月）
   ```bash
   scale cortex evolve --project <test-project> --observe-mode on
   ```
   
3. [ ] 收集数据
   - gate fail rate trend
   - 失败模式分布
   - Instinct 质量评分
   
4. [ ] 发布案例文档
   - 每个项目 1 份报告
   - 效果对标表格
   - Instinct 示例（脱敏）
   
5. [ ] 编写性能指南
   - Cortex 开销评估（CPU/存储）
   - 性能优化建议
   - ROI 计算模型

#### 验证
```bash
# 运行对标报告
scale cortex metrics --days 60 --compare-baseline
# 期望输出:
# - gate fail rate: 12% → 8% (↓33%)
# - 常见失败模式: Top 5 patterns
# - Instinct 应用次数: X times
```

#### 交付件
- `docs/case-studies/CORTEX_VALIDATION_REPORT.md` (综合报告)
- `docs/case-studies/cortex-project-*.md` (5 份项目报告)
- `docs/guides/CORTEX_BEST_PRACTICES.md` (最佳实践)
- Cortex ROI 计算工具（可选）

---

### 4. 治理证据碎片化 → 统一配置 DSL
**优先级**: P1 | **工作量**: XL | **影响**: 高 | **难度**: 高

#### 问题
```
当前分散:
  ├─ .scale/verification.json (profile 定义)
  ├─ .scale/skills.json (skill 路由)
  ├─ .scale/tools.json (工具编排)
  ├─ .scale/frameworks.json (框架约定)
  ├─ .scale/engineering-standards.json (标准规则)
  ├─ .scale/resource-policy.json (资源治理)
  └─ SCALE_POLICY.md (Orchestrator policy)
  
现象: 规则分散、决策逻辑难以理解、配置冲突难定位
```

#### 方案：统一 YAML DSL
```yaml
# .scale/governance.yaml (替代 7 个配置文件)

version: "2.0"

# Tier 1: Profile 定义
profiles:
  fast-lane:
    description: "S级任务快速通道"
    gates: [G0, G3, G4, G5]
    evidence_required: false
    max_changes: 10
    skip_gates: [G1, G2, G6-G22]
    
  standard:
    description: "M级常规任务"
    gates: [G0-G8]
    evidence_required: true
    
  comprehensive:
    gates: [G0-G22]
    evidence_required: true

# Tier 2: Gate 配置
gates:
  G0:
    name: "Build"
    command: "npm run build"
    timeout_secs: 300
    blocking: true
    
  G1:
    name: "Exploration"
    rules:
      min_files_read: 3
      require_contradiction: true
    blocking: false

# Tier 3: 工具编排
tools:
  eslint:
    gates: [G4]
    enabled_by_default: true
    alternatives: [prettier, stylint]
    
  vitest:
    gates: [G5]
    max_workers: 4

# Tier 4: 工程标准
engineering_standards:
  typescript:
    min_coverage: 75
    strict_mode: true
  documentation:
    required_for: [L, CRITICAL]
    link_validation: true

# Tier 5: 资源治理
resources:
  context_budget_tokens: 2400
  workspace_max_age_hours: 24
  parallel_workspaces: 3

# Tier 6: 编排策略
orchestration:
  tracker: github
  polling_interval_ms: 30000
  agent_model: "claude-sonnet-4-6"
```

#### 执行步骤
1. [ ] 设计 `governance.yaml` schema
   - JSON schema 定义（用于 IDE 验证）
   - 示例模板（5 个 governance profile）
   
2. [ ] 迁移现有配置
   - 解析 7 个 JSON 文件 → 新 YAML
   - 自动化迁移脚本
   - 反向兼容性检查（旧配置仍可读）
   
3. [ ] 更新 CLI
   - `scale config validate --format yaml`
   - `scale config migrate --from json --to yaml`
   - `scale config diff` (对比两个 governance 版本)
   
4. [ ] 文档与教程
   - `docs/guides/GOVERNANCE_DSL.md` (完整手册)
   - 配置最佳实践 (3-5 个真实场景)
   - 迁移指南 (旧→新)

#### 验证
```bash
# 验证新 YAML 等价于旧 JSON 配置
make bootstrap-scale --governance-format yaml
make verify PROFILE=default
scale gates status --json | jq '.gates | length'  # 应为 23
```

#### 交付件
- `src/schema/governance.schema.json`
- `.scale/governance.yaml` (新模板)
- `src/commands/config-migrate.ts`
- `docs/guides/GOVERNANCE_DSL.md`
- 迁移脚本 & 测试

---

## Tier 2 改进项（中等问题）

### 5. 可用性曲线陡 → 分阶段教程
**优先级**: P1 | **工作量**: M | **影响**: 中 | **难度**: 低

#### 执行步骤
1. [ ] 创建学习路径 `docs/guides/LEARNING_PATH.md`
   - Level 1 (15 min): make preflight / make verify
   - Level 2 (30 min): make new-task / make plan / make explore
   - Level 3 (45 min): make gate-workflow / make gate-quality
   - Level 4 (60 min): scale orch / scale shield
   - Level 5 (90 min): scale cortex / scale ai-os

2. [ ] 制作 3 个视频（每个 5-10 分钟）
   - 新手快速开始
   - 常见失败案例排查
   - Cortex 完整演示

3. [ ] 创建交互式 CLI 向导
   ```bash
   scale onboard --interactive
   # 引导: workflow 类型? 项目规模? 使用频率? → 推荐 profile
   ```

#### 交付件
- `docs/guides/LEARNING_PATH.md`
- 3 个视频教程（5-10 分钟）
- `src/commands/onboard.ts` (交互式向导)
- FAQ 更新

---

### 6. 跨平台脆弱 → 统一运行时
**优先级**: P1 | **工作量**: L | **影响**: 中 | **难度**: 高

#### 问题
- PowerShell + Bash 混用
- Windows/Mac/Linux 差异处理不一致
- 用户 PATH/环境变量 问题常见

#### 方案
```
废弃 PowerShell 脚本 → 全量 Node.js + Bash
├─ scripts/gates/* → Node.js (cross-platform)
├─ scripts/workflow/* → Node.js (cross-platform)
├─ scripts/bootstrap-scale.ps1 → Node.js
└─ Makefile → Node.js CLI (npm scripts)
```

#### 执行步骤
1. [ ] 将 `scripts/workflow/verify.ps1` 迁移到 `src/commands/verify.ts`
2. [ ] 将 `scripts/gates/*.sh` 迁移到 Node.js 模块
3. [ ] 更新 Makefile → npm scripts
4. [ ] 完整测试 (Win/Mac/Linux)
5. [ ] 性能对标（Node 版 vs Bash 版）

#### 交付件
- Node.js 版本的所有脚本
- CI/CD 测试矩阵（3 个平台）
- 迁移文档

---

### 7. 性能开销未评估 → 透明化与优化
**优先级**: P1 | **工作量**: M | **影响**: 中 | **难度**: 中

#### 执行步骤
1. [ ] 发布性能基准
   ```markdown
   # Gate Latency Baseline
   - G0 (Build): 45s ± 5s
   - G1 (Explore): <1s (check only)
   - G4 (Lint): 8s ± 2s
   - G5 (Tests): 120s ± 30s
   - Total (G0-G8): 200s ± 50s
   ```

2. [ ] 异步化 evidence 录制
   - 不阻塞 gate 执行
   - 后台上传 evidence store

3. [ ] Gate 并行化
   - 无依赖的 gate 并行运行
   - 预期总耗时 ↓20%

#### 交付件
- `docs/PERFORMANCE_BASELINE.md`
- 性能监控 dashboard（可选）
- 优化 PR

---

### 8. 多代理协调 (G13/G14) 强制化
**优先级**: P2 | **工作量**: M | **影响**: 中 | **难度**: 中

#### 问题
- G13/G14 仅建议，无法保证多 Agent 间的一致性
- 无 session 间协调证据

#### 方案
```yaml
# G13: Multi-Agent Coordination → 改为阻断
G13:
  name: "Multi-Agent Coordination"
  blocking: true
  required_evidence:
    - session_ids: [s1, s2, s3]
    - shared_context: verified
    - conflict_log: []
    - coordination_record: session-coordinator-*.json

# G14: Skill Usage → 改为阻断 (for L/CRITICAL)
G14:
  name: "Skill Selection & Verification"
  blocking: true
  applies_to: [L, CRITICAL]
  required: "skill usage matrix"
```

#### 执行步骤
1. [ ] 强制记录 session 间依赖
2. [ ] 生成 coordination-record.json
3. [ ] 更新 G13/G14 检查逻辑
4. [ ] 测试 L/CRITICAL 任务多 Agent 场景

#### 交付件
- 更新的 G13/G14 脚本
- Session coordinator 文档

---

### 9. 知识库集成 (G9) 轻量化
**优先级**: P2 | **工作量**: M | **影响**: 中 | **难度**: 高

#### 问题
- G9 依赖外部 gbrain/Graphify
- 无系统时报 "blocked"，体验差

#### 方案
```
新增本地 fallback:
├─ 无 gbrain → 本地 SQLite 知识库
├─ 无 Graphify → 本地 AST 索引
└─ 定期同步到 cloud （可选）
```

#### 执行步骤
1. [ ] 实现本地知识库 (SQLite)
   - 存储历史 task/decision
   - 支持全文搜索
   
2. [ ] 轻量级 AST 索引
   - codebase 结构缓存
   - 增量更新
   
3. [ ] G9 fallback 逻辑
   ```
   if gbrain_available:
     use gbrain
   elif graphify_available:
     use graphify
   else:
     use local_sqlite  # fallback
   ```

#### 交付件
- `src/knowledge/local-kb.ts`
- G9 fallback 实现
- 文档

---

## Tier 3 改进项（可优化）

### 10. Token 预算 (G21) 强制化
**优先级**: P3 | **工作量**: S | **影响**: 低 | **难度**: 低

从 advisory → 阻断（L/CRITICAL 任务）

### 11. Session 健康 (G22) 细粒度信号
**优先级**: P3 | **工作量**: M | **影响**: 低 | **难度**: 中

```
当前: worktree 泄露检查太粗糙
新增:
  ├─ context window utilization trend
  ├─ memory growth rate
  ├─ connection pool health
  └─ 建议: 何时清理、何时 checkpoint
```

### 12. 文档链接卫生 (G17) 强制化
**优先级**: P3 | **工作量**: S | **影响**: 低 | **难度**: 低

从 advisory → 阻断（变更 Markdown 文件强制校验）

### 13. ROI 仪表板
**优先级**: P3 | **工作量**: L | **影响**: 中 | **难度**: 高

实时展示:
```
├─ Total tasks: X
├─ Average cycle time: Y hours
├─ Defect rate trend: ↓ Z%
├─ Gate pass rate by type
└─ Cortex ROI: 节省 X% 时间
```

---

## 实施时间表

### 短期（3个月）= Q3 2026

| 周次 | 改进项 | 主要任务 | 交付件 |
|------|--------|--------|--------|
| W1-W2 | #1 Fast-lane | 新增 profile，测试 S 级任务 | FAST_COMMIT_GUIDE.md |
| W3-W4 | #5 学习路径 | 3 个视频，LEARNING_PATH.md | onboard CLI |
| W5-W6 | #7 性能基准 | 测量所有 gate，发布基线 | PERFORMANCE_BASELINE.md |
| W7-W8 | #10-12 小改进 | G21/G22/G17 升级 | 3 个 gate 脚本更新 |
| W9-W12 | #3 Cortex 验证 Phase A | 选 5 项目，跑 2 个月验证 | 项目对标报告 |

**短期交付预期**: +1.0 分（7.4 → 8.4）

### 中期（6个月）= Q4 2026

| 月次 | 改进项 | 主要任务 |
|------|--------|--------|
| M1-M2 | #2 升级自动化 | recommend/auto-backup/compare-baseline |
| M2-M3 | #3 Cortex 验证 Phase B | 效果量化，发布案例 |
| M3-M4 | #6 跨平台统一 | PS → Node.js 迁移 |
| M5-M6 | #4 DSL 统一 | governance.yaml 设计与迁移 |

**中期预期**: +0.8 分（8.4 → 9.2，但需验证）

### 长期（1年）= 2027

| 项目 | 目标 |
|------|------|
| #3 Cortex 完全闭合 | 自进化循环可信 |
| 学术论文 | 发布工程化实践论文 |
| 生态建设 | 开放插件 API，3-5 个三方 skill |
| 大规模验证 | 500+ Agent tasks 性能基准 |

**长期预期**: +0.3 分（最终 9.5/10）

---

## 成功指标

| 指标 | 当前 | 目标（12个月） | 验证方法 |
|------|------|--------|---------|
| 综合评分 | 7.4/10 | 8.5/10 | 重新评估 |
| 新手上手时间 | 2 小时 | 30 分钟 | user study |
| Gate 平均耗时 | 200s | <170s | latency monitoring |
| Cortex 改进率 | 0% | >20% | A/B 对标 |
| 用户案例 | 0 | 5+ | 文档与社区反馈 |
| 插件生态 | 0 | 3-5 个 | 三方贡献 |

---

## 决策与风险

### 关键决策
- **DSL 统一 (#4)**：breaking change，需过渡期（向后兼容 6 个月）
- **Cortex 验证 (#3)**：需真实项目，无法 mock 效果
- **跨平台 (#6)**：性能新因素，需完整回归测试

### 风险与缓解
| 风险 | 概率 | 缓解策略 |
|------|------|--------|
| 性能退化（Fast-lane 引入复杂度） | M | 性能测试环节、回滚计划 |
| 升级自动化失败 | M | alpha 用户反馈、手工回滚文档 |
| 知识库本地化失败 | L | 保留外部系统 fallback |

---

## 相关文档

- [GATES_AND_SCORE.md](GATES_AND_SCORE.md) - 当前 23 个门禁定义
- [DEVELOPMENT_WORKFLOW.md](../guides/DEVELOPMENT_WORKFLOW.md) - 开发流程标准
- [CORTEX.md](../CORTEX.md) - Cortex 架构详解
- [UPGRADE_MANAGEMENT.md](../UPGRADE_MANAGEMENT.md) - 升级管理（需更新）

---

## 下一步行动

1. **立即行动**（本周）
   - [ ] Review 本文档，评估优先级是否合理
   - [ ] 为 #1 Fast-lane 创建任务卡
   - [ ] 为 #5 学习路径创建任务卡

2. **一周内**
   - [ ] 启动 Fast-lane 实现（预计 1 周）
   - [ ] 启动 Cortex 项目选择（预计 3 天）

3. **二周内**
   - [ ] Fast-lane 功能冻结、测试
   - [ ] 学习路径大纲评审

---

## 附录：配置示例

### 示例 1: Fast-lane Profile 配置

```json
{
  "profiles": {
    "fast-lane": {
      "name": "S级快速通道",
      "description": "typo/注释/小配置改动快速提交",
      "gates": ["G0", "G3", "G4", "G5"],
      "skip": ["G1", "G2", "G6", "G7", "G8", "G9-G22"],
      "evidence_required": false,
      "max_changed_files": 10,
      "max_diff_size_kb": 50
    }
  }
}
```

### 示例 2: 升级命令用法

```bash
# 检查升级
scale upgrade check --dir . --json

# 获取建议（新增）
scale upgrade recommend --auto-analysis
# 输出: 
# - Risk score: 0.3/10 (低风险)
# - Breaking changes: 0
# - Compatibility: 100%

# 应用（带备份）
scale upgrade apply --auto-backup

# 验证（带性能对标）
scale upgrade verify --compare-baseline
```

### 示例 3: 统一 DSL 配置片段

```yaml
# .scale/governance.yaml
version: "2.0"

profiles:
  fast-lane:
    gates: [G0, G3, G4, G5]
    evidence_required: false

gates:
  G0:
    name: "Build Verification"
    blocking: true
    timeout_secs: 300

engineering_standards:
  typescript:
    min_coverage: 75
```

---

**文档维护者**: @hongmaple0820  
**最后更新**: 2026-06-03  
**下次评估**: 2026-09-03
