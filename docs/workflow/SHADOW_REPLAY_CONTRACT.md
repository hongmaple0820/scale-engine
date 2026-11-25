# Shadow Replay Contract / Shadow Replay 契约

Status: contract-first foundation; no production sandbox adapter is shipped yet.

## Purpose

A reviewed Failure Learning candidate must be replayed against a pinned scenario snapshot and candidate bundle in an isolated environment before its evidence can be considered for later human review. This contract is deliberately separate from `shadow-hit`, which records externally observed evidence and does not execute a replay.

## Current implementation boundary

- `createShadowReplayPlan` accepts only a candidate with accepted status and a recorded accepted review.
- The source failure must match the candidate and must not be closed or accepted-risk.
- The plan pins the source Git commit, scenario snapshot digest, candidate bundle digest, adapter identity/version, sandbox kind, and bounded resource limits.
- `executeShadowReplay` delegates only to an explicitly injected adapter that declares: container or VM isolation, networking disabled, host credentials excluded, source mounted read-only, and output isolated.
- Output is capped at 256 KiB per stream and redacted before being returned.
- Every invocation receives a fresh run ID. Results are descriptive evidence only; they never change production hooks or policies.

**Important security qualification:** adapter capability declarations are a trust contract, not cryptographic proof of OS isolation. This repository currently ships no container/VM executor adapter, no replay CLI command, and no durable replay-run ledger. The module cannot execute `replayCommand` or arbitrary shell commands. Do not treat a mocked adapter test as evidence that a real sandbox exists.

## Required adapter acceptance criteria

A production adapter must independently demonstrate all of the following before it can be enabled:

1. Create a disposable container or VM from a pinned image digest; never execute in the active project worktree.
2. Mount the source snapshot read-only and expose a separate, bounded output directory.
3. Disable network access and do not forward host credentials, agent sockets, SSH agents, environment secrets, or cloud metadata access.
4. Enforce CPU, memory, process-count, disk, and wall-clock limits outside the child process.
5. Resolve candidate and scenario inputs by verified content digest, not mutable host paths.
6. Capture runner identity/version, image digest, input digests, exit code, timestamps, timeout reason, and output artifact hashes.
7. Persist immutable run records; retries get new IDs and never overwrite prior evidence.
8. Fail closed if the adapter crashes, exceeds limits, cannot verify its environment, or returns malformed provenance.
9. Keep replay results advisory. A separate human approval and existing promotion gates remain mandatory.

## Next implementation stages

- Stage A (this change): typed contract, eligibility checks, resource bounds, adapter capability gate, bounded/redacted output, deterministic unit tests.
- Stage B: container/VM adapter with pinned images and OS-enforced resource/network controls, plus integration tests proving escape/network/credential boundaries.
- Stage C: immutable replay ledger, artifact hashing/verification, CLI lifecycle, and operator-facing audit report.
- Stage D: three clean-project qualification runs and artifact review. No Beta Ready claim before all three runs and bilingual parity are evidenced.

## 中文说明

Failure Learning 候选必须先经过人工接受，再绑定固定的源代码提交、场景快照和候选规则包摘要，在隔离环境中重放。现有 `shadow-hit` 只负责登记外部观察证据，不会执行 Replay。

本阶段只交付契约层：接受审核校验、输入摘要绑定、容器/虚拟机适配器接口、网络关闭/宿主凭据隔离/源码只读/输出隔离能力门禁、资源上限、输出限长与脱敏。**当前尚未交付真正的容器/虚拟机执行器、Replay CLI 或持久化 Replay Ledger。** 适配器的能力声明只是可信边界约定，不是操作系统隔离的密码学证明；模拟测试也不能证明真实沙箱存在。

生产适配器必须使用固定镜像摘要、一次性容器或虚拟机、操作系统级 CPU/内存/进程/磁盘/时间限制，关闭网络且不传递任何宿主凭据；输入按内容摘要读取，输出和产物可校验、可追溯，失败时 fail closed。Replay 结果仅作为人工审核证据，不得自动修改生产 Hook 或策略。

