# Shadow Replay Docker Adapter / Docker 沙箱适配器

Status: Docker CLI adapter, data-only Runner v1, real Linux Docker-daemon integration, and an adapter-to-ledger orchestration seam are implemented on the current Draft PR stack. Full lifecycle CLI wiring, artifact export/retention, immutable published image provenance, hostile-container review, and clean-project qualification remain open.

The adapter requires a locally present immutable \`repository@sha256:<digest>\` image. The image must provide \`/usr/local/bin/scale-shadow-replay\` and \`/inputs\`, accepting \`--scenario /inputs/scenario.snapshot\` and \`--candidate /inputs/candidate.bundle\`. Those files must implement the strict data-only [Runner Protocol v1](SHADOW_REPLAY_RUNNER_PROTOCOL.md); unknown fields and arbitrary command/script payloads are rejected. Protocol v1 is a deterministic literal-match policy simulation, not an execution of the original failure's \`replayCommand\` or arbitrary application code.

The first runner implementation lives in \`sandbox/shadow-replay-runner/\`. Its Dockerfile creates a non-root UID/GID 65532 image with a fixed entrypoint. A dedicated GitHub Actions workflow runs the Python unit suite, builds the image and checks the configured user and entrypoint. The Dockerfile currently references the mutable \`python:3.13-alpine\` base tag; a successful CI build does not provide an immutable published image digest or supply-chain attestation. Production use still requires an immutable image reference accepted by the adapter.

Before Docker is invoked, both input files are checked against the approved plan digests. Symlinks, non-regular files and files over 10 MiB are rejected. Verified bytes are copied to a private temporary directory; only these two copies are mounted read-only. No shell, replayCommand, project tree, home directory, Docker socket, host environment, SSH agent or cloud credentials are passed into the container.

Container controls: exact local image digest and \`--pull=never\`; \`--network=none\`; read-only root; dropped Linux capabilities; no-new-privileges; non-root UID/GID 65532; PID, memory, swap, one-core CPU quota, file descriptor and process limits; small noexec/nosuid/nodev tmpfs; force-remove on completion/timeout. Execution deadline is the stricter of wall-clock and CPU-time budgets. stdout/stderr are bounded to 256 KiB and redacted by the contract.

This is a Docker container adapter, not a VM. It relies on a trusted Docker daemon and host kernel; container isolation is not a hardware VM boundary. Docker Desktop, Windows and rootless daemon behavior need explicit qualification. Fake-CLI tests validate argument construction, digest gating and cleanup only; they do not prove OS isolation. Runner unit tests and image build verify the protocol implementation and image defaults, not runtime isolation.

Real-daemon integration has now passed in GitHub Actions on Linux: the workflow builds and pushes the runner to an ephemeral local registry, resolves an immutable RepoDigest, executes the actual adapter, inspects effective container settings (non-root, network=none, read-only root, dropped capabilities, no-new-privileges, resource limits, read-only mounts), checks bounded/no-input-echo output, and verifies container cleanup. This is configuration/lifecycle evidence, not a hostile-container penetration test or VM boundary.

A new `runAndRecordShadowReplay` orchestration seam composes the reviewed plan, adapter execution, bounded/redacted result, provenance validation, and SQLite ledger persistence. The host independently validates the exact input file digests, creates private copies for the adapter, evaluates the data-only protocol, and requires Runner stdout/exit status to match that host evaluation before writing a record. Tests cover passed outcomes, valid Runner mismatch exit 10 persisted as `failed`, forged output rejection, ledger readback, and provenance mismatch rejection. It is not yet exposed as an end-user execute CLI and does not yet write a separate signed/exportable artifact manifest.

Next: pin the Python base image by digest; scan/sign/attest the final runner image and retain build provenance; complete adapter-to-runner-to-ledger artifact export/retention; perform hostile-input/container security review; then run three clean-project qualifications.

## 中文边界

本适配器使用 SHA256 固定的本地 Docker 镜像。输入文件必须匹配审核计划摘要，拒绝符号链接、非普通文件及超 10 MiB 输入。容器仅只读挂载验证后的两个输入副本；关闭网络、只读根文件系统、删除 capabilities、启用 no-new-privileges、非 root 用户并限制资源。超时后 kill 并删除容器。

Runner v1 源码、非 root Dockerfile、单元测试和镜像构建工作流已提交。但基础镜像仍使用可变 tag，尚无不可变镜像发布和摘要证明，也没有真实 Docker daemon 集成安全验证。当前 fake CLI 测试不能证明真实系统隔离。
