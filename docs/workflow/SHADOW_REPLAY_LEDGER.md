# Shadow Replay Ledger / 重放证据账本

The append-only SQLite ledger stores the approved replay plan, normalized replay result and provenance in one row per unique run ID. It verifies plan/result identity, adapter identity, unchanged production-policy/hook flags, input digests, and a digest-pinned runner image for Docker records. Duplicate run IDs are rejected by the primary key. SQLite triggers reject UPDATE and DELETE, and WAL plus a busy timeout support concurrent readers/writers.

Stored output is the contract's bounded, redacted stdout/stderr summary, not raw unbounded process output. The ledger does not itself prove the host filesystem or database file cannot be modified by an administrator; its immutability is an application/database guardrail, not tamper-proof external attestation. Backups, signed manifests and artifact retention remain future hardening.

中文：账本使用 SQLite WAL 持久化每次 Replay 的计划、结果和来源信息；runId 唯一，重复写入拒绝，数据库触发器阻止 UPDATE/DELETE。写入前核对 plan/result/adapter 身份、输入摘要及 Docker 镜像摘要。保存的是经过限长和脱敏的输出摘要。它能防止正常 API 路径覆盖记录，但不能抵御拥有文件系统/数据库管理权限的人直接篡改；签名清单、备份和产物保留仍需后续实现。
