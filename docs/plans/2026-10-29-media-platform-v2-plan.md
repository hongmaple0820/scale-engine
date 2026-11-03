# 受治理动作平台 v2：以媒体为首个域（content-media v3 · P5 扩展立项）

- 日期：2026-10-29
- 状态：待评审（已完成产品/架构/工程三视角评审；评审通过后按 M0–M5 分 PR 执行）
- 上游文档：`docs/plans/2026-10-25-content-media-workflow-plan-v3.md`（下称 v3 计划）
- 关联文档：`docs/plans/2026-10-25-content-media-workflow-plan.md`（v2 计划，已废弃）、`docs/plans/2026-10-15-dsh-plugin-integration-plan.md`（DSH 事实基线）
- 任务等级：L（跨模块、跨流程、涉及外部计费与审批）
- 事实基线：以仓库当前代码为准；凡未在代码中确认的外部 API 细节，均标注 `[UNCERTAIN]`

---

## 0. 一页结论

v3 计划已交付 P0–P4 与 P5 第一批（画布、Media Studio、DSL v0.2、批量渲染），并把“视频模型 provider、云端执行、协作”留作单独立项。本计划就是这个立项，但范围不止视频：

1. **先把能力变成受治理的动作**：媒体动作目录 + MCP 异步语义，解决“工具同步阻塞、60 秒超时、成本/审批不可见”的结构问题。
2. **再打通素材回流**：`asset://` 跨任务引用与物化，让“生成 → 分镜 → 渲染”成为一条可审计的链。
3. **接入视频与语音 provider**：Provider v2 接口、异步远程任务生命周期、断点恢复、配额与成本台账。
4. **具备成片能力**：视频片段 + 配音 + 字幕的拼接渲染，模板向导。
5. **具备交付能力**：多规格导出包、审批收件箱、`publish_prepare`（只生成发布包，不直接调第三方平台）。
6. **升维到 DSH 与 Cortex**：工具卡、设置页、媒体观察回流。

总量约 **31 人日**（M0–M5，含 S0 技术验证 spike），其中 M0–M4 约 27 人日可形成完整闭环。全部新能力默认关闭，按里程碑逐项开启。

**非目标（本计划明确不做）**：直接发布到第三方平台、账号池、任意本地文件上传、明文密钥存储、DOM 注入式 UI、云端多机执行、多人协作、电商套图/PPT/换装等模板族。

---

## 0.5 平台定位：三个视角的结论

### 0.5.1 产品视角

- **产品论点**：scale-engine 不是内容工具，而是让 Agent 产出物“可估算、可批准、可恢复、可审计”的治理层。媒体被选为第一个域，不是要做自媒体平台，而是因为它同时压满四项治理能力：高成本、长时异步、外部依赖、不可逆交付。
- **用户是三层，不是一个人**：
  1. Agent（MCP/DSH 主消费者）——需要机器可读的动作目录、成本预估、可续等的任务语义。
  2. 操作者（Dashboard/DSH）——需要审批收件箱、状态可见、可干预。
  3. 维护者/组织——需要预算、证据、复现与审计。
- **JTBD**：从一句需求到一个可交付媒体包，全程可估算、可批准、可恢复、可审计。
- **价值链路**：意图 → 分镜 → 素材（生成/引用）→ 合成 → 导出 → 发布包 →（人工）发布。本计划覆盖前六段，明确停在“包”。
- **成功指标（北极星 + 护栏）**：北极星 = 每周带证据完成的交付物数量；护栏 = 单交付物成本、审批绕过 = 0、恢复成功率、素材复用率、P95 首素材时间、旧 0.2 渲染零回归。
- **范围逻辑**：MVP = M0 + M1 + M2（受治理的生成与复用）；M3 成片、M4 交付、M5 界面按验证结果排序。
- **定位差异**：竞品插件提供“生成能力”，本计划提供“生成能力 + 治理与可交付性”；不复用其包，只借鉴交互与生命周期设计。
- **商业假设**：当前按“内部能力”建设，不设计计费与账号体系；若未来外化，按域打包（动作目录 + 策略闸门 + 账本）而非按功能收费。该假设不影响本期实现，但决定了不做账号池与多租户。

### 0.5.2 架构视角

- **内核 / 域的分界**：内核只定义“受治理动作”的契约（动作目录、策略闸门、账本/证据适配）；媒体是第一个实现者。内核不包含任何媒体概念（storyboard、provider、ffmpeg）。
- **不重复造轮子**：仓库已有执行账本、运行证据账本、用量/成本账本、输出面注册表、Artifact/FSM 与长任务引擎（见 3.4）。本计划复用前三者与输出面注册表；明确不把媒体任务塞进 Artifact/TaskEngine，并给出理由与未来扩展点。
- **依赖规则**：`media → kernel/ledger/surface`；`dashboard/api/dsh/cli → media`。媒体核心不得反向依赖 Dashboard；四个表面只做适配。
- **分层视图**：

```text
表面层    MCP 工具        REST /api/media        DSH 卡片/设置        CLI
             └──────────────────┬──────────────────┘
                                ▼  只做适配，不含业务规则
域层      media（本期唯一实现）        未来域（不建，仅用 checklist 验收）
                                ▼
内核层    动作目录（Action Catalog） · 策略闸门（成本/审批/配额） · 账本/证据适配
                                ▼  复用，不重建
平台底座  ExecutionLedger · RuntimeEvidenceLedger · ModelUsageLedger/CostAnalyzer
          ScaleSurface · FileLock/pathSafety/eventBus · Artifact/FSM（共存）
```

- **第二域就绪判据（测试而非交付）**：新增一个域（如“研究报告生成”）只需新增动作清单 + 执行 handler，不改 MCP 注册、REST 路由、成本/审批/证据代码。现在不建第二个域（YAGNI）。
- **非功能要求**：并发/恢复/存储/超时/失败隔离/模式演进/可观测，见 4.5。

### 0.5.3 工程视角

- **先用 spike 消除最大未知**：provider API 是唯一能推翻工期的外部变量，M2 开工前必须完成 S0（真 key、录 fixtures、定适配器形状）；失败则缩为“一个确认 provider + Mock”。
- **预算是运行时约束，不是提交前提示**：估算 → 预留 → 结算，超支中止；只在 preflight 拦一次不算治理。
- **可确定性测试**：provider HTTP 用录制夹具；ffmpeg/Playwright 集成用例沿用 `it.runIf` 但需 golden 断言；禁止把 skip 当通过。
- **演进与回滚**：`job.json` 增加记录版本与读兼容；DSL 版本矩阵显式；每个里程碑独立开关与回滚路径。
- **维护成本**：定价表有保鲜期，需 owner、更新入口与过期告警；provider 适配器变更走契约测试。

---

## 1. 与 v3 计划的关系

| v3 计划中的内容 | 本计划处理方式 |
| --- | --- |
| P5 剩余“视频模型 provider” | 由 M2 承接并扩展为 Provider v2 + 异步任务生命周期 |
| P5 剩余“云端执行” | 仍不做；M2 只做“远程生成任务”的轮询/下载，渲染仍在本机 |
| P5 剩余“协作” | 仍不做；M4 只做单机审批收件箱 |
| “CLI / MCP / API / DSH 调同一应用服务” | M0 用动作目录落成契约；M2 起成本/审批统一走该入口 |
| DSL 严格校验、未知字段策略 | 沿用；M1/M3 只做向后兼容的加法 |
| 不改写既有任务状态语义 | 仅追加 `awaiting_approval` 与相应边，不改既有边 |

本计划**不修改** v3 已验收的 P0–P4 行为；所有新增能力通过特性开关控制，默认关闭。

---

## 2. 目标与非目标

### 2.1 目标（按可验证结果表述）

- G1：任一媒体动作都能被列出、估算成本、判定风险与审批要求，且 MCP / REST / DSH 读到的是同一份元数据。
- G2：长任务不再依赖同步工具调用；MCP 客户端可用 `create → run → wait/get` 完成分钟级生成，且进程重启后可恢复轮询。
- G3：生成结果可被其他任务以 `asset://<taskId>/assets/<path>` 引用，渲染前自动物化到目标任务目录，路径与来源可审计。
- G4：至少一个视频 provider（Seedance 系）与一个语音 provider（OpenAI 兼容 `/audio/speech`）可插拔；无密钥时 Mock provider 可完整跑通契约测试。
- G5：分镜可包含视频元素与音频轨，渲染产出带配音/字幕的成片；无法处理的组合明确报 `failed_validation`，不静默降级。
- G6：一次渲染可导出 16:9 / 9:16 / 1:1 三种规格与封面，并生成 `publish/manifest.json`。
- G7：高成本动作在阈值以上必须人工批准；无成本数据时 fail-closed；审批决定进入证据链。
- G8：DSH 侧能看到新工具卡与媒体状态；任务终态可按统一格式回流 Cortex 观察。

### 2.2 非目标

- 不做第三方平台直发（抖音/小红书/B 站/视频号），只产出发布包与适配器接口。
- 不做账号池、多账号轮询、密钥共享。
- 不接受任意本地路径作为生成输入；参考图只能来自项目资产。
- 不做浏览器 DOM 注入、侧栏硬编码改造；只用 DSH 官方 slot。
- 不做云端渲染集群、队列服务、多人协作与权限体系。
- 不做本地内容审核模型；依赖 provider 侧策略并在证据中记录。

---

## 3. 现状事实基线（代码为准）

### 3.1 媒体核心

| 事实 | 位置 |
| --- | --- |
| `MediaProvider` 现有 `enabled`/`getCapabilities`/`validateConfig`，生成能力仅 `generateImage?`；`ProviderKind` 已含 `video`/`music` | `src/media/providers/types.ts:5,7-14,42-50` |
| provider 注册表为硬编码，`getProvider` 带 enabled 门 | `src/media/providers/ProviderRegistry.ts:10,21-39` |
| 已有 Mock 与 OpenAI 兼容图像 provider，密钥走 env；SSRF 校验已存在 | `src/media/providers/image/MockImageProvider.ts:42,52-58`；`image/OpenAICompatibleImageProvider.ts:13,17-36,39,42,64-114` |
| Suno provider 默认关闭且未接线；`enabled` 在模块加载时求值（运行时改 env 无效） | `src/media/providers/music/SunoApiExperimentalProvider.ts:13-18,29-57,60` |
| DSL：`SCENE_DSL_VERSION='0.2'`，接受 `0.1/0.2`；元素 text/rect/image；Storyboard 含 canvas/output/scenes/subtitles | `src/media/types.ts:5-7,9-32,34-72,74-94` |
| 任务状态 9 个；类型仅 `render | generate_image`；`input` 为内联 `{storyboardFile?, imageRequestFile?}` | `src/media/types.ts:98-107,140-158`（类型 `:142`，状态 `:143`，input `:152-153`） |
| 分镜校验：图片 src 仅相对路径、扩展名白名单、拒绝绝对路径/盘符/`..` | `src/media/validation/validateStoryboard.ts:94-109,327-336` |
| 渲染 7 阶段：validate_assets → prepare → capture → audio → encode → inspect → commit | `src/media/render/RenderOrchestrator.ts:50-66,73-81,83-196` |
| ffmpeg 适配：编码、探测、字幕滤镜、抽帧；音频当前为 440Hz 占位 | `src/media/render/FfmpegAdapter.ts:14-33,67-81,84-90,106-161` |
| 场景 HTML 用 `../assets/<src>` 引图；SRT 构建已存在 | `src/media/render/SceneRenderer.ts:32-35,63-135,138-151` |
| 任务状态机、可中断状态、幂等、恢复 | `src/media/jobs/jobStateMachine.ts:8-18,31`；`jobs/JobService.ts:74-100,158-190,212-221,242-276`；`jobs/JobStore.ts:20-60,91-93,106-125` |
| 创建任务时即校验分镜/图像请求（render 校验在 `:63-68`） | `src/media/jobs/JobService.ts:63-71` |
| 整个运行持有 `media-run` 文件锁，TTL 30 分钟 | `src/media/jobs/JobService.ts:31-33,135-145`；`src/core/FileLock.js` |
| 图像生成产物落在 `assets/generated/<taskId>.<ext>` | `src/media/render/ImageOrchestrator.ts:82-95` |
| CLI 媒体命令：validate/render/batch/task/providers/image/doctor，根命令 `media` | `src/cli/mediaCommands.ts:51-355,357-369`；注册 `src/api/cli.ts:88,1847` |
| 配置无集中 loader/schema；媒体 provider 直接读 `process.env`；未引入 zod/ajv | `.scale/config.yaml:1-61`；`src/cli/engineBootstrap.ts:27-28`；`package.json:78-95` |
| 证据写入统一经 `EvidenceWriter` 脱敏（token/secret/password/cookie/authorization/api-key） | `src/media/evidence/EvidenceWriter.ts:10-23,42` |
| 测试脚本：`npm test`、`test:quick`（含 `tests/media`）；vitest 超时 180s；coverage 阈值 80/75 | `package.json:57-76`；`vitest.config.ts:15,28,36-41` |
| MCP 媒体工具 11 个；render/generate_image 为同步阻塞 | `src/media/mcpTools.ts:42-146,153-232`；`src/api/mcp.ts:13,47-48,496,877-879` |
| Dashboard 媒体 API 14 个；`POST /tasks` 只接收 storyboard 并 detached 运行 | `src/dashboard/MediaControlPlane.ts:172-196,118-302`；`DashboardServer.ts:64,1853` |
| DSH 客户端 25 个工具卡；无媒体专用卡；命令桥 9 个命令 | `packages/dsh-scale/src/client.ts:11-19,55-112`；`commandsBridge.ts:25-70` |
| MCP 超时 60s（dev patch） | `packages/dsh-scale/mcp-dev.patch.yml:19-20` |
| 前端 Media Studio 仍是 JSON textarea；画布编辑器已存在 | `dashboard/web/src/components/MediaStudio.vue:54-60,129-191,271-307`；`MediaCanvasEditor.vue:12-39,187-240,346-348` |

### 3.2 已确认的工程约束

- 仓库策略：**不安装、不复用** `dsh-imagegen-video` 与 `dsh-agnes-multimodal` 的包，只借鉴设计、自研等价能力（v2 计划第 6 行）。
- 未运行验证不得声称通过；不确定事实标 `[UNCERTAIN]`；shell 命令优先 `rtk` 前缀（`AGENTS.md`）。
- 计划文档惯例：Gate 制阶段、DoD、风险登记、决策清单（v3 计划）。
- 任务状态记录惯例：`.scale/state/planning/tasks/<date>-<name>/{explore,mini-prd,plan,reality-check,runtime,verification,review,summary}.md`。

### 3.3 治理、Dashboard、DSH 与证据接缝

| 事实 | 位置 |
| --- | --- |
| MCP 工具定义集中在 `getTools()`，媒体工具通过 `...MEDIA_MCP_TOOLS` 展开；新增媒体工具只要留在该数组即可被 `tools/list` 与 `tools/call` 自动暴露 | `src/api/mcp.ts:40-48,128-497,496,877-879` |
| 媒体同步工具在 handler 内直接 `await runJob`（render `:189`、generate_image `:205`、retry `:217`），其余为同步文件 IO | `src/media/mcpTools.ts:160-232` |
| ToolPolicy 只有 `mode/destructiveActions/evidenceRequired`，**没有审批队列**；仓库无 `pending_approval` 持久化 | `src/tools/ToolPolicy.ts:4-22,169-177`；`.scale/tools.json:186-194` |
| Dashboard 默认 `host='0.0.0.0'`，全局中间件只有 CORS；唯一 token 校验只用于 bridge register，未设置 token 时直接放行 | `src/dashboard/DashboardServer.ts:944-945,968-970,6458-6479` |
| 媒体 API 注册参数仅 `{ projectDir }` | `src/dashboard/MediaControlPlane.ts:29-31,118-119` |
| 飞书有可复用实发原语（`lark-cli im +messages-send`），但没有通用通知端点；自动实发仅限 agent-control completed 回复 | `src/communication/FeishuChannelProvider.ts:67-87`；`FeishuBridge.ts:237-310` |
| Cortex `Observation` 必填 `timestamp/sessionId/gateName/gateStatus/filePaths/tokensUsed/modelUsed`，面向门禁；生产代码无调用方 | `src/cortex/InstinctExtractor.ts:32-43,183-191` |
| DSH 目前只注册 `tool.call.toolview`，未使用 `settings.section` | `packages/dsh-scale/src/client.ts:80,97-112` |
| 可选 LLM 客户端存在但受 `SCALE_LOCAL_MODEL` 门控；本计划不依赖它 | `src/review/JsonLlmClient.ts:33-92` |

### 3.4 平台内核盘点与复用边界

仓库已有多个平台级模块。媒体 v2 若全部自建，会形成并行账本与并行证据，违背“四本账收敛”的初衷。逐项处理如下：

| 既有模块 | 既有能力 | 本计划处理 | 理由 |
| --- | --- | --- | --- |
| `src/runtime/ExecutionLedger.ts` | 跨 Agent 执行时间线，已定义 `approval.requested/resolved`、`evidence.recorded`、`tool.invoked` 等事件 | **复用**：媒体审批与终态证据写入该账本，`metadata.domain='media'` | 审批与证据是跨域事实，不应只存在于任务目录 |
| `src/runtime/RuntimeEvidenceLedger.ts` | 运行证据（command/gate/tool/skill/mcp/...），带脱敏与 taskId/sessionId | **复用（二级）**：任务内 `events.jsonl` 保留细节；终态向运行证据账本写一条摘要 | 细节留在任务目录，跨会话审计走全局账本 |
| `src/runtime/ModelUsageLedger.ts` + `CostAnalyzer.ts` | 用量记录（provider/model/taskId/metadata/estimatedCostUsd）与成本汇总 | **复用记录形状**：媒体花费以 `provider` 维度写入同一账本，单位放 `metadata.unit`；`CostAnalyzer` 增加 `byDomain` 聚合 | 不新建存储子系统；模型成本与 provider 成本可同表汇总 |
| `src/surface/ScaleSurface.ts` | 输出面注册表：evidence/state/tmp/cache 分类、72h TTL、manifest、禁止清理 evidence/specs | **复用**：媒体任务目录与 `render/` 缓存注册为对应 kind；GC 规则服从该注册表 | 清理策略必须全仓一致，避免媒体自定一套删除规则 |
| `src/artifact/` + `src/tasks/TaskEngine.ts` | 通用 Artifact 模型（11 类、FSM、Gate、SQLite store）与长任务引擎（步骤/检查点/恢复） | **共存，不合并**；仅导出包未来可注册为 `Release` artifact | `ArtifactType` 是冻结契约（`artifact/types.ts:6` 要求冻结评审）；媒体任务高频、文件密集、生命周期不同；TaskEngine 面向开发任务步骤编排，强并会引入大改风险 |
| `src/capabilities/CapabilityRegistry.ts` | MCP 能力对象（browser/search/computer/exa）的注册与生命周期 | **不复用，明确区分**：动作目录是“工具级元数据”，不是能力对象；命名用“动作目录（Action Catalog）”避免混淆 | 两者抽象层次不同，强行统一会扭曲接口 |
| `src/core/FileLock.ts`、`pathSafety.ts`、`eventBus.ts` | 锁、路径安全、事件总线原语 | **复用** | 已在媒体核心使用，保持单一实现 |

结论：本计划新增的“内核”只有三件——**动作目录、策略闸门（成本/审批/配额）、账本适配**；其余全部复用或显式共存。任何“再建一套账本/证据/清理”的实现都视为评审阻断项。

---

## 4. 架构决策（ADR 摘要）

### ADR-0 媒体是首个域，不是平台本身

**决策**：内核契约按“域无关”设计——动作目录、策略闸门、账本适配三件；媒体是第一个实现者。实现只服务媒体，抽象不引入任何媒体概念。

**理由**：把媒体功能直接写成平台，会让下一个域复制整套 MCP/REST/成本/审批代码；反过来，先建通用插件框架又没有第二个域验证，属于过度设计。正确做法是“契约域无关、实现单域、用第二域就绪测试验收”。

**约束**：不建插件框架、不建第二个域；第二域就绪判据写入总 DoD（见 0.5.2、14）。

### ADR-1 动作目录先于新 provider

**决策**：新增 `src/media/actions/` 作为媒体动作的唯一元数据源（动作目录，Action Catalog）；MCP 工具、REST 端点、DSH 卡片、成本估算、审批策略都从它读取。

**理由**：v3 的“四本账”问题（能力、权限、成本、证据各写一份）在媒体域已经出现：工具定义在 `mcpTools.ts`，端点能力在 `MediaControlPlane.ts`，DSH 卡片在 `client.ts`，成本无处可查。先加 provider 会把第四份不一致固化。

**约束**：命名与 `CapabilityRegistry` 区分（后者是 MCP 能力对象）；接口形状按域无关设计（`id/toolName/risk/cost/approval/surfaces`），但 M0 只落地媒体清单。

### ADR-2 异步优先，同步工具仅作便利包装

**决策**：所有可能超过 45 秒的动作走 `create_task → run_task → wait_task/get_task`；`media_render_storyboard`、`media_generate_image` 保留为短任务便利入口，描述中明确“长任务请用异步链路”。

**理由**：DSH 侧 MCP 超时 60s，视频生成常见 1–5 分钟；同步阻塞必然超时且无法恢复。

**约束**：`wait_task` 服务端最长 50 秒，超时返回未完成快照而非错误；客户端自行续等。

### ADR-3 跨任务引用用 `asset://`，渲染前物化

**决策**：DSL 允许 `asset://<taskId>/assets/<rest>`；提交时只做语法与归属校验，渲染时在 `validate_assets` 之前物化复制到目标任务 `assets/external/<sourceTaskId>/<rest>`，用重写后的 Storyboard 再生成页面与校验资产。

**理由**：直接跨任务读路径会破坏任务目录边界与可移植性；硬链接跨卷不可靠；复制最稳，代价可接受（素材通常 < 100MB）。

**约束**：源必须属于同一 project；路径必须落在源任务 `assets/` 下；复制记录 sha256 进入证据。

### ADR-4 Provider v2：能力可选，生命周期显式

**决策**：`MediaProvider` 扩展为可选方法集合；视频生成返回 `completed | remote` 二态；remote 句柄持久化在任务记录中，由 JobService 轮询、下载、恢复。

**理由**：图像是同步的，视频普遍异步；用同一个“submit 返回结果”假设会逼出超时与丢任务。

### ADR-5 成本与审批 fail-closed

**决策**：动作声明 `cost.estimator` 与 `approval.mode`；成本未知视为“需审批”；审批模式 `off | threshold | always`，默认 `threshold`；预算按日累计，超限拒绝创建。

**理由**：借鉴竞品的教训：能力很强但无成本闸门，一次误触可能产生真实账单。

### ADR-6 发布只到“包”，不到“平台”

**决策**：M4 产出 `publish/manifest.json` + 封面 + 视频 + 字幕；定义 `PublishAdapter` 接口但不实现任何平台适配。

**理由**：第三方发布涉及账号、ToS、审核与不可逆外部副作用；当前阶段收益低、风险高。

### ADR-7 审批端点默认只对本机开放

**决策**：审批写端点仅在 Dashboard 绑定回环地址，或请求携带匹配 `SCALE_MEDIA_APPROVAL_TOKEN` 的 token 时可用；否则 403。

**理由**：Dashboard 默认 `host='0.0.0.0'` 且无全局鉴权（`DashboardServer.ts:944-945,968-970`）。审批端点若直接暴露，局域网内任何人都能批准付费动作，等于把成本闸门拆掉。

**约束**：不改变 Dashboard 全局鉴权模型（超出本计划范围）；只对新增审批端点做最小防护，并在文档中明确“生产使用审批请绑定 127.0.0.1”。

### ADR-8 复用既有账本、证据与输出面注册表

**决策**：审批/证据/用量事件写入既有 `ExecutionLedger` / `RuntimeEvidenceLedger` / `ModelUsageLedger`；媒体任务目录与缓存注册到 `ScaleSurface`；不新建第二套账本、证据库或清理规则。

**理由**：仓库已具备跨 Agent 执行账本（含 approval 事件）、运行证据账本（带脱敏）、用量成本账本与输出面注册表（见 3.4）。平行实现会让“四本账”从问题变成架构。

**约束**：任务内 `events.jsonl` 保留为细节层；全局账本只写结构化摘要（含 `metadata.domain='media'`）。媒体成本以 `provider` 维度复用用量记录形状，单位写入 `metadata.unit`。

## 4.5 非功能要求（NFR）

| 维度 | 要求 | 验收方式 |
| --- | --- | --- |
| 并发 | 同一任务同一时刻只有一个执行者；跨进程用文件锁；锁 TTL 覆盖最长 provider deadline 并支持心跳续期（若 `FileLock` 不支持续期，则按 `deadlineAt` 动态传入） | 并发 run 同一任务：一个成功、一个返回状态错误；崩溃后锁可回收 |
| 恢复 | 进程重启后，`running` 且带远程句柄的任务自动回到轮询；无句柄的 `running` 转 `interrupted` | 杀进程重启测试 |
| 持久化 | `job.json` 增加 `recordVersion`；新字段全部可选；旧版本记录可读 | 旧记录回放测试 |
| 存储 | 提交前配额检查；外部副本按 sha256 去重；`render/` 缓存走 `ScaleSurface` TTL | 配额拒绝、去重命中、GC dry-run |
| 时延 | 创建/查询 P95 < 300ms（不含执行）；`wait` 单次 ≤ 50s；远程轮询间隔按 provider 建议且 ≥ 2s | 基准脚本 + 计时断言 |
| 失败隔离 | provider 故障只影响该任务；连续失败触发熔断并保留句柄；不影响旧渲染路径 | 故障注入测试 |
| 预算 | 估算 → 预留 → 结算；实际花费超预留 20% 中止并告警 | 预留/结算单测 + 超支用例 |
| 可观测 | 稳定错误码；结构化事件；按 provider 的时长/失败/成本汇总 | 事件断言 + 指标快照 |
| 安全 | 密钥只从 env 读取；证据脱敏；路径与 SSRF 校验 | 安全专项测试（7.2） |

---

## 5. 契约设计

### 5.1 动作目录（MediaActionManifest）

```ts
// src/media/actions/types.ts
export type MediaRisk = 'low' | 'medium' | 'high';

export interface MediaCostSpec {
  /** 定价表键；null 表示成本未知（fail-closed） */
  pricingKey: string | null;
  /** 估算函数入参来自动作参数 */
  unit: 'image' | 'video_second' | 'speech_char' | 'render_minute' | 'export';
}

export interface MediaApprovalSpec {
  mode: 'never' | 'threshold' | 'always';
  /** 仅 threshold 模式使用，人民币 */
  thresholdCny?: number;
}

export interface MediaActionManifest {
  id: string;                 // media.generate_video
  title: string;              // 生成视频
  description: string;
  risk: MediaRisk;
  cost: MediaCostSpec;
  approval: MediaApprovalSpec;
  longRunning: boolean;
  /** 该动作从哪个里程碑起可用；未到期的动作不暴露给工具/端点 */
  availableIn: 'M0' | 'M2' | 'M4';
  /** 通过哪个 MCP 工具触发；fixed 为固化参数 */
  invoke: { toolName: string; fixed?: Record<string, unknown> };
  /** 该动作在哪些表面可见 */
  surfaces: Array<'mcp' | 'rest' | 'dsh' | 'cli'>;
  /** 参数 JSON Schema（与 MCP 工具入参同源） */
  paramsSchema: Record<string, unknown>;
}
```

动作清单（随里程碑启用）：

| 动作 id | 触发工具 | 风险 | 成本单位 | 长任务 | 启用 |
| --- | --- | --- | --- | --- | --- |
| `media.generate_image` | `media_create_task` (fixed type) | low | image | 否 | M0 |
| `media.render_storyboard` | `media_create_task` (fixed type) | medium | render_minute | 是 | M0 |
| `media.generate_video` | `media_create_task` (fixed type) | high | video_second | 是 | M2 |
| `media.generate_speech` | `media_create_task` (fixed type) | low | speech_char | 否 | M2 |
| `media.export` | `media_create_task` (fixed type) | low | export | 是 | M4 |
| `media.publish_prepare` | `media_create_task` (fixed type) | medium | export | 是 | M4 |

`availableIn` 未到期的动作不出现在 MCP 工具枚举、REST 类型枚举与 DSH 卡片中；`media_estimate_cost` 对未启用动作返回 `action_unavailable`。只读与控制工具（list/get/validate/evidence/estimate/run/wait/cancel/retry/recover）不进动作目录，保持薄封装。

`media.publish_prepare` 不新增任务类型：它是 `export` 请求中携带 `publish` 元数据的模式；manifest 仅用于成本/审批/展示，`invoke` 与 `media.export` 相同（`type='export'`），由参数是否带 `publish` 区分。

`paramsSchema` 是给 MCP 工具声明与文档用的 JSON Schema 元数据；仓库未引入 zod/ajv，M0 不新增校验依赖，实际参数校验仍由现有 `validateStoryboard` / `validateImageRequest` / `validateJobRequests` 负责。

### 5.2 MCP 工具变更

新增：

```ts
// media_run_task
{ taskId: string }                       // 仅接受 created / awaiting 已批准的 created
// media_wait_task
{ taskId: string; maxSeconds?: number }  // 默认 25，上限 50
// media_estimate_cost
{ actionId: string; params: object }     // 返回 { estimatedCny: number | null, breakdown }
```

`media_create_task` 的 `type` 枚举按里程碑扩展：M0 保持 `render | generate_image`，M2 加 `generate_video | generate_speech`，M4 加 `export`。扩展时 registry 漂移测试必须同步通过。

`media_wait_task` 语义：

- 每 500–1000ms 读取一次任务快照；终态立即返回。
- 到达 `maxSeconds` 返回 `{ done: false, job }`，不是错误。
- 不触发执行；只观察。

### 5.3 Provider v2

```ts
// src/media/providers/types.ts（在现有接口上做加法；现有成员保持不变）
export interface VideoGenerationRequest {
  prompt: string;
  durationSeconds: number;              // 4–12
  aspectRatio?: '16:9' | '9:16' | '1:1';
  resolution?: '720p' | '1080p';
  firstFrameAsset?: string;             // 已物化/校验的本地路径
  referenceAssets?: string[];           // 最多 3
  seed?: number;
  signal?: AbortSignal;
}

export interface RemoteVideoHandle {
  providerJobId: string;
  family: string;                       // 适配器内部用于选择 status/fetch 实现
  submittedAt: string;                  // ISO
  deadlineAt: string;                   // ISO，超时即失败
  pollIntervalMs: number;               // 服务端建议
  resumePayload?: Record<string, unknown>; // 不含密钥
}

export type VideoStatus =
  | { state: 'queued' | 'running'; progress?: number }
  | { state: 'completed'; artifactUrl: string }
  | { state: 'failed'; code?: string; message: string };

export type VideoGenerationResult =
  | { kind: 'completed'; artifact: ProviderArtifact }
  | { kind: 'remote'; handle: RemoteVideoHandle };

export interface SpeechGenerationRequest {
  text: string;                         // <= 2000 字符
  voice: string;
  format: 'mp3' | 'wav';
  speed?: number;
}

export interface ProviderHealth { ok: boolean; message: string; }

export interface MediaProvider {
  // —— 现有成员（types.ts:42-50）——
  id: string;
  kind: ProviderKind;
  enabled: boolean;
  getCapabilities(): ProviderCapabilities;
  validateConfig(): ProviderConfigStatus;
  generateImage?(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
  // —— 新增（全部可选）——
  healthCheck?(): Promise<ProviderHealth>;
  generateVideo?(req: VideoGenerationRequest): Promise<VideoGenerationResult>;
  getVideoStatus?(handle: RemoteVideoHandle): Promise<VideoStatus>;
  fetchVideo?(handle: RemoteVideoHandle, destDir: string): Promise<ProviderArtifact>;
  cancelVideo?(handle: RemoteVideoHandle): Promise<void>;
  generateSpeech?(req: SpeechGenerationRequest): Promise<ProviderArtifact>;
}
```

`ProviderCapabilities` 现有字段为 `{ kind, models, async, canEstimate, canCancel, notes }`（`types.ts:7-14`），复用 `async/canEstimate/canCancel` 表达异步与成本/取消能力；仅追加可选细节：

```ts
video?: { maxDurationSeconds: number; aspectRatios: string[]; resolutions: string[] };
speech?: { voices: string[]; formats: string[] };
```

`enabled` 必须是**动态求值**（getter 或每次读取 env），不得像 Suno provider 那样在模块加载时固化（否则运行时开关无效、测试需重置模块缓存）。

### 5.4 DSL 版本

| 版本 | 里程碑 | 变更 | 兼容策略 |
| --- | --- | --- | --- |
| 0.1 | 已交付 | 历史版本（禁止 slide/wipe） | 继续接受 |
| 0.2 | 已交付 | 现状 | 继续接受 |
| 0.3 | M1 | `src` 允许 `asset://<taskId>/assets/<path>` | 加法；旧分镜行为不变 |
| 0.4 | M3 | 新增 `VideoElement`、`AudioTrack`、`subtitleOptions`、场景 `narrationText` | 加法；0.1–0.3 仍可渲染 |

```ts
// 0.4 追加
export interface VideoElement {
  type: 'video';
  src: string;                    // asset:// 或任务内相对路径
  fit?: 'cover' | 'contain';
  muted?: boolean;                // 默认 true
  trimStartMs?: number;
  trimEndMs?: number;
  loop?: boolean;
}

export interface AudioTrack {
  src: string;                    // asset:// 或相对路径
  kind: 'narration' | 'bgm';
  volume?: number;                // 0–1，默认 1
  loop?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface SubtitleSpec {
  mode: 'none' | 'burn' | 'srt' | 'both';
  source?: 'auto' | 'file';
  src?: string;                   // source=file 时必填
}

// 0.4 的 Storyboard 追加（保留已有 subtitles?: SubtitleCue[] 不变）：
export interface StoryboardV04Additions {
  subtitleOptions?: SubtitleSpec;
  audioTracks?: AudioTrack[];
}

// 0.4 的 StoryboardScene 追加：
export interface StoryboardSceneV04 {
  // ...existing id/durationMs/elements/transitionOut...
  narrationText?: string;         // auto 字幕的唯一文本来源；存在 narration 音轨时必填
}
```

约束：

- `asset://` 仅在 0.3+ 允许；0.2 及以下出现 asset ref 一律拒绝，避免旧语义漂移。
- `VideoElement` / `AudioTrack` 仅在 0.4 允许；0.3 及以下出现即拒绝。
- 整个 Storyboard 最多 1 条 `narration`、1 条 `bgm`（场景级音频留待后续版本）；超出 `failed_validation`。
- `subtitleOptions.source='auto'` 时，凡有 narration 音轨的场景必须提供 `narrationText`；缺失则 `failed_validation`。
- 旁白从 0 开始混音；超过成片总时长截断，不足补静音。自动 SRT 按场景时长比例切分 `narrationText`，**不保证与 TTS 音素级对齐**（v1 限制，精确对齐后续再做）。
- `VideoElement.trimStartMs < trimEndMs`，且 `trimEndMs ≤ 素材时长`（渲染期探测，不通过则失败）。
- 视频片段裁剪后的可用长度必须 ≥ 所在场景 `durationMs`；不足时只有 `loop=true` 才允许循环补足，否则 `failed_validation`。场景时长始终是成片时长的权威来源。
- 未知字段策略沿用 v3：顶层未知字段拒绝，元素级未知字段警告（保持现状）。

**版本升级必须同步修改的精确位置**：

| 位置 | 修改 |
| --- | --- |
| `src/media/types.ts:5` | `SCENE_DSL_VERSION` 在 M1 升 `'0.3'`、M3 升 `'0.4'` |
| `src/media/types.ts:7` | `ACCEPTED_DSL_VERSIONS` 累积加入新版本 |
| `src/media/validation/validateStoryboard.ts:11` | `STORYBOARD_LIMITS.acceptedSchemaVersions` 与上同步 |
| `validateStoryboard.ts:63-112` | `validateElement` 增加 video 分支；错误文案白名单加 `video` |
| `validateStoryboard.ts:327-336` | `storyboardAssetRefs` 必须收集 image（M1）、video/audio（M3）引用，否则物化/存在性校验漏检 |
| `validateStoryboard.ts:9-31` | 新上限（视频时长、音轨数、视频扩展名）加入 `STORYBOARD_LIMITS` |
| `src/media/index.ts` | 导出新增类型与函数，保持公共面完整 |

### 5.5 任务状态扩展

新增状态：`awaiting_approval`。现有转移表见 `jobStateMachine.ts:8-18`（`created→validated/failed_validation/cancelled`、`interrupted→running/cancelled` 等）；只追加以下边，不改既有边：

```text
created -> awaiting_approval        （创建时动作要求审批；发生在 createJob 校验通过之后）
awaiting_approval -> created        （批准）
awaiting_approval -> cancelled      （拒绝或过期）
```

`interrupted → running` 已存在，可直接复用于“重启后重新挂起视频任务”。`failed → running` 也已存在，供 retry 使用。

任务记录追加字段：

```ts
interface MediaJob {
  // ...existing
  approval?: { id: string; state: 'pending' | 'approved' | 'rejected'; reason?: string };
  provider?: {
    id: string;
    jobId: string;
    family: string;
    submittedAt: string;
    deadlineAt: string;
    pollIntervalMs: number;
    attempts: number;
    lastPolledAt?: string;
  };
  cost?: { estimatedCny: number | null; actualCny?: number; pricingKey: string | null };
}
```

### 5.6 REST API 变更

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/media/tasks` | M1/M2/M4 | 扩展 `type` 与按类型入参；仍统一 detached |
| POST | `/api/media/tasks/:id/run` | M0 | 启动已创建任务，立即返回快照 |
| GET | `/api/media/tasks/:id` | M2/M4 | 返回值增加 `provider`、`approval`、`cost` |
| POST | `/api/media/approvals/:id/decide` | M2 | `{ decision: 'approve' \| 'reject', note?, run? }` |
| GET | `/api/media/approvals?state=pending` | M2 | 审批收件箱数据源 |
| GET | `/api/media/assets/content?ref=asset://...` | M1 | 复用现有字节端点，新增 ref 解析 |
| POST | `/api/media/plan` | M3 | 模板规划（纯函数，不落盘） |
| POST | `/api/media/templates/:id/assemble` | M3 | 槽位 → 分镜（纯函数） |
| GET | `/api/media/budget` | M2 | 当日预算与已用额度 |

`POST /api/media/tasks` 的兼容形状：`{ storyboard, project?, idempotencyKey? }` 仍然等价于 `type='render'`；新类型使用 `{ type, storyboard? | imageRequest? | videoRequest? | speechRequest? | exportRequest?, project?, idempotencyKey? }`，缺少对应请求体时返回 400，不做隐式猜测。

所有端点沿用现有 `MediaControlPlane` 的错误信封与路径校验；新增路径不得接受任意文件系统路径。审批写端点（`/approvals/:id/decide`）按 ADR-7 做本机/token 校验；其余读端点沿用现状，但不得返回密钥与绝对路径。

### 5.7 新任务请求类型

`MediaJob.input` 现为内联 `{ storyboardFile?, imageRequestFile? }`（`types.ts:152-153`）。按里程碑追加：

```ts
export interface VideoJobRequest {
  providerId: string;
  model?: string;
  prompt: string;                       // 1..4000
  durationSeconds: number;              // 4..12
  aspectRatio?: '16:9' | '9:16' | '1:1';
  resolution?: '720p' | '1080p';
  firstFrame?: string;                  // asset:// 或任务内相对路径
  referenceImages?: string[];           // <= 3
  seed?: number;
}

export interface SpeechJobRequest {
  providerId: string;
  model?: string;
  text: string;                         // 1..2000
  voice: string;
  format: 'mp3' | 'wav';
  speed?: number;                       // 0.5..2
}

export type ExportProfileId = '16x9-1080p' | '9x16-1080p' | '1x1-1080p';

export interface ExportJobRequest {
  sourceTaskId: string;                 // 必须为 succeeded 的 render 任务
  profiles: ExportProfileId[];          // 1..3
  burnSubtitles?: boolean;
  covers?: number[];                    // 毫秒时间点，<= 5 个
  publish?: {
    title: string;                      // 1..100
    description?: string;               // <= 2000
    tags?: string[];                    // <= 20
    platformHints?: string[];
  };
}
```

- 对应输入文件：`video-request.json`、`speech-request.json`、`export-request.json`；`MediaJob.input` 增加同名字段。
- 校验统一放在 `src/media/validation/validateJobRequests.ts`（新增），覆盖长度、枚举、数值范围与 asset ref 语法；`JobService.createJob` 在写盘前调用。
- `firstFrame` / `referenceImages` 只接受 `asset://` 或任务内相对路径，任何绝对路径/盘符/`..` 直接拒绝。
- `ExportJobRequest.sourceTaskId` 必须是同 project、`succeeded` 的 render 任务；导出任务只读源任务。

---

## 6. 里程碑与任务分解

> 每个里程碑独立可合并、可回滚；特性开关默认关闭。工作量单位：人日（pd）。

### M0 — 动作目录与异步语义（3 pd）

**目标**：能力元数据单一来源；长任务可通过 MCP 异步完成。

**新增文件**

- `src/media/actions/types.ts` — 上述 manifest 类型。
- `src/media/actions/manifests.ts` — 6 个生成类动作的声明。
- `src/media/actions/registry.ts` — `listActions()`、`getAction(id)`、`getActionForTool(toolName, fixedType?)`。
- `src/media/actions/pricing.ts` — 静态价格表骨架（M2 填真实值；未知返回 null）。
- `src/media/actions/estimate.ts` — `estimateCost(actionId, params)`。
- `tests/media/actions/registry.test.ts` — 唯一性、schema 合法性、工具枚举一致性。

**修改文件**

- `src/media/mcpTools.ts` — 工具定义从 registry 派生；新增 `media_run_task`、`media_wait_task`、`media_estimate_cost`；更新长任务描述。
- `src/api/mcp.ts` — **无需改动**：媒体工具仍由 `MEDIA_MCP_TOOLS`（`:47`）展开、`MEDIA_TOOL_NAMES`（`:48`）命中、`default` 分支（`:877-879`）分派；M0 只验证这一路径。
- `src/dashboard/MediaControlPlane.ts` — 新增 `POST /tasks/:id/run`，复用 `JobService.runJob` 的 detached 语义（现有 POST /tasks 可继续自动 run）。
- `src/media/index.ts` — 导出注册表、估算与新增类型（公共面 `:5-57`）。
- `src/media/jobs/JobService.ts` — 创建/终态写入 `ExecutionLedger`（`approval.requested/resolved`、`evidence.recorded`、`tool.invoked`，`metadata.domain='media'`）；任务内 `events.jsonl` 保持细节层（ADR-8）。
- 现有 `MediaError`/`MediaErrorCode` 模块 — 增加 `MEDIA_ACTION_UNAVAILABLE`、`MEDIA_ACTION_INVALID_STATE` 等错误码。
- `packages/dsh-scale/src/client.ts` — 工具白名单/卡片加入 3 个新工具。
- `tests/media/mcpTools.test.ts`、`tests/media/jobLifecycle.test.ts` — 覆盖 run/wait 与状态保护。
- `tests/dsh/client.test.ts` — 卡片数量断言 25 → 28（以实际工具总数为准）。

**关键实现点**

- `media_wait_task` 用 `setTimeout` 轮询，单次请求不持有文件句柄；终态早退；上限 50s。
- `media_run_task` 只接受 `created`（或 `awaiting_approval` 已批准后转成的 `created`）；其他状态返回明确错误码。
- `media_run_task` 与 `POST /tasks/:id/run` 都采用 detached：`void runJob(...).catch(...)`，立即返回任务快照（REST 202）；失败通过 `task.json` 与事件体现，不在 HTTP/MCP 响应里等待。
- 注册表漂移测试：`mcpTools` 中每个工具名必须出现在某个 manifest 的 `invoke.toolName`，或显式列入只读/控制白名单。
- 账本适配只写结构化摘要（事件类型、任务 id、动作 id、结果、耗时），不写 storyboard 或 provider 原始响应；大 payload 留在任务目录。
- 不新增账本文件格式：`ExecutionLedger` 追加记录，媒体侧只做映射函数并单测。

**验收（Gate M0）**

- [ ] 契约评审通过：manifest 字段、动作 id、工具名、DSL 版本策略冻结；后续里程碑只增不改。
- [x] `media_create_task → media_run_task → media_wait_task` 用 Mock provider 在 MCP stdio 下跑通；wait 在 50s 内返回。
- [x] 现有 11 个工具行为与返回结构不变；旧前端无需改动。
- [ ] `rtk make gate-quality` 通过；`rtk make verify PROFILE=default` 通过。
      （环境性未通过：G5/verify 仅 root/test 失败，12 个失败均为既有 Windows EPERM 清理与 10s hook 超时，且无媒体用例；G7 因 npmmirror 不支持 audit 端点失败，公共 registry 审计 0 漏洞。）
- [x] 注册表漂移测试、DSH 卡片测试通过。
- [x] `ExecutionLedger` 可检索到 `domain=media` 的 `tool.invoked` / `evidence.recorded` 事件；未新增账本文件格式。

**回滚**：删除新工具与注册表，恢复 `mcpTools.ts` 静态定义；无数据迁移。

---

### M1 — `asset://` 素材回流（3 pd）

**目标**：生成结果可被其他任务引用，渲染前自动物化并可审计。

**新增文件**

- `src/media/assets/refs.ts` — 解析/校验 `asset://<taskId>/assets/<path>`。
- `src/media/assets/materialize.ts` — 复制、重写、幂等、证据记录。
- `tests/media/assets/refs.test.ts`
- `tests/media/assets/materialize.test.ts`

**修改文件**

- `src/media/types.ts` — `schemaVersion` 增加 `'0.3'`；`ImageElement.src` 允许 asset ref（类型不变，语义扩展）。
- `src/media/validation/validateStoryboard.ts` — 识别 asset ref；校验 taskId 字符集、路径归属、扩展名白名单、禁止 `..`/绝对路径/盘符。
- `src/media/render/RenderOrchestrator.ts` — 阶段顺序改为 `materialize → validate_assets → prepare → capture → ...`；materialize 返回新 Storyboard，`prepare` 必须用它生成 `page.html`；仅在有外部 ref 时执行复制，否则原样返回。
- `src/dashboard/MediaControlPlane.ts` — `assets/content` 支持 `ref` 参数；`CONTENT_TYPES`（`:33-45`）补视频/音频/字幕 MIME；权限与路径检查复用。
- `src/media/index.ts` — 导出 refs/materialize API。
- `dashboard/web/src/components/MediaStudio.vue`、`MediaCanvasEditor.vue` — 增加“插入生成结果”选择器，列出已完成生成任务及其资产，插入 `asset://` 引用。
- `dashboard/web/src/components/media-types.ts`（若类型仍内联则先抽出）— 与后端类型对齐。
- `docs/media/storyboard-format.md` — 记录 0.3 的 asset ref 语义与错误码。

**物化规则**

1. ref 形状固定为 `asset://<taskId>/assets/<rest>`；`rest` 不得为空、不得含 `..`/绝对路径/盘符。源任务必须存在、同 project、状态为 `succeeded`。
2. 目标路径：`taskDir/assets/external/<sourceTaskId>/<rest>`（去掉 ref 中的 `assets/` 前缀，避免 `assets/external/.../assets/...` 双重嵌套）；已存在且 sha256 相同则跳过。
3. 返回一份新的 Storyboard（不可变）：ref 重写为任务内相对路径；后续阶段只用返回值，不修改入参。落盘的是物化后副本与映射记录。
   - **实现注记**：`ImageElement.src` 由 `SceneRenderer` 按任务 `assets/` 目录解析，因此 `src` 实际重写为 `external/<sourceTaskId>/<rest>`；落盘路径与证据里的 `destPath` 仍是 `assets/external/<sourceTaskId>/<rest>`（避免渲染出 `assets/assets/...`）。
4. 证据追加 `asset_materialized` 事件：`{ ref, sourceTaskId, sourceSha256, destPath, bytes }`。
5. 创建时只做语法 + 源任务存在性检查，源缺失 → `failed_validation(asset_ref_missing)`；渲染物化时再检查，缺失/哈希不匹配 → `failed(asset_ref_missing|asset_ref_corrupt)`（运行期错误不伪装成校验失败）。
   - **实现注记**：创建期检查在幂等去重之后、创建锁内执行，源缺失直接抛 `MEDIA_ASSET_REF_MISSING`（不落任务）；因此幂等重放即使源任务后来被删也仍返回原任务。`MEDIA_ASSET_REF_*` 全部沿用既有错误码体系，未新增 `asset_ref_*` 小写码。

**验收（Gate M1）**

- [x] 0.2 与 0.3 分镜均可校验；合法 asset ref 渲染成功。（证据：`tests/media/storyboardValidation.test.ts`、`tests/media/renderPipeline.test.ts` 的真实渲染用例）
- [x] 越界路径（`../`、绝对路径、盘符、跨 project、非白名单扩展名）全部拒绝，且有单测。（证据：`tests/media/assets/refs.test.ts`、`tests/media/assets/materialize.test.ts`、`tests/media/storyboardValidation.test.ts`）
- [x] 物化幂等：同一任务重试不产生重复副本；映射写入证据。（证据：`tests/media/assets/materialize.test.ts`）
- [ ] 画布可从已完成任务插入素材并渲染。（实现完成且 `vite build` 通过；缺浏览器交互 E2E，未勾选）
- [ ] `make gate-quality` / `make verify PROFILE=default` 通过。（M1 改动的测试面已全绿；完整 gate/verify 未在本机复跑，见 `verification.md`）

**回滚**：删除 materialize 阶段与新端点参数；0.3 分镜降级为不可提交；已物化文件不影响旧任务。

---

### M2 — Provider v2、视频生成与成本闸门（9 pd，含 S0）

**目标**：视频/语音 provider 可插拔；远程任务可轮询、下载、恢复；成本与审批 fail-closed。

**前置 S0 — provider 技术验证（2 pd，未通过不进入 M2 实现）**

- 用真实 key 验证 Seedance/Seedream：提交、轮询、结果 URL 有效期、取消、失败码；只做最小调用，录制脱敏 fixtures。
- 产出 `docs/plans/2026-10-29-media-provider-spike.md`（端点、鉴权、状态机、样例响应、定价、配额）与 `tests/media/providers/fixtures/`。
- 退出标准：能写出仅依赖 env 的 adapter 骨架并通过录制夹具测试；否则 M2 缩为“已确认 provider + Mock”，并在计划中记录缩减决定。

**S0 执行记录（2026-10-29，缩减决定）**

本机未提供任何真实 provider 凭据：`MEDIA_SEEDANCE_API_KEY`、`ARK_API_KEY`、`VOLCENGINE_API_KEY` 均未设置，仓库无 `.env`；且按既定约束不引入/复用竞品包。因此 S0 的真实提交、轮询、结果 URL、取消与失败码验证**无法执行**，也无法录制脱敏 fixtures。

按退出标准，M2 缩减为：

- **完整实现**：MockVideoProvider、MockSpeechProvider、视频/语音异步编排（轮询/超时/取消/重启恢复）、审批、预算预留/结算、配额、成本映射、长任务锁 TTL。
- **实现但不声明已验证**：OpenAI 兼容 speech adapter（公开 `/audio/speech` 契约、仅 env 配置、可注入 fetch 的契约测试）；默认 `MEDIA_FEATURE_SPEECH=off`，live 状态标记 `[UNCERTAIN]`。
- **不实现**：Seedance / 其他 live video adapter。端点、鉴权与模型名未经真实调用确认，写死猜测违反“没有验证不说通过”；待拿到 key 后补 S0，再按其结论落地。
- Gate M2 的验收项本身均为 Mock / 治理路径，不依赖真实 key；live provider 验证在 Gate 中保持未覆盖并记录。

**新增文件**

- `src/media/providers/video/MockVideoProvider.ts` — 状态机：queued → running → completed/failed/timeout；用于测试与无密钥演示。
- `src/media/providers/video/SeedanceProvider.ts` — 提交、查状态、下载；端点与模型名由 env 配置。
- `src/media/providers/speech/MockSpeechProvider.ts`
- `src/media/providers/speech/OpenAISpeechProvider.ts` — 复用 OpenAI 兼容网关的 `/audio/speech`。
- `src/media/jobs/VideoOrchestrator.ts` — submit → persist handle → poll → download → commit。
- `src/media/jobs/SpeechOrchestrator.ts`
- `src/media/validation/validateJobRequests.ts` — video/speech 请求校验（M4 扩展 export）。
- `src/media/actions/MediaCostAdapter.ts` — 把 provider 花费映射为 `ModelUsageLedger` 记录（provider 维度，`metadata.unit`/`metadata.domain='media'`），不新建账本（ADR-8）。
- `src/media/approvals/types.ts`、`src/media/approvals/ApprovalStore.ts`、`src/media/approvals/policy.ts`
- `src/media/storage/QuotaGuard.ts`
- `tests/media/providers/video/contract.test.ts`（Mock 契约）
- `tests/media/validation/validateJobRequests.test.ts`
- `tests/media/jobs/videoOrchestrator.test.ts`（轮询/超时/取消/恢复）
- `tests/media/approvals/policy.test.ts`
- `tests/media/actions/mediaCostAdapter.test.ts`

**修改文件**

- `src/media/providers/types.ts` — Provider v2 接口与请求/结果类型。
- `src/media/providers/ProviderRegistry.ts` — 注册新 provider；`listProviders` 返回可由 registry 生成的描述。
- `src/media/types.ts` — 任务类型增加 `generate_video`、`generate_speech`；状态增加 `awaiting_approval`；任务记录增加 provider/approval/cost。
- `src/media/jobs/jobStateMachine.ts` — 追加审批边。
- `src/media/jobs/JobService.ts` — `CreateJobOptions` 增加 `videoRequest`/`speechRequest`（M4 加 `exportRequest`）；`createJob` 写盘前执行 `preflight`（配额、预算、审批）；`runJob` 再复核一次（防绕过）；`runJob` 对 `awaiting_approval` 必须拒绝（批准后由审批服务转 `created`）。
- `src/media/jobs/JobStore.ts` — `recoverInterruptedJobs` 扩展：有 provider 句柄且未过期 → 重新挂起；过期 → `failed(provider_timeout)`；无句柄 → 维持 interrupted。
- `src/media/jobs/JobService.ts:31-33` — 运行锁 TTL：远程视频可能超过 30 分钟；按任务 `deadlineAt + 10min` 动态传入，或在轮询期间续期（`src/core/FileLock.ts` 若无续期 API，则采用动态 TTL）。
- `src/media/mcpTools.ts` — create 类型枚举扩展；工具描述更新；`media_estimate_cost` 接入真实定价。
- `src/dashboard/MediaControlPlane.ts` — tasks 支持新类型；审批端点；budget 端点；task 详情带 provider/approval/cost；`POST /tasks` 仅在创建结果为 `created` 时 detached run，`awaiting_approval` 返回 202 但不启动。
- `src/dashboard/DashboardServer.ts:1853` — 把 `this.host` 传入 `registerMediaApi`，供审批端点做本机判定。
- `src/media/actions/pricing.ts` — Seedance、Seedream、语音定价；未知模型 → null；本机动作（render/export）定价为 0 而非 null；定价表带 `updatedAt` 与 owner，过期 90 天告警。
- `src/runtime/ModelUsageLedger.ts` / `src/runtime/CostAnalyzer.ts` — 复用记录形状；`CostAnalyzer` 增加 `byDomain` 聚合（ADR-8）。
- `src/runtime/ExecutionLedger.ts` — 审批 `requested/resolved` 事件由媒体审批服务写入，`metadata.domain='media'`。
- `dashboard/web/src/components/MediaStudio.vue` — 任务列表展示 provider 状态/成本/审批状态。

**远程任务生命周期**

```text
created --run--> running --submit--> running(provider.jobId)
   ├─ poll completed --> download --> packaging --> succeeded
   ├─ poll failed    --> failed(provider_failed)
   ├─ deadline       --> failed(provider_timeout)  [保留 jobId 供人工核查]
   ├─ cancel         --> cancelled（尽力调用 cancelVideo）
   └─ 进程重启        --> reattach（未过期）/ failed（已过期）
```

- 轮询间隔取 provider 建议值，钳制在 2s–30s；连续 3 次网络错误后指数退避，不直接失败。
- 下载写入 `assets/generated/<taskId>.mp4`（或 `.mp3`），先写 `.part` 再原子改名；禁止用远端 id 作文件名。
- 下载 URL 仅允许 https 或 allowlist 主机；拒绝私网地址；`MEDIA_PROVIDER_ALLOW_LOCAL=1` 时才允许 localhost（沿用现有变量语义）。
- 参考图只接受已校验的项目资产路径，大小上限 10MB，base64 上传；不接受任意本地路径。

**成本与审批**

- 审批模式：`MEDIA_APPROVAL_MODE=off|threshold|always`，默认 `threshold`。
- 阈值：`MEDIA_APPROVAL_THRESHOLD_CNY`，默认 5。
- 组合规则：`off` → 全部跳过；`always` → 全部审批；`threshold` → 动作 manifest 为 `never` 则不审批，否则按估算与阈值比较（成本未知视为需审批）。
- 预算：`MEDIA_DAILY_BUDGET_CNY`，默认 50；超限在 `preflight` 拒绝，错误码 `budget_exceeded`。
- 预算执行采用“估算 → 预留 → 结算”：创建时预留估算额；终态按实际花费结算并释放差额；实际超预留 20% 中止后续步骤并告警；预留带过期时间，进程崩溃后可回收。
- 成本未知（pricing 返回 null）→ 视为需审批；本机动作（render/export）成本为 0，不需要审批（除非动作显式 `always`）。
- 审批记录追加到 `.scale/state/media/approvals.jsonl`；成本以 provider 维度写入既有用量账本（`ModelUsageLedger`），任务详情内嵌摘要；不新增 `cost-ledger.jsonl`（ADR-8）。
- 过期检查采用惰性方式：在审批列表、任务详情与 `recoverJobs` 时检查 `MEDIA_APPROVAL_TTL_MINUTES`，过期转 `cancelled`；不新增常驻定时器。
- 审批通过前不提交 provider；拒绝 → `cancelled`。
- 批准 → `awaiting_approval → created`；`decide` 请求体可带 `run: true`，表示批准后立即 detached 运行（默认 false，由调用方显式触发）。
- **审批端点访问控制**：Dashboard 默认监听 `0.0.0.0` 且无鉴权。审批端点只允许两种情况：`registerMediaApi` 收到的 `host` 为回环地址（`127.0.0.1`/`localhost`/`::1`），或请求头 `x-scale-token` 匹配 `SCALE_MEDIA_APPROVAL_TOKEN`。否则返回 403 并提示绑定回环或配置 token。`MediaApiOptions.host` 为可选；未提供时按“非本机”处理（必须带 token），避免测试或新调用方意外放开。该检查在 `MediaControlPlane` 内实现，测试通过注入 `host` 覆盖。
- 审批端点不做 CSRF 例外：写操作要求 `Content-Type: application/json`，不提供 GET 触发变更。

**新增环境变量（全部可选）**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MEDIA_FEATURE_VIDEO` | `off` | `off` / `mock` / `live` |
| `MEDIA_FEATURE_SPEECH` | `off` | `off` / `mock` / `live` |
| `MEDIA_SEEDANCE_BASE_URL` | 空 | live 模式必填 `[UNCERTAIN]` 具体端点 |
| `MEDIA_SEEDANCE_API_KEY` | 空 | 仅从环境读取，不落盘 |
| `MEDIA_SEEDANCE_MODEL` | 空 | 模型 id `[UNCERTAIN]` 以官方文档为准 |
| `MEDIA_SPEECH_BASE_URL` / `_API_KEY` / `_MODEL` / `_VOICE` | 空 | OpenAI 兼容网关 |
| `MEDIA_APPROVAL_MODE` | `threshold` | 见上 |
| `MEDIA_APPROVAL_THRESHOLD_CNY` | `5` | 见上 |
| `MEDIA_DAILY_BUDGET_CNY` | `50` | 见上 |
| `MEDIA_APPROVAL_TTL_MINUTES` | `1440` | 待审批过期时间；过期视为拒绝 |
| `SCALE_MEDIA_APPROVAL_TOKEN` | 空 | 远程访问审批写端点的 token；为空则仅回环可用 |
| `MEDIA_APPROVAL_WEBHOOK_URL` | 空 | 通用审批通知 webhook（M4） |
| `MEDIA_APPROVAL_FEISHU_CHAT_ID` | 空 | 可选：复用 lark-cli 实发到该会话（M4） |
| `MEDIA_PROJECT_QUOTA_MB` | `2048` | 项目素材上限 |
| `MEDIA_MIN_FREE_MB` | `1024` | 磁盘最低余量 |
| `MEDIA_KEEP_FRAMES` | `1` | 成功渲染后保留中间帧的天数；0 表示立即清理 |
| `MEDIA_GC_MIN_AGE_DAYS` | `14` | GC 候选的最小年龄 |

特性开关语义：`off` = provider 不注册、不出现在 `listProviders`；`mock` = 注册 Mock provider（无需密钥，可完整跑契约/演示）；`live` = 注册真实 provider，`validateConfig` 不通过时仍可见但不可用，并给出缺哪些 env。开关在每次读取时求值，不在模块加载时固化。

**验收（Gate M2）**

- [x] MockVideoProvider 全状态机契约测试通过（含超时、取消、恢复）。
  - 证据：`tests/media/videoSpeech.test.ts`（submit/completed、failed、expired、deadline 超时 + provider cancel、provider-reported cancel、restart reattach、过期 handle 恢复）。
- [x] `MEDIA_FEATURE_VIDEO=mock` 下，MCP 异步链路完成一次视频“生成”并落盘。
  - 证据：`tests/media/mcpTools.test.ts` "runs the async video chain end-to-end"（create→run→wait→`assets/generated.mp4`）。
- [x] 进程重启测试：运行中的 mock 视频任务恢复轮询并完成；过期任务标 `provider_timeout`。
  - 证据：`videoSpeech.test.ts` 的 reattach 用例（不二次提交）与 `recoverJobs` 用例（`provider_handle_expired` → `failed/MEDIA_PROVIDER_TIMEOUT`）。
- [x] 审批：低于阈值直接执行；高于阈值停在 `awaiting_approval`；拒绝后为 `cancelled`；未知成本必须审批。
  - 证据：`tests/media/approvals.test.ts`（未知成本、阈值 0 边界、拒绝、批准后真实执行）。
- [x] 审批端点访问控制：`host=0.0.0.0` 且无 token → 403；`host=127.0.0.1` → 可用；正确 token → 可用。
  - 实现偏差：不引入 `host` 选项，改为按**真实对端地址**判断（非回环即 403），语义等价且更严格；token 支持 `x-media-approval-token` / `x-scale-token` 与 `MEDIA_APPROVAL_TOKEN` / `SCALE_MEDIA_APPROVAL_TOKEN`。
  - 证据：`tests/dashboard/mediaApi.test.ts` M2 approvals（非回环 403、回环 200、token 200、错 token 403）。
- [x] 审批绕过测试：未批准时直接 `media_run_task`、retry、recover 都被拒绝。
  - 证据：`approvals.test.ts` "retry and recover never bypass a pending approval"；MCP 与 REST 的 `MEDIA_APPROVAL_REQUIRED` 用例。
- [x] 预算超限与配额不足均在提交前拒绝，且有错误码。
  - 证据：`tests/media/budget.test.ts`（`MEDIA_BUDGET_EXCEEDED`）、`tests/media/quotaGuard.test.ts`（`MEDIA_QUOTA_EXCEEDED`，任务失败且未调用 provider）。
  - 诚实说明：当前没有已确认的正价动作，JobService 层预算拒绝路径端到端不可触发；预算拒绝在 ledger 层已用真实写入证明。
- [x] 成本记录可在 `CostAnalyzer` 的 `byDomain=media` 中汇总；未产生第二套成本账本。
  - 证据：`tests/media/costAggregation.test.ts`（`byDomain.media={calls:2,costCny:1.25}`、`Media spend` 行、media 记录无 USD 估算）。
- [x] 预算预留/结算：成功任务释放差额；超支任务中止并告警；崩溃后过期预留可回收。
  - 证据：`budget.test.ts`（settle 2 释放 1、TTL 回收）；实际超估算 20% 写 warning 日志（代码路径，未断言日志）。
- [x] 长任务超过 30 分钟时运行锁仍有效（动态 TTL 或续期），完成后释放。
  - 证据：`videoSpeech.test.ts` TTL 断言（video 70 min > 3600s 轮询上限，render 30 min）；锁在 `finally` 释放。
- [x] 路径安全测试：参考图越界、下载 URL 私网、远端 id 注入文件名全部拒绝。
  - 证据：`validateJobRequests`/`videoSpeech.test.ts`（越界、10 MB 上限、`http://127.0.0.1` 下载拒绝、`../../evil.ps1` jobId 仍落 `assets/generated.mp4`）。
- [x] 密钥不出现在日志、任务记录、证据中。
  - 证据：`tests/media/providers.test.ts` 全任务目录 + ExecutionLedger + ModelUsageLedger 扫描不含测试密钥；语音证据不含输入文本。
- [x] 全部既有测试通过；`make gate-quality` / `make verify PROFILE=default` 通过。
  - 证据：`bash scripts/gates/all.sh --quality`（Windows 无 `make`，即 gate-quality 本体）→ **passed 12 / failed 0**，505 s；G5 全量测试 258 文件 / 2489 通过 / 1 跳过。
  - 首轮失败的唯一用例是 `openclaw-adapter` 的 Windows `EPERM` 临时目录清理（与媒体无关）；已按仓库既有约定加 `maxRetries/retryDelay`，3 次隔离复跑 79/79，随后全量门禁全绿。详见 `verification.md`。

**回滚**：`MEDIA_FEATURE_VIDEO=off`、`MEDIA_FEATURE_SPEECH=off`；删除新 provider 注册；审批表可弃用（append-only 文件不影响旧任务）。

---

### M3 — 成片：拼接、配音、字幕、模板向导（7 pd）

**目标**：分镜支持视频与音频；产出带配音/字幕的成片；提供三条模板线。

**新增文件**

- `src/media/render/ClipComposer.ts` — 分段生成与拼接。
- `src/media/render/OverlayRenderer.ts` — 视频场景的文字/图形透明层渲染（复用 SceneRenderer 的 HTML/CSS）。
- `src/media/render/AudioMixer.ts` — 旁白 + BGM 混音、淡入淡出。
- `src/media/render/SubtitleBuilder.ts` — 自动 SRT（按场景旁白文本与时长比例切分）。
- `src/media/templates/types.ts`、`src/media/templates/builtin.ts`、`src/media/templates/assemble.ts`
- `tests/media/render/clipComposer.test.ts`（用 lavfi 生成微型素材）
- `tests/media/render/audioMixer.test.ts`
- `tests/media/templates/assemble.test.ts`
- `tests/fixtures/media/video/*`（< 200KB 的测试片段生成脚本，不入库大文件）

**修改文件**

- `src/media/types.ts` — DSL 0.4：VideoElement、AudioTrack、`subtitleOptions`、场景 `narrationText`；`SCENE_DSL_VERSION`/接受列表同步（见 5.4 表）。
- `src/media/validation/validateStoryboard.ts` — 0.4 规则：音轨数量、裁剪区间、字幕来源、轨道与元素引用合法性；`storyboardAssetRefs`（`:327-336`）收集 video/audio。
- `src/media/render/RenderOrchestrator.ts` — 检测视频/音频元素后走 ClipComposer 分支；纯图片分镜保持原路径。0.4 且 `subtitleOptions.source='auto'` 时，在 `prepare` 前用 SubtitleBuilder 生成 cues 并注入 Storyboard（不可变替换），确保 `buildSrt` 使用新 cues。
- `src/media/render/FfmpegAdapter.ts` — 增加 `normalizeClip`、`overlayPng`、`concatSegments`、`mixAudio`、`muxAudio`、`ensureSilentAudio`。
- `src/media/render/SceneRenderer.ts` — `buildPageHtml` 支持透明背景（供 OverlayRenderer）；`elementContent` 对 video 元素不生成 `<img>`（视频画面由 ffmpeg 合成）。
- `src/media/jobs/JobService.ts` — `generate_speech` 分派；渲染前置检查音轨素材。
- `src/media/index.ts` — 导出 ClipComposer、AudioMixer、SubtitleBuilder 与模板 API。
- `src/dashboard/MediaControlPlane.ts` — `/plan`、`/templates/:id/assemble`。
- `dashboard/web/src/components/MediaStudio.vue` — “向导”标签页：选模板 → 填槽位 → 逐项生成 → 预览 → 渲染。
- `dashboard/web/src/components/MediaCanvasEditor.vue` — 支持视频元素与音频轨编辑（最小集：选择、裁剪、音量）。
- `docs/media/storyboard-format.md` — 记录 0.4 元素、音轨、字幕与限制。

**渲染策略（混合式）**

1. 图片场景：沿用 Playwright 截图 + 现有转场。
2. 视频场景：ffmpeg 裁剪/缩放/补边 → 叠加由 OverlayRenderer 生成的透明 PNG（文字/图形）→ 输出与图片场景同编码参数的片段。**视频场景内的元素动画不生效**，只做静态叠加；需要动画时改用图片场景。混合分镜中，图片场景仍由 Playwright 捕获，视频场景由 ClipComposer 生成，不得对视频场景做整段截图。
3. 拼接：所有片段统一编码参数后用 concat demuxer `-c copy`；片段间默认硬切。**视频场景之间的 xfade 不在本阶段**，文档明确。
4. 音频：0.4 路径下旁白与 BGM 混音；无音频轨时补静音轨。0.2/0.3 纯图片路径保持现有 440Hz 占位行为不变，避免回归。
5. 字幕：`auto` 时按场景旁白生成 SRT；`burn` 用现有 `subtitles` 滤镜；`srt` 仅随输出附带。

**模板（v1 三条）**

| id | 名称 | 画幅 | 槽位 |
| --- | --- | --- | --- |
| `talking-head` | 口播讲解 | 9:16 | 1 视频/图 + 每场景旁白 |
| `product-showcase` | 产品展示 | 16:9 | 3–6 图片/视频 + BGM |
| `fast-cuts` | 图文快剪 | 1:1 | 4–8 图片 + 旁白/字幕 |

- `/plan` 返回 `{ draft, slots[], estimate }`，纯函数、不落盘。
- 向导逐步调用公开任务 API；服务端不引入隐藏流水线。一键流水线（服务端编排）列为后续项，不在本计划。

**验收（Gate M3）**

- [x] 含 1 个视频片段 + 旁白 + 字幕的分镜渲染成功，输出可播放且音画时长一致。
  - 证据：`tests/media/render/composedPipeline.test.ts` — 2 个视频幕 + 旁白音轨 + `mode:'both'` 自动字幕，经 `createJob → runJob` 产出 `output/final.mp4`（h264/aac、320×180，时长 ≈2 s，±0.5 s）与 `output/subtitles.srt`；阶段为 `compose_segments → audio_mix → mux`，无 `capture/encode`。
- [ ] 纯图片分镜输出与 M2 前逐帧一致（回归对比）。
  - 未验证：没有做像素级逐帧对比。已确认纯图片 0.4 分镜仍走旧管线（`composedPipeline` 用例 3 断言 `capture/audio/encode` 且无 `compose_segments/mux`），但“与 M2 前逐帧一致”未测量，M2 产物也未在同一工作区保留作基线。
- [ ] 视频裁剪越界、双旁白、未知音轨类型均 `failed_validation`。
  - 部分达成（语义偏差，故不勾选）：双旁白 / 未知音轨类型在**创建任务时**即被校验器拒绝（400 `MEDIA_STORYBOARD_INVALID`，任务不落盘；`tests/media/storyboardValidation.test.ts`）；裁剪越界 / 未循环短片在 `compose_segments` 阶段失败，任务落 `failed` + `MEDIA_STORYBOARD_INVALID`（`clipComposer.test.ts`、`composedPipeline.test.ts` 断言 `stage_failed`）。状态机没有 `running → failed_validation` 迁移，`failed_validation` 从不写入。
- [x] 自动 SRT 在样例上条目数 = 旁白句数，时间轴单调不重叠。
  - 证据：`tests/media/render/subtitleBuilder.test.ts` — 2 幕 3 句 → 3 条 cue，时间轴 0–4000 ms 且逐条 `startMs >= 上一条 endMs`。唯一偏差：短于 200 ms 的 cue 会并入前一条（避免闪现字幕），此时条目数少于句数。
- [x] 三条模板均可 plan → 生成素材 → assemble → render 全流程（Mock 素材）。
  - 证据：`tests/media/templates/renderFlow.test.ts` 以 `MEDIA_M3_FULL_RENDER=1` 实跑——talking-head 5381 ms、product-showcase 16410 ms、fast-cuts 15123 ms，3 passed / 3 skipped，37.54 s，三条均落 `output/final.mp4`。
- [x] ffmpeg 缺失时测试显式 skip 并给出原因，不静默通过。
  - 证据：`clipComposer` / `audioMixer` / `composedPipeline` / `renderFlow` 均有顶层 `it.skipIf` 用例与说明文字；缺少 Chromium 时视频幕叠加与模板全渲染腿同样显式 skip。
- [ ] `make gate-quality` / `make verify PROFILE=default` 通过。
  - M3 期末状态（如实记录）：两次全量门禁 11/12 通过，唯一失败 G5 `tests/workflow/phaseCli.test.ts` 为预存在 Windows EPERM 临时目录清理 flake（2542 passed / 1 failed / 8 skipped；该文件单独重跑 4 次均 46/46 通过）。无任何媒体测试失败，但门禁整体未通过，故不勾选。M4 改动落地后需重新运行门禁再评估。

**回滚**：0.4 分镜不再被接受（校验层降回 0.3）；渲染分支保留但入口关闭；模板 API 下线不影响既有任务。

---

### M4 — 导出包、审批收件箱、发布准备（5 pd）

**目标**：一次成片多规格交付；高成本动作有可视化审批；产出发布包。

**新增文件**

- `src/media/export/profiles.ts` — 16:9 1080p、9:16 1080p、1:1 1080p；封面时间点。
- `src/media/export/ExportOrchestrator.ts` — 源任务 → 多规格转码/裁切 → 封面 → 字幕 → 发布包。
- `src/media/export/PublishPackage.ts` — `publish/manifest.json` 生成与校验。
- `src/media/publish/PublishAdapter.ts` — 仅接口与空实现注册表（不接平台）。
- `src/media/approvals/notify.ts` — 审批通知：Feishu 实发（可选）或通用 webhook；失败只告警。
- `src/media/storage/AssetIndex.ts` — 扫描任务与引用，提供 GC 候选集。
- `src/media/storage/gc.ts` — 清理中间产物/孤儿 external 副本（默认 dry-run）；可清理范围与 TTL 从 `ScaleSurface` 注册表读取，不自定义删除规则（ADR-8）。
- `tests/media/export/exportOrchestrator.test.ts`
- `tests/media/export/publishPackage.test.ts`
- `tests/media/approvals/notify.test.ts`
- `tests/media/storage/gc.test.ts`

**修改文件**

- `src/media/types.ts` — 任务类型增加 `export`；`ExportJobRequest` 与 `MediaJob.input.exportRequestFile`。
- `src/media/validation/validateJobRequests.ts` — 扩展 export 请求校验（源任务存在且 succeeded、规格枚举、封面时间点）。
- `src/media/jobs/JobService.ts` — export 分派。
- `src/media/mcpTools.ts` — create 类型枚举加 `export`；描述说明“仅本地产包”。
- `src/dashboard/MediaControlPlane.ts` — 审批列表/决定端点已在 M2 提供；M4 只补 export 任务创建与收件箱所需的查询字段，不重复实现端点。
- `dashboard/web/src/components/MediaStudio.vue` — “交付”标签页：选择规格、封面时间点、生成导出包；审批收件箱。
- `packages/dsh-scale/src/commandsBridge.ts` — 可选：新增 `scale-media-approvals` 命令（若 DSH 侧需要）。
- `src/cli/mediaCommands.ts` — 新增 `export`、`approvals`、`gc` 子命令并挂到根 `media` 映射（`:357-369`）；`gc` 默认 dry-run，`--apply` 才删除。
- `src/cli/mediaCommands.ts` 的 `doctor`/`providers` — 覆盖视频/语音 provider 配置检查与 ffmpeg 能力探测。
- `src/surface/ScaleSurface.ts` — 注册媒体任务目录（state/cache）与 `render/` 中间产物（tmp）；evidence 与任务记录保持不可清理。

**导出规则**

- 目标画幅从源画幅中心裁切/补边；v1 仅中心构图。
- 每个规格输出 `output/exports/<profile>.mp4`；封面 `output/exports/<profile>-cover.jpg`。
- 字幕：沿用源任务 SRT；按规格选择 burn 或旁挂。
- 无音轨源：补静音轨后再转码。
- 产物全部写入新任务目录，源任务只读；证据记录 `sourceTaskId`、规格、哈希。

**发布包**

```json
{
  "version": "1.0",
  "sourceTaskId": "...",
  "createdAt": "...",
  "title": "...",
  "description": "...",
  "tags": ["..."],
  "platformHints": ["douyin", "xiaohongshu"],
  "assets": [{ "profile": "9x16-1080p", "video": "9x16-1080p.mp4", "cover": "9x16-1080p-cover.jpg", "subtitles": "9x16-1080p.srt" }]
}
```

标题/描述/标签来自用户在导出参数中的输入，不做 LLM 生成；`platformHints` 仅提示，不产生外部调用。

**审批收件箱**

- 列表：待审批任务（动作、成本估算、参数摘要、创建时间）。
- 操作：批准 / 拒绝（可填备注）。
- 通知：`MEDIA_APPROVAL_FEISHU_CHAT_ID` 配置且 `lark-cli` 可用时，复用 `buildFeishuSendMessageCommand({ dryRun: false })` 实发（`FeishuChannelProvider.ts:67-87`）；否则 POST `MEDIA_APPROVAL_WEBHOOK_URL`。两者都是尽力而为，失败只写日志/事件，不阻塞审批状态。
- 过期：`MEDIA_APPROVAL_TTL_MINUTES` 默认 1440；过期视为拒绝，任务取消并记录原因。
- 不改造 Agent OS Workbench 的审批聚合（其当前只有展示、无操作按钮）；媒体审批走独立存储与端点，避免与 Agent OS 检查点语义混淆。

**验收（Gate M4）**

- [x] 同一成片导出三种规格，分辨率/画幅/时长断言通过；封面可抽取。
  - 证据：`tests/media/export/exportOrchestrator.test.ts` — 640×360 源 → 1920×1080 / 1080×1920 / 1080×1080（h264，时长 ±0.5 s），每规格封面 JPEG magic 校验，`transcode:<id>`/`cover:<id>` 阶段事件，源任务输出保持原样。
- [x] 发布包结构通过 schema 校验；缺少必填元数据时拒绝导出并给出字段名。
  - 证据：同文件用例 2/5 — 带 publish 块生成 `publish/manifest.json` 且 `validatePublishManifest` 0 issues；缺 `title` 在创建期即拒绝，错误消息包含字段名；空 assets 被 schema 标记。
- [x] 审批收件箱可批准/拒绝；决定进入证据；过期自动取消。
  - 证据：M2 机制（`tests/media/approvals.test.ts` 决定/过期/证据）未回退；M4 新增 `scale media approvals list|decide` CLI（smoke 实测）与通知事件 `approval_notified`。
- [x] webhook 失败不影响审批结果，且日志有明确原因。
  - 证据：`tests/media/approvals/notify.test.ts` 7 passed — 不可达端口返回 `{channel:'webhook',ok:false,reason}`、无 channel 时 no-op、飞书优先且失败仅告警、本地回环 webhook 实收（子进程接收器）。
- [x] `media gc` 默认只列候选、不删除；`--apply` 只清理中间产物与孤儿 external 副本，生成产物与任务记录保持不动。
  - 证据：`tests/media/storage/gc.test.ts` 8 passed — dry-run 默认零删除；apply 后 render/ 与孤儿 external 消失而 `task.json`/`events.jsonl`/`evidence/`/`output/`/`assets/` 存活；毒化 plan 与重复 apply 均被拒绝。
- [x] GC 的可清理范围来自 `ScaleSurface` 注册（evidence/specs 永不清理），媒体未自定义删除规则。
  - 证据：`src/media/storage/gc.ts` 的 `assertDeletable` 在删除前重放 `src/surface/ScaleSurface.ts` 的 `classifyMediaPath`（render/ → tmp）；`mediaSurfaceRoots()` 注册媒体任务目录（state）、evidence（永不清理）与 render/（tmp）。媒体侧无独立删除规则表。
- [x] 未实现任何平台直发；`PublishAdapter` 无外部调用。
  - 证据：`src/media/publish/PublishAdapter.ts` 仅有接口 + `local-preview`（描述性预览，零网络/进程调用），经代码检视确认（无平台集成测试，因按计划 M4 不做平台）。
- [x] `make gate-quality` / `make verify PROFILE=default` 通过。
  - 第一次实跑（M4 落地后）：11/12 — G5 `tests/integration/openclaw-adapter.test.ts` 两例 Windows EPERM 临时目录清理 flake（与媒体无关，隔离重跑 15/15 通过；与 M3 期末 phaseCli 同类）。
  - 第二次实跑（复跑，`bash scripts/gates/all.sh --quality`）：**12/12 通过**，G5 `root/test` / `root/build` / `root/lint` / `root/typecheck` 全绿，本轮无 EPERM 失败（首次运行的两例失败为 flake 而非回归）。据此勾选。

**回滚**：关闭 export 类型；删除导出入口；发布包为普通文件，无外部副作用。

---

### M5 — DSH 升维与 Cortex 回流（4 pd）

**目标**：DSH 内可见、可查、可回顾；媒体失败与成本异常进入学习回路。

**修改文件**

- `packages/dsh-scale/src/client.ts` — 媒体工具卡（create/run/wait/estimate/export）；`settings.section` 媒体面板（provider 状态、预算、待审批数）；`turnTail` 展示最近媒体产物摘要。
- `packages/dsh-scale/src/commandsBridge.ts` — 媒体命令补全（doctor/tasks/providers 已有；新增 approvals 视需要）。
- `packages/dsh-scale/mcp-dev.patch.yml` — 复核 60s 超时；文档写明长任务必须异步。
- `src/media/observations.ts`（新增）— 任务终态 → 统一观察记录。
- `src/media/jobs/JobService.ts` — 终态钩子调用观察记录（失败不影响任务结果）。
- `tests/dsh/client.test.ts` — 卡片与设置页断言更新。

**DSH 约束**

- 只使用官方 slot：`tool.call.toolview`、`settings.section`、`conversation.chat.turnTail`。
- 不做 DOM 注入、不伪造侧栏图标。
- 仓库当前只验证过 `tool.call.toolview`（`client.ts:80,97-112`），未使用过 `settings.section` / `turnTail`；实现前先确认 DSH 运行时确实提供这些 slot，缺一即跳过对应增强，不引入私有 HTTP 通道。`[UNCERTAIN]`
- 设置页数据来源：优先复用插件现有宿主桥接；若只能经 MCP 获取，则展示只读快照。`[UNCERTAIN]`
- 长任务在对话里表现为：卡片显示 taskId + 状态 + 产物路径；不阻塞对话。

**Cortex 观察格式**

现有 `Observation` 是门禁导向的必填结构（`timestamp/sessionId/gateName/gateStatus/filePaths/tokensUsed/modelUsed`，`InstinctExtractor.ts:32-43`），不能直接把媒体事件塞进去。做法是**向后兼容的加法**：

```ts
// src/cortex/InstinctExtractor.ts（扩展 Observation，可选字段）
export interface Observation {
  // ...existing required fields unchanged...
  domain?: 'gate' | 'media';
  media?: {
    kind: 'job_failed' | 'provider_timeout' | 'cost_overrun' | 'approval_rejected' | 'validation_failed';
    jobId: string;
    actionId: string;
    providerId?: string;
    errorCode?: string;
    estimatedCny?: number | null;
    actualCny?: number;
    attempt: number;
  };
}
```

媒体侧填充映射：

| Observation 字段 | 媒体值 |
| --- | --- |
| `sessionId` | `media:<jobId>` |
| `gateName` | `'media'` |
| `gateStatus` | 失败/超时/超预算为失败态，其余为通过态（取值以现有类型为准 `[UNCERTAIN]`） |
| `filePaths` | 任务内相对路径（不写绝对路径） |
| `tokensUsed` | `0` |
| `modelUsed` | providerId 或 `'n/a'` |

去重：同 `jobId + attempt + kind` 只写一次；写入前扫描当天 `.scale/observations/<date>.jsonl` 判断，避免进程重启重复。`recordObservation` 目前仅测试调用（`tests/cortex/cortex.test.ts:250`），本次接入是新增生产调用点，需单测覆盖。

**验收（Gate M5）**

- [x] DSH 新会话可见新工具卡；调用 create/run/wait 有状态更新。
  - 证据：`tests/dsh/client.test.ts` 9 passed — 40 张 `mcp__scale__*` 卡注册；媒体工具（13 个）卡渲染 taskId + 状态徽章（succeeded→done 绿、failed→红、awaiting_approval→灰）+ 产物路径行，支持 run/get 的平铺、wait 的 `{done,job}` 与 list 的 `{tasks[]}` 三种真实载荷；结果不可解析时回退原始文本。`packages/dsh-scale` 构建成功（lib/client.js 重打包）。GUI 内实际渲染仍未见浏览器会话（与 2026-10-15 计划 T3 同状，注册/降级由单测覆盖）。
- [ ] 设置页显示 provider/预算/待审批（数据来源符合上述约束）。
  - **按计划条款跳过**：`settings.section` slot 官方存在（2026-10-15 计划 §2.8），但客户端→宿主动态数据通道对第三方插件未打通（T3 U4：typert Remote 需宿主侧新建服务、`host.call` 形状未验证），面板无数据来源且计划禁止私有通道。`turnTail` slot 名在运行时枚举中零出现，同样跳过。查询入口保持 MCP 工具（`media_list_providers`/`media_list_approvals`）与 DSH 命令 `scale-media-approvals`（只读 list）。`[UNCERTAIN]`
- [x] 失败任务产生一条观察记录；记录失败不影响任务状态。
  - 证据：`tests/media/observations.test.ts` 15 passed — 真实 `runJob` 失败路径（无 key → `MEDIA_PROVIDER_UNAVAILABLE`）恰好产生 1 条 `domain:'media'` 观察（sessionId `media:<jobId>`、kind `job_failed`、errorCode）；审批拒绝产生 `approval_rejected` 且 actionId 来自审批记录；同 `jobId+attempt+kind` 重启后不重复；观察目录不可写时 `observeTerminalState` 不抛；坏行日文件跳过后照常追加。JobService 在 rethrow 前调用钩子（失败隔离）；`detectPatterns` 直接消费媒体观察（script 实证）。
- [x] 不触碰 DOM、不新增非官方 slot。
  - 证据：`client.ts` 仍只注册 `tool.call.toolview`（keyed by wire name）；无 DOM API 调用（仅 `styles.insert` 客户端全局 + React `createElement`）；`grep settings.section|turnTail` 对 packages/dsh-scale/src 零匹配。
- [x] `make gate-quality` / `make verify PROFILE=default` 通过。
  - 实跑（M5 落地后）：第 4 次实跑 `bash scripts/gates/all.sh --quality` **12/12 通过**（G5 clean：2583 passed / 9 skipped / 0 failed，268 files；媒体与 DSH 测试全绿）。前三跑各 1 例 G5 失败（doctor `afterEach` 10s 超时 / client 卡测试在最终修复落盘前的中途态 / phaseCli Windows EPERM 临时目录清理），隔离均通过、第 4 跑零复现，确认为满载下 Windows temp-cleanup flake 而非回归。完整四跑记录见 verification.md M5 节。

**回滚**：移除新卡片与设置节；观察记录为追加文件，可停止写入。

---

## 7. 测试策略

### 7.1 分层

| 层 | 范围 | 工具/方式 |
| --- | --- | --- |
| 单元 | refs 解析、校验规则、定价、审批策略、状态机边 | vitest，纯函数，无 IO |
| 契约 | Provider v2 各适配器对同一组请求/响应 fixture 的行为 | Mock provider + 录制式 fixture（不含密钥） |
| 集成 | 任务生命周期、物化、渲染（含 ffmpeg）、导出 | 临时目录 + lavfi 微型素材 + 真实 ffmpeg |
| 端到端 | MCP stdio 异步链路、REST 审批流、DSH 客户端卡片 | 现有测试基建 + 本地进程 |
| 回归 | 0.2/0.3 分镜逐帧/哈希对比 | 固定输入 + 输出哈希断言（容差按编码器稳定性设定） |

### 7.2 必测清单（安全）

- 路径穿越：`asset://`、参考图、下载落盘、导出路径。
- SSRF：provider base URL、下载 URL、webhook URL；私网/回环默认拒绝。
- 文件名注入：远端 id、标题、模板 id 不得直接成为路径。
- 密钥泄漏：日志、任务记录、证据、错误消息四处的脱敏断言。
- 审批绕过：直接调用 MCP `run_task`、重试、恢复三条路径都必须重新检查审批/预算。

### 7.3 测试数据

- 微型视频/音频用 ffmpeg lavfi 在测试 setup 生成（`testsrc`、`sine`），不提交二进制大文件。
- 图片 fixture 沿用现有；新增 1 张 16:9、1 张 9:16。
- 所有外部 HTTP 用本地 stub server；禁止测试触网。

### 7.4 仓库惯例（必须沿用）

- **不 mock 模块**：provider 测试用 `node:http` 起本地 OpenAI 兼容 mock server，并通过真实 env 指向它，`finally` 清理（`tests/media/providers.test.ts:39-61,124-126,151-153`）。
- ffmpeg/playwright 用 `resolveMediaBin` + `createRequire(...).resolve('playwright')` 探测，`it.runIf` 跳过并保留 `it.skipIf` 占位（`tests/media/renderPipeline.test.ts:45-55,88-90`）。
- REST 测试用 `Hono.app.request()`（`tests/dashboard/mediaApi.test.ts:24-25`），不启真实端口。
- vitest 全局 `globals: false`、`pool: 'forks'`、`testTimeout: 180000`；覆盖率阈值 lines/functions/statements 80、branches 75（`vitest.config.ts:13-28,36-41`）。
- 新增测试文件放在 `tests/media/...` 对应子目录；DSH 相关放 `tests/dsh/`。

---

## 8. 安全、合规与反模式对照

| 竞品问题 | 本计划控制 |
| --- | --- |
| 明文保存 API key | 仅 env；任务记录/证据不落密钥；日志脱敏测试 |
| 任意本地文件读取并上传 | 生成输入只接受项目资产 ref；物化路径强校验；大小上限 |
| 远端任务 id 直接作文件名 | 落盘文件名固定为 `<taskId>.<ext>`；远端 id 仅存元数据 |
| 无审批、无成本上限 | 动作级成本估算 + 阈值审批 + 日预算 + 台账 |
| 内存队列、重启丢任务 | 任务持久化 + provider 句柄 + 启动恢复 + 过期语义 |
| 固定条数硬删除 | 不做自动删除；GC 仅清理明确无引用的中间产物，默认 dry-run |
| DOM 注入侧栏 | 只用 DSH 官方 slot |
| 账号池/共享密钥 | 明确非目标；单租户单密钥 |

其他：

- 外部响应视为不可信输入：状态码、JSON 字段、下载内容类型与大小均校验。
- 错误消息不回显密钥、完整 URL 查询串或本地绝对路径。
- 审批与预算检查位于 `preflight`，MCP/REST/恢复三条入口共用。
- Dashboard 默认 `0.0.0.0` 且无全局鉴权；审批写端点按 ADR-7 仅回环或 token 可用。生产使用审批时文档要求绑定 `127.0.0.1`。
- 仓库现有 ToolPolicy 没有审批队列；本计划不复用它做媒体审批，避免把“破坏性动作确认”与“付费动作审批”混为一谈。
- 审批决定、成本记录均为追加式文件；拒绝/过期不可被后续请求静默改写。

---

## 9. 存储与生命周期

- 目录不变：`media/projects/<projectId>/tasks/<taskId>/{assets,output,evidence,render}`。
- 新增子目录：`assets/external/<sourceTaskId>/...`、`output/exports/`、`publish/`。
- 配额：提交前检查项目总大小与磁盘余量；超限拒绝，不中途失败。
- 清理策略复用 `src/surface/ScaleSurface.ts` 的 kind/TTL 与 manifest，不新增删除规则；`evidence/` 与任务记录永不清理。
- GC（`scale media gc`，默认 dry-run）：
  - 清理 `render/` 中间帧与临时文件（成功后按 `MEDIA_KEEP_FRAMES` 决定，默认保留 1 天）。
  - 清理 `assets/external/` 中目标文件已不存在或哈希不匹配的孤儿副本。
  - **不清理** `assets/generated/` 生成产物与任何任务记录。
- 证据：物化映射、provider 提交/轮询/下载、成本、审批、导出规格均追加事件。

---

## 10. DSH 集成边界

- 事实基线沿用 `docs/plans/2026-10-15-dsh-plugin-integration-plan.md` 的 R1–R7；本计划不重新假设运行时能力。
- 新增工具自动出现在工具表；卡片映射需显式更新并测试。
- 设置页与 turnTail 属于增强项；若官方 slot 数据访问受限，降级为只读展示，不引入私有通道。
- 不在 DSH 内执行渲染；渲染仍在 scale-engine 本机进程。

---

## 11. 可观测性与证据

- 任务事件：沿用 `events.jsonl`；新增 `approval_requested`、`approval_decided`、`provider_submitted`、`provider_polled`、`provider_downloaded`、`asset_materialized`、`export_profile_done`。
- 证据：每个终态任务必须包含输入哈希、关键事件、产物哈希、成本（若有）、审批决定（若有）。
- 全局账本：审批/证据/用量摘要写入 `ExecutionLedger` / `RuntimeEvidenceLedger` / `ModelUsageLedger`，`metadata.domain='media'`（ADR-8）。
- 指标（本地汇总即可）：成功率、按 provider 的 P50/P95 时长、失败码分布、日成本、审批拒绝率；产品护栏：单交付物成本、恢复成功率、素材复用率、P95 首素材时间。
- Cortex：仅回流结构化观察，不写自由文本；可在后续计划中扩展 Instinct 提取规则。

---

## 12. 风险登记

| # | 风险 | 概率 | 影响 | 缓解 | 回滚 |
| --- | --- | --- | --- | --- | --- |
| R1 | Seedance/Seedream API 细节与定价变动 | 高 | M2 返工 | 先落 Mock 契约；适配器隔离；端点/模型全 env 化；实施前用官方文档核对并记录 `[UNCERTAIN]` 项 | 关闭 live 开关 |
| R2 | ffmpeg 拼接音画不同步/编码不一致 | 中 | 成片质量 | 统一编码参数；片段级探测；集成测试断言时长与流信息 | 走纯图片路径 |
| R3 | MCP 客户端仍按同步习惯调用长任务 | 中 | 超时误判 | 工具描述 + wait 语义 + DSH 卡状态；文档示例 | 保留旧同步包装 |
| R4 | 审批阻断自动化流程 | 中 | 体验 | 默认阈值 5 元、可配 off；未知成本才强制；错误码明确 | 切 `off` |
| R5 | 跨任务引用导致磁盘膨胀 | 中 | 存储 | 配额前置；外部副本 GC；单文件上限 | 删除 external 副本 |
| R6 | 进程重启丢失远程任务 | 中 | 成本/结果 | provider 句柄持久化；启动恢复；超时保留 jobId | 人工按 jobId 核查 |
| R7 | DSH slot/数据访问与预期不符 | 中 | M5 缩水 | 先做工具卡；设置页可降级只读 | 移除增强节 |
| R8 | 现有 0.2 渲染回归 | 低 | 信任 | 输出哈希回归；分支隔离（无视频/音频走原路径） | 关闭新分支 |
| R9 | 路径/SSRF 漏洞 | 低 | 安全 | 专项测试 + 代码评审 + 拒绝私网 | 关闭 provider |
| R10 | 成本估算与账单偏差 | 中 | 预算 | 台账记录估算与实测；偏差>30% 触发观察记录 | 调阈值/关 live |
| R11 | 平台重复建设（并行账本/证据/清理） | 中 | 架构腐化 | 3.4 复用边界；评审阻断“第二套账本/证据/清理” | 删除并行实现 |
| R12 | 定价表过期导致估算失真 | 高 | 预算 | 定价表带 `updatedAt` 与 owner；过期 90 天告警并强制审批 | 切 `always` |

---

## 13. 交付与 PR 计划

| PR | 里程碑 | 主要内容 | 预估 |
| --- | --- | --- | --- |
| PR-1 | M0 | 动作目录、3 个新工具、run 端点、账本适配、DSH 白名单 | 3 pd |
| PR-2 | M1 | asset refs、物化、插入选择器 | 3 pd |
| PR-3 | M2 | S0 spike、Provider v2、视频/语音、生命周期、成本/审批、配额 | 9 pd |
| PR-4 | M3 | ClipComposer、音频/字幕、DSL 0.4、模板向导 | 7 pd |
| PR-5 | M4 | 导出、发布包、审批收件箱、webhook | 5 pd |
| PR-6 | M5 | DSH 卡片/设置/turnTail、Cortex 观察 | 4 pd |

约束：

- 每个 PR 自带测试与文档更新；不跨里程碑混提。
- 提交信息使用约定式前缀（`feat:`/`fix:`/`docs:`/`test:`/`chore:`），不加归属尾注。
- 每个 PR 合并前运行 `rtk make preflight`、`rtk make gate-quality`、`rtk make verify PROFILE=default`。
- 涉及计费/外部调用的 PR 必须附“无密钥路径”的测试证据。
- L 级任务记录：执行期在 `.scale/state/planning/tasks/2026-10-29-media-platform-v2/` 维护 `explore.md`、`plan.md`、`reality-check.md`、`verification.md`、`review.md`、`summary.md`（沿用仓库惯例）。

---

## 14. 总 DoD

- [ ] M0–M4 的 Gate 全部满足；M5 至少工具卡与观察回流完成。
- [ ] 0.2/0.3/0.4 分镜兼容性测试通过；纯图片路径输出无回归。
- [ ] 所有外部调用在无密钥环境下可被 Mock 替代并跑通测试。
- [ ] 安全专项：路径穿越、SSRF、文件名注入、密钥泄漏、审批绕过均有测试。
- [ ] 文档：本计划状态更新；v3 计划状态行指向本计划；`docs/media/storyboard-format.md` 更新 0.3/0.4 语义与限制；新增 env 变量写入指南；CLI 帮助覆盖 `export`/`approvals`/`gc`。
- [ ] 未验证项在总结中逐条列出，不以“应该可以”代替证据。
- [ ] 回滚路径在演练环境中至少验证一次（关闭开关后旧流程可用）。
- [ ] 复用验证：仓库中不存在第二套审批/证据/成本账本；媒体事件可在 `ExecutionLedger` 检索，成本可在 `CostAnalyzer` 汇总，GC 走 `ScaleSurface`。
- [ ] 第二域就绪测试：按文档化的“新增域 checklist”走查一遍（只评审，不实现第二域）。
- [ ] 产品指标可读出：带证据交付物数、单交付物成本、恢复成功率、素材复用率。

### 14.1 第二域就绪 checklist（评审用，不实现第二域）

- [ ] 新域只需新增动作清单（id/risk/cost/approval/params）与执行 handler。
- [ ] MCP 工具枚举、REST 路由、DSH 卡片由目录派生，无需逐处修改。
- [ ] 成本与审批走同一策略闸门；事件写入同一账本，`metadata.domain` 区分。
- [ ] 存储/清理通过 `ScaleSurface` 登记，不新增删除规则。
- [ ] 证据、恢复、配额语义复用；新域不复制 JobService/ApprovalStore/CostLedger。

---

## 15. 验证命令（按仓库惯例）

```bash
rtk make preflight
rtk make gate-workflow
rtk make gate-quality
rtk make verify PROFILE=default
```

针对性验证（脚本已确认存在）：

```bash
# 快速集：包含 tests/media 与 tests/dsh
rtk npm run test:quick

# 媒体域 + DSH 客户端定向
rtk npx vitest run tests/media tests/dsh/client.test.ts --pool=forks

# 全量（耗时较长，合并前跑）
rtk npm test
```

> 未实际执行的命令不得在交付汇报中标记为“通过”。ffmpeg/playwright 缺失时，`tests/media/renderPipeline.test.ts:45-55` 的 `it.runIf` 会跳过集成用例并保留 skip 原因，不能把 skip 当作通过。

---

## 16. 待确认事项（实施前必须钉死）

1. **Seedance/Seedream 接入方式与定价**：端点、鉴权、异步协议、结果 URL 有效期、失败码。`[UNCERTAIN]`
2. **语音 provider 细节**：已选定 OpenAI 兼容 `/audio/speech`；具体可用模型、音色列表与限流以网关为准。Edge TTS 仅作离线 spike，不进入默认路径。`[UNCERTAIN]`
3. **Cortex `gateStatus` 允许取值**：扩展 `Observation` 时需按现有类型填媒体终态，取值集合未在本次探查中确认。`[UNCERTAIN]`
4. **审批端点的本机判定实现**：`@hono/node-server` 下从 `c.env` 取 peer address 的具体形状需在实现时验证；Bun 回退路径可能取不到。取不到时降级为“必须配置 token”。`[UNCERTAIN]`
5. **DSH `settings.section` / `turnTail` 可用性**：仓库只验证过 `tool.call.toolview`；运行时若不提供，M5 降级为仅工具卡。`[UNCERTAIN]`
6. **`FileLock` 是否支持续期**：不支持时改用按 `deadlineAt` 动态传入的 TTL；需确认 `acquireFileSync` 参数面。`[UNCERTAIN]`
7. **`ScaleSurface` 的可达性**：注册发生在 orchestration 层（`ScaleSurface.ts:1-12` 注释），Dashboard/媒体进程能否直接注册需实现时确认；不能则退化为媒体目录遵循同名 kind 约定并在启动时登记。`[UNCERTAIN]`

> 以上各项在对应里程碑开工前用代码/官方文档确认，并把结论回写本文件；未确认前不进入实现。配置与 CLI 位置已确认：媒体沿用 env 直读（仓库无集中 loader），CLI 挂在 `src/cli/mediaCommands.ts` 并注册到 `src/api/cli.ts:1847`；测试脚本与 ffmpeg/playwright 探测方式已确认（`package.json:57-76`、`tests/media/renderPipeline.test.ts:45-55`）。

---

## 17. 决策记录（本计划新增）

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| DSL 版本拆分 | 0.3 只加 asset refs；0.4 加视频/音频 | 每个版本对应可交付能力，避免“能校验但不能渲染”的假支持 |
| 视频渲染方式 | 混合式（Playwright 覆盖层 + ffmpeg 拼接） | 复用现有 CJK 文字渲染，避免 drawtext 字体地狱 |
| 转场范围 | 视频场景间硬切；图片场景保留现有转场 | 控制 M3 复杂度；xfade 跨片段后续单独立项 |
| 模板执行 | 向导逐步调用公开 API，不做隐藏流水线 | 符合“UI 只消费 API”原则；一键流水线后续再做 |
| 审批位置 | `preflight` 统一入口，MCP/REST/恢复共用 | 防止绕过 |
| 发布边界 | 只产包，不直发 | 外部副作用不可逆，当前阶段不做 |
| 语音任务形态 | 作为普通任务（快），与视频共用生命周期 | 统一证据与成本口径 |
| 审批端点暴露 | 仅回环或 token；不改造全局鉴权 | Dashboard 默认 0.0.0.0 且无鉴权，审批必须单独设防 |
| Cortex 观察接入 | 扩展 `Observation` 可选字段，填充门禁必填项 | 不改现有必填契约，保持 Cortex 兼容 |
| provider 开关求值 | `enabled` 动态读取 | 避免 Suno provider 的模块加载固化问题 |
| 平台定位 | 契约域无关、实现单域；媒体是首个域 | 避免“媒体=平台”，也避免无第二域就建框架 |
| 账本复用 | 审批/证据/成本写入既有 runtime 账本 | 防止“四本账”被架构化 |
| 输出面清理 | 复用 `ScaleSurface` 的 kind/TTL | 全仓清理策略一致，evidence 永不清理 |
| 成本执行 | 估算 → 预留 → 结算，超支中止 | 提交前拦截不足以防真实账单 |
| provider 未知 | S0 spike 前置，失败则缩范围 | 唯一能推翻工期的外部变量 |

---

## 18. 最终建议

按 **M0 → M1 → S0 → M2** 顺序先落地“内核契约 + 素材回流 + 受治理的视频生成”，这是平台能力的最小闭环；M3 的成片能力在 M2 稳定后再开，避免 ffmpeg 复杂度与 provider 不确定性叠加；M4/M5 作为交付与体验层，可在前三阶段验证后调整优先级。

若只能投入两个里程碑，选 **M0 + M2（含 Mock）**：先让动作目录、异步语义、账本复用与成本治理成立，视频能力即使暂时只跑 Mock，也能验证整条架构。S0 不通过时不要硬上 live，缩为“一个确认 provider + Mock”并把决定写回本文件。
