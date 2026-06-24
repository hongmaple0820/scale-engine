# SCALE Skill 仓库

这个仓库视图用于让 Agent 按任务渐进式发现、激活和编排 skills/MCP/CLI，而不是一次性把所有能力塞进上下文。

## 统一来源

- `.scale/skills/` 是项目随仓库维护的通用 workflow skills 主来源，发包时必须包含。
- `.scale/skills.json` 只负责路由、证据要求和 `skillSources` 配置，不再承载 skill 内容本身。
- `skills/` 只作为旧项目 fallback；新模板、新扫描和新门禁都优先读取 `.scale/skills/`。
- `~/.agents/skills`、`~/.codex/skills`、`~/.claude/skills` 等用户目录只代表本机安装状态，不能替代项目主来源。

## 渐进式披露

1. 启动时只读取 Skill 元数据和一句话描述。
2. 任务命中时才读取完整 SKILL.md。
3. scripts、references、assets 只在明确需要时懒加载。

## 安全安装

- 安装前必须执行安全扫描，阻断 `curl | bash`、`Invoke-Expression`、危险删除和非 HTTPS 来源。
- npm/npx 来源必须补充 `npm audit signatures`、来源仓库、许可证和版本/commit 固定检查。
- 任何第三方 Skill 都先进入隔离审查，再写入项目或全局 skills 目录。

## 供应链防护清单

- review-skill-frontmatter
- inspect-scripts-directory
- verify-license-and-source
- verify-attribution-and-notice
- pin-source-revision
- npm-audit-signatures

## Skill 目录

| ID | 类别 | 信任 | 主要用途 | 组合建议 |
| --- | --- | --- | --- | --- |
| `planning-with-files` | planning | community | Use persistent planning files, progress logs, findings, active-plan selection, and plan attestation for long-running agent work. | memory-brain, web-access, code-reviewer |
| `gbrain` | memory | community | Use as the default graph-backed memory provider for long-running project knowledge, entity relationships, and background memory maintenance. | memory-brain, codegraph |
| `impeccable` | ui | ecosystem | Run as the required UI quality gate for deterministic anti-pattern detection before visual acceptance. | taste-skill, awesome-design-md, ui-ux-pro-max, webapp-testing |
| `taste-skill` | ui | ecosystem | Choose the product visual direction and taste parameters before UI implementation starts. | impeccable, frontend-design, awesome-design-md |
| `frontend-design` | ui | official | 在 DESIGN.md 和 UX 验收之后补齐前端实现约束、组件状态和落地方式。 | awesome-design-md, ui-ux-pro-max, webapp-testing |
| `awesome-design-md` | ui | ecosystem | 建立产品级设计规范、品牌语言和 DESIGN.md。 | ui-ux-pro-max, frontend-design |
| `ui-ux-pro-max` | ui | ecosystem | 补齐体验策略、交互状态和 UI 验收维度。 | awesome-design-md, webapp-testing |
| `webapp-testing` | testing | official | 验证页面点击、表单、控制台、截图和端到端行为。 | agent-browser, mcp-chrome-devtools |
| `web-access` | browser | ecosystem | 获取一手资料、动态页面内容、网页证据和来源引用。 | agent-browser, mcp-chrome-devtools |
| `agent-browser` | browser | ecosystem | 与 Web 页面真实交互，补齐手工验收证据。 | web-access, webapp-testing, mcp-chrome-devtools |
| `mcp-chrome-devtools` | browser | ecosystem | 调试控制台错误、网络请求、页面状态和性能问题。 | agent-browser, webapp-testing |
| `cua` | desktop | ecosystem | 操作桌面应用并收集端侧截图、状态和副作用边界证据。 | web-access, agent-browser |
| `liteparse` | document-parsing | ecosystem | Parse documents into structured outputs and screenshots for knowledge ingestion with source citation evidence. | graphify, memory-brain, web-access |
| `d2-diagram` | diagramming | ecosystem | Use text-first diagrams with validation and formatting for architecture planning artifacts. | planning-with-files, architecture-diagram-generator |
| `opensquilla` | orchestration | ecosystem | Reference external routing, context, MetaSkill orchestration, and feedback-loop ideas without making them required runtime dependencies. | gbrain, codegraph, codex-cli |
| `code-reviewer` | review | official | 合并前分级审查缺陷、安全、可维护性和测试风险。 | security-and-hardening, update-docs |
| `fix` | review | official | 提交前清理格式和 lint 问题。 | code-reviewer |
| `pr-creator` | review | official | 生成标准 PR 描述和合并前说明。 | code-reviewer, update-docs |
| `update-docs` | docs | official | 发现并更新受代码变更影响的长期文档。 | documentation-and-adrs |
| `find-skills` | discovery | ecosystem | 按任务意图搜索合适 Skill，再进入安全扫描。 | web-access |
| `codex-cli` | agent-cli | official | 外部 CLI 审查和命令级证据。 | gemini-cli, opencode-cli |
| `gemini-cli` | agent-cli | official | 外部 CLI 审查和命令级证据。 | codex-cli, opencode-cli |
| `opencode-cli` | agent-cli | ecosystem | 外部 CLI 审查和命令级证据。 | codex-cli, gemini-cli |
| `agency-agents-zh` | role-library | community | 提供 CEO、CTO、工程、设计、产品等角色预设参考。 | skill-safety-scan |

## Third-Party Attribution

| ID | License | Usage | Notice |
| --- | --- | --- | --- |
| `planning-with-files` | MIT | adapted-concept | Inspired by and compatible with OthmanAdi/planning-with-files. SCALE should not copy upstream files unless the MIT license text and attribution are included. |
| `gbrain` | MIT | external-reference | Optional external provider only. Do not vendor GBrain code into SCALE without preserving MIT license text, source revision, and modification notices. |
| `impeccable` | review-required | external-reference | License and attribution must be verified before installation, vendoring, or redistribution. |
| `taste-skill` | review-required | external-reference | License and attribution must be verified before installation, vendoring, or redistribution. |
| `liteparse` | review-required | external-reference | License and attribution must be verified before installation, vendoring, or redistribution. |
| `d2-diagram` | review-required | external-reference | License and attribution must be verified before installation, vendoring, or redistribution. |
| `opensquilla` | review-required | external-reference | License and attribution must be verified before installation, vendoring, or redistribution. |
