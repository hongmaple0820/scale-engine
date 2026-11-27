# Shadow Replay Artifact Manifest / 重放产物清单

Version 1 exports a bounded, redacted ledger record together with its approved scenario/candidate SHA-256 digests and the digest-pinned Runner image reference. It computes a canonical JSON SHA-256 digest for the record and another for the manifest. Object keys are sorted by locale-independent code-unit order; array order is preserved.

`writeShadowReplayArtifact` writes a same-directory temporary file with restrictive permissions, fsyncs it, and publishes the final filename through an exclusive hard link. Existing run artifacts are never overwritten. `verifyShadowReplayArtifactFile` rejects symlink/non-regular files and checks the manifest, record digest, identity, filename, and input provenance.

Important trust boundary: these SHA-256 digests detect content changes when the expected digest is trusted; they are **not a digital signature** and do not establish who created the artifact. A party able to replace both the artifact and its expected digest can forge both. Signing keys, transparency/provenance attestations, retention, and backup remain separate future work.

中文：v1 清单导出经过限长与脱敏的 Ledger 记录、输入快照摘要及固定摘要的 Runner 镜像引用。规范化 JSON 使用稳定键排序，分别计算记录摘要和清单摘要。产物采用同目录临时文件、fsync 与独占硬链接发布，禁止覆盖同一 runId 的既有文件。验证时检查文件类型、文件名、身份和摘要。**SHA-256 完整性摘要不是数字签名，也不能证明产物作者身份**；签名、透明度证明、保留策略和备份仍是后续工作。
