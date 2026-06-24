# Release Readiness

SCALE Engine 不以“代码已写完”作为发版标准。发版前必须确认核心工作流、官方 demo、真实项目适配和发布包都已经通过验证。

## 当前发版门槛

每次准备发版前至少完成以下检查：

```bash
npm run release:check
```

`release:check` 是本地发版唯一门禁。它会依次执行学习/记忆健康检查、文档健康检查、
typecheck、lint、全量测试、安装烟测、provider 回放、build、生产依赖审计、
`git diff --check` 和 `npm pack --dry-run`。
`npm run test:serial` 只用于排查卡死或顺序相关的测试问题，不作为默认发版替代项。

## GitHub/Gitee 发行版同步

Git tag 触发 `.github/workflows/publish.yml` 后，工作流只负责 npm publish 和 GitHub Release。Gitee 的 release 元数据不走 GitHub Actions secret，由维护者在本地补齐，避免把 Gitee API token 放入 GitHub environment。

本地同步会把 GitHub 上的 release 标题、正文、tag、prerelease 状态同步到 Gitee：

```bash
npm run release:sync-gitee -- --gitee-owner hongmaple --gitee-repo scale-engine
```

本地补齐历史 release 前先 dry-run：

```bash
npm run release:sync-gitee -- --dry-run --json
```

本地补齐历史 release 或当次 release 时必须显式提供 token：

```bash
GITEE_TOKEN=<gitee-api-token> npm run release:sync-gitee -- --gitee-owner hongmaple --gitee-repo scale-engine
```

注意：

- `GITEE_TOKEN` 必须是 Gitee API 可用的私人令牌；普通 Git HTTPS 密码不一定能调用 `https://gitee.com/api/v5`。
- Gitee API token 不放入 GitHub Actions secret；本地命令只在当前 shell 进程内使用 token。
- 当前脚本同步 release 元数据。GitHub release asset 会以下载链接写入 Gitee release notes，不做二进制附件镜像上传。
- 如果 Gitee release 已存在同名 tag，脚本会跳过，不覆盖用户手工编辑过的 Gitee release。

如果本次改动影响官方 demo、治理模板或 CLI 入口，还必须额外运行：

```bash
npx vitest run tests/api/officialDemoWorkflow.test.ts
```

## 官方 Demo 验收

官方 demo 必须覆盖完整闭环：

1. 复制 `examples/demo-projects/agent-governance-demo` 到临时目录。
2. `npm install`。
3. `npm test`。
4. `scale init --governance-pack node-library`。
5. `scale preflight --preflight-profile quick`。
6. `scale context grill`、`scale diagnose plan`、`scale tdd slice`。
7. `scale runtime start/record/final-check`。
8. `scale memory pack/settle`。
9. `scale artifact render/doctor`。

这条链路用于验证用户照着文档操作时能看到实际价值，而不是只看到单个命令成功。

## 真实项目落地验收

发布前需要至少选一个真实项目执行轻量落地验证，并记录结论：

- `scale init --governance-pack <pack>` 是否生成合理文件。
- `scale preflight --preflight-profile quick` 是否可运行，失败是否可解释。
- `scale assets scan/doctor` 是否正确区分长期文档、临时产物、运行证据和生成媒体。
- `scale standards scan/doctor` 是否能发现日志、安全、ORM、框架、测试和 UI/UX 相关风险。
- `scale runtime final-check` 是否能阻断没有通过证据的交付声明。
- `scale memory settle` 是否只生成候选，不自动污染长期知识库。

真实项目存在历史债务时，不要求一次性清零，但必须证明新增/变更范围不会被历史债务掩盖。

## 不能发版的情况

出现以下任一情况，不得发版：

- 全量测试失败。
- `npm run learning:health` 失败，或 `.scale/skills/`、记忆 provider、学习证据模板、发布包清单未满足门禁。
- npm/GitHub 发布完成后，Gitee release 元数据未用本地同步命令补齐，且本次发版要求 Gitee release 页面同步。
- 官方 demo smoke 失败。
- npm pack dry-run 失败，或包内缺失关键 dist 文件。
- README、quickstart、demo walkthrough 与实际命令不一致。
- 发现 runtime evidence、memory candidate、HTML artifact、测试报告等本地运行时产物被默认提交。
- 发现安全、脱敏、路径边界或工作区边界问题未处理。

## 可以发版的最低条件

最低条件不是“没有失败测试”，而是：

- 核心 CLI 能跑。
- 官方 demo 能完整闭环。
- 至少一个真实项目完成轻量落地验证。
- 发布包 dry-run 可用。
- 剩余风险被明确记录，且不是阻断级别。
