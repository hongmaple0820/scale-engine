# 场景 × 规范矩阵（Scenario Matrix）

Status: P2-C implemented（`scale product scenarios`）
Scope: 回答「不同场景/项目形态下，SCALE 的约束规范、架构规范、治理覆盖到哪、缺什么」

`scale product scenarios [--json]` 输出本矩阵；`src/product/ScenarioMatrix.ts` 是唯一数据源，
测试 `tests/product/scenarioMatrix.test.ts` 校验其结构。

## 矩阵

| 场景 | 项目形态 | 治理 pack | 关键资产 | 覆盖 |
| --- | --- | --- | --- | --- |
| 编程 · 单体 Web/Node | 前端 / Node 库 | `frontend-app`, `node-library` | impeccable, ui-ux-pro-max | ✅ covered |
| 编程 · 单体后端 | Java/Spring, Python | `spring-vue-admin`, `python-service` | 架构标准, SQL 迁移评审 | ✅ covered |
| 编程 · 企业后台 | 单体/管理后台 | `enterprise-admin` | RBAC/租户/审计/模块归属 | ✅ covered |
| 编程 · 微服务 | gateway/auth/admin/worker | `microservice-platform` | 服务归属, 契约评审, 发布顺序 | ✅ covered |
| 编程 · 桌面应用 | Electron/Tauri | `desktop-app` | OS 访问, 安装器, 密钥存储 | ✅ covered |
| 编程 · Agent OS 产品 | Agent 工作台 | `agent-os-workbench` | tools/memory/sessions/dashboard | ✅ covered |
| 编程 · Monorepo / MOE 多仓 | monorepo / 多仓 | — | workspace topology, Cross-Repo Orchestrator, Session Coordinator | ⚠️ partial |
| 自媒体 · 内容生产 | 图文/短视频 | — | media 受治理动作 M0–M5, wewrite, huashu-motion | ⚠️ partial |
| 办公 · 企业应用/文档 | CRUD/RBAC/文档 | — | product blueprints, docs-health, DOCUMENT_STANDARDS | ⚠️ partial |

统计：covered 6 / partial 3 / gap 0（共 9 行）。

## 缺口与补齐策略

按「已有资产直接填 / 需要新 pack / 明确不做」三类：

| 缺口 | 现状 | 策略 |
| --- | --- | --- |
| Monorepo / MOE 多仓无专属 pack | workspace topology + 多仓编排已具备，但无模板化 governance pack | **已有资产直接填**：从现有 workspace/Cross-Repo 能力提炼 `monorepo-platform` pack（下一迭代，P3 候选） |
| 自媒体内容生产 | media 域 M0–M5（审批/预算/成本账本/成片）已落地；wewrite/huashu skills 可用；缺面向自媒体用户的场景包装 | **需要新 pack**：`content-media` governance pack —— 把「选题→脚本→生图/生视频→发布包」串成带审批的规范化闭环 |
| 办公场景 | product blueprints（identity/RBAC/tenant/audit）+ 文档健康检查已有；缺办公自动化场景包装 | **需要新 pack**：`office-automation` pack（表单/审批/文档流转 + 资源治理） |

## 设计原则

- **诚实标注**：partial 就是 partial，不把「有底层能力但无场景包装」标成 covered。
- **数据驱动**：矩阵由 `ScenarioMatrix.ts` 静态声明，`scale product scenarios --json` 可被 dashboard / CI 消费。
- **可扩展**：新增 pack（如 `content-media`）时同步在 `ROWS` 追加一行即可，测试会守护总数一致性。

## 与安装的联动

`scale install --governance-pack <pack>` 可选上述任一 covered pack。partial 场景（自媒体/办公/MOE）
当前需组合现有资产手动配置，待对应 pack 落地后自动纳入 `scale install` 推荐。
