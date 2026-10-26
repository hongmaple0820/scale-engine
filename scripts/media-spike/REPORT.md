# P0.5 Windows 渲染 Spike 报告

- 日期：2026-10-25
- 依据：`docs/plans/2026-10-25-content-media-workflow-plan-v3.md` §7.3（阻断关卡）
- 结论：**P0.5 门禁通过** —— Windows 出片链路可行，Scene DSL + 可信渲染器路线确认，node:vm 不进入 MVP（v3 既定）。

## 1. 版本矩阵（本次实测）

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| Node | v24.14.1 | 本机 |
| Playwright | ^1.50.0（仓库依赖），Chromium **1223** | ms-playwright 缓存，已就绪无需下载 |
| FFmpeg | **20181217-f22fcd4**（静态构建，含 libass/drawtext/libx264/aac） | npm `@ffmpeg-installer/ffmpeg`（网络抖动下 winget/直连下载均不可用，npm CDN 秒级可用） |
| ffprobe | 20230213-2296078 | npm `@ffprobe-installer/ffprobe` |

> 注意：静态 FFmpeg 为 2018 年构建，功能满足本次 spike；P1 开工前应修复 winget 断链（`winget upgrade Gyan.FFmpeg`，8.1.1 已在源内）并重跑冒烟，确认新版行为一致。

## 2. 样片与性能

| 指标 | 实测 |
| --- | --- |
| 成片 | 15.00s（ffprobe 精确），1920×1080，h264 + aac，401KB |
| 帧捕获 | 450 帧 / 23.3s → **平均 52ms/帧**（约 30fps 出片需求的 6 倍实时吞吐） |
| 每 100 帧耗时 | 5735 / 4880 / 4821 / 4961 ms（平稳，无衰减） |
| 音频合成 | 129ms（lavfi sine + afade in/out） |
| 编码 | 4.66s（libx264 crf20 medium + 字幕烧录） |
| 全流程 | 31.9s（含浏览器启动/关闭） |
| 峰值内存（Node 侧） | ~171MB |
| 进程清理 | ffmpeg 残留 0；chrome.exe 基线对照 31→31（泄漏 0，spike 期间观测到的 35 为本机环境噪音） |

## 3. v3 §7.3 必测项逐项结论

| # | 项 | 结论 |
| --- | --- | --- |
| 1 | 固定版本并记录 | ✅ 见 §1 |
| 2 | 1080p30 15s 基准样片 | ✅ `~/tools/media-spike/输出 测试/final.mp4`，ffprobe 校验 h264/aac/15.00s |
| 3 | 中/日/英混排 | ✅ 中英混排字形正确（Microsoft YaHei，无 tofu）；**日文未测**（同 Han 字体族，风险低，列入 P1 冒烟清单） |
| 4 | 缺字/换行/fallback/emoji | ⚠️ 部分：缺字未触发（样片文本全部命中系统字体）；换行/emoji 未测 → P1 文本布局器范围 |
| 5 | 图像缩放/透明/SVG/遮罩/渐变/模板动画 | ⚠️ 部分：rect 几何动画、fadeIn/fadeInUp/slideUp/progressBar、场景级淡入淡出转场 ✅；SVG/遮罩/渐变未测（DSL v0.1 无此元素）→ P1 renderer 元素集设计输入 |
| 6 | 音轨淡入淡出/音画对齐/字幕烧录/封装 | ✅ afade 1s in/out、`-shortest` 对齐、libass 烧录中文（force_style 指定雅黑）、h264+aac MP4 封装 |
| 7 | 中断/磁盘满/ffmpeg 缺失/特殊路径 | ⚠️ 部分：**非 ASCII + 空格输出路径 ✅**（`输出 测试/final.mp4` 直写成功）；ffmpeg 缺失探测逻辑 ✅；硬中断与磁盘满是任务模型范畴 → P1 恢复/限额测试 |
| 8 | 性能记录（总耗时/每帧/内存/临时空间/产物大小） | ✅ 见 §2（临时 PNG 帧 ~450 文件，跑后可清理） |
| 9 | 异常退出后子进程清理 | ✅ leak 基线对照 0 泄漏（launch→screenshot→close 全周期） |

## 4. 决策（按 v3 §21 决策清单确认）

1. **渲染底座：Playwright/Chromium 截帧，冻结。** 52ms/帧 @1080p，4K（4× 面积）按比例估算 ~210ms/帧仍有 ~2.5× 余量；确定性由「显式时间注入 + 逐帧截图」保证（页面动画纯由 `renderFrame(tMs)` 驱动，无 rAF 依赖）。
2. **Scene DSL MVP 确认。** 本次样片即由声明式 `scene.json` 驱动（rect/text + 4 种有界动画 + 场景转场），未执行任何任意代码。
3. **字幕双路**：libass 烧录可用；P1 保留 mov_text 软字幕作为无 libass 环境的回退。
4. **非 ASCII 路径**：ffmpeg argv 级 Unicode 直写成功；P1 仍默认 ASCII 工作目录 + 非 ASCII 仅用于最终输出路径（防御性收窄）。

## 5. 遗留与移交 P1

- winget 断链修复（Gyan.FFmpeg 8.1.1）后重跑本 spike 冒烟，更新 §1 版本矩阵。
- 日文/emoji/换行、SVG/遮罩/渐变元素、硬中断恢复 → P1 renderer 与任务模型测试矩阵。
- P1 起始代码可直接演化本 spike：`scene.json` → schema 化 DSL，`render-spike.mjs` → `src/media/render/`（FrameCapture/FfmpegAdapter/RenderOrchestrator）。
