---
name: scale-media
description: |
  SCALE 自研媒体引擎入口：分镜渲染（Scene DSL v0.1）、模型生图（generate_image）、
  任务管理（幂等/取消/恢复/证据）与 Dashboard 媒体工作台的使用路由。
  触发关键词：渲染分镜、出片、生图、媒体任务、media studio、scale media。
  非媒体场景（普通前端 UI、纯文本内容）不触发。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# SCALE Media — 自研媒体引擎入口

## 运行原则

- 一切写操作走 `scale media` CLI 或 `/api/media/*`（同一 JobService 业务层），不要绕过直接操作任务目录。
- Scene DSL 是纯声明式的：不写代码、不嵌 URL；格式与限额见 `docs/media/storyboard-format.md`。
- 模型生图需要供应商配置：`MEDIA_OPENAI_API_KEY`（用户级环境变量，绝不入库）；本机无配置时用 `mock` provider 做链路验证。
- 任务失败先看 `scale media task evidence <id>`，再决定重试或改输入；`failed_validation` 不自动重试。

## 能力路由

| 意图 | 路径 |
|---|---|
| 校验分镜 | `scale media validate <storyboard.json>` |
| 渲染出片 | `scale media render <storyboard.json> [--project p] [--idempotency-key k]` |
| 模型生图 | `scale media image generate --prompt "…" --size 1024x1024 --provider openai-compatible` |
| 查任务 | `scale media task list / show / evidence <id>` |
| 取消/重试 | `scale media task cancel|retry <id>`；崩溃残留先 `scale media task recover` |
| 体检 | `scale media doctor`；供应商状态 `scale media providers list` |
| 可视化 | Dashboard「Media Studio」页（gallery/队列/详情/evidence），API 见 `/api/media/*` |
| MCP | `media_validate_storyboard` / `media_render_storyboard` / `media_generate_image` / `media_get_task` 等 |

## 与外部 skills 的分工

- 创造性整片动画/配乐 → 全局 skill `huashu-motion` / `huashu-art-motion`（motionVideo 领域）。
- 本引擎负责：素材供给（生图）、工程化渲染（分镜→帧→ffmpeg）、任务治理（状态/证据/限额）。
- 产物锚点：`<root>/media/projects/<project>/tasks/<task>/`（assets/、output/、evidence/）。

## 安全边界

- 发布类动作永远是显式 opt-in；provider 请求走 HTTPS（loopback 需 `MEDIA_PROVIDER_ALLOW_LOCAL=1`）。
- 实验性音乐 provider（suno-api）默认禁用：启用前先阅读 v3 方案 §8.6 的条款边界。
