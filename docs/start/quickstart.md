# 3 分钟快速开始

目标：在客户项目里用一条主命令安装 SCALE 工作流，然后再按需启用记忆、知识图谱、UI skills 等第三方能力。

## 前置条件

- Node.js 20+
- npm
- Git

Python、Bun、Rust/Cargo、uv/pipx 不是启动 SCALE 的硬性要求。只有选择安装 Graphify、GBrain、RTK 等第三方能力时，安装器才会提示缺少哪些运行时以及修复命令。

## 推荐路径

首次试用不需要全局安装：

```bash
cd your-project
npx -y @hongmaple0820/scale-engine@latest install --dir .
```

长期高频使用可以先全局安装：

```bash
npm install -g @hongmaple0820/scale-engine
cd your-project
scale install --dir .
```

`scale install` 会依次完成：

1. 检测项目类型和已存在的 Agent 配置。
2. 用编号选择 Agent、治理强度、项目模板和第三方能力包。
3. 写入 `.scale/`、Agent 配置、项目规则文档、治理模板和阈值配置。
4. 输出阶段化进度条。
5. 给出安装验收结果、阻塞项、警告和下一步命令。

默认建议先选择“只安装工作流本体”。核心工作流安装完成后已经可以使用：

```bash
scale open --dir .
scale smoke --dir .
scale define "your feature" --dir .
```

## 一条命令静默安装

CI、脚本或团队模板里建议显式指定参数：

```bash
npx -y @hongmaple0820/scale-engine@latest install \
  --agent codex \
  --profile standard \
  --governance-pack frontend-app \
  --pack core \
  --dir . \
  --json
```

如果要在安装时同时规划推荐第三方能力：

```bash
scale install --agent codex --profile advanced --pack recommended --dir .
```

如果确认要执行可安装的第三方能力：

```bash
scale install --agent codex --profile advanced --pack recommended --apply --yes --dir .
```

## 能力包

| Pack | 说明 |
| --- | --- |
| `core` | 只安装 SCALE 工作流本体，不要求 Bun/Cargo/Python。首次安装推荐。 |
| `recommended` | 根据 profile 和 governance pack 选择推荐能力。 |
| `full` | 规划完整第三方能力。 |
| `ui` | 安装 UI/UX 相关 skills。 |
| `memory-knowledge` | 规划 gbrain 记忆和 Graphify/CodeGraph 知识能力。 |

也可以继续使用底层命令：

```bash
scale init --agent codex --governance-pack standard --dir .
scale setup --pack memory,knowledge --dir .
scale setup --pack memory,knowledge --apply --yes --dir .
scale setup --verify --pack memory,knowledge --dir .
```

这些命令适合高级维护、CI 拆分步骤或排查安装问题；普通客户首选 `scale install`。

## 验证闭环

安装完成后至少运行：

```bash
scale open --dir .
scale smoke --dir .
```

未运行验证，不要声称通过。`--json` 代表机器可读输出，不代表第三方能力已经实际可用；第三方能力需要 `setup --verify` 或对应 smoke 测试闭环。
