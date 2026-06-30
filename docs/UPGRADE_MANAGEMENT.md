# SCALE 升级管理

SCALE 的升级对象不只有 CLI 包本身，还包括已经生成到业务项目里的治理文件，以及工作流引用的第三方 skills、MCP、浏览器自动化、桌面自动化和外部 CLI。

## 为什么不能直接重新 init

`scale init` 适合首次落地。项目运行一段时间后，很多生成文件会被本地团队调整，例如：

- `.scale/verification.json`
- `.scale/skills.json`
- `.scale/tools.json`
- `docs/workflow/README.md`
- `docs/workflow/templates/*`
- `scripts/workflow/*`

如果直接重新初始化，可能覆盖用户已经适配过的服务矩阵、验证命令、资源治理规则和本地脚本。因此升级必须先检查、再计划、最后由人确认。

## 推荐流程

```bash
scale upgrade check --dir .
scale upgrade plan --dir . --html
scale upgrade apply --dir . --confirm
scale tools outdated --dir .
scale skill outdated --dir .
scale preflight --preflight-profile quick
```

### 1. 检查

```bash
scale upgrade check --dir . --json
```

检查内容：

- 当前项目是否有 `.scale/governance.lock.json`。
- SCALE Engine 生成时版本和当前 CLI 版本是否一致。
- governance pack 版本是否落后。
- 已生成文件是否被删除或被用户修改。
- 第三方能力是否需要人工评审或阻断自动升级。

状态含义：

| 状态 | 含义 |
| --- | --- |
| `clean` | 锁文件存在，生成文件无漂移，当前版本一致 |
| `updates-available` | 有缺失文件、CLI 版本变化或 pack 版本变化 |
| `local-changes` | 生成文件存在本地改动，不能自动覆盖 |
| `missing-lock` | 缺少治理锁文件，需要先建立治理基线 |

### 2. 生成计划

```bash
scale upgrade plan --dir . --html
```

计划会输出：

- `applyMode=safe`：没有本地改动阻塞，可以按计划处理。
- `applyMode=manual-review`：存在本地修改或缺少锁文件，需要人工确认。
- blockers：阻断自动应用的原因。
- steps：建议执行的升级步骤。

HTML 报告默认写到：

```text
.scale/reports/upgrade-plan.html
```

HTML 只作为审阅界面，源事实仍以 JSON 输出和 Git diff 为准。

### 3. 检查第三方能力

```bash
scale tools outdated --dir .
scale skill outdated --dir .
```

这两个命令不会联网安装，也不会自动更新。它们只输出：

- 能力 ID 和类型：skill、MCP、CLI、browser、desktop。
- 来源 URL。
- 信任等级：`trusted`、`community`、`high-risk`。
- 更新策略：`check-only`、`manual-review`、`blocked`。
- 安装策略：始终是 `never-auto-install`。

默认策略：

| 类型 | 默认处理 |
| --- | --- |
| 官方/可信来源 | 可检查版本和 changelog，不自动安装 |
| 社区来源 | 必须人工评审来源、安装脚本和权限 |
| MCP | 必须检查启动命令、网络权限和本地访问范围 |
| 外部 CLI | 只检测版本和来源，不自动改 PATH 或全局包 |
| 桌面自动化/CUA | 高权限，默认阻断自动升级 |

如果你确认要补齐这些第三方能力，用显式 setup，而不是指望升级流程隐式安装：

```bash
scale setup --pack full --memory-provider hrain --memory-mode local-only --json
scale setup --pack full --memory-provider hrain --memory-mode local-only --apply --yes
scale setup --verify --pack full --json
```

## 安全应用

`apply` 只处理没有 blocker 的安全变更，并且必须显式确认：

```bash
scale upgrade apply --dir . --confirm
```

当前安全应用范围：

- 恢复 `.scale/governance.lock.json` 中记录但本地缺失的生成文件。
- 刷新 `.scale/governance.lock.json` 中的 SCALE 版本和生成文件哈希。
- 在 `.scale/backups/upgrade-*/manifest.json` 写入回滚点。

当前不会自动做的事：

- 不覆盖用户改过的生成文件。
- 不自动合并本地模板改动。
- 不自动安装或升级第三方 skills、MCP、CLI、浏览器工具或桌面自动化工具。
- governance pack 版本变化仍需要人工 review。

如果需要撤回最近一次 SCALE 管理的安全应用：

```bash
scale upgrade rollback --dir .
```

rollback 只依据 `.scale/backups/upgrade-*/manifest.json` 操作，不会猜测 Git 历史，也不会回滚非 SCALE 管理的手工修改。

## 给业务项目的规则

- 不要把 `scale init` 当升级命令反复跑。
- 升级前先跑 `scale upgrade check`，确认是否有本地 drift。
- 用户改过的生成文件必须先人工 review，再决定保留、合并或替换。
- 第三方 skills/MCP/CLI 更新必须看来源、权限、安装脚本和 changelog。
- 升级后必须跑 `scale preflight`，不能只看升级命令返回成功。
