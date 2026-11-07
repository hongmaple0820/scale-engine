# SCALE × spec-kit 接入（参考 preset）

本目录是 SCALE 与 [github/spec-kit](https://github.com/github/spec-kit) 的**参考接入声明**。

## 定位

spec-kit 是流程平台（SDD + extensions/presets/workflows），SCALE 补的是它生态里的**验证深度层**：

- spec-kit 管「写什么、落哪些文档」（spec.md / plan.md / tasks.md）；
- SCALE 管「做完是否真的可验证」——effort-tuned verification + clean-context 独立审查。

二者互补，不替换：spec-kit 的 `/speckit.analyze` 是只读跨产物一致性检查（同一 agent 上下文），
SCALE 提供的是**独立上下文 + 可审计隔离证明 + 可配置门禁**（`FEF` 生态留白 #4916 方向）。

## 接入方式（两条）

1. **preset / extension**（推荐）：把 `preset.yaml` 按 spec-kit 当前 preset schema 适配后提交其社区
   catalog。步骤：`scale verify-task --effort`（实现后）+ `scale review --isolated --fresh-gate block`
   （收敛前）。
2. **workflow step**：spec-kit 的 workflow step 类型可调用 shell，直接 `scale verify-task --effort`。

## 诚实边界

- spec-kit 破坏性变更高频（1.3.0 曾移除核心 `taskstoissues`）——本 preset 需锁定测试的 spec-kit
  最低版本，独立版本号。
- 本仓库**不伪造 spec-kit 的 preset schema**：`preset.yaml` 是语义声明，提交前须对照其当前 schema。
- 真正进入 spec-kit 社区目录需要向其仓库提交 PR（外部账号操作，非本仓库可完成）。

## 相关

- 能力说明：`docs/EFFORT_TUNED_VERIFICATION.md`
- 交付渠道总览：本方案 P3 阶段
