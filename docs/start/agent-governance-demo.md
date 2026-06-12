# 官方 Demo Walkthrough：让 Agent 不再跳过工程纪律

这个 demo 用一个很小的 OAuth state 校验任务，演示 SCALE 如何把“应该做”的工程动作变成可检查证据。

## Demo 目标

我们要实现并验证一个安全敏感行为：

> 当 OAuth callback 的 state 过期、被消费或不匹配时，系统必须拒绝请求，而不是返回模糊 500。

SCALE 关注的不是这段业务逻辑有多复杂，而是 Agent 是否：

- 先澄清上下文和验收标准。
- 先诊断失败模式，不盲修。
- 写出可检查的 TDD 切片。
- 运行验证命令并留下证据。
- 生成可评审的 Markdown 和 HTML artifact。
- 不把临时报告、截图、脚本、敏感信息乱提交。

## 1. 准备 demo 项目

从仓库复制官方 demo：

```powershell
Copy-Item -Recurse E:\project\scale-engine\examples\demo-projects\agent-governance-demo .\scale-agent-demo
Set-Location .\scale-agent-demo
npm install
npm test
```

macOS/Linux 可以用：

```bash
cp -R /path/to/scale-engine/examples/demo-projects/agent-governance-demo ./scale-agent-demo
cd scale-agent-demo
npm install
npm test
```

## 2. 安装治理工作流

```bash
scale init --governance-pack node-library
scale preflight --preflight-profile quick
scale status
```

你应该看到 SCALE 生成 `.scale`、`docs/workflow/templates` 和项目治理规则。

## 3. 建立任务证据

```bash
scale context init --name "Agent Governance Demo"
scale runtime start --session-id 2026-05-18-oauth-state --task-id 2026-05-18-oauth-state --level M --agent codex
scale context grill --task-id 2026-05-18-oauth-state --task "加固 OAuth state 校验"
scale diagnose plan --task-id 2026-05-18-oauth-state --symptom "OAuth callback 在 state 过期或不匹配时行为不明确"
scale tdd slice --task-id 2026-05-18-oauth-state --behavior "拒绝过期、已消费或不匹配的 OAuth state" --public-interface "verifyOAuthState(record, providedState, now)" --failing-test "expired, consumed, mismatched state should return ok=false" --test-file tests/oauth-state.test.ts --impl-files src/oauth-state.ts
```

这一步会在任务目录中沉淀探索、诊断和 TDD 证据。

## 4. 运行真实验证

```bash
npm test
scale standards scan --dir .
scale assets scan --dir .
scale runtime record --title "demo business tests" --kind command --status passed --command "npm test" --exit-code 0 --summary "official demo OAuth state tests passed"
scale runtime final-check --task-id 2026-05-18-oauth-state --session-id 2026-05-18-oauth-state --level M
```

验收标准：

- `npm test` 必须真实通过。
- `standards scan` 不能发现阻断级别问题。
- `assets scan` 应能识别长期维护文档、任务证据和生成产物分类。
- `runtime final-check` 必须确认当前任务范围内有通过证据，且没有未解决失败证据。

## 5. 生成记忆候选和 HTML artifact

```bash
scale memory pack --task-id 2026-05-18-oauth-state --session-id 2026-05-18-oauth-state --task "加固 OAuth state 校验" --level M --budget 4000
scale memory settle --task-id 2026-05-18-oauth-state --session-id 2026-05-18-oauth-state --task "加固 OAuth state 校验" --level M
```

`memory pack` 用于恢复上下文，`memory settle` 用于把本次真实验证沉淀成可审查学习候选。候选仍需要人审后才能进入长期知识库或工程规范。

```bash
scale artifact render --task-id 2026-05-18-oauth-state --artifact-dir docs/worklog/tasks/2026-05-18-oauth-state
scale artifact doctor --artifact-dir docs/worklog/tasks/2026-05-18-oauth-state
scale artifact open --task-id 2026-05-18-oauth-state --artifact-dir docs/worklog/tasks/2026-05-18-oauth-state
```

HTML artifact 的价值是让人类更快评审 Agent 的思考、证据和风险。Markdown 仍然是源文件，HTML 是交付视图。

## 6. 对比没有 SCALE 的情况

没有 SCALE 时，Agent 很容易出现这些行为：

- 直接改实现，不先说明验收标准。
- 修了 happy path，却漏掉过期、已消费、不匹配等异常路径。
- 说“测试通过”，但没有命令输出。
- 写了临时脚本、截图、报告，却不知道哪些应该提交。
- 发版前没有 review evidence 和风险记录。

有 SCALE 后，这些行为会被命令、模板、门禁和证据文件显式化。它不能替代人类判断，但能让 Agent 的工作不再靠口头保证。

