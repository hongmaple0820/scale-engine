# SCALE Engine 升级迭代方案：v0.59 → v1.0

> 制定日期：2026-11-07 ｜ 依据：本会话三项独立审计（真实安装烟测 / SOTA 研究 / spec-kit 深度竞品 + 全景调查）
> 状态：待评审 ｜ 目标：把自评 7.4 真实推向 8.5，并在 6 个月内建立不可替代的差异化

---

## 0. 一句话战略

**不做第二个 spec-kit（148K★ 的平台之争打不赢），做 spec-kit 生态里唯一缺的「验证深度层」：effort-tuned verification + 独立证据链，以 extension/preset 形态借它的分发，以 SKILL.md 标准借整个 Agent 生态的分发。**

三条候选路线的取舍：

| 路线 | 判断 |
|---|---|
| A. 正面对标 spec-kit/OpenSpec（平台化管线） | ✗ 管线已是 commodity，148K vs 55★，无胜算 |
| B. 深耕单点治理（更细门禁 + 证据链） | ✓ 但单独不够——治理工具的宿命是被平台吸收 |
| **C. B 的能力 × A 的分发渠道（寄生生态）** | ✓ 本方案：能力走 B，分发走 A（DSH 已是 spec-kit 41 个官方集成之一，这是现成入口） |

核心依据：spec-kit 开放需求 [#4916](https://github.com/github/spec-kit/issues/4916)（per-step reasoning-effort / context-size 控制）至今未解决，而 effort-tuned verification 正是 SCALE 已有的概念；CMU/Google SDD 实证研究（arXiv 2608.25202，2026-10）明确的两个工具缺口——「验收标准编译为可执行检查」与「实现者不得验证自己」——恰好是 SCALE verification.json 的自然延伸。

---

## 1. 现状诊断（证据锚定）

### 1.1 实测缺陷（本会话亲手复现，2026-11-07）

| # | 缺陷 | 证据 | 严重度 |
|---|---|---|---|
| D1 | **install 验收与 doctor 依赖解析口径不一致**：npx 安装时验收层报原生绑定 blocker 并 exit 1（npx 临时缓存无预构建二进制），紧随其后的 `doctor env` 用全局 node 路径解析同一绑定却报 ok | 烟测日志：Node 22.20.0/win32，`Cannot find module ..._npx.../better_sqlite3.node` | 🔴 P0——用户流失第一现场 |
| D2 | Windows 安装未提示 PowerShell 执行策略问题，须 `npx.cmd` 绕过 | 烟测实测 | 🟡 P0 |
| D3 | blocker 产生逻辑违反自家契约：[check-native-abi.mjs](../../scripts/workflow/check-native-abi.mjs) 明写 "never block an install"，但 [SetupVerification.ts](../../src/setup/SetupVerification.ts#L123-L128) 把 required 环境检查失败全部升级为 blocker | 代码比对 | 🔴 P0 |

### 1.2 SOTA 缺口（2026-11 台面，8 项）

clean-context 独立审查 ｜ evals-in-CI 金数据集 ｜ spec↔code drift 持续检测 ｜ 上下文工程（compaction/JIT 检索/Ralph 式 fresh-context）｜ 沙箱化执行+审计 ｜ 多模型升级路由 ｜ MCP 2026-07-28 stateless 符合性 ｜ 容器化验证环境

### 1.3 spec-kit 13 项台面对照

**已达标**：管线骨架、规则层（constitution 类）、歧义门禁（Shield hooks）、非 greenfield 工作流（bug/assess 类）、无遥测。
**缺口**：agent 无关分发广度、extension/preset/catalog 平台化、GitHub 集成面、MCP 只读清单化 + 新规范符合性、跨平台安装故事（D1/D2 踩的正是这项）。

### 1.4 可复用的既有资产（不从零开始）

- EARS+ 验收标准解析已存在：[specCommands.ts](../../src/cli/specCommands.ts#L83)、[MySpecImporter.ts](../../src/spec/MySpecImporter.ts#L182-L187)（criteria → verificationSurface 映射）
- 影子→候选 hook 的成熟度门禁已存在：[RuleMaturity.ts](../../src/evolution/RuleMaturity.ts)（shadow hits / defect evidence / 误报率门控）——evals-in-CI 的天然底座
- 受治理动作平台 v2 已落地媒体域：[manifests.ts](../../src/media/actions/manifests.ts)（id/risk/cost/approval/longRunning 元数据）——可推广为通用验收动作目录
- [docs/WORKFLOW_EVAL.md](../WORKFLOW_EVAL.md)、[docs/verification-protocol.md](../verification-protocol.md) 已有验证协议文档
- release:check 十连（typecheck/lint/全量测试/双烟测/audit/pack dry-run）已是 CI 骨架

---

## 1.5 需求覆盖核对（2026-11-07 复核，不粉饰）

本方案第一版是「引擎技术演进方案」，四需求覆盖度：Q3≈90%、Q1≈70%、**Q2≈15%、Q4≈10%**。复核后补入 P2（产品体验层），四维全部纳入：

| 需求 | 第一版覆盖 | 缺口 | 本版补齐处 |
|---|---|---|---|
| Q1 安装/能力发挥/agent 自装 | 70% | 未定义「能力阶梯」（core vs full 的第三方能力）；未实跑 agent 自主安装路径 | P0-5 |
| Q2 面板/dsh 插件/产品闭环/交互合理性 | 15% | 方案无任何面板/插件改进项；dsh 插件的 Electron ABI 降级路径未评估 | **P2 产品体验层** |
| Q3 对比头脑风暴/spec-kit/方法论 | 90% | superpowers/BMAD 前置收敛互操作未入正文 | P2-D |
| Q4 多语言/多项目形态/多场景约束规范标准化 | 10% | 8 个 governance pack、product blueprints、媒体域（自媒体）盘点了但无改进项 | **P2 产品体验层** |

---

## 2. 总路线图

```
P0 第一公里修复      P1 验证深度差异化      P2 产品体验层         P3 生态与分发          P4 平台化收敛
v0.59 (2周)   →   v0.60–0.62 (6周)  →  v0.63–0.64 (4周)  →  v0.65–0.67 (6周)  →  v0.68–v1.0 (8周)
安装可信度/一致性    clean-context审查       面板产品化           SKILL.md 打包         lean/governed 双形态
口径统一/自动修复    验收标准→可执行检查       dsh 插件满血化       spec-kit preset       上下文工程子系统
能力阶梯定义         effort-tuned 一等公民    场景/规范矩阵        MCP 新规范符合        沙箱+审计+容器化
agent 自装路径      drift 持续检测          交互合理性评审       GitHub issues 集成    property-based 检查
                    evals-in-CI 金集        头脑风暴前置互操作    市场叙事与文档站      v1.0 收敛与治理换届
```

每个阶段有独立用户价值，任何阶段后中断都不产生半成品平台。

---

## 3. P0 —— 第一公里修复（v0.59，2 周，1 人）

**目标：让「首次安装 exit 0」成为可度量、可守护的不变量。**

### 3.1 工作项

**P0-1 统一依赖解析口径（修 D1+D3）**
- 文件锚点：[SetupVerification.ts](../../src/setup/SetupVerification.ts#L80-L128)、`resolveNonBlockingDependencyIds`
- 动作：
  1. 抽出单一 `resolveNativeModuleRoot()`（基于 `process.execPath` 的全局解析），install 验收与 `doctor env` 共用——同一台机器只允许存在一个结论
  2. 原生绑定可加载性检查从 `required: true` 降级为 warning + `autoFixCommand`（一行 `npm rebuild <pkg>` 或重装指引），与 check-native-abi.mjs 的 "never block" 契约对齐
  3. 验收 JSON 增加 `autoFix` 字段；CLI 渲染 blocker 时必附「可执行的下一条命令」
- 验收标准：
  - 在干净 Windows/macOS/Linux 各跑一次 npx 烟测，install 与 doctor 对同一依赖给出**一致**状态
  - 原生绑定缺失场景：install exit 0 + warning + autoFixCommand（不再 exit 1）
  - 新增回归测试：模拟 npx 缓存缺二进制，断言验收不产生 blocker

**P0-2 Windows 安装文档与体验（修 D2）**
- 动作：README/install 文档加 Windows 前置小节（PowerShell 执行策略 → `npx.cmd` 一句话）；install 命令入口检测到 win32 + pwsh 环境时主动提示
- 验收标准：中文 Windows 用户照文档首次安装零额外搜索

**P0-3 安装漏斗可观测（无遥测原则下）**
- 动作：install 结束时输出一个 8 行以内的「安装健康摘要」（阶段耗时/失败点/环境指纹：os/node/npm 版本），用户可自愿粘贴到 issue——用 issue 数据代替遥测做漏斗分析
- 同时：把「首次安装成功率」加入 release:check 的烟测矩阵（三平台各一次干净安装）

**P0-4 自评体系补位**
- 动作：把 D1/D3 写入自评 Tier1 缺陷清单（当前 13 项改进里没有任何一项指向安装成功率——这是自评盲区）
- 验收标准：下一版自评报告含「安装第一公里」维度

**P0-5 能力阶梯 + agent 自主安装路径（补 Q1 缺口）**
- 背景：Q1 问「用户安装后能发挥全部能力吗」——答案是**不能，且当前没人说清差在哪**。`--pack core` 与 `--pack full` 的差距（rtk/gbrain/graphify/codegraph 四个第三方能力）没有阶梯视图；agent 按 `agent-full-workflow.md` 提示词自主安装的路径也没有专项验证。
- 动作：
  1. 定义「能力阶梯」三档：**Level 1 core**（门禁/证据/工作流，零第三方依赖）、**Level 2 full**（+ 本地记忆 hrain + 代码图谱，可一键装）、**Level 3 extreme**（+ rtk/gbrain/graphify 等，需 cargo/bun/uv）。install 结束时明确告知用户当前所在档位与升级命令——不是「装完了」而是「装到了哪一档」
  2. **agent 自主安装烟测**：模拟 `agent-full-workflow.md` 的提示词流程（只读检查 → 计划 → 用户确认 → setup --apply --verify），验证：agent 能否正确识别 degraded/blocker 状态、是否会静默降级、第三步 `setup --verify` 是否给出下一条可执行命令而非空转
  3. 把 agent 自装烟测纳入 release:check（与 P0-3 的三平台安装矩阵合并）
- 验收标准：
  - 能力阶梯成文（中英），install 输出与面板首屏（P2-A）共用同一阶梯视图
  - agent 自装烟测跑通：任意缺失第三方能力时，agent 输出的计划含「缺什么/怎么补/回滚方式」，不静默降级

### 3.2 度量
- 三平台干净安装 exit 0 率 ≥ 99%（CI 矩阵守护）
- 「install 报 blocker 但 doctor 报 ok」类 issue 归零

---

## 4. P1 —— 验证深度差异化（v0.60–v0.62，6 周，1–2 人）

**目标：落地三个 spec-kit 生态公认空白，把「验证深度∝自主度」从内部概念升为一等公民能力。**这是 7.4→8.5 的核心增量。

### 4.1 P1-A clean-context 独立审查（v0.60，2 周）

- Why：Cognition 2026-04 实测——无共享上下文的 reviewer 平均每 PR 揪出 2 个 bug（58% 严重级）；CMU 研究把「实现者不得验证自己」列为设计原则；spec-kit 的 analyze 是只读交叉检查，没有独立**评审者上下文**概念
- 动作：
  1. `scale review`（[reviewCommands]）增加 `--isolated` 模式：以隔离子代理运行 reviewer，输入仅含（a）diff/变更文件（b）spec 摘要（c）验收标准——**不含实现过程的对话历史与自我评估**
  2. 评审报告落盘 `.scale/reviews/<task>/`，含 blocker/critical/high 计数与证据引用，进入 verification.json 证据链
  3. verify 前置门禁：CRITICAL 级任务强制 isolated review（受 effort-tuned 矩阵调度）
- 验收标准：
  - isolated 模式产出的评审报告与常规 review 结构一致、来源可区分（`context: isolated`）
  - 端到端跑一个真实任务：implementation → isolated review → 证据入 verification.json → gate 判定，全程无人工干预
- 风险：成本增加 → 用 effort 矩阵控制（仅 CRITICAL/L 默认开启，S 可关）

### 4.2 P1-B 验收标准 → 可执行检查编译器（v0.61，2 周）

- Why：CMU 研究明确的工具缺口；HubReb 独立评测发现 spec-kit 的「结论对但机制错」契约能通过审查——需要机器可校验；SCALE 已有 EARS+ 解析底座（specCommands.ts L83）离这一步只差一层编译
- 动作：
  1. 新模块 `src/verify/AcceptanceCompiler.ts`：把 `WHEN/IF/WHILE … SHALL` 句式编译为 `verification.json` 条目（`checkId / specClauseId / kind: command|checklist|property / command 模板`）
  2. 可测试句式给命令模板（`npm test -- --grep <checkId>`），不可测试句式落 checklist 并标 `needsHuman: true`——**不假装都能自动化**
  3. traceability 表：spec clause ↔ check ↔ test ↔ 代码路径，verify 时输出覆盖率（多少 clause 有 check、多少 check 最近一次 pass）
- 验收标准：
  - 对一个含 10 条 EARS+ 标准的样例 spec，编译产出 10 条 check 条目且 clause↔check 双向可查
  - 「至少一句能让测试失败的验收标准」占比成为 verify 报告的显式指标
- 风险：句式自由度大 → 先支持 EARS+ 标准句式，其余降级 checklist；不追求 NLP 全覆盖

### 4.3 P1-C drift 持续检测（v0.62，1 周）

- Why：CMU 研究发现「完成后才查 drift」是失败模式，需持续检测 + 草拟更新须人确认
- 动作：Shield 增加 post-tool hook：代码变更触及 spec 引用的模块而 spec/check 未变时，输出**草拟的 spec 更新建议**（append-only，等人工确认），不自动改 spec
- 验收标准：演示场景中改代码不改 spec 触发草拟建议；确认后 spec 追加带日期的变更记录（OpenSpec 式 delta）

### 4.4 P1-D evals-in-CI 金数据集（v0.62，与 4.3 并行，1 周）

- Why：50–500 版本化金案例做合并门禁已是 2026 标准（Anthropic AI-native SDLC playbook / EDD pattern）
- 动作：
  1. 建 `evals/golden/`：把现有 WORKFLOW_EVAL 案例扩到 ≥50 条（管线各阶段的输入→期望产物 schema）
  2. 两层门禁：PR 跑确定性层（schema/结构断言，脚本化），合并跑 model-in-loop 层（产物质量打分）
  3. 复用 [RuleMaturity](../../src/evolution/RuleMaturity.ts) 的 shadow→candidate-hook 门控做灰度
- 验收标准：CI 出现 evals 报告；故意破坏一个模板 → 金集捕到回归

### 4.5 P1 对外叙事

effort-tuned verification（S/M/L/CRITICAL → 最小验证深度矩阵）写成独立文档 `docs/EFFORT_TUNED_VERIFICATION.md`（中英），这是后面 P2 的「商品说明书」——spec-kit #4916 说的就是这件事，我们要第一个把说明书立起来。

---

## 5. P2 —— 产品体验层（v0.63–v0.64，4 周，1–2 人）

**目标：把「引擎能力」变成「用户可感知、可交互、可跨场景复用的产品」——补齐第一版漏掉的 Q2（面板/插件/闭环）与 Q4（多语言/多项目形态/多场景规范）。**

### 5.1 P2-A 面板产品化（v0.63，1.5 周）

**背景（盘点已证实，非新写）**：面板已是 Vue3 + Hono + Naive UI 的 8 页面实实现（Overview/Workflow/Topology/Monitoring/Tokens/Documents/Knowledge/Prompts），「空态说明来源缺失」的设计原则是 2026 最被推崇的可解释性实践。但 competitive-comparison.md 第 99-106 行自列的 6 条「提升空间」与本审计交叉确认后，按用户价值排序如下：

| 动作 | 现状 | 升级 | 验收标准 |
|---|---|---|---|
| **Dashboard 正式入口** | `npm run serve` 或直接跑 `dist/api/http.js`，用户要记得内部路径 | `scale dashboard serve` 成正式 CLI（README 已承诺，第 101 行）；`scale open` 与 `scale smoke` 的 3 分钟闭环（开面板 → 跑验收 → 看健康）做成文档站 demo | 一条命令打开面板，新用户 3 分钟看到 Overview 绿/黄/红 |
| **首次打开引导** | 8 页面裸奔，无 onboarding | 首屏「能力阶梯」视图：core 已就绪 / full 待装（rtk/gbrain/graphify/codegraph 状态一目了然），呼应 Q1 的「发挥全部能力」之问——用户永远知道自己在阶梯哪一级 | 新装项目首屏 10 秒内说清「现在能做什么/还差什么/怎么补」 |
| **Tokens & Cost 闭环** | 读 usage.jsonl，但归因粗 | 按 task/session/agent/role 归因（competitive-comparison 第 104 行原话）；面板直读 | 一次真实任务后，面板能回答「哪个阶段最烧 token」 |
| **知识库/记忆可编辑** | Documents 页可编辑 md/json/html，但 knowledge.db 与 gbrain 只读 | 知识库导入/编辑/版本历史/导出；gbrain 节点可视化（第 103 行原话） | 用户在面板完成一次知识导入→编辑→导出，无需 CLI |
| **多项目体验** | 靠 `SCALE_DASHBOARD_PROJECTS` 分号列表 + `/api/projects` 切换 | 面板内项目切换器（不重记环境变量） | 双项目切换全程 GUI 完成 |

**不做**：不重写 Vue SPA（现有实现可复用）；不引入新 UI 框架。

### 5.2 P2-B dsh 插件满血化评估（v0.63，0.5 周）

**背景（关键发现，本会话读到）**：dsh-scale README「边界」节自述——「不构造 SQLiteArtifactStore/MemoryBrain，因为 DSH 的 Electron ABI（MODULE_VERSION 149）与主包原生模块（137）不兼容，本插件只走 InMemoryArtifactStore/纯函数路径」。这是「完整可用」问句的直接答案：**插件当前是降级形态，不是满血**。

**动作（先评估后动手，不预设结论）**：
1. 验证 13.x N-API（主包 CHANGELOG 声称跨 ABI 稳定）是否已使上述 ABI 假设过时——若 13.x 预编译在 Electron 149 可加载，则插件可升满血，收益是把面板/证据/记忆在 DSH 内打通
2. 若仍不可加载：明确把「降级边界」文档化为能力阶梯（哪些功能在 DSH 内可用、哪些必须回主包），并在插件 README 首屏写明——诚实降级 > 让用户撞墙
3. 补 `evidenceMode: 'all'` 的写盘量压测（README 自述「未压测」，plan U8）——这是插件唯一未验证项

**验收标准**：产出一页《dsh 插件能力矩阵》——每个功能标注「满血/降级/不可用 + 原因」，用户 10 秒看懂插件边界。

### 5.3 P2-C 场景 × 规范矩阵盘点（v0.64，1 周）

**背景**：8 个 governance pack 已存在（frontend-app / node-library / enterprise-admin / spring-vue-admin / microservice-platform / python-service / desktop-app / agent-os-workbench），product blueprints 5 个解决方案，媒体域 M0-M5 是自媒体场景的地基——**但没有任何文档回答「哪个 pack 覆盖哪个场景、缺什么」**。这是 Q4 的第一层答案缺口。

**动作**：
1. 产出 `docs/SCENARIO_MATRIX.md`：行 = 场景（编程/自媒体/办公/数据/桌面），列 = 语言 × 项目形态（单体/微服务/monorepo/MOE 多仓），格 = 现状（pack/blueprint/skill 覆盖）或空白
2. 矩阵空白处标注三类补齐策略：已有资产直接填 / 需要新 pack / 明确不做
3. 让 `scale install --interactive` 按矩阵推荐 pack（选项目形态自动匹配）

**验收标准**：一个从未用过 SCALE 的用户，按矩阵 30 秒选到适合自己的 pack。

### 5.4 P2-D 头脑风暴/superpowers 前置互操作（v0.64，1 周）

**背景**：竞品识别已修正——用户说的「头脑风暴」大概率指 superpowers 的 brainstorming skill（313K★，Claude Code 第一大插件）或 BMAD 的 forge-idea（55K★）。两者与 SCALE 是**前后脚互补**：头脑风暴产出「至少一句能让测试失败的验收标准」，SCALE 把验收标准编译成可执行检查（P1-B）。

**动作**：
1. 提供「前置收敛 → SCALE 接纳」的衔接器：读 superpowers/BMAD 头脑风暴输出的验收标准句式（`Given/When/Then` 或清单），转成 SCALE 的 EARS+ 验收标准 → 喂给 P1-B 的 AcceptanceCompiler
2. 不重写头脑风暴（那是别人的强项），只做**翻译层**
3. 互操作文档 + 示例：一个从 superpowers brainstorming 到 scale verify 的端到端 walkthrough

**验收标准**：拿 superpowers 的 brainstorming 输出跑通「验收标准 → 可执行检查」全链。

---

## 6. P3 —— 生态与分发（v0.65–v0.67，6 周，1–2 人）

**目标：把 P1 的能力送进两个现成分发渠道。**

### 6.1 P3-A SKILL.md 打包（v0.65，2 周）

- Why：BMAD 2026-09 已把装机方式切到 `npx skills add`（SKILL.md 目录约定）；skills.rest 索引 75 万+；Anthropic Agent Skills 2025-12 已成开放标准；这是比再适配 N 个 IDE 边际收益高的第七入口
- 动作：把 SCALE 核心流程（effort-tuned verify、isolated review、acceptance compiler）打包为 SKILL.md 技能目录（progressive disclosure：SKILL.md 摘要 + scripts + 参考资料），兼容 `npx skills add hongmaple0820/scale-engine` 与 `~/.agents/skills` 约定
- 验收标准：在一个纯 Claude Code / 纯 Codex 环境用 skills 装法跑通一次 SCALE verify

### 6.2 P3-B spec-kit extension/preset（v0.66，2 周）

- Why：DSH 已是 spec-kit 41 个官方集成之一；其社区 catalog 已有 Security/Database 治理类 preset，但没有验证深度层；148K★ 生态的分发通道比自己建生态快一个数量级
- 动作：发布 `scale-verification-preset`——把 effort-tuned 矩阵 + isolated review 以 spec-kit preset/extension 形态提供（workflow step：`scale verify-task --effort`），按其 catalog 规范提交社区目录
- 验收标准：spec-kit 工作流中插入 scale 验证步骤跑通；catalog PR 提交
- 风险：spec-kit 破坏性变更高频（1.3.0 曾移除核心命令）→ preset 独立版本号、锁定测试的 spec-kit 最低版本

### 6.3 P3-C MCP 2026-07-28 符合性（v0.66，与 6.2 并行，1 周）

- 动作：升级 MCP SDK；移除连接级会话态（stateless core + server-minted handles）；list 结果可缓存；对照其 changelog 做符合性测试；`specify mcp` 式只读清单工具保留
- 验收标准：用官方符合性用例跑通；文档声明规范版本

### 6.4 P3-D GitHub 集成 + 文档站（v0.67，1–2 周）

- tasks→issues（gh CLI，学习 spec-kit 教训：做成可移除扩展而非核心命令）；文档站（GitHub Pages）承载 EFFORT_TUNED_VERIFICATION 叙事 + 中英双 README

---

## 7. P4 —— 平台化收敛（v0.68–v1.0，8 周）

**目标：补齐 SOTA 缺口中剩余的工程性项目，收敛到 1.0。**

| 项 | 动作 | 对应 SOTA 缺口 |
|---|---|---|
| P4-A lean/governed 双形态 | `--lean` profile：1–3 点小需求只跑「一句验收标准 + 单 check + 快 verify」；OpenSpec 用 74K★ 证明 lean 半边市场存在，治理工具绝不能只会重拳 | 防官僚化（Böckeler 批评） |
| P4-B 上下文工程子系统 | 长任务 compaction + 结构化笔记 + JIT 检索（路径/查询标识符运行时解引用）；progress 文件已是事实上的持久状态，补 fresh-context 再入（Ralph 式） | 缺口 4 |
| P4-C 沙箱化执行与审计 | 每个受治理动作全量审计落盘（谁/何时/命令/证据）；secrets 预阻断（进 pre-tool hook）；容器化验证（Docker 可选路径） | 缺口 5/8 |
| P4-D property-based spec 检查 | Kiro 方向：对数值/状态类验收标准生成 property 断言模板 | 验证前沿 |
| P4-E 多模型升级路由 | smart-friend：主模型卡住（连续 N 轮无进展）时升级到更强模型做一次诊断，仅返回 1–2k token 建议 | 缺口 6 |
| P4-F v1.0 收敛 | 自评体系换届：以「验证深度×安装成功率×生态在位×产品体验」四轴替换 13 项清单；对外 1.0 语义 = 「能力承诺」而非「稳定承诺」（学 spec-kit 1.0 的坦诚） | — |

---

## 8. KPI（90 天窗口）

| 指标 | 现值 | P0 后 | P3 后（90 天） |
|---|---|---|---|
| 干净安装 exit 0（三平台矩阵） | 未测（实测 Win 失败） | ≥99% | 守护 |
| 周下载 | 445 | — | ≥1,000 |
| GitHub stars | 55 | — | ≥300 |
| CRITICAL/L 任务 isolated review 覆盖率 | 0 | — | ≥80%（本仓库 dogfood） |
| 验收标准可执行化占比（本仓库） | 未度量 | 度量可见 | ≥60% |
| spec-kit 生态在位 | 无 | — | preset 收录 + ≥1 外部采用 |
| 面板新装「3 分钟闭环」达成率 | 未度量 | — | ≥80%（面板 onboarding 后实测） |
| 场景矩阵覆盖（编程/自媒体/办公） | 未成文 | — | 矩阵成文 + 每场景 ≥1 可跑 pack |
| dsh 插件能力矩阵成文 | 无 | — | 成文且满血/降级边界清晰 |

## 9. 明确不做（防官僚化清单）

1. 不做默认遥测（对齐 spec-kit 的零遥测立场；漏斗靠自愿粘贴的健康摘要 + issue）
2. 不做并行多写者 swarm（Cognition 已证伪：~15× token 成本、隐式决策冲突）
3. 不加更重的 spec 模板——每加一页模板必须先删两页（futurion 实证：活下来的 spec 是 1–2 页含可失败句子的）
4. 不做 IDE fork、不追 A2A/ACP（单仓工作流引擎未到必需阶段；roadmap-watch 即可）
5. 不在 1.0 前做 marketplace/catalog 平台化（先把别人的生态当渠道）
6. blocker 一律必须附「下一条可执行命令」——一个不能转化为动作的 blocker 是制造焦虑，不是治理

## 10. 本方案的证据索引

- 本地实测：npx 烟测日志（2026-11-07，Node 22.20.0/win32）、SetupVerification.ts 代码比对、dsh-scale README 边界节（ABI 降级）
- SOTA：Anthropic context engineering（2025-09-29）、Cognition multi-agents-working（2026-04-22）、CMU/Google SDD 研究（arXiv 2608.25202）、Terminal-Bench 2.0/Harbor
- 竞品：spec-kit v1.3.2 全量审计（148K★、#4916、13 项台面）、OpenSpec 74K★、BMAD 55K★、Kiro、superpowers 313K★（头脑风暴）
- 本仓库：docs/WORKFLOW_EVAL.md、verification-protocol.md、SHIELD.md、GOVERNANCE_DASHBOARD.md、competitive-comparison.md（面板提升空间 6 条）、PRODUCT_MODULE_TEMPLATES.md（8 pack + blueprints）、自评体系、release:check

## 11. 需要的决策输入（评审时定）

1. P3-B 提交 spec-kit 社区 catalog 的沟通策略（fork 其 catalog 规范 vs 直接 PR）
2. isolated review 的默认开启档位（建议 L/CRITICAL 默认开，M 可选）
3. 90 天窗口是否与作者本人的人力预算匹配（P0 1 人 × 2 周为最紧约束）
4. dsh 插件满血化：先评估 N-API 13.x 是否已破 ABI 壁垒，还是直接维持降级并文档化（P2-B 有两条路，需拍板走哪条）
5. 场景矩阵的「办公」场景边界：product blueprints 5 个解决方案是否算办公场景的地基，还是要新开「办公自动化 pack」（影响 P2-C 工作量）
