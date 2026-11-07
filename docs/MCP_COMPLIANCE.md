# MCP 符合性审计（MCP 2026-07-28 规范）

Status: P3-C 审计（2026-11-07）
Scope: 评估 SCALE 的 MCP server 与 MCP `2026-07-28` 规范的符合度

## 现状

- SDK：`@modelcontextprotocol/sdk@1.32.2`（package.json 精确 pin）。
- 入口：`src/api/mcp.ts`（工具定义，40 个 `mcp__scale__*`）与 `src/api/mcpStdio.ts`（stdio transport）。
- transport：`StdioServerTransport`（本地单连接、进程内常驻）。

## stateless core 符合性（2026-07-28 的关键变更）

2026-07-28 规范移除了协议级 session 与 `Mcp-Session-Id`，改为 **stateless core + server-minted handles**；跨调用状态通过显式 handle 传递，而非隐式连接态。

审计结论（基于代码）：

| 检查点 | 现状 | 结论 |
| --- | --- | --- |
| 协议级 `Mcp-Session-Id` 使用 | 无。`sessionId` 仅作为**业务工具参数**（Agent OS 会话 id），不是协议连接态 | ✅ 符合 |
| 跨调用隐式 server 状态机 | 无。工具处理不依赖上一次调用的内存状态 | ✅ 符合 |
| list 结果可缓存 | 工具列表静态注册，天然可缓存 | ✅ 符合 |
| handle 化跨调用状态 | SCALE 用 `.scale/` 文件与 artifact store 承载持久状态（进程外），符合「状态在 server 之外」的精神 | ✅ 符合 |
| authorization 硬化 | stdio 本地进程，无远端鉴权面；HTTP 面若暴露需另行评估 | ⚠️ 仅 stdio 场景无虞 |
| 工具注解（tool annotations） | 部分工具未标注 readOnly/destructive 提示 | ⚠️ 待补 |

## 差距与升级路径

1. **SDK 版本对齐**：当前 1.32.2；每次 SDK 大版本升级时对照其 changelog 的规范版本声明，跑符合性用例。规范演进快，**必须锁版本 + 逐版核对**，不能盲升。
2. **工具注解补全**：为破坏性/只读工具补 `annotations`（readOnlyHint / destructiveHint），提升宿主端的自动审批体验。
3. **HTTP transport 审计**：若启用远端 HTTP MCP（非 stdio），需补 `Mcp-Session-Id` 移除后的 handle 化、以及 authorization 硬化。当前主用 stdio，暂不阻塞。
4. **符合性用例**：把上述检查点写成可重复的测试/清单，纳入 release:check（下一迭代）。

## 结论

- **stdio 场景下，SCALE 的 MCP server 基本符合 2026-07-28 stateless core 精神**：无协议级 session、无隐式跨调用状态、状态外置到 `.scale/`。
- 待补的两项（工具注解、HTTP transport 审计）是增强项，不阻塞当前本地/stdio 使用。
- 本审计**不做真实符合性套件运行**（需外部规范测试环境），诚实标注为「代码级审计 + 差距清单」。
