# SCALE Shadow Replay Runner v1

This image implements the strict, data-only protocol documented in
[SHADOW_REPLAY_RUNNER_PROTOCOL.md](../../docs/workflow/SHADOW_REPLAY_RUNNER_PROTOCOL.md).

## Build and test

From the repository root:

\`\`\`sh
python3 -m unittest discover -s sandbox/shadow-replay-runner -p 'test_*.py' -v
docker build -t scale-shadow-replay-runner:local sandbox/shadow-replay-runner
\`\`\`

The runner accepts only \`--scenario PATH --candidate PATH\`. It validates bounded JSON
documents and performs deterministic literal substring policy simulation. It does not
execute candidate code, shell commands, scripts, regular expressions, plugins, network
requests, or arbitrary tools.

Exit codes: \`0\` = valid evaluation with no mismatches; \`10\` = valid evaluation with
policy mismatches; \`2\` = invalid input or protocol error. A mismatch is a completed
evaluation, not a protocol failure.

## Image identity and security boundary

The Dockerfile uses a Python Alpine base tag for local development. The CI build records
image metadata, but this tag alone is **not** an immutable supply-chain identity. Before
any deployment, resolve and pin the final runner image as
\`repository@sha256:<64 lowercase hex>\`; the host adapter refuses mutable tags and
never pulls images.

The host adapter's container restrictions are defense in depth. This is a Linux container,
not a VM; it trusts the Docker daemon and host kernel. A successful unit test or image build
does not prove isolation. Real-daemon integration, image digest attestation, vulnerability
review, and clean-project qualification remain separate gates.
