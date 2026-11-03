# Scene DSL 分镜格式（v0.4）与 scale media CLI

媒体引擎的实现基准是 [内容媒体工作流方案 v3](../plans/2026-10-25-content-media-workflow-plan-v3.md)（P0.5 已通过，报告见 `scripts/media-spike/REPORT.md`）。本文是 Scene DSL v0.4 的格式说明与 CLI 用法。**v0.4（M3）新增：视频元素、全局音轨（旁白/BGM）与字幕策略；v0.3 新增 `asset://` 跨任务素材引用（渲染前物化）；v0.2 新增 slide/wipe 转场与 `scale media batch`；v0.1–v0.3 分镜仍为合法输入。**

## 安全模型（先读）

- Scene DSL 是**纯声明式**的：没有脚本、没有 URL、没有动态求值。校验器（`src/media/validation/validateStoryboard.ts`）是安全边界——未知字段一律拒绝。
- 渲染器是可信模板（`src/media/render/SceneRenderer.ts`），动画状态是注入时间的纯函数（无 rAF），同一分镜重跑产出逐帧一致的帧序列。
- 素材引用只能是任务目录 `assets/` 内的相对路径（v0.3 起也可以是同项目已完成任务的 `asset://` 引用），扩展名白名单 `.png/.jpg/.jpeg/.webp`，`..`、绝对路径、盘符一律拒绝。`asset://` 在创建/保存时校验源任务，渲染前复制进当前任务并记录证据。
- 任务成功状态只在「产物检查 + evidence 提交」之后设置；崩溃残留的任务会被标为 `interrupted`，不会被伪装成成功或失败。

## 格式

```jsonc
{
  "schemaVersion": "0.4",              // 0.1 / 0.2 / 0.3 / 0.4 均可；slide/wipe 需 ≥0.2；asset:// 需 0.3；视频/音轨/字幕需 0.4
  "title": "可选，≤200 字符",
  "canvas": {
    "width": 1920,                      // 偶数整数，[16, 3840]
    "height": 1080,                     // 偶数整数，[16, 2160]
    "fps": 30,                          // 白名单：24/25/30/50/60
    "background": "#0f172a"             // #RGB/#RRGGBB/#RRGGBBAA
  },
  "output": {                           // 可选
    "videoCodec": "libx264", "pixelFormat": "yuv420p", "audioCodec": "aac",
    "crf": 20, "preset": "medium"       // crf [0,51]；preset 白名单
  },
  "scenes": [                           // 1..30 个；单幕 ≤60s；总时长 ≤120s
    {
      "id": "intro",                    // /^[\w-]{1,64}$/，全局唯一
      "durationMs": 5000,
      "elements": [                     // 每幕 1..50 个
        { "type": "text", "content": "≤200 字符", "fontFamily": "Microsoft YaHei",
          "fontSize": 96, "color": "#f8fafc", "x": "center", "y": 430,
          "animation": { "type": "fadeInUp", "delayMs": 0, "durationMs": 900 } },
        { "type": "rect", "x": 260, "y": 320, "width": 420, "height": 400,
          "color": "#2563eb", "radius": 24,
          "animation": { "type": "slideUp", "durationMs": 800 } },
        { "type": "image", "src": "covers/cover.png", "x": 100, "y": 100,
          "width": 400, "height": 300 },
        { "type": "image", "src": "asset://job-2026-10-29-1a2b3c4d/assets/generated/hero.png",
          "x": "center", "y": 0, "width": 1920, "height": 1080 }   // 仅 0.3
      ],
      "transitionOut": { "type": "slide", "direction": "left", "durationMs": 500 }
      // type: fade（无 direction）| slide | wipe（必须 direction: left/right/up/down）
    }
  ],
  "subtitles": [                        // 可选，≤50 条；startMs < endMs
    { "startMs": 800, "endMs": 4500, "text": "烧录字幕" }
  ]
}
```

- `x`：数字（0..3840）或 `"center"`；`y`：数字（0..2160）。
- 动画白名单：`fadeIn` / `fadeInUp` / `slideUp` / `progressBar`；`delayMs`/`durationMs` 必须落在所在幕时长内（progressBar 动画 width 从 0 → 元素 width）。
- 转场（v0.2）：`fade`（淡出，无 direction）、`slide`（整幕滑出，direction 指定滑出边）、`wipe`（clip-path 擦除，direction 指定擦除边）；v0.1 只允许 fade。
- 字体白名单：Microsoft YaHei / SimHei / SimSun / KaiTi / Segoe UI / Arial / sans-serif / serif / monospace。
- 限额可通过 `STORYBOARD_LIMITS`（代码内常量）追溯；修改限额属于治理变更，需同步测试。

## `asset://` 跨任务素材（v0.3）

把已完成生成任务的图片引到另一条分镜里，渲染前自动物化，可审计、可幂等重试。

```jsonc
{ "type": "image", "src": "asset://<sourceTaskId>/assets/generated/hero.png",
  "x": "center", "y": 0, "width": 1920, "height": 1080 }
```

- 源任务必须存在、同 project、状态 `succeeded`；创建/保存 storyboard 时即校验（源缺失 → `MEDIA_ASSET_REF_MISSING`）。
- ref 形状固定 `asset://<taskId>/assets/<rest>`；`rest` 非空，只允许 `[\w./-]`，禁止空段、`.`、`..`、盘符（`:`）、反斜杠和百分号编码；扩展名白名单同普通图片。
- 渲染阶段顺序：`materialize → validate_assets → prepare → capture → ...`。物化目标 `assets/external/<sourceTaskId>/<rest>`；`src` 重写为 `external/<sourceTaskId>/<rest>`（`src` 始终相对任务的 `assets/`）。
- 目标已存在且 sha256 相同 → 跳过；不同 → `MEDIA_ASSET_REF_CORRUPT`，绝不覆盖。源文件与源任务 output 记录的 sha256 不一致同样是 `CORRUPT`。
- 证据追加 `asset_materialized`：`{ ref, sourceTaskId, sourceSha256, destPath, bytes, skipped }`（`destPath` 为任务相对路径）。
- 错误码：语法/越界/绝对路径/盘符/非法扩展名 → `MEDIA_ASSET_REF_INVALID`；源任务缺失、未完成或源文件缺失 → `MEDIA_ASSET_REF_MISSING`；哈希不一致 → `MEDIA_ASSET_REF_CORRUPT`。
- Dashboard 预览：`GET /api/media/assets/content?project=<p>&ref=asset://...`（`ref` 与 `taskId/path` 二选一）。
- 画布编辑器：选中场景 → 检查器「插素材」列出同项目已完成任务的图片；保存时自动把 schemaVersion 提升到 0.3。

## Scene DSL 0.4：视频、配音与字幕（M3）

```jsonc
{
  "schemaVersion": "0.4",
  "canvas": { "width": 1080, "height": 1920, "fps": 30, "background": "#0b1220" },
  "scenes": [
    {
      "id": "open",
      "durationMs": 4000,
      "narrationText": "第一句。第二句！",          // 自动字幕的唯一文本来源（1..500 字符）
      "elements": [
        { "type": "video", "src": "clips/host.mp4",
          "fit": "cover", "muted": true, "loop": true,
          "trimStartMs": 0, "trimEndMs": 6000 },   // 最多 1 个视频/幕；时长窗口 ≤600000ms
        { "type": "text", "content": "口播标题", "fontFamily": "Microsoft YaHei",
          "fontSize": 64, "color": "#f8fafc", "x": "center", "y": 120 }
      ]
    }
  ],
  "audioTracks": [                                  // ≤2 条，narration / bgm 各至多一条
    { "src": "voice/vo.mp3", "kind": "narration", "volume": 1, "fadeInMs": 120 },
    { "src": "music/bed.mp3", "kind": "bgm", "volume": 0.35, "loop": true, "fadeOutMs": 800 }
  ],
  "subtitleOptions": { "mode": "both", "source": "auto" }
}
```

- **视频元素**：`src` 仍是任务 `assets/` 内相对路径，扩展名 `.mp4/.mov/.webm`，≤200 字符。`trimStartMs < trimEndMs` 且 `trimEndMs ≤ 600000`；`fit` 默认 `cover`（裁切填满），`contain` 用画布背景色留边；`muted` 默认 `true`。幕时长是权威值：窗口短于幕且 `loop:false` → 渲染期 `MEDIA_STORYBOARD_INVALID`；`loop:true` 循环的是**裁切后的窗口**，不是整段原片。
- **渲染方式**：视频幕由 ffmpeg 裁切/缩放/补边并统一编码；图片幕仍由 Playwright 逐幕截帧。视频幕里除 `video` 之外的元素作为**静态透明图层**叠加（0.4 暂不支持视频上的元素动画）。所有 segment 使用同一编码参数后 concat 流拷贝，硬切；不做跨幕淡化。
- **音轨**：`narration` / `bgm` 各至多一条；`volume` ∈ [0,1]，`loop` 到片尾，`fadeInMs/fadeOutMs` 为淡入淡出。音轨与未静音的片段原声由 ffmpeg 混成 48kHz 立体声 AAC；`muted:false` 的片段音频按幕起点落到全片时间轴。
- **字幕**：`subtitleOptions.mode = none | burn | srt | both`；`source` 默认 `auto`（由各幕 `narrationText` 按句切分，自动排到幕内时间），`file` 时必须给 `src`（`assets/` 内 `.srt`）。`srt/both` 额外产出 `output/subtitles.srt` 作为第二个 output；`burn/both` 在 ffmpeg 支持 `subtitles` 滤镜时烧录。声明旁白音轨 + 自动字幕时，**每一幕都必须有 `narrationText`**。
- **路径选择**：只要存在视频元素或音轨，就走组合渲染（`compose_segments → audio_mix → mux`）；纯图片且无音轨的 0.4 分镜仍走旧管线（`capture → audio(440Hz 占位) → encode`），行为与 0.1–0.3 一致。
- **失败语义**：DSL 结构错误在创建任务时即 400；依赖素材的裁切越界/过短在 `compose_segments` 阶段才可知，任务落 `failed` + `MEDIA_STORYBOARD_INVALID`（状态机没有 `running → failed_validation` 迁移，`failed_validation` 不会被写入）。

### 模板向导（M3）

内置 3 个模板：`talking-head`（9:16 口播，1 个媒体 + 旁白/可选配乐）、`product-showcase`（16:9，3–6 个媒体 + 可选 BGM）、`fast-cuts`（1:1，4–8 张图 + 可选逐图字幕/配音）。

```text
GET  /api/media/templates                     → { templates: TemplateDefinition[] }
POST /api/media/plan         { templateId, slots } → { ok, plan }        # 纯预览：占位符 + 估算，不落盘
POST /api/media/templates/:id/assemble { slots, title? } → { ok, storyboard }  # 严格：缺必填即 400
```

预览（`plan`）会给缺失槽位填结构占位符并返回 warnings；组装（`assemble`）不做占位，缺必填 / 类型不符 / 数量越界直接 `MEDIA_STORYBOARD_INVALID`，未知模板 `MEDIA_ACTION_UNKNOWN`。组装结果再过一遍 DSL 校验器，随后用普通 `POST /api/media/tasks` 建任务。

## 批量分镜（P5）

```bash
scale media batch <template.json> <count> <out.json> [--start 1]
```

模板中的 `{{n}}`（批次序号，1 基）与 `{{nn}}`（按最大索引宽度补零）会在文本、scene id、图片 src、字幕里替换；字幕时间按模板周期自动平移。展开结果先过校验器再写盘。

## CLI

```bash
scale media doctor                                    # ffmpeg/ffprobe/playwright/工作区体检
scale media validate <storyboard.json>                # 只校验不出片
scale media render <storyboard.json> --project p1 \
  --idempotency-key <key> [--ffmpeg <path>]           # 建任务并同步执行
scale media task list|show|cancel|retry|evidence|recover ...
```

- 工作区结构：`<root>/media/projects/<project>/tasks/<task-id>/{task.json, events.jsonl, storyboard.json, assets/, output/, evidence/, render/}`。
- 二进制发现顺序：CLI 参数 → `MEDIA_FFMPEG_BIN`/`MEDIA_FFPROBE_BIN` → WinGet Links → `~/tools/ffmpeg-dl`、`~/tools/media` 扫描 → PATH。
- 单写者：仓库级 FileLock 保护，第二个写者 3 秒快速失败（`MEDIA_LOCK_TIMEOUT`，可重试）。
- 取消是阶段间协作式的：`task cancel` 写入标志，运行中的任务在下一阶段边界停止并落 `cancelled`。
- evidence：`evidence/events.jsonl` 逐事件记录阶段耗时、二进制版本、产物 sha256；secret 形键名强制 `[redacted]`。

## 测试

`npm run test:quick` 的 `tests/media` 目录覆盖：校验器（含 0.3 asset ref 越界与 0.4 视频/音轨/字幕用例）、`asset://` 解析与物化（幂等/缺失/哈希不符/跨 project）、任务生命周期（状态机/幂等/取消/崩溃恢复/重试）、evidence、provider、MCP 工具、REST API、M3 字幕/混音/视频拼接（含视频幕的透明叠加层）/模板组装，以及端到端管线（组合与旧路径；本机无 Chromium/FFmpeg 时显式跳过并注明原因，CI 安全）。

## 模型生图与 Provider（v3 §8）

- `scale media image generate --prompt "…" --provider openai-compatible`（或 `--provider mock` 做零成本链路验证）。
- OpenAI 兼容适配器：`MEDIA_OPENAI_API_KEY`（必填）+ `MEDIA_OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）+ `MEDIA_OPENAI_IMAGE_MODEL`（默认 `gpt-image-1`）。key 只在环境变量，绝不入库/入 evidence。
- SSRF 守卫：provider URL 必须 HTTPS；loopback HTTP 需 `MEDIA_PROVIDER_ALLOW_LOCAL=1`；云元数据地址（169.254.169.254 / *.internal）一律拒绝。
- 实验性音乐 provider（suno-api）默认禁用：启用需 `MEDIA_ENABLE_EXPERIMENTAL_PROVIDERS=suno-api` + `MEDIA_SUNO_BASE_URL`，启用前先读 v3 方案 §8.6 条款边界。
- MCP 宿主（DSH 等）经 `media_*` 工具访问同一 JobService（`src/media/mcpTools.ts`）；Dashboard 经 `/api/media/*`（`src/dashboard/MediaControlPlane.ts`）。

## Dashboard「Media Studio」

导航 → Media Studio：任务队列（3s 自动刷新）、任务详情（storyboard 冻结副本 + evidence 时间线 + 产物预览）、模板向导（选模板 → 填槽位 → 预览方案 → 组装并创建）、画布编辑器（场景排序/时长/转场、视频裁切与循环、音轨音量/循环、旁白文本与字幕模式）、素材库（图/视频缩略预览）、新建任务（粘贴 storyboard JSON）、provider 状态。API 契约见 `src/dashboard/MediaControlPlane.ts` 头注。
