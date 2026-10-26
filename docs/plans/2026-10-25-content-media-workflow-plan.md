# 内容媒体工作流方案 v2 — 自研媒体引擎 × 引入 skills × 双端可视化（Dashboard + DSH 插件）

- 日期：2026-10-25（v2，替代同日 v1「直接装 dsh 插件」方案）
- 状态：**实施细节已被 v3 评审版替代**（见 `2026-10-25-content-media-workflow-plan-v3.md`，有条件采纳为实施基准）；本文保留能力调研与内容管线集成叙事（wewrite/huashu/dsh 学习来源、三条流水线），作为 v3 的上下文输入
- 任务等级：L（新增自研子系统 + 双宿主界面 + 多 agent 兼容层）
- 策略修正（用户定调）：**skills 引入集成，平台能力自研**。wewrite、huashu-motion、huashu-art-motion 作为 skill/CLI 引入；dsh-imagegen-video 与 dsh-agnes-multimodal 是独立 DSH 插件，**不装不复用其包**，只学习借鉴其设计，由 scale-engine 自研等价能力，融入自己的工作流。
- 关联：`docs/plans/2026-10-15-dsh-plugin-integration-plan.md`（dsh-scale 插件，T0/T1 实机验收，T2 命令/Skills 桥与 T3 toolview 卡片已见 README）；`2026-10-25-wechat-content-integration`（wewrite 治理集成，已完成）

---

## 0. 结论先行

| 能力 | 处置方式 | 理由 |
| --- | --- | --- |
| wewrite（公众号图文，CLI + 10 skills） | 已引入集成（上一任务完成） | 成熟完整，治理已登记 |
| huashu-motion / huashu-art-motion（代码动画/宣传片 skills） | 引入集成：`npx skills add` 装机 + 治理登记 | 纯 skill 形态，天然多 agent 兼容 |
| 生图/生视频（模型调用 + 代码渲染 + 分镜拼接 + 画布） | **自研 `scale media` 子系统** | dsh 两插件是独立宿主插件，账号池、配置、产物都在别人体系里；自研后引擎归我们，双端界面共用一个后端 |
| suno-api（gcui-art/suno-api，AI 音乐生成） | **接入为音乐 provider**：用户自部署（Vercel/Docker/本地），`scale media` 经 HTTP 调用；不 vendor（LGPL-3.0，复制代码有传染义务，HTTP 调用自部署服务干净） | 非官方 Suno.ai 封装：generate/custom_generate（自定义歌词+风格）/extend_audio/stems/歌词时间戳/配额查询，还有 OpenAI 兼容格式；恰好补上「歌曲级配乐」工位——huashu-motion 的 ABC 记谱是纯器乐代码路径，suno 负责带人声的成曲 |
| 可视化操作页面 | **双端都要**：Dashboard「Media Studio」页（主）+ DSH 插件形态（复用 dsh-scale 桥） | 同一引擎两个壳，不重复造 UI 逻辑 |

**自研边界**（学什么、不抄什么）：借鉴 dsh-imagegen-video 的「模型生成 + 代码生成」双路径、分镜→ffmpeg 拼接、无限画布 UX、模板 gallery；借鉴 dsh-agnes-multimodal 的 generate_image/generate_video 工具形状与供应商配置模式。**只取设计与协议思路，不复制代码**（其一是 Apache-2.0 fork，复制会引入 NOTICE 义务；概念自研则完全规避），两个仓库与 suno-api 仍按外部参考登记进 EXTERNAL_REFERENCES。suno-api 是**外部自部署服务型 provider**，与 Seedance 等直连 API provider 并列进 provider 抽象层，cookie/账号全部留在用户侧。

---

## 1. 证据边界

| 类别 | 来源 | 可靠度 |
| --- | --- | --- |
| A. 本机实装 | wewrite CLI v4.2.1 + 10 skills；dsh-scale 包与其 README（五桥 + client 卡片） | 权威 |
| B. 上游 README | huashu 两件套、dsh-imagegen-video、dsh-agnes-multimodal（2026-10-25 抓取） | 能力面强，本机行为未验 |
| C. 本仓库契约 | `src/dashboard`（REST API 模式 `AgentControlPlane`，`/api/agent-control/*`）、`src/cli` 命令注册模式、`packages/dsh-scale`、`.scale/skills.json` 域路由 + 全局 roots 机制 | 权威 |
| 未实测 | huashu 两件套在 win32 的渲染链路（上游仅 macOS 实测）；ffmpeg 在本仓 WORKSPACE 的编排 | P1/P2 前置 spike |

---

## 2. 架构：一个引擎、两个壳、三层兼容

```
┌─ 界面壳（两个，共用同一引擎）────────────────────────────────────┐
│ ① SCALE Dashboard「Media Studio」页（自研主界面）                 │
│    views/media-studio.html + /api/media/* 路由（照 AgentControlPlane 模式）│
│    素材 gallery / 分镜板 / 任务队列 / 供应商配置 / evidence 链接   │
│ ② DSH 插件形态（复用 packages/dsh-scale 既有桥）                  │
│    tools.register：generate_image / generate_video（后端=media 引擎）│
│    client toolview 卡片：mcp__scale__media_* 结果展示（既有模式）  │
│    commands.register：/scale-media-* 斜杠命令（既有 allowlist 模式）│
└──────────────────────┬──────────────────────────────────────────┘
                       │ 三条驱动通道（多 agent 兼容的关键）
┌─ 引擎层（自研 scale media 子系统）───────────────────────────────┐
│ CLI：scale media providers|generate-image|render|storyboard|stitch│
│ MCP：ScaleMCPServer 增 media_* 工具（DSH 端自动得 toolview）      │
│ API：/api/media/*（Dashboard 用）                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌─ 能力层 ─────────────────────────────────────────────────────────┐
│ 代码生成渲染路径（零 API 费）：agent 写 JS 绘制程序 → node:vm 沙箱 │
│   （超时/禁网/仅输出目录可写）→ 帧序列 → ffmpeg → mp4/webm/gif     │
│ 模型生成路径（按量计费）：provider 抽象（OpenAI-compatible 先行，  │
│   Seedance/Seedream/wan/Agnes 按需接入）→ key 用户级配置 →        │
│   用量记账进 evidence；音乐 provider：自部署 suno-api（HTTP）      │
│ 分镜与拼接：storyboard manifest（JSON：scenes/shots/transitions/  │
│   素材或程序引用）→ 逐镜渲染 → ffmpeg 拼接/转场                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌─ 素材与内容层 ───────────────────────────────────────────────────┐
│ 内容任务目录（wewrite 已有独立任务目录约定）＝ 唯一产物锚点：      │
│   assets/（图片/视频片段/工程文件）+ storyboard.json + evidence   │
│ 引入 skills：huashu-motion/art-motion 的产物也落同一目录约定，     │
│ 反向可引用 assets/ 里模型生成的素材                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 自研 `scale media` 子系统设计

### 3.1 模块落位

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| 渲染沙箱 | `src/media/sandbox.ts` | node:vm 执行 agent 生成的绘制程序：无网络、无 fs（除输出目录）、CPU/时钟上限 |
| 帧渲染与导出 | `src/media/render.ts` | Chromium/Playwright 截帧（复用仓库既有 browser 依赖面）或 node-canvas；ffmpeg 子进程导出 |
| 分镜模型 | `src/media/storyboard.ts` | storyboard.json 读写/校验/逐镜调度/拼接 |
| Provider 抽象 | `src/media/providers/*.ts` | 统一 `generateImage/generateVideo` 接口；配置驱动、按 provider 限速、用量落 evidence |
| CLI | `src/cli/mediaCommands.ts` | `scale media …`（照 evolveDoctorCommands 的注册模式） |
| MCP | ScaleMCPServer 增 `media_*` 工具 | DSH/其他宿主经 MCP 调用（T0 桥已验证） |
| Dashboard API | `src/dashboard/MediaControlPlane.ts` | `/api/media/*`：任务队列、素材索引、storyboard CRUD、（写操作经 Shield 同款确认语义） |

### 3.2 代码生成路径（v1 核心，零模型成本）

借鉴 dsh-imagegen-video「聊天模型写绘制程序 → 本地沙箱渲染」，两点加固：
1. **沙箱收权**：node:vm + 显式超时 + 禁 require/网络 + 仅输出目录写权（上游用裸 node:vm，我们按本仓库 security 域标准加边界）。
2. **可复现**：程序与 storyboard.json 都入内容任务目录，渲染命令记录参数指纹（seed/时长/分辨率），产物可重放——这是 evidence 门禁的输入。

### 3.3 模型生成路径（P3 接入）

- Provider 接口先行（P1 定义、mock 实现），P3 起按需接真供应商：OpenAI-compatible 通用适配器最先（覆盖面最大），Seedance/Seedream、wan、Agnes 池按需。
- **音乐 provider（suno-api，与图像 provider 并列的首批接入项）**：
  - 接入面：用户自部署 suno-api（Vercel/Docker/本地皆可），SCALE 侧只做 HTTP client——`generate`（prompt→歌）、`custom_generate`（自定义歌词+风格，接 wewrite 的词）、`get`（轮询成曲）、`get_limit`（配额）、`get_aligned_lyrics`（**逐字时间戳**，直接喂视频字幕/口播对齐）。
  - 配置与安全：服务地址进用户级配置（`~/.scale/`），SUNO_COOKIE 只存在于用户自部署的服务里，**绝不进 SCALE 配置或仓库**；不做账号池、不做 cookie 自动抓取（上游有"自动保持账号活跃"的灰色能力，明确不用）。
  - 产物：成曲 mp3/视频下载到内容任务目录 `assets/audio/`，storyboard 的镜头/转场可直接引用；提示词、模型版本、配额用量落 evidence。
  - 双配乐路径并存：huashu-motion ABC 记谱（纯器乐、零成本、可控）兜底；suno 负责成曲/人声/主题曲（按账号配额）。接口按「配乐需求 = 器乐 or 成曲」自动路由。
- key 全部走用户级配置（`~/.scale/` 或环境变量），**绝不进仓库**；每个 provider 在 `.scale/tools.json` 有对应条目（confirm 级），用量与成本落 evidence（借鉴 agnes 的记账与 RPM 处理思路）。

### 3.4 与引入 skills 的协同

- huashu-motion/art-motion 负责整片创作与艺术片段（它们的编辑器/门禁自带上游 QA）；scale media 负责**素材供给**（模型生图/生视频）与**工程化拼接**（分镜、转场、格式导出）。
- 统一产物锚点：所有工具读写同一内容任务目录（`assets/` + `storyboard.json`），Dashboard 索引该目录即得全链路视图，无需数据库。

---

## 4. 多 agent 兼容层

| 通道 | 机制 | 覆盖的 agent |
| --- | --- | --- |
| Skills | `.scale/skills/media-*` skill 家族（主路由 + 图像/视频分册）→ 既有 globalRoots 同步与 skills audit；dsh-scale Skills 桥（已实现 `skills.registerProvider`）自动进 DSH | Claude Code、Codex、ZCode、Gemini CLI、DSH |
| CLI | `scale media …` 任何能跑 shell 的 agent 都能驱动；Shield 工具名映射（R3）已端到端验证 | 全部 |
| MCP | `media_*` 工具进 ScaleMCPServer → DSH 自动获得 `mcp__scale__media_*` 与既有 toolview 卡片 | DSH 及其他 MCP 宿主 |
| API | `/api/media/*` → Dashboard 与自动化脚本 | 人 + 机器 |

治理面同步：`skills.json` 新增 `motionVideo` 领域（关键词：宣传片/动画/分镜/配乐/口播/短视频…；recommendedSkills：`scale-media`、`huashu-motion`、`huashu-art-motion`）；`tools.json` 注册 `scale-media`、`huashu-motion`、`huashu-art-motion` 及各模型 provider（confirm 级）；`SkillPolicy.ts`/`ToolPolicy.ts` 默认副本同步；AGENTS.md Brain operations 加触发词行。

---

## 5. 双端可视化设计

### 5.1 Dashboard「Media Studio」（主界面，自研）

- **v1（够用即停）**：素材 gallery（扫描内容任务目录 `assets/` + 缩略图，图片/视频/音频三类条目）、storyboard 分镜板（读改 `storyboard.json`，拖拽排序）、生成任务队列（提交→轮询状态→产物入库，含音乐生成的异步轮询）、单镜预览与 evidence 链接。
- **v2（按需）**：无限画布编辑（借鉴 dsh-imagegen 画布 UX：节点连线、时间线转场）；供应商配置页（借鉴 agnes 设置 UI，只暴露已启用 provider）。
- 边界：Dashboard 保持「只读聚合 + 显式写操作」定位；渲染/生成写盘动作与 CLI 同一确认语义。

### 5.2 DSH 插件形态（复用 dsh-scale，不新起炉灶）

| DSH 扩展点 | 已有基础（dsh-scale README） | 媒体增量 |
| --- | --- | --- |
| `tools.register` | Shield/Evidence 桥已挂 | 注册 `generate_image`/`generate_video`（形状借鉴 agnes），后端拉起 `scale media` CLI（allowlist 固定参数模式照 Commands 桥） |
| `client` toolview | 25 个 `mcp__scale__*` 卡片模式 | 新增 media 工具的结果卡片（图/视频预览 + 参数 + evidence 链接），轻量 React `createElement` 模式不变 |
| `commands.register` | 6 个 `/scale-*` 斜杠命令 | 加 `/scale-media-gallery`、`/scale-media-render` 等 |
| 画布级面板 | 无 | **不做**：创作画布留在 Dashboard；DSH 端保持对话 + 卡片的轻形态（若后续画布需求强烈，独立评估 `packages/dsh-media`） |

这样「dsh 的插件版」成立：DSH 用户在会话内 `@media 生成一张封面 → 卡片预览 → /scale-media-render 出片`，治理（Shield 拦截、evidence 落盘）与 Dashboard 端完全同源。

---

## 6. 门禁与证据

| 产物 | 质检 | 证据 |
| --- | --- | --- |
| 代码渲染片段/整片 | 沙箱执行报告 + 渲染参数指纹（可重放） | `.scale/evidence` + 任务目录 |
| 模型生成图/视频 | provider 用量记录 + 尺寸/时长校验 | evidence（模型、提示词、用量） |
| 音乐成曲（suno） | 配额余量校验（get_limit）+ 时长/格式校验 + 歌词时间戳完整性 | evidence（服务地址、clip id、配额用量）+ `assets/audio/` 产物 |
| 封面/海报/关键帧 | 宿主 visual-judge（其职责含 poster/chart） | 渲染 PNG + 判定 JSON |
| 图文 | wewrite-review + gate-quality | wewrite 任务目录 |
| 发布动作 | confirm 级人工确认（publish-explicit-opt-in） | 发布前 diff + 任务目录记录 |

媒体产物自动落入既有 `resourceGovernance` 资产扫描（`**/*.mp4` 等已登记），生命周期沿用 asset-doctor，不新增策略。

---

## 7. 分阶段落地

| 阶段 | 内容 | 验收 | 规模 |
| --- | --- | --- | --- |
| **P0 登记 + 装机** | EXTERNAL_REFERENCES 等治理四件套登记（含两个学习参考仓库）；skills.json/tools.json + 代码副本 + AGENTS.md；`npx skills add` 装 huashu 两件套 | `scale doctor skills` 全解析；test:quick 绿 | S/M |
| **P1 引擎核心（纯代码渲染路径）** | `src/media/`（sandbox/render/storyboard）+ `scale media` CLI + mock provider + skills 家族 + evidence 接线；**win32 ffmpeg/Chromium 渲染 spike 前置** | agent 全程无模型 API 产出 15s 代码动画样片，参数指纹可重放 | L |
| **P2 Dashboard Media Studio v1** | `/api/media/*` + gallery/分镜板/任务队列 | 页面上完成「提交渲染→队列→产物入库→evidence 可见」 | L |
| **P3 模型 provider 接入** | OpenAI-compatible 适配器先行（图像），**音乐 provider（suno-api）并列接入**，Seedance/wan/Agnes 按需；tools.json confirm 级 + 用量 evidence | 真实文生图入库并进 gallery；一首 custom_generate 成曲（wewrite 词）落 `assets/audio/` 且带歌词时间戳；用量在 evidence 可审计 | M/L |
| **P4 DSH 插件版** | dsh-scale 增量：media tools.register + toolview 卡片 + 斜杠命令 | DSH 会话内「生成→预览→渲染→证据登记」闭环 | M |

依赖关系：P0 独立可先行；P1→P2→(P3|P4) 可并行。P1 的 win32 渲染 spike 与 P0 并行排期。

---

## 8. 风险与对策

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| 自研范围蔓延（画布 UX 最易过度建设） | 高 | 分镜板/任务队列先于画布；v1「够用即停」，画布列 v2 按需 |
| win32 渲染链路（Chromium 截帧/ffmpeg/字体）未证 | 高 | P1 前置 spike，半天内出样片再排量 |
| 沙箱逃逸（执行 agent 生成的程序） | 高 | node:vm 收权 + 超时 + 禁网 + 仅输出目录写；security 域 review（该域 blockLevels 含 L） |
| 模型供应商 churn / 成本失控 | 中 | provider 接口隔离；用量 evidence + confirm 级；代码路径始终是零成本兜底 |
| suno-api 非官方且脆弱：cookie 过期、Suno 内部 API 变动、账号风控/ToS 灰色 | 中高 | 服务自部署且 provider 隔离（接口不变换实现）；不做账号池与 cookie 自动抓取；器乐路径（huashu ABC）兜底；登记 license 与用途边界 |
| DSH rc 接口漂移（R7）、Electron 原生模块（R1） | 中 | 沿用接入方案结论：media 引擎是纯 Node 子进程/stdio，不触原生 addon |
| 与 huashu skills 的目录约定漂移 | 中 | 产物锚点（内容任务目录）写进 skill 家族文档并在 doctor 里校验 |

## 9. 待确认

1. P1 渲染底座选型：Playwright 截帧（复用仓库既有 browser 依赖、样式自由度高）vs node-canvas（更轻、无浏览器依赖）——建议 spike 后定，倾向 Playwright。
2. 模型供应商首批接哪家（决定 P3 范围与 key 管理）。
3. Media Studio 是否需要多内容项目总览（当前按单仓库任务目录设计）。
