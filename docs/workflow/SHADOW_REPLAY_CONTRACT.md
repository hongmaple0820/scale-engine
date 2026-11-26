# Shadow Replay Docker Adapter / Docker 沙箱适配器

Status: first Docker CLI adapter implementation; real-daemon integration qualification is still required.

The adapter requires a locally present immutable `repository@sha256:<digest>` image. The image must provide `/usr/local/bin/scale-shadow-replay` and `/inputs`, accepting `--scenario /inputs/scenario.snapshot` and `--candidate /inputs/candidate.bundle`.

Before Docker is invoked, both input files are checked against the approved plan digests. Symlinks, non-regular files and files over 10 MiB are rejected. Verified bytes are copied to a private temporary directory; only these two copies are mounted read-only. No shell, replayCommand, project tree, home directory, Docker socket, host environment, SSH agent or cloud credentials are passed into the container.

Container controls: exact local image digest and `--pull=never`; `--network=none`; read-only root; dropped Linux capabilities; no-new-privileges; non-root UID/GID 65532; PID, memory, swap, one-core CPU quota, file descriptor and process limits; small noexec/nosuid/nodev tmpfs; force-remove on completion/timeout. Execution deadline is the stricter of wall-clock and CPU-time budgets. stdout/stderr are bounded to 256 KiB and redacted by the contract.

This is a Docker container adapter, not a VM. It relies on a trusted Docker daemon and host kernel; container isolation is not a hardware VM boundary. Docker Desktop, Windows and rootless daemon behavior need explicit qualification. The runner image must be built, reviewed, scanned and pinned separately; this change does not create or attest that image. Fake-CLI tests validate argument construction, digest gating and cleanup only; they do not prove OS isolation.

Next: build and pin the runner image; integration-test against a disposable Linux Docker daemon for network egress, credential absence, read-only mounts, resource limits and cleanup; add immutable Replay Ledger and artifact capture; then run three clean-project qualifications.

## 中文边界

本适配器使用 SHA256 固定的本地 Docker 镜像。输入文件必须匹配审核计划摘要，拒绝符号链接、非普通文件及超 10 MiB 输入。容器仅只读挂载验证后的两个输入副本；关闭网络、只读根文件系统、删除 capabilities、启用 no-new-privileges、非 root 用户并限制资源。超时后 kill 并删除容器。

这不是 VM，也不等同硬件隔离；依赖可信 Docker daemon 与宿主内核。当前 fake CLI 测试不能证明真实系统隔离。Runner 镜像、真实 Docker 集成安全测试、持久化 Replay Ledger、产物校验及三个 clean-project qualification 仍未完成。
