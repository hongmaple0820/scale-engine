# npx 与交互式安装指南

目标：让第一次试用 SCALE 的用户不需要全局安装，也能用一个标准化向导完成项目接入。

## 为什么先用 npx

| 场景 | 价值 |
| --- | --- |
| 第一次试用 | 不污染全局 CLI 环境。 |
| 教程复现 | 团队复制同一条命令即可进入同一版本。 |
| 多项目隔离 | 每个项目可以固定不同版本。 |
| 国内网络 fallback | 可以加 `--registry=https://registry.npmmirror.com`。 |

## 推荐命令

```bash
cd your-project
npx -y @hongmaple0820/scale-engine@latest install --dir .
```

安装器会显示：

- 作者、来源和安装器品牌头。
- 安装语言选择，并写入 `.scale/config.yaml` 与 `.scale/agent-language.md`。
- 项目检测结果。
- 标准化编号/ID 选择。
- 安装阶段进度条和百分比。
- 第三方能力计划和确认。
- 失败原因、阻塞项、修复建议。
- 安装后的下一步命令和用途说明。

## 固定版本

```bash
npx -y @hongmaple0820/scale-engine@0.55.0 install --dir .
```

团队教程、CI 和客户交付建议固定版本，避免 `@latest` 行为漂移。

## 国内镜像

```bash
npx -y --registry=https://registry.npmmirror.com @hongmaple0820/scale-engine@latest install --dir .
```

如果仍然不稳定，改用全局安装：

```bash
npm install -g @hongmaple0820/scale-engine --registry=https://registry.npmmirror.com
scale install --dir .
```

## 交互与非交互

人工首次安装：

```bash
npx -y @hongmaple0820/scale-engine@latest install --dir .
```

CI 或脚本安装：

```bash
npx -y @hongmaple0820/scale-engine@latest install \
  --agent recommended \
  --profile standard \
  --governance-pack frontend-app \
  --pack core \
  --lang zh \
  --dir . \
  --json
```

Agent 平台参数支持：

| 参数 | 含义 |
| --- | --- |
| `--agent recommended` | 一次写入 Codex、Claude Code、Cursor、Qoder、Cline、Windsurf 这些常用入口。 |
| `--agent all` | 一次写入当前版本支持的全部 Agent 适配器。 |
| `--agent codex,claude-code` | 只写入指定多个 Agent。 |
| `--agent codex` | 只写入一个 Agent。 |

安装并执行推荐第三方能力：

```bash
scale install \
  --agent codex \
  --profile advanced \
  --pack recommended \
  --apply \
  --yes \
  --dir .
```

## 和底层命令的关系

`scale install` 是客户主入口，内部融合：

- `scale init`
- `scale setup`
- `scale setup --verify`
- 安装摘要和异常反馈

底层命令仍然保留给高级维护者：

```bash
scale init --agent codex --governance-pack standard --dir .
scale setup --pack full --dir .
scale setup --pack full --apply --yes --dir .
scale setup --verify --pack full --dir .
```

普通用户优先使用 `scale install`，只有在排查、CI 拆分或需要精细控制时才使用底层命令。

## 下一步命令是什么意思

安装结束通常会看到：

```bash
scale open --dir .
scale smoke --dir .
scale define "<feature>" --dir .
```

它们的含义是：

| 命令 | 用途 |
| --- | --- |
| `scale open --dir .` | 启动常驻面板并打开 Agent Control，可视化配置 agent、模型和消息通道。 |
| `scale smoke --dir .` | 一键验收安装、面板健康和 Agent Control 消息闭环，并生成本地报告。 |
| `scale define "<feature>" --dir .` | 开始一个需求，把自然语言功能描述转成可执行规格；把 `<feature>` 换成真实需求。 |
