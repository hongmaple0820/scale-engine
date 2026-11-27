# Shadow Replay Runner Protocol v1

Status: implemented as a data-only Python runner and container build source; immutable published image digest and real-daemon qualification remain pending.

## Purpose

The runner evaluates a reviewed candidate policy against a bounded scenario snapshot. It is a deterministic policy simulation only. It does **not** execute the original failure's \`replayCommand\`, candidate code, shell, JavaScript, regular expressions, plugins, network calls, or arbitrary tools.

## Inputs

The process entrypoint accepts exactly these CLI options:

- \`--scenario /inputs/scenario.snapshot\`
- \`--candidate /inputs/candidate.bundle\`

Both files are UTF-8 JSON. Each document is limited to 1 MiB. Duplicate JSON object keys are rejected. Unknown and missing fields are rejected at every schema level.

Scenario object (exact keys):

- \`protocolVersion: 1\`
- \`kind: "scale-shadow-replay-scenario"\`
- \`scenarioId: string\` (1-128 characters)
- \`sourceCommitSha: string\` (40-64 hexadecimal characters)
- \`events: array\` (1-500 entries)

Each event (exact keys):

- \`id: string\` (1-128 characters; unique within scenario)
- \`tool: string\` (1-64 characters; \`[A-Za-z][A-Za-z0-9._-]*\`)
- \`input: string\` (1-65,536 UTF-8 bytes)
- \`expectedDecision: "allow" | "warn" | "block"\`

Candidate object (exact keys):

- \`protocolVersion: 1\`
- \`kind: "scale-shadow-replay-candidate"\`
- \`candidateId: string\` (1-128 characters)
- \`failureId: string\` (1-128 characters)
- \`defaultDecision: "allow" | "warn" | "block"\`
- \`rules: array\` (0-500 entries)

Each rule (exact keys):

- \`id: string\` (1-128 characters; unique within candidate)
- \`priority: integer\` (-1000 through 1000; booleans are not integers)
- \`tool: string\` (1-64 characters; \`*\` or the tool-name grammar above)
- \`contains: string\` (1-4096 characters; literal substring only)
- \`decision: "allow" | "warn" | "block"\`

The host contract separately binds scenario commit, candidate ID and failure ID to the approved Replay plan before execution. The runner itself is deliberately filesystem-only and receives no plan, credentials, repository tree or network access.

## Evaluation

Rules are ordered by descending priority, then ascending code-point rule ID. The first rule whose tool is exact or \`*\` and whose literal \`contains\` substring occurs in the event input determines the actual decision. Otherwise the candidate default decision applies.

The output is one JSON object containing protocol/scenario/candidate/failure IDs, pass status, event/matched/mismatch counts, and mismatch records. Mismatch records contain only event ID, expected/actual decisions and matched rule ID. Raw event input is never echoed.

Exit codes:

- \`0\`: valid evaluation, zero mismatches
- \`10\`: valid evaluation, one or more policy mismatches
- \`2\`: invalid input or unsupported protocol

Exit code 10 is an evaluated failure, not a protocol parsing error.

## Runner image

\`sandbox/shadow-replay-runner/Dockerfile\` builds a non-root image (UID/GID 65532) with a fixed entrypoint. The build workflow runs unit tests, builds the image and checks the configured user and entrypoint.

The Dockerfile currently references the mutable \`python:3.13-alpine\` base tag. CI build success is not an immutable supply-chain attestation. Before deployment, the complete image must be published or otherwise distributed under an immutable \`repository@sha256:<digest>\` reference accepted by the host adapter. Vulnerability review and digest provenance are still required.

## Security boundary and remaining qualification

The adapter supplies network isolation, read-only root and input mounts, dropped capabilities, no-new-privileges, non-root identity and resource limits. This is a container boundary and trusts the Docker daemon and host kernel; it is not a VM.

Unit tests and a successful image build do not prove isolation. Remaining gates: immutable image digest/provenance, vulnerability scan, real Linux Docker daemon tests (network egress, credentials, mount immutability, resource limits, timeout cleanup), adapter/runner end-to-end contract tests, artifact capture and three independent clean-project qualifications.

## 中文说明

Runner v1 只做确定性的策略模拟：按优先级和规则 ID 排序，对工具名及输入文本做字面子串匹配，输出决策差异。它不执行候选代码、原始 replayCommand、Shell、JavaScript、正则表达式、插件或任意命令。输入 JSON 有大小、字段、数量和类型限制；拒绝重复键和未知字段；输出不回显原始输入。

当前已提交 Runner 源码、非 root Dockerfile、单元测试和镜像构建工作流。**尚未完成不可变镜像发布/摘要证明、漏洞扫描、真实 Linux Docker daemon 隔离验证、端到端产物留存和 clean-project qualification。**
