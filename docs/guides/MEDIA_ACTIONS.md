# Media 动作目录与异步治理（M0–M5）

本文对应 v3 计划的 M0–M4：把媒体能力收敛为**受治理的动作**，让长任务不再占用一次 MCP 调用，
并在任何 provider 花费之前完成审批、预算与配额检查；M3 补齐成片渲染（视频拼接、配音、字幕、模板向导）；
M4 补齐交付层（多规格导出、发布包、审批通知、存储 GC）。
完整设计见 [media-platform-v2-plan.md](../plans/2026-10-29-media-platform-v2-plan.md)。

## 1. 动作目录

`src/media/actions/manifests.ts` 是媒体动作的唯一元数据源。每个动作声明：

- `id`：稳定标识，例如 `media.generate_video`
- `risk` / `cost` / `approval`：风险、计价单位、审批要求
- `longRunning`：是否应在后台执行
- `availableIn`：从哪个里程碑起可调用
- `invoke`：由哪个 MCP 工具触发、固化哪些参数
- `surfaces`：计划暴露的表面（MCP / REST / DSH / CLI）
- `paramsSchema`：给工具声明与文档用的 JSON Schema 元数据

| 动作 | 风险 | 成本单位 | 长任务 | 启用 | 审批 |
| --- | --- | --- | --- | --- | --- |
| `media.generate_image` | low | image | 否 | M0 | threshold |
| `media.render_storyboard` | medium | render_minute | 是 | M0 | never（本机） |
| `media.generate_video` | high | video_second | 是 | M2 | threshold（未知价 → 必审） |
| `media.generate_speech` | low | speech_char | 否 | M2 | threshold |
| `media.export` | low | export | 是 | M4 | never（本机） |
| `media.publish_prepare` | medium | export | 是 | M4 | threshold |

`availableIn` 未到期的动作**不会**出现在 `media_create_task` 的 `type` 枚举、REST 类型或 DSH 卡片中。
`tests/media/actions/registry.test.ts` 会同时校验目录完整性与工具枚举漂移。

## 2. 异步语义

长任务推荐三步，而不是同步阻塞：

```text
media_create_task  → 返回 created / awaiting_approval + taskId
media_run_task     → 后台启动，立即返回当前快照（started）
media_wait_task    → 轮询到终态，默认 25s、上限 50s；超时返回 done=false
```

- `media_wait_task` 只观察，不触发执行；即使任务仍是 `created` 也不会启动它。
- `media_run_task` 只接受 `created` 状态；状态在**运行锁内复核**，所以跨进程并发启动不会变成隐式重试。
  失败/中断任务请用 `media_retry_task`；`awaiting_approval` 必须先决定审批。
- 另一个任务正在执行时，启动会返回 `MEDIA_LOCK_TIMEOUT`（可重试）。
- 运行锁 TTL 随任务类型变化：`render` 30 分钟，`generate_video` 70 分钟（覆盖 3600s 轮询上限 + 下载）。
  TTL 到期也不会被第二个进程“续跑”，恢复统一走 `recoverJobs`。
- 视频内部流程：submit → **先持久化 provider handle** → poll（250ms–30s，>3 次连续可重试错误后指数退避）
  → deadline 超时取消 → 下载并校验 → 原子写入 `assets/generated.<ext>`。
  崩溃/重启后按 handle 续轮询，不会二次提交（不重复付费）。

REST 侧对应 `POST /api/media/tasks/:taskId/run`（202 detached）。非 `created` 状态返回 409
`MEDIA_ACTION_INVALID_STATE`，待审批返回 409 `MEDIA_APPROVAL_REQUIRED`，锁竞争返回 409 `MEDIA_LOCK_TIMEOUT`。

## 3. 审批（ADR-7）

审批策略在**每次创建任务时**求值（环境变量可热改）：

| 模式 | 行为 |
| --- | --- |
| `off` | 从不审批（仅供本地/测试；生产不建议） |
| `always` | 所有动作都审批（含本机渲染） |
| `threshold`（默认） | 未知成本 → 必须审批（fail-closed）；估算 `>=` 阈值 → 必须审批 |

- 默认阈值 `MEDIA_APPROVAL_THRESHOLD_CNY=5`，动作清单可声明自己的阈值；非法值回退默认值，绝不回退为 0。
- 待审批记录 append-only 写入 `.scale/state/media/approvals.jsonl`（latest-wins，跨进程 FileLock）。
- 惰性过期：审批列表、任务详情、`recoverJobs` 都会检查过期；过期视为拒绝，任务转 `cancelled`
  （`MEDIA_APPROVAL_EXPIRED`）。默认 TTL 1440 分钟。
- 批准后任务回到 `created`，仍需显式运行；REST 支持 `{ "approve": true, "run": true }` 一步启动。
- 访问控制：`POST /api/media/approvals/:id/decide` 仅接受
  - 回环调用（`127.0.0.1` / `::1`），或
  - `x-media-approval-token`（兼容计划的 `x-scale-token`）匹配 `MEDIA_APPROVAL_TOKEN`
    （兼容 `SCALE_MEDIA_APPROVAL_TOKEN`）。

## 4. 预算与配额

预算在**提交 provider 之前**预留，成功/失败后结算：

```text
估算 → reserve（未知成本预留 0，由审批闸门兜底）→ 执行 → settle（实际 CNY）
```

- 账本文件 `.scale/state/media/budget.json`；当日 `spent + reserved > MEDIA_DAILY_BUDGET_CNY` →
  `MEDIA_BUDGET_EXCEEDED`（402），不发起任何 provider 调用。
- 预留按 taskId 幂等：重试/恢复复用同一条预留，不会重复占用。
- 崩溃留下的预留按 `MEDIA_BUDGET_RESERVATION_TTL_MINUTES`（默认 1440）惰性回收。
- 实际费用超过估算 20% 时写 warning 日志（不中止已完成的工作）。
- 配额预检：项目素材超过 `MEDIA_PROJECT_QUOTA_MB` 或磁盘余量低于 `MEDIA_MIN_FREE_MB` →
  `MEDIA_QUOTA_EXCEEDED` / `MEDIA_DISK_LOW`（507）。
- 视频下载上限 `MEDIA_VIDEO_MAX_MB`（默认 512）；参考图上限 10 MB。

## 5. 成本估算与真实成本

`media_estimate_cost` 读取 `src/media/actions/pricing.ts` 的静态价格表：

- 本机渲染、mock 图片/视频/语音：`0`
- 未确认的 provider 价格：`null`，并返回 `reason`；**不猜价格**（M2 起该情况强制审批）
- 数量无法从参数推导（storyboard 缺失/结构错误、时长为非数字等）：`quantity: null`、`estimatedCny: null`
- 过期的真实价格（超过 90 天）：按未确认处理
- M4 动作：`MEDIA_ACTION_UNAVAILABLE`
- 未知动作：`MEDIA_ACTION_UNKNOWN`

真实成本一律写入现有 `ModelUsageLedger`（`.scale/model-usage/usage.jsonl`），
`metadata.domain='media'`、`metadata.costCny`，不使用 USD、不建立第二套成本账本（ADR-8）。
`CostAnalyzer.byDomain.media` 与报告的 `Media spend` 行由此汇总。

## 6. Provider 特性开关

| 环境变量 | 默认 | 语义 |
| --- | --- | --- |
| `MEDIA_FEATURE_VIDEO` | `off` | `off` 不注册；`mock` 注册确定性 MockVideoProvider；`live` 注册真实 provider（**当前未实现**，`[UNCERTAIN]` 待 S0 验证） |
| `MEDIA_FEATURE_SPEECH` | `off` | 同上；`live` 走 OpenAI 兼容语音网关（未实测，`[UNCERTAIN]`） |
| `MEDIA_MOCK_VIDEO_LATENCY_MS` | 内置值 | 仅测试/演示用模拟延迟 |

开关在**每次读取时**求值，不在模块加载时固化；非法值按 `off` 处理并在特性列表里说明原因。
Provider 密钥只从环境变量读取，绝不写入任务记录、证据或日志。

## 7. 账本

媒体事件写入既有 `ExecutionLedger`（`.scale/ledger/events.jsonl`），不新增账本格式：

| 时机 | 事件 | 关键 metadata |
| --- | --- | --- |
| 创建任务 | `tool.invoked` | `domain=media`、`actionId`、`deduplicated` |
| 开始执行 | `task.started` | `actionId`、`attempt`、`retry` |
| 成功 / 失败 | `evidence.recorded` | `outcome`、`outputSha256` 或 `errorCode` |
| 取消（含审批拒绝/过期） | `task.cancelled` | `outcome=cancelled`、`approvalId` |
| 审批决定 | `evidence.recorded` | `approvalStatus`、`decidedBy` |
| 恢复中断 | `evidence.recorded` | `outcome=interrupted` |

任务目录里的 `events.jsonl` 与 `evidence.jsonl` 仍是细节层；账本只存结构化摘要。账本写入失败不会让任务失败。

## 8. 路径与内容安全

- 视频输出路径由引擎决定（`assets/generated.<ext>`）；provider 返回的远端 id **绝不**参与本地文件名。
- 参考图必须是任务目录内的图片（`assets/…`，白名单扩展名，≤10 MB），越界/绝对路径一律拒绝。
- 下载 URL 只允许公网 HTTPS；私网/回环/HTTP → `MEDIA_PROVIDER_DOWNLOAD_REJECTED`，且发生在 fetch 之前。
- 下载内容必须是 `video/*` 或 `application/octet-stream`，按声明长度与实际字节双重限制。
- 资产预览/引用全部走 `path.relative` 包含性检查，前缀相同的兄弟目录无法穿透。

## 9. M2 明确不做

- 真实视频 provider 的线上验证（需 S0 账号与价格确认）——`live` 开关会明确报“未实现”
- 导出包、`publish_prepare`、审批通知 webhook（M4）
- 视频场景/音频轨道的分镜渲染（M3 已交付，见 §10）
- 第二套账本、证据库或清理规则（架构阻断项）

## 10. M3 组合渲染与模板（已交付）

渲染器按分镜内容选择两条路径，阶段事件仍写入任务 `events.jsonl` 与 evidence：

| 路径 | 触发条件 | 阶段 |
| --- | --- | --- |
| 组合渲染 | 任一视频元素或 `audioTracks` | `materialize → validate_assets → prepare → compose_segments → audio_mix → mux → inspect → commit` |
| 旧管线 | 纯图片且无音轨（0.1–0.3 及部分 0.4） | `materialize → validate_assets → prepare → capture → audio(440Hz) → encode → inspect → commit` |

- **视频**：每幕至多 1 个 `video`；按 `trimStartMs/trimEndMs` 裁切、按 `fit` 缩放/补边，`loop` 循环的是裁切窗口；所有 segment 同参数编码后 concat 流拷贝（硬切）。视频幕中的非视频元素作为静态透明 PNG 图层叠加，0.4 不做视频上的元素动画。
- **音频**：`narration`/`bgm` 各至多一条，可循环与淡入淡出；未静音片段的原声按幕起点落到全片时间轴。混音恒为 48kHz 立体声，最终 mux 为 AAC。
- **字幕**：`mode = none | burn | srt | both`；`source=auto` 由每幕 `narrationText` 生成，`file` 读取 `assets/` 内 `.srt`。`srt/both` 把 `output/subtitles.srt` 追加为第二个 output（`kind: other`）；`burn/both` 在滤镜可用时烧录。
- **失败语义**：素材相关的裁切越界/过短只能在 `compose_segments` 阶段发现，任务落 `failed` + `MEDIA_STORYBOARD_INVALID`；状态机没有 `running → failed_validation` 迁移，`failed_validation` 不会被写入。
- **模板向导**：`GET /api/media/templates`、`POST /api/media/plan`（纯预览，占位符 + 估算）、`POST /api/media/templates/:id/assemble`（严格组装）。内置 `talking-head` / `product-showcase` / `fast-cuts`；未知模板 `MEDIA_ACTION_UNKNOWN`，槽位/数量/扩展名错误 `MEDIA_STORYBOARD_INVALID`。向导不直接创建任务，最终仍走 `POST /api/media/tasks` 与既有审批/预算闸门。
- Dashboard「模板向导」tab 与画布编辑器的「音轨与字幕（0.4）」面板消费这些接口；保存画布时自动把 schema 升到 0.4。

## 10.5 M4 交付层（导出包 / 审批收件箱 / GC）

### 多规格导出（`media.export`）

- 一次导出任务从**已成功的 render 任务**读取 `output/final.mp4`（源任务只读），按规格中心裁切/补边转码：
  `16x9-1080p`（1920×1080）、`9x16-1080p`（1080×1920）、`1x1-1080p`（1080×1080）。
- 每个规格输出 `output/exports/<profile>.mp4`（libx264 + AAC 160k，`+faststart`）与 `output/exports/<profile>-cover.jpg`
  （封面取帧秒数 `coverAtSec`，默认 0）。
- 字幕 `subtitles = none | srt | burn`：`srt` 旁挂源任务 SRT；`burn` 把 SRT 烧录进每个规格（依赖 ffmpeg subtitles 滤镜）。
- 产物（含哈希、字节数）全部登记到导出任务自己的 outputs；证据记录 `sourceTaskId`、规格与 bin 版本。
- 无音轨源自动补静音轨；转码失败 `MEDIA_ENCODE_FAILED`，请求不合法 `MEDIA_EXPORT_REQUEST_INVALID`，源不可用 `MEDIA_EXPORT_SOURCE_INVALID`。

### 发布包（`media.publish_prepare`，纯本地）

- `exportRequest.publish`（`title` 必填 ≤120 字符，`description/tags/platformHints` 选填）来自**用户输入，永不由 LLM 生成**。
- 携带 publish 块时额外生成 `publish/manifest.json`（`version/sourceTaskId/createdAt/title/.../assets[]`），
  结构由 `validatePublishManifest` 校验；缺 `title` 时在创建期即拒绝并指明字段名。
- `platformHints` 只是提示字段；`src/media/publish/PublishAdapter.ts` **仅接口与 `local-preview` 预览实现**，
  不含任何平台调用（M4 明确不做平台直发）。

### 审批通知（尽力而为）

- 创建任务产生审批请求时按序尝试：`MEDIA_APPROVAL_FEISHU_CHAT_ID`（lark-cli 实发）→ `MEDIA_APPROVAL_WEBHOOK_URL`（本地 fetch POST）。
- 两者都失败只写日志与 `approval_notified` 事件（含 channel/ok/reason），**绝不改变审批状态**；成本未知时文案为 fail-closed 提示，不编造数字。

### 存储 GC（默认 dry-run）

- `media gc` 列出候选：`render/` 中间产物（帧、分段编码、混音）与孤儿 `assets/external/<source>/` 副本（源任务已不存在）。
- `--apply` 才删除，且删除前对每条路径重放 `ScaleSurface.classifyMediaPath` 合同——只有 render/（tmp 类）与 external 副本可过；
  `task.json`、`events.jsonl`、`evidence/`、`output/`、`assets/` 永不清理（`PROTECTED_PATHS` 与测试双向锁定）。
- 年龄门槛 `MEDIA_GC_MIN_AGE_DAYS`（默认 14）；`MEDIA_KEEP_FRAMES=1` 可保留中间产物调试。
- 可清理范围来自 `src/surface/ScaleSurface.ts` 的媒体注册（任务记录=state、证据=evidence、render/ 中间产物=tmp），媒体侧不自定义删除规则（ADR-8）。

### CLI / Dashboard 入口

- `scale media export <sourceTaskId> [--profiles ...] [--subtitles srt|burn|none] [--title ...]`：创建并运行导出（带 `--title` 即生成发布包）。
- `scale media approvals list|decide <id> approve|reject [--reason ...]`：审批收件箱（决定进入证据，过期自动取消）。
- `scale media gc [--apply] [--min-age-days N]`：默认只列候选；输出包含 scope 说明。
- Dashboard「交付」tab：选择源成片、勾选规格、封面取帧秒、字幕模式与发布元数据 → `POST /api/media/tasks {type:'export'}`。

## 11. 相关代码

- 目录与估算：[`src/media/actions/`](../../src/media/actions/)
- 审批：[`src/media/approvals/`](../../src/media/approvals/)
- 预算：[`src/media/budget/`](../../src/media/budget/)
- 配额：[`src/media/storage/QuotaGuard.ts`](../../src/media/storage/QuotaGuard.ts)
- Provider：[`src/media/providers/`](../../src/media/providers/)
- MCP 工具：[`src/media/mcpTools.ts`](../../src/media/mcpTools.ts)
- REST 路由：[`src/dashboard/MediaControlPlane.ts`](../../src/dashboard/MediaControlPlane.ts)
- 任务服务：[`src/media/jobs/JobService.ts`](../../src/media/jobs/JobService.ts)
- 组合渲染：[`src/media/render/ClipComposer.ts`](../../src/media/render/ClipComposer.ts)、[`AudioMixer.ts`](../../src/media/render/AudioMixer.ts)、[`SubtitleBuilder.ts`](../../src/media/render/SubtitleBuilder.ts)
- 模板：[`src/media/templates/`](../../src/media/templates/)
- 导出与发布包：[`src/media/export/`](../../src/media/export/)、[`src/media/publish/PublishAdapter.ts`](../../src/media/publish/PublishAdapter.ts)
- 审批通知：[`src/media/approvals/notify.ts`](../../src/media/approvals/notify.ts)
- 存储 GC：[`src/media/storage/AssetIndex.ts`](../../src/media/storage/AssetIndex.ts)、[`gc.ts`](../../src/media/storage/gc.ts)、ScaleSurface 注册：[`src/surface/ScaleSurface.ts`](../../src/surface/ScaleSurface.ts)
- 账本适配：[`src/media/jobs/ledger.ts`](../../src/media/jobs/ledger.ts)
- Cortex 观察：[`src/media/observations.ts`](../../src/media/observations.ts)、[`src/cortex/InstinctExtractor.ts`](../../src/cortex/InstinctExtractor.ts)
- DSH 客户端卡：[`packages/dsh-scale/src/client.ts`](../../packages/dsh-scale/src/client.ts)

## 12. M5 DSH 升维与 Cortex 回流（已交付）

### 12.1 DSH 工具卡（`tool.call.toolview`）

- `packages/dsh-scale/src/client.ts` 的 `ScaleToolCard` 对 13 个 `mcp__scale__media_*` 工具渲染结构化条带：**taskId + 状态徽章 + 产物路径**（长任务不阻塞对话，plan §M5）。
- 状态徽章映射：`running/packaging/created/validated` → 黄（进行中），`succeeded` → 绿（done），`failed/failed_validation/interrupted` → 红，`awaiting_approval/cancelled` → 灰。
- 数据全部来自会话内的工具调用参数与结果（result 是 JSON 字符串时防御性解析）；结果不可解析时回退显示原始文本，失败信息绝不吞掉。非媒体工具卡行为不变。
- 约束遵守：只用官方 slot `tool.call.toolview`，无 DOM 注入。

### 12.2 明确跳过的增强项（slot 可用性核实结论）

- `settings.section` 媒体面板：slot 本身官方存在（2026-10-15 DSH 计划 §2.8），但客户端→宿主动态数据通道对第三方插件未打通（T3 U4 结论：typert Remote 需宿主侧新建服务，`host.call` 形状未验证）——provider/预算/待审批面板拿不到数据，且计划禁止私有 HTTP 通道，**跳过**。`[UNCERTAIN]`：若后续 DSH 开放第三方数据通道可补做。
- `conversation.chat.turnTail`：该 slot 名在仓库与运行时枚举中零出现（listBuiltins 文档、node_modules、源码均无），按"缺一即跳过"**跳过**。
- 设置页数据源约束（只读快照/宿主桥接）因此未触发；`media_list_providers`/`media_list_approvals` MCP 工具保持对话内查询入口。

### 12.3 Cortex 观察回流

- `src/media/observations.ts`：任务终态 → `Observation`（`gateName: 'media'`，`domain: 'media'`，`sessionId: media:<jobId>`，`tokensUsed: 0`，`modelUsed: providerId | 'n/a'`，`filePaths` 仅任务内相对路径，`media` 块含 `kind/jobId/actionId/providerId?/errorCode?/estimatedCny/actualCny?/attempt`）。
- kind 映射：`failed` → `job_failed`；`MEDIA_PROVIDER_TIMEOUT` → `provider_timeout`；`failed_validation` → `validation_failed`；审批拒绝 → `approval_rejected`；操作员主动取消**不产生**观察（非学习信号）；成功不产生观察。
- 去重：同 `jobId + attempt + kind` 只写一次，写入前扫描当天 `.scale/observations/<date>.jsonl`（进程重启不重复；坏行跳过）。
- 失败隔离：记录的任何失败（目录不可写、扫描失败）只写日志，永不影响任务结果；JobService 在 rethrow 真实错误**之前**调用钩子，钩子自身吞错。
- `Observation` 扩展（`src/cortex/InstinctExtractor.ts`）：`domain`/`media` 为可选字段，向后兼容——现有门禁观察不受影响，`detectPatterns` 直接消费媒体观察（验证过：media 记录按 `errorPattern` 参与模式提取）。
- 生产调用点：`JobService.runLocked` 失败/取消路径 + `decideJobApproval` 拒绝路径。这是 `recordObservation` 家族的第一个生产调用点（此前仅测试调用）。
