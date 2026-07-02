# 客户冒烟测试

目标：用户在自己的项目里安装 SCALE 后，只需要两条命令确认“能打开、能通信、能给出问题报告”。

## 最短路径

```bash
cd your-project
npx -y @hongmaple0820/scale-engine@latest install --dir .
npx -y @hongmaple0820/scale-engine@latest open --dir .
npx -y @hongmaple0820/scale-engine@latest smoke --dir .
```

已经全局安装时：

```bash
cd your-project
scale install --dir .
scale open --dir .
scale smoke --dir .
```

## 通过标准

`scale smoke --dir .` 会检查：

| 检查项 | 通过含义 |
| --- | --- |
| Project directory | 当前目录可访问。 |
| SCALE install | `.scale/` 下存在核心配置和治理文件。 |
| Dashboard health | 常驻面板已启动，`/api/health` 可访问。 |
| Agent Control message loop | 消息发送、认领、完成、回复和摘要生成都能跑通。 |

命令会写入报告：

```text
.scale/artifacts/smoke/smoke-<timestamp>.json
```

用户反馈问题时，优先让用户提供这份报告和终端输出。

## 常见结果

| 结果 | 含义 | 下一步 |
| --- | --- | --- |
| `passed` | 安装、面板和消息闭环通过。 | 开始在 Agent Control 里配置真实 agent 会话。 |
| `failed` | 至少一个核心检查失败。 | 按 smoke 输出的 `Next` 命令执行，通常先重跑 `scale install --dir .`。 |
| `dashboard-health` 失败 | 面板没有启动或端口不可访问。 | 运行 `scale dashboard daemon logs --dir . --lines 120`。 |
| `agent-control-loop` 失败 | 本地消息队列/API 异常。 | 查看 `.scale/agents/` 和 smoke 报告中的 message id。 |

## 高级排障

普通用户优先使用 `scale open` 和 `scale smoke`。只有排障、CI 拆分或维护治理规则时，再使用底层命令：

```bash
scale doctor --dir .
scale status --dir .
scale preflight --preflight-profile quick --dir .
scale dashboard daemon status --dir . --json
```
