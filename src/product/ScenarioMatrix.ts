// SCALE Engine — P2-C 场景 × 规范矩阵
//
// 回答 Q4：「不同场景（编程/自媒体/办公）× 项目形态（单体/微服务/monorepo）下，
// governance pack / blueprint / skills 覆盖到哪、缺什么」。矩阵成文 + 可 JSON 输出，
// 让覆盖缺口可见、可补，而不是靠口头承诺。
//
// 纯函数：不读磁盘，覆盖状态基于仓库既有资产（pack 名、product blueprints、media 域、
// skills）的静态声明，便于单测与文档同步。

export type ScenarioId = 'coding' | 'media' | 'office' | 'agent-os'
export type Coverage = 'covered' | 'partial' | 'gap'

export interface ScenarioRow {
  scenario: ScenarioId
  scenarioLabel: string
  form: string
  packs: string[]
  assets: string[]
  coverage: Coverage
  note: string
}

export interface ScenarioMatrixReport {
  version: number
  rows: ScenarioRow[]
  summary: { covered: number; partial: number; gap: number; total: number }
  gaps: string[]
}

const ROWS: ScenarioRow[] = [
  {
    scenario: 'coding',
    scenarioLabel: '编程 · 单体 Web/Node',
    form: '单体（前端/Node 库）',
    packs: ['frontend-app', 'node-library'],
    assets: ['impeccable', 'ui-ux-pro-max'],
    coverage: 'covered',
    note: 'UI 边界、视觉证据、可访问性、打包检查均有 pack 指导。',
  },
  {
    scenario: 'coding',
    scenarioLabel: '编程 · 单体后端 (Spring/Vue, Python)',
    form: '单体（Java/Spring, Python）',
    packs: ['spring-vue-admin', 'python-service'],
    assets: ['架构标准', 'SQL 迁移评审'],
    coverage: 'covered',
    note: '后端分层、路由/API 边界、静态检查与定向测试门禁。',
  },
  {
    scenario: 'coding',
    scenarioLabel: '编程 · 企业后台',
    form: '单体 / 管理后台',
    packs: ['enterprise-admin'],
    assets: ['RBAC', '租户', '审计', '模块归属'],
    coverage: 'covered',
    note: 'RuoYi-Vue-Plus 式企业后台的 RBAC/租户/审计/模块归属。',
  },
  {
    scenario: 'coding',
    scenarioLabel: '编程 · 微服务',
    form: '微服务（gateway/auth/admin/worker）',
    packs: ['microservice-platform'],
    assets: ['服务归属', '契约评审', '发布顺序'],
    coverage: 'covered',
    note: '服务所有权、契约评审、发布排序。',
  },
  {
    scenario: 'coding',
    scenarioLabel: '编程 · 桌面应用',
    form: '桌面（Electron/Tauri）',
    packs: ['desktop-app'],
    assets: ['OS 访问', '安装器', '密钥存储', '跨平台路径'],
    coverage: 'covered',
    note: 'OS 访问、安装器、密钥存储、跨平台路径评审。',
  },
  {
    scenario: 'coding',
    scenarioLabel: '编程 · Monorepo / MOE 多仓',
    form: 'monorepo / MOE 多仓',
    packs: [],
    assets: ['workspace topology', 'Cross-Repo Orchestrator', 'Session Coordinator'],
    coverage: 'partial',
    note: '有 workspace 拓扑与多仓编排能力，但缺专属 governance pack 模板。',
  },
  {
    scenario: 'media',
    scenarioLabel: '自媒体 · 内容生产',
    form: '图文 / 短视频',
    packs: [],
    assets: ['media 受治理动作 M0–M5', 'wewrite', 'huashu-motion'],
    coverage: 'partial',
    note: '媒体动作目录 + 审批/预算/成本账本已具备；缺一个面向自媒体用户的 content-media governance pack。',
  },
  {
    scenario: 'office',
    scenarioLabel: '办公 · 企业应用/文档',
    form: 'CRUD / RBAC / 文档治理',
    packs: [],
    assets: ['product blueprints (identity/tenant/audit)', 'docs-health', 'DOCUMENT_STANDARDS'],
    coverage: 'partial',
    note: '有解决方案蓝图与文档健康检查；缺一个办公场景的 office-automation pack。',
  },
  {
    scenario: 'agent-os',
    scenarioLabel: '编程 · Agent OS 产品',
    form: 'Agent 工作台 / 工具编排',
    packs: ['agent-os-workbench'],
    assets: ['tools', 'memory', 'sessions', 'dashboard', 'runtime evidence'],
    coverage: 'covered',
    note: '工具、记忆、会话、面板、运行时证据与本地优先 provider 路由。',
  },
]

export function buildScenarioMatrix(): ScenarioMatrixReport {
  const summary = { covered: 0, partial: 0, gap: 0, total: ROWS.length }
  for (const row of ROWS) summary[row.coverage] += 1
  const gaps = ROWS.filter(r => r.coverage !== 'covered').map(r => `${r.scenarioLabel} — ${r.coverage}: ${r.note}`)
  return { version: 1, rows: [...ROWS], summary, gaps }
}
