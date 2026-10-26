# Scene DSL 分镜格式（v0.2）与 scale media CLI

媒体引擎的实现基准是 [内容媒体工作流方案 v3](../plans/2026-10-25-content-media-workflow-plan-v3.md)（P0.5 已通过，报告见 `scripts/media-spike/REPORT.md`）。本文是 Scene DSL v0.2 的格式说明与 CLI 用法。**v0.2 新增：slide/wipe 先进转场、`scale media batch` 批量分镜；v0.1 分镜仍为合法输入。**

## 安全模型（先读）

- Scene DSL 是**纯声明式**的：没有脚本、没有 URL、没有动态求值。校验器（`src/media/validation/validateStoryboard.ts`）是安全边界——未知字段一律拒绝。
- 渲染器是可信模板（`src/media/render/SceneRenderer.ts`），动画状态是注入时间的纯函数（无 rAF），同一分镜重跑产出逐帧一致的帧序列。
- 素材引用只能是任务目录 `assets/` 内的相对路径，扩展名白名单 `.png/.jpg/.jpeg/.webp`，`..`、绝对路径、盘符一律拒绝。
- 任务成功状态只在「产物检查 + evidence 提交」之后设置；崩溃残留的任务会被标为 `interrupted`，不会被伪装成成功或失败。

## 格式

```jsonc
{
  "schemaVersion": "0.2",              // 0.1 / 0.2 均可；slide/wipe 仅 0.2
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
          "width": 400, "height": 300 }
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

`npm run test:quick` 的 `tests/media` 目录：校验器 11 例、任务生命周期（状态机/幂等/取消/崩溃恢复/重试）7 例、evidence 2 例、provider 9 例、MCP 工具 5 例、REST API 6 例、端到端管线 1 例（本机无 Chromium/FFmpeg 时自动跳过，CI 安全）。

## 模型生图与 Provider（v3 §8）

- `scale media image generate --prompt "…" --provider openai-compatible`（或 `--provider mock` 做零成本链路验证）。
- OpenAI 兼容适配器：`MEDIA_OPENAI_API_KEY`（必填）+ `MEDIA_OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）+ `MEDIA_OPENAI_IMAGE_MODEL`（默认 `gpt-image-1`）。key 只在环境变量，绝不入库/入 evidence。
- SSRF 守卫：provider URL 必须 HTTPS；loopback HTTP 需 `MEDIA_PROVIDER_ALLOW_LOCAL=1`；云元数据地址（169.254.169.254 / *.internal）一律拒绝。
- 实验性音乐 provider（suno-api）默认禁用：启用需 `MEDIA_ENABLE_EXPERIMENTAL_PROVIDERS=suno-api` + `MEDIA_SUNO_BASE_URL`，启用前先读 v3 方案 §8.6 条款边界。
- MCP 宿主（DSH 等）经 `media_*` 工具访问同一 JobService（`src/media/mcpTools.ts`）；Dashboard 经 `/api/media/*`（`src/dashboard/MediaControlPlane.ts`）。

## Dashboard「Media Studio」

导航 → Media Studio：任务队列（3s 自动刷新）、任务详情（storyboard 冻结副本 + evidence 时间线 + 产物预览）、素材库（图/视频缩略预览）、新建任务（粘贴 storyboard JSON）、provider 状态。API 契约见 `src/dashboard/MediaControlPlane.ts` 头注。
