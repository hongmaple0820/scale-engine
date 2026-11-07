# 沙箱与审计（Sandbox & Audit）

Status: P4-C（现状确认 + 增强清单）

## 已有能力

1. **全量运行时证据**：每个受治理动作经 `RuntimeEvidenceLedger` 落 `.scale/evidence/runtime/*.json`
   （kind: command/gate/tool/review/…，含 taskId/sessionId/command/exitCode/status/metadata，自动脱敏）。
2. **事件流**：EventBus 落 `.scale/events/*.jsonl`，含 `tool.blocked` / `verification.recorded` 等。
3. **secrets 预阻断**：Shield pre-tool 的 SecretLeakDetector 在 Edit/Write 前拦截硬编码密钥
   （高置信规则 block，泛化 40+ 规则 warn，`SCALE_SECRET_LEAK_MODE` 可调）。
4. **危险命令预阻断**：DangerousCommandDetector（rm -rf / DROP TABLE / curl|bash 等）。
5. **DSH 插件审计**：dsh-scale 的 Evidence 桥把工具调用落 `.scale/evidence/runtime/`（异步）。

## 审计查询

- `scale dashboard capabilities` — 七类数据源就绪状态（含 runtime-evidence / review-evidence）。
- `scale runtime ...` / `scale workflow evidence` — 查询证据与门禁记录。
- 面板 Monitoring / Tokens & Cost 页面读取证据流与 token 账单。

## 增强清单（后续）

1. **每动作全量审计（含 allow 动作）**：当前默认证据偏 failure/gate 驱动；可提高 `evidenceMode: 'all'`
   覆盖率，但需先压测写盘量（dsh-scale plan U8）。
2. **审计保留策略**：`.scale/evidence/` 永久保留（never GC）；可加分区归档与索引。
3. **容器化验证环境**：把 `scale verify` 放进容器执行（Harbor/Terminal-Bench 方向），隔离宿主机，
   本仓库暂以本地执行 + 证据落盘替代。
4. **审计报表**：按 task/agent/role 聚合的命令/门禁/证据时间线导出。

## 结论

SCALE 的审计底座（全量运行时证据 + 事件流 + secrets/危险命令预阻断）已具备；缺口是
「allow 动作全量审计 + 容器化隔离 + 审计报表」，属增强而非从零建设。
