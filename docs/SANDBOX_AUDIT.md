# 沙箱与审计（Sandbox & Audit）

Status: P4-C（审计底座已具备；Shadow Replay Docker adapter 与 ledger 已进入分层实现，尚未完成真实环境资格验证）

## 已有能力

1. **全量运行时证据**：每个受治理动作经 `RuntimeEvidenceLedger` 落 `.scale/evidence/runtime/*.json`
   （kind: command/gate/tool/review/…，含 taskId/sessionId/command/exitCode/status/metadata，自动脱敏）。
2. **事件流**：EventBus 落 `.scale/events/*.jsonl`，含 `tool.blocked` / `verification.recorded` 等。
3. **secrets 预阻断**：Shield pre-tool 的 SecretLeakDetector 在 Edit/Write 前拦截硬编码密钥
   （高置信规则 block，泛化 40+ 规则 warn，`SCALE_SECRET_LEAK_MODE` 可调）。
4. **危险命令预阻断**：DangerousCommandDetector（rm -rf / DROP TABLE / curl|bash 等）。
5. **DSH 插件审计**：dsh-scale 的 Evidence 桥把工具调用落 `.scale/evidence/runtime/`（异步）。
6. **Shadow Replay contract**：已具备人工接受候选校验、固定输入摘要、适配器隔离能力门禁和有界脱敏结果模型。
7. **Docker adapter（代码层）**：新增 digest-pinned Docker CLI adapter，校验输入文件摘要，仅只读挂载两个输入文件，关闭网络、只读根文件系统、非 root、drop capabilities、资源限制、超时清理。Runner Protocol v1 已定义为严格 data-only JSON 规则模拟，明确拒绝 shell/command/script 执行；Runner 镜像仍未交付，也尚未完成真实 Docker daemon 集成安全验证。
8. **Shadow Replay Ledger（代码层）**：SQLite WAL 持久化计划、结果和来源摘要；唯一 run ID，数据库触发器阻止 UPDATE/DELETE。它不是防管理员篡改的外部可信存证。

## 审计查询

- `scale dashboard capabilities` — 七类数据源就绪状态（含 runtime-evidence / review-evidence）。
- `scale runtime ...` / `scale workflow evidence` — 查询现有证据与门禁记录。
- `scale shadow-replay list` / `show <run-id>` 提供只读 Ledger 查询；不会创建 Ledger、写入记录或触发 Replay。
- 面板 Monitoring / Tokens & Cost 页面读取现有证据流与 token 账单。

## 后续增强与资格验证

1. **每动作全量审计（含 allow 动作）**：当前默认证据偏 failure/gate 驱动；可提高 `evidenceMode: 'all'`
   覆盖率，但需先压测写盘量（dsh-scale plan U8）。
2. **审计保留策略**：现有 `.scale/evidence/` 保留策略需统一；Replay Ledger 仍需签名清单、离机备份和 artifact retention。
3. **Runner image 与真实沙箱验证**：构建最小化、扫描、签名并固定 digest 的 runner image；在真实 Linux Docker daemon 上验证网络不可达、凭据不可见、只读挂载、资源限制和超时后无残留容器。Docker 容器不等同硬件 VM。
4. **产品接线**：接入 replay lifecycle CLI、ledger 查询与 artifact hash manifest；禁止 replay 结果自动修改生产 Hook/策略。
5. **clean-project qualification**：三个独立 clean projects、完整产物审查、中英文 parity 和 claim-to-evidence reconciliation。
6. **审计报表**：按 task/agent/role 聚合命令、门禁、Replay 与证据时间线导出。

## 结论

SCALE 已有运行时证据、事件流、secrets/危险命令预阻断；Shadow Replay 正在形成 contract、Docker adapter 与 append-only ledger 的代码基础。**目前还不能宣称具备生产可用的隔离 Replay 能力**：runner image、真实 Docker daemon 安全验证、CLI 接线、artifact capture 与三个 clean-project qualification 仍未完成。
