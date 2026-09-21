# Scale Shield — 钩子确定性拦截引擎

> 对标 agent-hooks-in-depth 退出码阻断模式。让 AI 物理上做不到危险操作。

## 设计理念

**不要试图说服 AI 自律。让 AI 物理上做不到错的事。**

- ❌ 提示词说"不要运行 rm -rf" → AI 可以忽略
- ✅ Shield hook 返回 exit 2 → AI 物理无法执行

## 核心协议

### 退出码协议

| 退出码 | 含义 | 行为 |
|--------|------|------|
| **0** | 允许 (allow) | 工具调用正常执行 |
| **2** | 阻断 (block) | 工具调用被拒绝，stderr 输出原因 |

### stdin/stdout JSON 协议

**输入** (stdin):
```json
{
  "session_id": "abc123",
  "cwd": "/path/to/project",
  "tool_name": "Bash",
  "tool_input": {"command": "rm -rf /"}
}
```

**输出** (stdout):
```json
{
  "decision": "block",
  "reason": "Dangerous command 'rm -rf /' blocked by Shield policy"
}
```

## 策略系统

### 声明式策略 (`.scale/policy.yaml`)

```yaml
rules:
  - name: protect-scale-dir
    description: 禁止修改 .scale/ 目录
    paths: [".scale/**"]
    action: block
    reason: ".scale/ directory is governance-critical"

  - name: block-destructive-commands
    description: 阻断危险命令
    commands: ["rm -rf", "DROP TABLE", "git push --force", ...]
    action: block
    reason: "Destructive command blocked"

  - name: require-gate-before-commit
    description: commit 前必须通过 gate-quality
    tools: ["Bash"]
    patterns: ["git commit"]
    require_gate: "gate-quality"
    action: block
```

### 策略编译

```bash
scale shield compile
```

将 `.scale/policy.yaml` 编译为：
- `.claude/hooks/shield-pre-tool.js` — PreToolUse hook 脚本
- `.codex/hooks/shield-pre-tool.js` — Codex 版本
- `.cursor/hooks/shield-pre-tool.js` — Cursor 版本

编译后的 hook 注册到对应平台的 settings.json 中。

## 受保护断言

### 路径保护 (12 条规则)

| 路径 | 保护级别 | 说明 |
|------|---------|------|
| `.scale/**` | block | 治理核心目录 |
| `.hook-state/**` | block | 跨 hook 状态 |
| `.env` | block | 环境变量 |
| `.env.*` | block | 环境变量变体 |
| `**/credentials.*` | block | 凭据文件 |
| `**/*.pem` | block | 密钥文件 |
| `**/*-key.json` | block | JSON 密钥 |
| `**/id_rsa*` | block | SSH 私钥 |
| `**/config.yaml` | warn | 配置文件 |
| `.claude/settings.json` | warn | Claude 配置 |
| `.codex/config.toml` | warn | Codex 配置 |
| `.cursorrules` | warn | Cursor 配置 |

### 命令阻断表 (40+ 模式)

**破坏性操作**: `rm -rf`, `del /f`, `format`, `mkfs`, `dd if=`

**数据丢失**: `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `DELETE FROM` (无 WHERE)

**安全风险**: `cat .env`, `echo $API_KEY`, `git push --force`, `eval`, `curl | sh`

**治理绕过**: 修改 `.claude/settings.json`, 删除 `.scale/` 文件, 禁用 hook

## 跨 Hook 状态共享

通过 `.hook-state/` 目录实现跨 hook 通信：

```
PreToolUse  → 写入 last_tool.json  →  PostToolUse 读取验证
SessionStart → 写入 session.json  →  Stop 验证合规
```

文件系统为管道，无内存依赖，crash-safe。

## 会话收尾：脏工作区提醒 (Stop hook)

`require-clean-worktree` 规则在会话结束时检查 `git status --porcelain`，有未提交改动时以 **warn 模式**输出提醒（不阻断会话，exit 0）：

```
[SCALE SHIELD WARN] Uncommitted changes detected: 2 changed entries (e.g. src/app.ts).
Commit your changes or run: scale commit-suggest
```

- 随 `scale shield compile` 自动注册到 settings 的 `Stop` 段（幂等，重复编译不重复注册）。
- 默认豁免工具产物：`.workbuddy/`、`.workbuddy-ai/`、`output/`、`tmp/`、`.scale-test-session/`、`.hook-state/`、`.planning/cache/`、`*.timestamp-<ts>-<hash>.mjs`。
- 非 git 目录、`git` 不可用时静默跳过（fail-open）。
- 只有显式把规则的 `action` 改成 `block` 才会以 exit 2 拦截。

配套命令 `scale commit-suggest` 依据改动生成符合规范的提交信息，可 `--execute` 直接暂存（精确到文件，绝不 `git add -A`）并提交。

## CLI 命令

```bash
# 编译策略并安装 hook
scale shield compile

# 查看 Shield 状态
scale shield status
# 输出: hook 注册状态、.scale/ 完整性、最近拦截记录

# 运行测试用例
scale shield test
# 运行 20 个 allow/warn/block 测试用例验证策略正确性

# 生成提交建议（可选直接提交）
scale commit-suggest
scale commit-suggest --execute
```

## 安全保证

- **延迟**: Hook 决策 p99 < 10ms (内存缓存策略规则)
- **不可绕过**: exit 2 协议由 Agent 平台原生支持，非 SCALE 自行实现
- **防篡改**: `.scale/` 目录 hash 校验，任何修改可检测
- **零信任**: 默认拒绝未明确允许的操作

## 相关文件

- `src/shield/PolicyCompiler.ts` — 策略编译器 + `evaluateDirtyTree` 共享评估
- `src/shield/ShieldProtocol.ts` — stdin/stdout JSON 协议
- `src/shield/ProtectedPaths.ts` — 受保护路径 + 命令阻断表
- `src/cli/shieldCommands.ts` — CLI 入口
- `src/workflow/CommitSuggest.ts` — 提交建议与暂存执行
- `src/cli/commitSuggestCommands.ts` — `scale commit-suggest` 入口
- `.scale/policy.yaml` — 声明式策略模板
