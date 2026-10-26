> **归档说明（2026-10-25，scale-engine 维护评审）**
> 来源：用户提供的外部工程评审稿（Downloads/内容媒体工作流方案_v3_可实施版.md），作者自述「未检查仓库代码，待实机验证后冻结」。
> 评审结论：**有条件采纳为实施基准**。已核验的仓库假设：AgentControlPlane / CLI 注册 / MCP / dsh-scale 五桥 / Shield 假设成立；`SkillPolicy.ts`、`ToolPolicy.ts` 默认副本确实缺一致性测试（§12.3 提议成立，现为真缺口）；`better-sqlite3` 已是仓库依赖（§2.3 存储选型有先例可循）；Suno 条款日期断言（2026-08-10 修订 / 2026-09-03 生效）与官方页面一致。
> 采纳裁剪与适配：① 任务状态机与资产 staging 语义按单机 MVP 收窄，`reconciliation_required` 等对账语义推迟到 P3 真实 Provider 接入时启用；② skill 落位改用本仓库扁平目录约定 `.scale/skills/<name>/SKILL.md` + manifest.json（非 §3 的嵌套结构）；③ 文档落位按 docs/ 既有分册约定调整；④ v2 方案（2026-10-25-content-media-workflow-plan.md）保留内容管线集成叙事（wewrite/huashu 三条流水线），本文只作引擎实施基准；⑤ 补充事实：Suno 新条款还含按档位下载上限（Free 7 次终身）与下载水印、商业权利仅 Pro/Premier，进一步支持 §8.6 默认禁用立场。
> 实施顺序以 §25 为准：P0 → P0.5（阻断关卡）→ P1 → P2 → P3 → P4；P5 另行决策。

# 内容媒体工作流方案 v3（可实施版）

- 版本：v3.0
- 日期：2026-10-25
- 状态：**P0 / P0.5 / P1 / P2 / P3（provider 层）/ P4 已实施并通过验证（2026-10-25）**；**P5 首批（无限画布编辑器、Media Studio 迁移 Vue 3 规范 UI、DSL v0.2 slide/wipe + 批量分镜、ffmpeg 6.1.1）已实施并通过验证（2026-10-26，见 `.scale/state/planning/tasks/2026-10-26-media-workflow-p5/`）**。剩余用户介入项：真实 API key 的 P3 验收、DSH profile 实装冒烟、Dashboard release build 浏览器目视；P5 其余扩展项（视频模型 provider、云执行、协作）按 §17 单独立项
- 适用范围：SCALE/scale-engine；已有 wewrite 集成；huashu-motion、huashu-art-motion Skills/CLI；dsh-scale；Dashboard；目标宿主包括 Windows 本机与支持 CLI/MCP 的 Agent
- 核心策略：**Skills/CLI 引入集成，平台编排、任务模型、资产治理与可视化自研；一个媒体服务、多个入口，共享一套权限、任务状态和 evidence。**

---

## 0. 执行摘要

### 0.1 结论

建议**有条件通过**。保留原方案“一个引擎、两个界面、多入口兼容”的主方向，但按本方案修订安全边界、任务状态模型、Windows 验收和阶段范围后再进入主体开发。

首期目标不是一次性做出完整专业视频编辑器，而是先交付一个可维护、可恢复、可审计的媒体任务闭环：

1. Agent 或用户提交一个媒体任务。
2. 系统验证输入、生成并校验 `storyboard.json`。
3. 可信本地渲染器将声明式场景描述渲染为帧序列。
4. FFmpeg 将画面、音轨、字幕等组合成视频。
5. 任务状态、素材、参数、日志和 evidence 被持久化。
6. 用户通过 CLI、Dashboard 或 DSH 查看同一任务及相同产物。
7. 真实模型 Provider 在基础闭环稳定后再接入。

### 0.2 关键修订

| 原设计 | v3 修订 | 原因 |
|---|---|---|
| 用 `node:vm` 执行 Agent 任意生成的 JS，并视为沙箱 | MVP 使用声明式 Scene DSL + 可信渲染器；任意代码执行不作为 MVP 能力 | Node 官方明确说明 `node:vm` 不是安全机制，不应用于运行不可信代码 |
| 只用目录作为任务/产物锚点 | 文件系统保留为资产事实来源；另设原子化任务清单与事件日志，单进程串行写入 | 解决崩溃恢复、并发、重复提交和任务状态不可判定问题 |
| 音乐 Provider 在 P3 即要求成功验收 | 作为可选实验 Provider；核心链路验收不依赖 Suno | 非官方封装容易受服务接口、认证及条款变化影响 |
| 直接覆盖 Dashboard、MCP、DSH 的整套能力 | 先统一服务契约；入口只做适配，逐个接通 | 避免多个入口出现不同业务逻辑与权限实现 |
| 参数指纹可复现 | 分开定义本地确定性渲染与外部生成的可追溯性 | 外部模型不应承诺字节级相同输出 |
| “零 API 成本” | 改为“本地渲染不产生媒体生成 API 费用” | Agent 编写场景仍可能产生模型推理费用，机器渲染也有资源成本 |

### 0.3 交付范围

**MVP 必须交付：**
- Scene DSL 与 storyboard 校验器。
- 本地静态图/矢量/文字/基本动画的可信渲染器。
- FFmpeg 封装器与 Windows 完整出片验证。
- 持久化任务状态、取消、失败重试、恢复、去重。
- CLI、媒体服务 API、Dashboard Gallery/分镜/任务队列/evidence。
- Provider 接口与 Mock Provider；至少一个真实图像 Provider 的小范围验证可作为后续里程碑。
- DSH/MCP 接入使用相同任务服务。
- 用户级配置、密钥脱敏、权限确认与成本限制。

**明确不属于 MVP：**
- 无限画布、复杂时间线、专业级非线性编辑器。
- 同时接入多家图像/视频/音乐厂商。
- 任意 Agent JS 的直接执行。
- 自动发布到第三方平台。
- 自动账号池、Cookie 抓取、绕过验证或访问限制。

---

## 1. 目标、非目标与成功标准

### 1.1 产品目标

1. 给用户提供统一的媒体工作流入口，覆盖封面图、宣传图、动画、分镜视频、音乐/配音素材和最终视频导出。
2. 让 Agent 能通过 Skills、CLI 或 MCP 调用同一套功能，而不是为每个宿主实现一份业务逻辑。
3. 将生成素材、渲染工程、分镜、参数、状态和 evidence 放在可发现、可追溯、可归档的位置。
4. 保留供应商替换能力，减少业务工作流对某一家模型 API 的耦合。
5. 先实现本地可控的确定性制作路径，再按实际需求添加模型生成路径。

### 1.2 非目标

- 不从零开发完整专业视频编辑器。
- 不复制第三方插件包，不将其配置、账号池或私有运行时作为平台核心。
- 不保证外部生成模型的输出完全确定。
- 不把“API 兼容”当作“各供应商能力完全相同”。
- 不在未审核的情况下执行 Agent 生成的任意系统代码。
- 不将媒体任务系统变成第三方账号管理或 Cookie 生命周期管理工具。

### 1.3 衡量成功的指标

| 指标 | MVP 目标 | 验收方法 |
|---|---|---|
| 本地出片闭环 | 能以样例 Scene DSL 生成不少于 15 秒的 MP4 | Windows 实机测试，检查编码、音轨、字体与帧数 |
| 任务可恢复 | 服务意外退出后，未完成任务可识别并进入恢复/人工处理状态 | 强制结束进程后重启测试 |
| 重复提交控制 | 相同 idempotency key 不重复建立计费任务 | 自动化集成测试 |
| 入口一致性 | CLI、Dashboard、MCP 查询到相同 task id、状态和产物清单 | 跨入口契约测试 |
| 安全控制 | 未授权路径不可写、超限任务可被终止、密钥不进入日志 | 安全测试与日志扫描 |
| 证据完整性 | 任务输入、配置版本、工具版本、输出校验和、失败信息可追溯 | 对照任务目录和 evidence |
| 失败可解释性 | Provider、渲染器、FFmpeg 各阶段失败均有稳定错误码和摘要 | 故障注入测试 |

这些目标是工程建议值，需结合实际机器性能、既有测试基线与项目策略调整；不代表当前系统已达到。

---

## 2. 架构总览

### 2.1 逻辑架构

```text
Skills / Agent / 人类用户
        │
        ├── CLI：scale media ...
        ├── MCP：media_* tools
        ├── Dashboard：/api/media/*
        └── DSH：通过既有 dsh-scale bridge 适配
                 │
                 ▼
        Media Application Service
        ├── 入参校验 / 权限与确认 / 幂等
        ├── Job Service（状态机、排队、重试、取消、恢复）
        ├── Storyboard Service（schema、版本、引用检查）
        ├── Render Orchestrator（Scene DSL → 帧 → FFmpeg）
        ├── Provider Manager（图像/视频/音频/音乐）
        ├── Asset Catalog（目录索引、校验、缩略图）
        └── Evidence Writer（操作、版本、用量、输出校验和）
                 │
                 ▼
        Workspace（文件系统是资产事实来源）
        ├── tasks/<task-id>/input
        ├── tasks/<task-id>/assets
        ├── tasks/<task-id>/render
        ├── tasks/<task-id>/evidence
        └── media-index / task journal
                 │
                 ▼
        Capability adapters
        ├── Trusted Scene Renderer
        ├── FFmpeg adapter
        ├── Image / Video provider adapters
        ├── Music provider adapter（可选）
        └── Skills/CLI wrappers（wewrite、huashu 等）
```

### 2.2 设计原则

- **一个业务层：** CLI、MCP、API、DSH 都调用同一 Media Application Service。
- **资产落盘优先：** 原始素材和最终产物写入任务目录；任务状态单独持久化，目录扫描不作为唯一成功判据。
- **入口无特权：** 不因调用来自 Dashboard 或 DSH 就跳过权限和输入检查。
- **明确能力差异：** Provider 返回标准能力描述与限制；不把所有厂商强行伪装成完全相同的 API。
- **可选依赖可降级：** 音乐、部分视频模型不可用时，不阻断本地渲染和图像工作流。
- **默认安全：** 只监听本机、密钥放用户配置、默认不执行任意代码、发布行为需显式确认。
- **先可用，再丰富：** 先完成基础流程和验收，不先做无限画布。

### 2.3 推荐技术选型

| 领域 | MVP 建议 | 备注/决策门 |
|---|---|---|
| 语言 | 延续仓库现有 TypeScript/Node.js 结构 | 不为媒体模块单独引入另一套后端语言 |
| Scene DSL | JSON Schema 校验的声明式 JSON | 禁止嵌入任意 JS/eval/function 表达式 |
| 渲染 | 优先 Playwright/Chromium 截帧 | 必须用 Windows spike 验证帧率、字体和内存；不行再评估 node-canvas |
| 视频处理 | 系统 FFmpeg 子进程 | 固定可执行文件发现策略、版本检查、参数白名单；参数数组调用，不拼接 Shell 字符串 |
| 任务存储 | JSON 状态快照 + append-only JSONL 事件日志，单写入者 | MVP 保持轻量；未来多 worker/高并发时再评估 SQLite 或数据库 |
| 文件更新 | 临时文件写入、flush、原子替换 | Windows 替换/占用行为需测试；跨卷移动不得假定原子性 |
| 队列 | 单进程持久化队列 + 限制并发 | MVP 不做分布式队列 |
| 缩略图 | 由渲染器/FFmpeg 生成，缓存到任务目录 | 缩略图可删除重建，不作为原始资产 |
| 配置 | 继续使用既有 `.scale/` 治理与用户级目录 | 不把 Secret 保存进仓库、任务文件或前端 local storage |

---

## 3. 仓库落位建议

应先检查现有代码目录、命名惯例和依赖，再按仓库真实结构调整路径。建议新增或扩展以下模块：

```text
src/
  media/
    index.ts
    types.ts                 # Job、Asset、Provider、Evidence 等公共类型
    errors.ts                # 稳定错误码与错误映射
    config.ts                # 合并仓库级非敏感配置与用户级 Secret 引用
    validation/
      storyboard.schema.json
      scene.schema.json
      validateStoryboard.ts
      validateAssetRef.ts
    jobs/
      JobService.ts
      JobStore.ts            # 快照与事件日志
      JobScheduler.ts        # 单写入者、并发上限、恢复
      jobStateMachine.ts
      idempotency.ts
    storyboard/
      StoryboardService.ts
      migrateStoryboard.ts
    render/
      SceneRenderer.ts       # 可信声明式渲染
      FrameCapture.ts        # Playwright 封装
      FfmpegAdapter.ts
      RenderOrchestrator.ts
      renderProfile.ts
    providers/
      ProviderRegistry.ts
      ProviderPolicy.ts
      image/
        ImageProvider.ts
        MockImageProvider.ts
        OpenAICompatibleImageProvider.ts # 仅在真实能力验证后启用
      video/
        VideoProvider.ts
      audio/
        AudioProvider.ts
      music/
        MusicProvider.ts
        SunoApiExperimentalProvider.ts
    assets/
      AssetCatalog.ts
      AssetInspector.ts
      ThumbnailService.ts
      SafePath.ts
    evidence/
      EvidenceWriter.ts
      Redactor.ts
    security/
      MediaPermission.ts
      SecretResolver.ts
      RenderExecutionPolicy.ts
  dashboard/
    MediaControlPlane.ts
    # 复用现有 Dashboard 路由、鉴权、确认和错误处理模式
  cli/
    mediaCommands.ts
packages/
  dsh-scale/
    # 仅增量注册 media 工具、命令与结果卡片；不另建业务逻辑
.scale/
  skills.json
  tools.json
  skills/
    media/
      SKILL.md
      image/SKILL.md
      video/SKILL.md
      storyboard/SKILL.md
      troubleshooting/SKILL.md
docs/
  plans/media-workflow-v3.md
  media/
    architecture.md
    security.md
    storyboard-format.md
    provider-contract.md
    runbook-windows.md
```

### 3.1 代码组织约束

1. `src/media/` 不直接依赖 Dashboard UI 或 DSH UI。
2. Provider 不自行决定是否需要人工确认；确认由统一 Policy/Application 层执行。
3. 所有写磁盘的入口都经过 `SafePath`、权限检查与目标目录校验。
4. `AssetCatalog` 的扫描是索引能力；不能据此把 `running` 状态的任务自动标为成功。
5. Provider 接口必须描述能力、异步行为、成本估算是否可用以及取消支持情况。
6. MCP 工具与 REST 路由使用相同 request/response DTO，并共享错误码。

---

## 4. 任务模型与生命周期

### 4.1 核心实体

**MediaJob**
- `id`: UUID 或仓库现有 ID 规范生成的稳定 ID。
- `type`: `render`、`generate_image`、`generate_video`、`generate_music`、`stitch`、`import_asset`。
- `status`: 当前状态。
- `createdAt`、`updatedAt`、`startedAt`、`finishedAt`。
- `requestedBy`: `cli`、`dashboard`、`mcp`、`dsh`、`skill` 或自动化调用方。
- `idempotencyKey`: 可选，但所有计费任务必须支持。
- `inputRef`: 任务输入摘要或配置文件引用。
- `progress`: `stage`、`completed`、`total`、`percent`（percent 可空，不能伪造精度）。
- `attempt`: 当前尝试序号。
- `error`: 标准错误码、短消息、是否可重试、用户可见说明。
- `outputs`: 已提交的 Asset ID 列表。
- `evidenceRef`: evidence 文件引用。

**Asset**
- `id`、`taskId`、`kind`（image/video/audio/subtitle/project/thumbnail/other）。
- `relativePath`、`mimeType`、`sizeBytes`、`sha256`。
- `createdAt`、`source`、`provider`、`model`（适用时）。
- `width`、`height`、`durationMs`、`frameRate`（适用时，可空）。
- `state`: `staging`、`ready`、`quarantined`、`deleted`。

**Evidence Event**
- `eventId`、`timestamp`、`taskId`、`actor`、`action`、`result`。
- `toolVersion`、`configFingerprint`、`providerRequestId`（适用时）。
- `inputFingerprint`、`outputFingerprint`、`usage`、`costEstimate`（能获得时）。
- `redactionsApplied`；严禁记录原始密钥、完整 Cookie 或认证头。

### 4.2 状态机

```text
created -> validated -> queued -> running -> packaging -> succeeded
                        |          |            |
                        |          |            └-> failed
                        |          ├-> cancel_requested -> cancelled
                        |          ├-> retry_wait -> queued
                        |          └-> interrupted -> recovery_required
                        └-> failed_validation
```

状态约束：
- `succeeded` 只能在输出检查通过、资产清单提交成功并写入最终 evidence 后设置。
- `failed_validation` 不能自动重试，除非输入已修改。
- `retry_wait` 只用于可重试错误；重试次数和退避时间有上限。
- 对外部模型生成任务，网络超时后可能存在“供应商已受理但本地未收到响应”的不确定状态；应查询供应商任务 ID 或标记 `reconciliation_required`，不能盲目再次提交造成双重计费。
- `cancelled` 表示本地任务已终止；若 Provider 不支持取消，应显示外部任务可能仍在运行，不得假装远端已经停止。

### 4.3 崩溃恢复

启动流程：
1. 读取任务快照与事件日志，检查版本和校验和。
2. 识别上次退出时仍为 `running` 或 `packaging` 的任务。
3. 本地渲染任务：检查临时目录、产物完整性与已完成 stage；安全条件满足才继续，否则清理临时文件并重排。
4. 外部 Provider 任务：若已有 `providerRequestId`，先查询状态；没有足够信息时标记 `reconciliation_required`，等待人工处理或执行明确的补偿策略。
5. 对不完整或损坏的快照，优先从事件日志重建；重建失败则标记 `recovery_required`，不静默删除记录。

### 4.4 幂等和并发

- 所有会产生外部费用的提交操作必须接受 `idempotencyKey`。
- 以 `(user/workspace, idempotencyKey)` 作为去重范围，并设置合理 TTL/保留策略。
- 单进程 MVP 使用唯一 writer 锁，所有状态变更由 `JobScheduler` 串行提交。
- 渲染任务按资源限制控制并发；默认 1 个重渲染任务，Provider 并发另行配置。
- 不允许两个任务写同一个输出目录。最终文件先写入临时目录，验收通过再原子提交到 `assets/`。

---

## 5. 目录结构、资产与文件操作

### 5.1 建议的任务目录

```text
<workspaceRoot>/media/
  projects/<project-id>/
    project.json
    tasks/<task-id>/
      task.json
      storyboard.json
      inputs/
      assets/
        images/
        video/
        audio/
        subtitles/
        thumbnails/
      render/
        scene-source/
        frames/
        temp/
        logs/
      evidence/
        events.jsonl
        summary.json
        checksums.json
      output/
        final.mp4
        preview.gif
```

与 wewrite、huashu 或其他工具协同时，先通过适配层导入其实际产物；不要假设所有外部 Skills 都能接受完全相同的目录或写入约定。导入时记录 `sourceTool`、原始路径摘要、拷贝/硬链接/引用方式以及内容哈希。

### 5.2 目录规则

- `workspaceRoot` 必须是管理员或用户显式配置的根路径。
- API 不接受任意绝对路径作为读写目标；所有 asset 引用均使用任务范围内的相对路径或 asset ID。
- 检查路径规范化后的最终路径仍位于允许的根目录内，拒绝 `..`、UNC 外部路径、符号链接/重解析点逃逸及设备路径。
- 不将用户输入直接作为文件名；名称经过安全清理并附加稳定 ID。
- 原始输入、工作中临时资产、已提交资产分层管理；临时资产不可被 Gallery 当成最终成果。
- 缩略图和缓存可重建；源文件和最终输出不得在清理缓存时被删除。

### 5.3 文件提交协议

1. 在 `render/temp/<attempt-id>/` 生成文件。
2. 校验文件存在、可打开、大小、格式、分辨率、时长和音轨要求。
3. 计算 SHA-256，生成 Asset manifest。
4. 将产物移入最终 `assets/` 或 `output/` 目录。
5. 写入 `checksums.json` 与完成事件。
6. 最后把任务状态改为 `succeeded`。

如果最后任一步失败，则任务不能标记成功。启动恢复时按文件哈希和阶段记录识别可复用的产物。

### 5.4 项目与任务边界

- `project` 是内容项目容器，保存主题、画布规格、默认样式和资产索引。
- `task` 是一个可独立重试、取消、审计的操作单元。
- 一个项目允许多个任务共享只读资产；默认不允许多个任务覆盖同一资产。
- `storyboard.json` 必须版本化，迁移应可检测、可测试；不得静默修改旧版本文件。

---

## 6. Storyboard 与 Scene DSL

### 6.1 目标

将“媒体内容结构”和“渲染实现细节”分开。Storyboard 描述镜头顺序、时长、资源引用、转场、字幕、配乐、输出格式；Scene DSL 只描述允许的可视元素和动画参数。

### 6.2 Storyboard 格式建议

```json
{
  "schemaVersion": "1.0",
  "projectId": "project-demo",
  "title": "15 秒示例动画",
  "canvas": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "background": "#101827"
  },
  "output": {
    "format": "mp4",
    "videoCodec": "h264",
    "pixelFormat": "yuv420p",
    "audioCodec": "aac"
  },
  "scenes": [
    {
      "id": "scene-001",
      "title": "标题场景",
      "durationMs": 5000,
      "sceneDsl": "render/scene-source/scene-001.json",
      "assets": [],
      "transitionOut": { "type": "fade", "durationMs": 500 }
    },
    {
      "id": "scene-002",
      "title": "产品展示",
      "durationMs": 10000,
      "sceneDsl": "render/scene-source/scene-002.json",
      "assets": [],
      "transitionOut": { "type": "cut", "durationMs": 0 }
    }
  ],
  "audioTracks": [],
  "subtitles": [],
  "metadata": {
    "createdBy": "scale-media",
    "notes": "样例；正式文件经 schema 校验"
  }
}
```

该示例仅表示建议格式，不是现有仓库已经支持的格式。

### 6.3 Scene DSL 的 MVP 元素

允许：
- `rect`、`ellipse`、`line`、`text`、`image`、`group`。
- 坐标、宽高、颜色、边框、透明度、旋转、字体白名单。
- 有界时间动画：位置、透明度、缩放、旋转、简单 easing。
- 受限图片引用：只能指向已登记的 asset ID 或任务相对路径。
- 已审核模板：标题卡、字幕条、简单产品镜头、进度条、背景粒子（使用固定算法与上限）。

MVP 禁止：
- 任意 JS、`eval`、函数体、动态 `import`、`require`、Shell 命令或插件载入。
- 动态任意 URL 图片、远程 CSS、任意 HTML 注入。
- 未受限递归、无限循环、用户指定自定义字体文件或外部文件路径。
- 用场景描述控制文件系统、进程、网络或系统 API。

### 6.4 校验限制建议

- 最大画布：先限定到 3840×2160；超出需确认和独立性能测试。
- 帧率白名单：24/25/30/50/60 FPS；MVP 默认 30 FPS。
- 单任务总时长：MVP 默认上限 120 秒；可通过受治理配置调整。
- 场景数、元素数、图层深度、图片大小、动画数量均设上限，具体数值以性能 spike 冻结。
- 对文本长度、颜色、字体、坐标、时长、转场和资产引用做严格 schema 校验。
- 未知字段默认拒绝或产生显式兼容告警，不静默接受可能改变安全语义的字段。

### 6.5 关于自定义代码路径

如未来确实需要 Agent 直接生成绘制代码，应作为独立的高级渲染后端：
1. 只有通过安全审查的代码执行环境才可启用。
2. `node:vm` 不得被标记为安全隔离边界。
3. Windows 上应评估 AppContainer/低权限令牌、Job Object 资源控制及文件 ACL 等组合；相关机制需要工程实现与安全测试，不能仅因启用了其中一个功能就宣称安全。
4. 网络默认隔离；若任务确需网络，由可信 Provider 代理访问，不把通用网络权限交给用户代码。
5. 若使用容器/虚拟化，明确其运行前提、挂载范围、网络策略、镜像来源与升级方式。
6. 自定义代码模式默认关闭，只有管理员显式启用并接受对应风险后才开放。

---

## 7. 渲染与 FFmpeg 流程

### 7.1 渲染阶段

1. `validate_input`：检查 schema、任务目录、输入资产、画布和资源限制。
2. `prepare_scene`：将 Scene DSL 转成可信模板渲染页面/场景。
3. `render_frames`：按时间轴生成帧；每批帧记录范围、分辨率和完成标记。
4. `encode_video`：调用 FFmpeg 编码视频；通过参数数组启动，不经过 Shell 拼接。
5. `mix_audio`：按时间轴混合音乐、旁白和效果音，应用音量/淡入淡出策略。
6. `mux_subtitles`：选择烧录字幕或独立字幕文件；字幕字体与字符编码须测试。
7. `inspect_output`：检查文件可解析、时长范围、音视频流、分辨率、帧率和文件大小。
8. `commit_assets`：提交最终产物和校验和，写 evidence，更新任务状态。

### 7.2 Playwright/Chromium 与 node-canvas 的选择

**先做 spike，再冻结选择。** 推荐首选 Playwright/Chromium 的理由是 CSS 排版、文本、图片、SVG、布局和动画表达能力较强，且可与既有 Browser 依赖统一。但其代价包括浏览器安装体积、内存占用、版本差异和帧生成吞吐量。Playwright 官方支持页面/元素截图，但连续动画的时间控制仍需由渲染器设计，不应简单地连续调用截图就视为确定性视频渲染。

node-canvas 更轻，但复杂文本布局、字体兼容和模板交互能力需要另行实现。若 spike 表明 Playwright 在目标 Windows 环境的性能或分发成本不可接受，再把 node-canvas 作为备选，而不是同时维护两套完整 renderer。

### 7.3 Windows spike 必测项

- 固定 Node、Playwright、Chromium 与 FFmpeg 版本，记录实际版本号。
- 渲染 1920×1080、30 FPS、15 秒基准样片。
- 测试中文、日文、英文混排；缺字、换行、字体 fallback、emoji 的处理。
- 测试图像缩放、透明背景、SVG、遮罩、渐变和固定模板动画。
- 测试音轨淡入淡出、音画时长对齐、字幕烧录和输出封装。
- 测试渲染中断、磁盘写满、FFmpeg 不存在/版本不合适、路径含空格或非 ASCII 字符的行为。
- 记录总耗时、每帧耗时、峰值内存、临时空间占用和产物大小。
- 检查异常退出后 Chromium/FFmpeg 子进程是否被清理。

### 7.4 FFmpeg 调用规则

- 启动使用 `spawn(executable, args, { shell: false })` 或仓库等价安全封装。
- 只允许受控参数集；输出目录由系统生成，不接受任意用户写入目标。
- 记录 FFmpeg 版本、关键参数、退出码和经过脱敏的 stderr 摘要。
- 设置超时、取消信号和子进程清理；Windows 上必须验证子进程树终止策略。
- 不对用户传入的任意 FFmpeg filter 字符串直接放行；复杂 filter 由经过校验的中间表示生成。
- 最终输出使用播放器可接受的兼容配置；先以 H.264/AAC/MP4 作为 MVP 默认组合，实际可用性由目标机器验收确定。

---

## 8. Provider 架构

### 8.1 Provider 接口原则

Provider 是能力适配器，不是完整工作流。它不管理 UI、不直接改写 storyboard、不自行决定授权级别。

接口概念：

```ts
interface MediaProvider {
  id: string;
  kind: "image" | "video" | "audio" | "music";
  getCapabilities(): ProviderCapabilities;
  validateConfig(): Promise<ProviderConfigStatus>;
  estimate?(request: MediaRequest): Promise<UsageEstimate>;
  submit(request: MediaRequest, ctx: ProviderContext): Promise<ProviderSubmission>;
  getStatus?(providerTaskId: string, ctx: ProviderContext): Promise<ProviderTaskStatus>;
  cancel?(providerTaskId: string, ctx: ProviderContext): Promise<CancelResult>;
  download?(providerTaskId: string, ctx: ProviderContext): Promise<ProviderArtifact[]>;
}
```

上面是概念接口，正式类型须依据仓库 TypeScript 规范完善。不同类型的请求/响应应使用判别联合，而不是把所有可选字段堆在一个松散对象里。

### 8.2 能力描述

每个 Provider 必须声明：
- 生成类型（图像/视频/音频/歌曲）。
- 支持的输入模式、模型名、画幅、尺寸、时长和格式限制。
- 是否异步、状态查询方式、取消能力。
- 是否可以估价或查询配额。
- 是否支持幂等键、供应商任务查询及结果下载。
- 数据发送目的地、可能的保留策略和用户应知事项。
- 支持的地区/账号限制（如适用）。

### 8.3 接入优先级

1. `MockProvider`：用于测试及 UI/队列开发，无真实费用。
2. 一个真实图像 Provider：先验证端到端能力、错误、成本和配置；不先承诺支持所有 OpenAI-compatible 厂商。
3. 视频 Provider：仅在图像和任务基础服务稳定后接入，单独处理异步任务与时长限制。
4. 音乐 Provider：由用户明确启用，作为可选能力；器乐/本地生成路径可作为降级方案，前提是其依赖和许可证已验证。

### 8.4 用户级密钥与配置

- API Key、Cookie、Token 不进入 git、`.scale/tools.json`、任务目录、evidence、前端 bundle 或浏览器 local storage。
- `.scale/tools.json` 只声明工具及其策略，例如 `confirm` 级别和配置引用名，不保存密钥值。
- 密钥来源优先级：操作系统/部署的 Secret 存储（若项目已有）→ 用户级配置文件并设严格权限 → 环境变量；明确优先级，避免同名变量造成误判。
- 配置文件权限尽可能仅当前用户可读；不在异常信息中打印请求头、完整 URL 查询参数或供应商原始响应体。
- Dashboard 仅展示已配置/未配置、连通性结果、脱敏末尾标识；不得回显完整 secret。
- 供应商地址需做 URL 校验，阻止不受信任的内网地址/云元数据地址被当作 Provider 请求目标，防止 SSRF。

### 8.5 成本与配额治理

- `confirm` 级操作首次或显著高于预算时必须经用户确认。
- 支持每次任务预算上限、每日/每月预算上限、并发上限和 RPM 限制。
- 能估算时先展示估算；无法估算时明确标为“供应商侧费用未知”，不要显示虚假精确数字。
- 每次外部请求记录 Provider、模型、任务 ID、请求 ID、输入指纹、估算/实际 usage（若返回）和失败原因。
- 对超时提交实行不确定状态对账，不能无条件自动重发计费请求。

### 8.6 Suno 非官方封装的处理政策

`gcui-art/suno-api` 在其公开 README 中声明这是非官方封装，并说明依赖 Suno Cookie 和验证码解决服务。Suno 现行条款（2026-08-10 修订、2026-09-03 生效）禁止数据抓取/自动化数据提取及绕过访问封锁等行为。项目不得因服务自行部署就假定用户行为合规。

因此：
- 不把该 Provider 作为默认启用能力。
- 不提供 Cookie 抓取、账号池、保活或绕过风控功能。
- 仅在用户自行评估并确认其使用方式符合适用条款的前提下，提供可移除的适配器；默认禁用。
- 不把 Suno 的 API 连通性作为核心 CI/验收条件。
- 若项目使用范围不适合该接入，则删除该适配器，仅保留通用 `MusicProvider` 接口。
- 对需要商业发布的内容，必须核实所选服务层级及对应输出的使用权限，记录生成来源与许可信息。

---

## 9. CLI 契约

命令名需匹配仓库已有的 CLI 注册习惯；以下为推荐语义，不意味着已在代码中存在。

```text
scale media doctor
scale media providers list
scale media providers inspect <provider-id>
scale media project create --title "..."
scale media storyboard validate <path>
scale media storyboard show <project-id> <task-id>
scale media render --storyboard <path> [--project <id>] [--idempotency-key <key>]
scale media image generate --provider <id> --prompt-file <path> --output-task <id>
scale media task list [--status running]
scale media task show <task-id>
scale media task logs <task-id>
scale media task cancel <task-id>
scale media task retry <task-id>
scale media assets list [--project <id>]
scale media assets inspect <asset-id>
scale media evidence show <task-id>
```

### 9.1 CLI 行为要求

- 所有命令支持 `--json` 机器可读输出，并遵守仓库现有标准错误码和退出码规范。
- 不在命令行参数中要求用户直接输入 Secret，避免进入 Shell history；推荐配置命令只接受 Secret 引用或使用安全交互输入。
- 写操作显示目标项目、预期写入目录、估算成本（若可用）和确认等级。
- `--yes` 不得绕过仓库级禁止策略；是否能跳过确认由现有 Shield/Policy 统一裁决。
- 长耗时生成默认返回 task ID，而非一直阻塞到生成完成；可提供 `--wait` 作为可选模式。
- cancel/retry 对任务当前状态进行服务器端检查，无法取消的远端任务要明确提示。

---

## 10. REST API 契约

所有端点应接入现有 `AgentControlPlane` 或同类路由、中间件、错误响应、鉴权和审计模式；不得另起一套不一致的认证方案。

| 方法 | 路径 | 作用 | 是否写操作 |
|---|---|---|---|
| GET | `/api/media/health` | 环境、FFmpeg、renderer 与 workspace 可用性 | 否 |
| GET | `/api/media/providers` | Provider 清单与启用状态，不返回 Secret | 否 |
| POST | `/api/media/providers/:id/test` | 执行连接测试；需限速并脱敏结果 | 是/可能产生外部请求 |
| GET | `/api/media/projects` | 项目列表 | 否 |
| POST | `/api/media/projects` | 创建项目 | 是 |
| GET | `/api/media/projects/:id/assets` | 资产列表/筛选/分页 | 否 |
| GET | `/api/media/tasks` | 任务列表/筛选/分页 | 否 |
| POST | `/api/media/tasks` | 创建任务，支持幂等键 | 是 |
| GET | `/api/media/tasks/:id` | 任务详情与当前阶段 | 否 |
| GET | `/api/media/tasks/:id/events` | 任务事件/进度 | 否 |
| POST | `/api/media/tasks/:id/cancel` | 请求取消 | 是 |
| POST | `/api/media/tasks/:id/retry` | 按策略重试 | 是 |
| GET | `/api/media/tasks/:id/evidence` | 查看可公开 evidence 摘要 | 否 |
| GET | `/api/media/assets/:id` | 资产元数据 | 否 |
| GET | `/api/media/assets/:id/content` | 受控读取资产内容或返回受保护的本地资源引用 | 否/有访问控制 |
| GET | `/api/media/storyboards/:id` | 获取分镜 | 否 |
| PUT | `/api/media/storyboards/:id` | 更新分镜，带版本号防并发覆盖 | 是 |

### 10.1 API 基本规则

- JSON 请求体必须做 schema 校验、大小上限、路径/URL 校验。
- 对修改分镜的请求使用版本号或 `If-Match`，避免拖拽排序时覆盖其他修改。
- 长耗时任务使用 `202 Accepted` + task ID；前端轮询或使用既有事件机制查询进度。
- 每个写操作都经过权限与确认策略；确认结果应绑定任务输入指纹，避免用户确认后参数被替换。
- 错误响应包含稳定 `code`、安全的 `message`、`retryable` 与 `correlationId`，不直接返回 Stack Trace、Secret 或供应商原始敏感内容。
- 默认绑定 loopback；若需局域网访问，必须显式配置、鉴权并提示风险。
- 检查 Origin、CORS、CSRF 和跨站请求；不因本地服务而忽略浏览器攻击面。
- 限制上传大小、内容类型、总磁盘空间和并发任务；对媒体文件执行安全的元数据探测，不执行其携带的脚本。

---

## 11. MCP 与 DSH 集成

### 11.1 MCP 工具最小集合

- `media_list_providers`
- `media_create_task`
- `media_get_task`
- `media_list_assets`
- `media_get_asset_metadata`
- `media_validate_storyboard`
- `media_render_storyboard`
- `media_cancel_task`
- `media_get_evidence`

不建议第一版暴露任意路径读写工具、任意 FFmpeg 命令工具或任意代码执行工具。

### 11.2 工具 schema

- 所有路径参数优先使用 `projectId`、`taskId`、`assetId`，不暴露宿主绝对路径。
- 提交任务返回 task ID、当前状态、确认需求和结果查询方法。
- 外部费用操作使用统一确认策略；MCP 工具本身不能绕过 Shield。
- 工具响应只返回 UI 所需的摘要和受控链接，不把大型 base64 媒体直接塞进对话上下文。
- 大型产物通过本地受控资源、下载操作或 DSH 支持的预览引用呈现，具体遵循宿主能力。

### 11.3 DSH 桥

- 在 `packages/dsh-scale` 只增加适配器、工具注册、卡片和斜杠命令。
- DSH 端调用媒体服务/CLI，不复制渲染与 Provider 业务逻辑。
- 建议提供 `generate_image`、`generate_video` 的精简语义工具，但视频工具先以异步任务方式工作。
- Toolview 显示：任务状态、输入摘要、预览、输出格式/时长、失败原因、evidence 链接。
- 若宿主 API 发生漂移，适配层失败需可识别，不应影响 CLI 和 Dashboard 核心路径。

### 11.4 与其他 Agent 的兼容策略

- Skills 提供推荐工作流和 CLI 使用方法；CLI 是跨宿主的最小公分母。
- MCP 是可选的直连工具层；未支持 MCP 的 Agent 依旧可调用 CLI。
- 不承诺每个 Agent 都有相同的 UI 卡片；承诺相同的底层任务和产物语义。
- 安装 Skills 时记录来源仓库、版本/提交、安装日期、许可证和校验状态。

---

## 12. Skills 与外部工具治理

### 12.1 引入顺序

1. 审核上游 README、许可证、依赖、执行脚本和写盘路径。
2. 记录外部引用到 `EXTERNAL_REFERENCES` 等治理文件。
3. 固定版本或 commit；生产工作流避免跟踪浮动 `main`。
4. 在 Windows 环境安装、执行最小示例、检查产物和退出码。
5. 登记 `skills.json`、`tools.json` 与策略副本，并运行仓库既有 doctor/audit。
6. 将上游产物通过 adapter 导入项目任务目录，记录来源和哈希。

### 12.2 Skill 目录

建议把 `scale-media` 拆成任务路由与细分 Skill：
- `media/SKILL.md`：选择能力、工作流入口、任务目录和授权提醒。
- `media/image/SKILL.md`：图像生成、尺寸、资产登记。
- `media/video/SKILL.md`：视频生成和导出。
- `media/storyboard/SKILL.md`：Storyboard/Scene DSL 编写与校验。
- `media/troubleshooting/SKILL.md`：Windows 字体、FFmpeg、任务恢复等排错。

Skills 文档必须告诉 Agent：先读取仓库治理；写操作调用统一 CLI/API；不要自行访问密钥；不要直接运行任意 Shell/FFmpeg；生成结束后查询任务状态和 evidence。

### 12.3 治理登记

- 新增 `motionVideo` 领域时，关键词避免过宽；至少用正例/反例测试路由。
- `recommendedSkills` 指向当前已存在且通过 audit 的 Skills，不登记未完成能力为可用能力。
- `tools.json` 对外部收费 Provider 使用 `confirm`；本地渲染仍需要写盘策略检查。
- `SkillPolicy.ts`、`ToolPolicy.ts` 的默认副本必须有同步测试，避免只更新一份。
- `AGENTS.md` 提示不要把外部 Skill 当作安全边界。
- 升级上游版本必须重跑 audit、Windows smoke tests 和产物兼容性测试。

---

## 13. Dashboard Media Studio

### 13.1 v1 页面与功能

**A. 项目/资产 Gallery**
- 显示图像、视频、音频、字幕、分镜与最终导出。
- 筛选：文件类型、创建时间、来源 Provider、任务状态、标签。
- 卡片展示缩略图、时长/尺寸、创建任务、来源和哈希摘要。
- 隐藏临时文件、失败产物和 quarantined 资产，除非用户主动切换查看。

**B. Storyboard 分镜板**
- 查看场景顺序、时长、素材引用、转场、字幕和音轨。
- 支持拖拽排序与单镜预览。
- 保存时做 schema 校验和版本冲突检查。
- 不在浏览器端直接执行 Scene DSL 或任意代码。

**C. 任务队列**
- 按待处理、运行中、需处理、成功、失败、已取消筛选。
- 显示当前阶段、进度（如果可准确计算）、耗时、重试次数和预估/实际成本。
- 任务失败提供错误码、用户可读说明、日志摘要和“查看 evidence”。
- 取消、重试等写操作显示影响范围并沿用相同确认策略。

**D. Provider 管理（初版可只读）**
- 列表展示 Provider 启用状态、能力、连通性和配置来源。
- 不在页面中回显 Secret。
- “测试连接”提示可能产生的网络请求/费用，记录结果。

**E. Evidence 查看器**
- 时间线展示输入校验、用户确认、Provider 提交、轮询、下载、渲染、编码、输出校验等事件。
- 敏感字段默认脱敏；原始日志只在受控权限下访问。

### 13.2 交互原则

- Dashboard 不是另一套任务执行引擎，只是 API 的消费者。
- 所有写操作在服务端做权限与状态检查，不能信任前端按钮禁用状态。
- 轮询采用退避与停止条件，页面隐藏或任务结束时停止高频轮询。
- 页面只展示可验证的进度；若 Provider 不提供进度，不要伪造百分比。
- 媒体预览不应执行文件内的脚本、HTML 或外部资源请求。

### 13.3 v2 后续功能

仅在 v1 真实使用后再评估：无限画布、节点连线、可视化时间线、批量镜头重排、高级转场、协作编辑。每项都应基于用户真实需求和可量化痛点立项。

---

## 14. Evidence、审计和质量门禁

### 14.1 每个任务至少记录

- task ID、输入摘要、Storyboard schema 版本、Scene DSL 版本。
- 用户/Agent 调用入口、授权与确认结果。
- `scale-engine`、Node、Playwright/Chromium、FFmpeg 版本。
- Provider ID、模型、供应商任务 ID、请求 ID（适用时）。
- 生成参数、成本/配额信息（只记录实际可获得的字段）。
- 每个产物的相对路径、大小、类型、校验和和元数据检查结果。
- 每阶段开始/结束时间、退出码、错误码和重试原因。
- 脱敏策略与 evidence schema 版本。

### 14.2 不得写入 Evidence 的内容

- API Key、Cookie、Authorization header、完整环境变量。
- 带签名的临时下载 URL（若需要保留，应只记录不可逆摘要或经审查的域名/路径摘要）。
- 含个人信息或敏感内容的完整请求体，除非业务明确需要且经授权。
- 未经清洗的完整第三方错误响应。

### 14.3 质量门禁

- 图片：格式可读取、尺寸/色彩空间符合要求、非空、可计算校验和。
- 视频：FFprobe 能解析；时长、分辨率、帧率、视频/音频流存在性符合配置；关键帧可抽取。
- 音频：格式可解析、采样率/通道符合约定、时长在期望范围内。
- 分镜：所有引用都能解析；时长总和一致；转场无负值或越界；字幕/音轨范围有效。
- 对封面/关键帧可以调用宿主已有 visual-judge，但它是质量辅助而非安全检查替代品。
- 外部生成的内容需根据业务设置人工审核；自动检查不能替代版权、肖像、品牌与发布合规判断。

---

## 15. 安全威胁模型

### 15.1 需要防御的主要威胁

| 威胁 | 示例 | 控制措施 |
|---|---|---|
| 恶意 Scene DSL/渲染输入 | 极端元素数、深层嵌套、异常图片尺寸 | schema 限制、资源上限、可信 renderer、不支持脚本 |
| 任意代码逃逸 | Agent 输出访问文件或网络的 JS | MVP 不执行任意 JS；高级代码模式独立隔离并经安全审查 |
| 路径穿越 | `../../` 写入工作区外 | ID/相对路径接口、规范化后根目录检查、拒绝链接逃逸 |
| SSRF | Provider URL 指向 localhost/内网/云元数据 | Provider 主机 allowlist/策略、DNS 解析检查、禁用重定向到受限网络 |
| 命令注入 | 通过文件名/滤镜参数拼接 Shell | `shell:false`、参数数组、白名单参数和安全生成器 |
| Secret 泄漏 | 日志打印 Cookie 或 API Key | 集中脱敏、禁止记录认证头、前后端 Secret 隔离、扫描测试 |
| 重复计费 | 网络超时后自动重试 POST | 幂等键、Provider 任务对账、对不确定状态暂停盲重试 |
| 本地 Web 攻击 | 恶意站点向本地 API 发请求 | loopback 默认、鉴权/Origin/CSRF 检查、严格 CORS |
| 资源耗尽 | 无限任务、大分辨率、大量并发 | 时长/尺寸/帧数/并发/磁盘限额、超时和取消 |
| 产物污染 | 外部文件含恶意结构或错误元数据 | 类型探测、隔离导入、元数据读取使用可信工具、预览不执行脚本 |
| 上游依赖风险 | Skills 被改版、引入恶意脚本 | 固定版本、许可证审查、依赖审计、变更复核和回滚 |

### 15.2 Windows 进程与权限

- 渲染器和 FFmpeg 使用独立的可执行进程，且不继承不必要的环境变量和凭据。
- 资源限制、超时、进程树清理应由可信父进程监督；可评估 Windows Job Objects 等机制用于管理进程组和资源限制。
- 对任意代码执行的更强隔离，可评估 AppContainer/受限访问令牌、ACL、网络限制或虚拟化/容器方案；这些必须通过实现与安全测试验证，不能仅凭概念上采用就视为已安全。
- 工作目录只授予任务所需权限；不把用户主目录、仓库凭据目录或整个盘符挂载给渲染任务。
- 在子进程环境中清理云凭据、API Key、Cookie、开发工具 Token 等环境变量。
- 失败时终止子进程树并释放临时文件；清理失败要形成 evidence 事件并提示。

### 15.3 发布与外部副作用

- 生成、导出和发布分离；媒体生成不会自动触发发布。
- 发布功能不属于 MVP；未来若新增，必须要求显式 opt-in、预览 diff、目标账号和发布内容确认。
- 生成内容的许可、肖像权、商标、音乐版权及平台规则应有独立审核流程，不能只靠“模型可生成”决定可发布。

---

## 16. 测试策略

### 16.1 单元测试

- Storyboard schema 与迁移。
- Scene DSL 元素边界、深度、时长和尺寸限制。
- 路径安全、命令参数组装和敏感字段脱敏。
- 状态机合法/非法转换。
- 幂等键、重试和退避。
- Provider 错误映射与能力协商。
- evidence 完整性和哈希计算。

### 16.2 集成测试

- 从 Storyboard 到最终 MP4 的完整链路。
- Provider Mock：成功、速率限制、超时、提交成功但响应丢失、下载失败、配额不足。
- 服务重启后的任务恢复。
- 重复提交不会重复建任务或重复记账。
- 多次同时修改 Storyboard 的版本冲突。
- Dashboard、CLI、MCP 查询同一个任务时状态和 Asset ID 一致。
- Windows 路径含空格、中文、日文字符、不同盘符、文件被占用等情况。

### 16.3 安全测试

- `../`、UNC、符号链接/重解析点、设备路径和大小写边界。
- 巨型 JSON、巨幅图片、超长视频、异常媒体元数据。
- Provider URL 指向本机/私有网段/重定向地址。
- 输出路径覆盖仓库文件、Secret 文件或已有正式资产。
- 日志中的 Secret 泄漏扫描。
- 取消/超时后是否残留子进程。
- 前端跨站请求、Origin 校验与无权限写操作。
- 若启用自定义代码模式，必须额外做隔离逃逸与红队测试；未通过时保持功能关闭。

### 16.4 验收样例

- `sample-title-card`：只有文字和背景，生成 5 秒视频。
- `sample-motion-15s`：多场景、淡入淡出、图像素材、配乐，输出 15 秒 MP4。
- `sample-cjk-fonts`：中/日/英混排与字幕。
- `sample-cancel`：运行中取消后无残留渲染进程。
- `sample-provider-timeout`：外部 Provider 超时后不重复计费。
- `sample-recovery`：中断服务后恢复可确定状态。

---

## 17. 分阶段实施计划

阶段不能只按日期推进，必须满足 Gate 才能进入下一阶段。

### P0 — 治理与基线确认

**工作项**
- 核查现有 `AgentControlPlane`、CLI 注册、MCP server、dsh-scale、Shield/Evidence、资产扫描和用户级配置实现。
- 登记外部仓库、版本、许可证、依赖与预期用途。
- 固定 huashu Skills/CLI 版本；先在 Windows 上验证安装与最小示例。
- 新增媒体能力的 `skills.json`/`tools.json`/策略副本/AGENTS.md 登记。
- 记录现有测试基线和媒体相关依赖树。

**交付物**
- `media-workflow-v3.md`、依赖审查记录、外部引用登记、版本锁定清单、基线测试报告。

**Gate P0**
- 现有治理 doctor/audit 通过。
- 所有新增外部依赖有明确许可证/来源和安装版本。
- 未把未实现能力登记为可用能力。

### P0.5 — Windows 与安全 Spike（阻断关卡）

**工作项**
- 验证 Playwright/Chromium 截帧与 FFmpeg 编码。
- 测试中文/日文字体、音轨、字幕、路径与进程清理。
- 决定 MVP 使用 Scene DSL，默认关闭任意代码路径。
- 编写最小威胁模型，验证路径限制、子进程资源上限和安全配置。

**交付物**
- 可播放的 15 秒样片、运行日志、性能记录、依赖版本、限制清单。

**Gate P0.5**
- 在目标 Windows 机器成功输出视频。
- 对字体、音轨、输出编码有明确结论。
- 不以 `node:vm` 作为不可信代码隔离。
- 若渲染性能/依赖不达标，暂停主体开发并调整渲染方案。

### P1 — 核心引擎与任务运行模型

**工作项**
- 定义 MediaJob、Asset、Evidence 及错误码。
- 实现任务状态机、JSON 快照、事件日志、单写入者、幂等、取消、重试、恢复。
- 实现 Storyboard schema、Scene DSL 校验和可信 renderer。
- 实现 FFmpeg adapter、输出检查、资产提交协议。
- 实现 Mock Provider 和 CLI 基础命令。
- 打通 evidence 与现有 Shield/资源治理机制。

**交付物**
- 15 秒本地动画样片、自动化测试、任务目录样例、CLI 使用文档。

**Gate P1**
- 可创建、查询、取消、恢复任务。
- 成功状态只在产物检查和 evidence 提交后设置。
- 安全测试通过；没有默认开启的任意代码执行。

### P2 — Dashboard Media Studio v1

**工作项**
- 新增 `/api/media/*`，接入现有鉴权/确认/错误处理。
- 做 Gallery、Storyboard 编辑、任务队列、任务详情和 evidence 视图。
- 服务端校验所有写操作；前端通过 API 调用同一个 JobService。
- 加入任务事件刷新、进度和失败原因展示。

**交付物**
- 页面提交任务、查看进度、浏览产物、查阅 evidence 的演示流程。

**Gate P2**
- Dashboard 与 CLI 对同一任务的状态一致。
- 浏览器不能访问越界路径、读取 Secret 或自行执行 Scene DSL。
- 页面刷新/重启后仍可找到任务。

### P3 — 一个真实图像 Provider

**工作项**
- 根据实际需求选择一家具备可用接口、条款可接受的 Provider。
- 实现配置测试、异步/同步行为、失败映射、成本限制、下载和内容校验。
- 验证 idempotency/超时对账策略。
- 用户级配置与 Secret 脱敏完整接通。

**交付物**
- 一张真实生成图进入 assets/Gallery 的完整证据。

**Gate P3**
- 密钥不进入仓库、前端、日志或 task evidence。
- 真实调用的成本/用量记录可解释；无法确认成本时明确显示未知。
- 失败/超时测试不导致无条件重复提交。

### P4 — MCP 与 DSH 插件接入

**工作项**
- 注册媒体工具、结果卡片和斜杠命令。
- 连接同一 Media Application Service；不复制业务逻辑。
- 加入 task ID、状态查询、结果预览和 evidence 引用。
- 测试宿主 API 漂移和能力缺失时的降级行为。

**交付物**
- DSH 会话中提交媒体任务、查看状态、预览产物和证据的闭环。

**Gate P4**
- CLI、Dashboard、MCP/DSH 任务数据一致。
- 写操作均由同一 Policy/Shield 规则控制。

### P5 — 按需求扩展

可能项目：视频模型 Provider、实验音乐 Provider、批量分镜、先进转场、无限画布、云任务执行、多人协作。

每项单独立项、说明预期收益和维护成本，不默认全部纳入版本计划。Suno 类非官方接入必须通过服务条款与安全评审；不通过就不实现。

---

## 18. 风险登记表

| 风险 | 概率/影响 | 早期信号 | 缓解措施 | 责任关卡 |
|---|---|---|---|---|
| Windows 渲染链路不稳定 | 中/高 | Chromium 或 FFmpeg 在目标机失败 | P0.5 spike、固定版本、实机测试 | P0.5 |
| 不可信代码执行风险 | 高/极高 | 方案依赖 `node:vm` 作为唯一隔离 | MVP 使用 DSL；自定义代码模式关闭直至安全验证 | P0.5/P1 |
| 任务状态与磁盘产物不一致 | 中/高 | 任务成功但文件缺失，或反之 | 状态机、原子提交、哈希、恢复测试 | P1 |
| 外部 Provider 更改或限流 | 高/中高 | 错误率增加、API 行为改变 | Provider 隔离、mock contract test、可禁用配置 | P3+ |
| API 重试造成重复计费 | 中/高 | 超时后创建多个远端任务 | 幂等键、查询对账、未知状态暂停 | P1/P3 |
| Provider 费用失控 | 中/高 | 单任务请求量异常 | 预算上限、确认、并发/RPM 限制 | P3 |
| Dashboard/DSH 两套逻辑漂移 | 中/高 | 同一请求在不同入口表现不同 | 共享服务和 DTO、契约测试 | P2/P4 |
| Skills 上游变化 | 中/中高 | 文件结构/CLI 输出变化 | 固定 commit、审计、更新流程、回滚 | P0/P5 |
| Suno 非官方封装风险 | 高/高 | Cookie 失效、验证码/接口变更、条款不匹配 | 默认禁用、可选适配器、无核心依赖 | P5 |
| 产物和 evidence 泄密 | 中/高 | 日志出现 Token/临时下载 URL | 脱敏、最少记录、扫描和保留策略 | P1/P3 |
| 无限画布范围失控 | 高/中 | v1 包含节点编辑、复杂时间线 | 明确 v1 非目标，按需另立项目 | P2 |

---

## 19. 配置与运行手册

### 19.1 配置分层

- **仓库配置：** 非敏感默认值、能力声明、策略等级、schema 版本。
- **用户配置：** Provider 标识、用户偏好、用户级 endpoint 和 Secret 引用。
- **任务配置：** 画布、分辨率、fps、时长、输出格式、限额；任务创建后生成配置快照或指纹。
- **运行环境：** FFmpeg 可执行文件位置、临时目录、并发数、日志级别等运维配置。

明确每一类配置的覆盖优先级，避免不同入口在同一任务上使用不一样的配置。

### 19.2 默认限额建议

以下是首期建议默认值，应由性能测试冻结：
- 最大输出画布：3840×2160。
- 默认输出：1920×1080、30 FPS、H.264/AAC/MP4。
- 默认单任务时长：120 秒。
- 本地渲染并发：1。
- Provider 并发：按 Provider 独立配置。
- 最大重试：2 次，仅对安全、明确可重试错误；计费不确定状态不自动重试。
- 任务临时空间：每任务有上限；全局 workspace 有磁盘告警阈值。
- 本地 API 默认 loopback；远程访问默认关闭。

### 19.3 清理策略

- 失败任务的临时文件在保留诊断 evidence 后，按设置清理；默认不立即删除用户输入和已登记输出。
- 缓存/缩略图可被清理并重建。
- 任何自动清理均不得删除仍被其他任务引用的资产。
- 删除用户资产需显式确认，并写入审计事件。
- 对远端 Provider 生成结果，仅在遵守服务条款和本地保留策略的条件下下载/保存。

### 19.4 故障排查顺序

1. 运行 `scale media doctor`，检查 workspace、配置、FFmpeg、Chromium、权限与目录空间。
2. 查看 task status、阶段、退出码和稳定错误码。
3. 查看脱敏后的 task logs 与 evidence 时间线。
4. 对渲染问题用最小样例复现，不直接重跑可能产生费用的 Provider 请求。
5. Provider 超时先做状态对账；没有明确结论时进入人工处理，不盲目重试。
6. 升级外部依赖后，重跑 Windows smoke tests、schema tests 和契约测试。

---

## 20. 版本、迁移与回滚

- Storyboard 使用显式 `schemaVersion`；每次迁移提供纯函数与迁移测试。
- 任务快照与 evidence 记录自身 schema 版本；新版本代码必须能识别不支持的版本并给出迁移/只读提示。
- Provider 以配置启用，出现异常可单独禁用，不影响本地渲染路径。
- Dashboard/DSH 新功能通过功能开关逐步启用；若入口桥接失败，可关闭对应适配器，不回滚核心任务目录格式。
- 发布前备份配置和任务元数据；迁移不覆盖原文件，先写新版本、验证成功后再更新引用。
- 外部 Skills 更新可回退到上一个固定 commit；禁止自动拉取上游最新版后直接覆盖生产环境。
- 版本回滚不得把已经提交成功的产物误改成失败；任务状态与代码版本分开记录。

---

## 21. 决策清单（默认建议）

| 决策项 | 默认建议 | 需要在何时重开决策 |
|---|---|---|
| 首期渲染底座 | Playwright/Chromium，经 Windows spike 确认 | 性能、安装体积或字体表现不合格 |
| Scene DSL 或任意代码 | 首期 Scene DSL；任意代码关闭 | 确实出现 DSL 无法覆盖的需求且隔离技术通过安全评审 |
| 任务存储 | 单写入者 JSON 快照 + 事件日志 | 需要多 worker、多实例或频繁并发写入 |
| 数据库 | MVP 暂不引入 | 文件方案无法满足恢复/一致性/检索需求 |
| 首个真实 Provider | 以条款清晰、API 可用、能稳定下载结果者为准 | 完成供应商能力对比后冻结 |
| 音乐 | 通用 MusicProvider 可预留；Suno 适配器默认关闭 | 合规、账号风险和可持续性评估通过 |
| Dashboard v1 | Gallery + 分镜 + 队列 + evidence | 用户研究证明无限画布是关键需求 |
| DSH 画布 | 不做；只提供工具和卡片 | 另立需求与维护评估 |
| 云端多用户 | 不纳入 MVP | 有明确部署、身份、隔离、配额需求 |

---

## 22. 完成定义（Definition of Done）

每个功能完成前至少满足：

- [ ] 输入/输出契约已记录并做 schema 校验。
- [ ] 权限、确认、幂等、错误与取消语义已定义。
- [ ] 代码路径和 Provider 请求可观测、可脱敏、可追溯。
- [ ] 单元测试覆盖边界条件和失败路径。
- [ ] 集成测试验证真实数据流；外部服务用 Mock 覆盖异常。
- [ ] Windows 实机测试通过，且记录版本和测试结果。
- [ ] CLI、API、MCP/DSH（适用时）使用同一业务逻辑。
- [ ] 文档、Doctor、Skills 和治理登记同步更新。
- [ ] 失败恢复、回滚、临时文件清理已验证。
- [ ] 不存在未评估的 Secret 泄漏或任意代码执行路径。

---

## 23. 推荐的第一批工程任务拆分

按照实现依赖排序，第一批 PR 可以拆为：

1. **PR-1：契约与类型** — `MediaJob`、`Asset`、`Storyboard`、错误码、Schema 和样例。
2. **PR-2：任务存储** — task snapshot、事件日志、状态机、幂等和恢复测试；不含 UI。
3. **PR-3：Windows render spike** — 15 秒样片脚本、Playwright/FFmpeg 版本与性能报告。
4. **PR-4：Scene DSL renderer** — 可信模板、基本元素、帧渲染和安全限制。
5. **PR-5：FFmpeg adapter** — 输出封装、音轨、时长/流检查、进程取消和临时文件清理。
6. **PR-6：CLI 与 Doctor** — 创建、查询、取消、重试、日志、evidence；加入仓库既有命令注册模式。
7. **PR-7：REST API** — 基于现有 `AgentControlPlane` 统一 API 和权限策略。
8. **PR-8：Dashboard v1** — Gallery、分镜、任务队列、evidence。
9. **PR-9：真实图像 Provider** — 单供应商、真实费用确认、密钥脱敏、失败对账。
10. **PR-10：MCP/DSH** — 复用服务层的工具、卡片和命令。

不要把以上任务拆分理解为已核实的仓库文件现状；每个 PR 开始前都需依据实际代码确认插入位置和复用方式。

---

## 24. 参考资料与核验边界

以下外部资料用于核验技术与条款边界；项目实际代码和目标机器实测仍是最终依据。

1. Node.js 官方 `node:vm` 文档，明确说明该模块不是安全机制，不应运行不可信代码：<https://nodejs.org/api/vm.html>
2. Microsoft Learn：Windows AppContainer 隔离与文件、网络、进程边界：<https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation>
3. Microsoft Learn：Windows Job Objects 与进程组/资源限制：<https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
4. Playwright 官方截图文档：<https://playwright.dev/docs/screenshots>
5. FFmpeg 官方滤镜文档：<https://ffmpeg.org/ffmpeg-filters.html>
6. `gcui-art/suno-api` 公开 README（非官方项目声明、认证/验证码依赖与许可证）：<https://github.com/gcui-art/suno-api>
7. Suno 官方条款（版本和生效日期以页面为准）：<https://suno.com/terms>

### 核验边界

- 本方案依据用户提供的 v2 文档及上述公开资料形成，不代表已经检查或运行了用户的完整仓库。
- 文件路径、已有组件能力、Dashboard 路由细节、DSH 当前接口与 Windows 上 huashu 的实际行为，必须在 P0/P0.5 通过本地代码检查和实测确认。
- Provider 选择、费用、地区可用性和输出商业使用权限会变化，应在实际接入时重新核验。
- 若外部条款与实际使用方式不相容，应移除对应适配器，而不是依靠“自部署”推定合规。

---

## 25. 最终实施建议

**按 P0 → P0.5 → P1 → P2 → P3 → P4 的顺序实施，P5 所有扩展另行决策。**

首先完成治理登记与 Windows 安全/渲染 Spike。通过后实现声明式场景、可靠任务模型、可信本地渲染和 FFmpeg 出片；随后做 Dashboard；再验证一个真实图像 Provider；最后接入 DSH/MCP。不要在首期同时建设无限画布、多个厂商池、歌曲生成和任意代码沙箱。

这条路线保留了 v2 的平台所有权与多 Agent 兼容价值，同时将最大的不确定性提前暴露，并把“能出片”升级为“可恢复、可审计、可安全运行、可持续维护”。
