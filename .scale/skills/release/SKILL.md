---
name: release
version: 1.0.0
description: SCALE Engine release workflow
triggers:
  - release
  - publish
  - 发版
  - 发布
agents:
  - implementer
  - reviewer
---

# SCALE Engine Release Workflow

## Trigger

当用户说以下关键词时自动激活此技能：
- "发版" / "发布" / "release"
- "提交发版" / "提交发布"
- "push to npm" / "publish"

## Purpose

确保发版流程完整执行，包括：
1. 文档更新（README 徽章、版本号、更新日志）
2. 构建和测试验证
3. npm 发布
4. Git 推送双仓库
5. 验证 npmmirror 同步

## Release Checklist

Agent 必须**按顺序**执行以下检查，不可跳过：

### Phase 1: 验证当前状态

```bash
# 1. 检查 git 状态
git status
git diff HEAD

# 2. 检查当前版本
cat package.json | grep version

# 3. 运行测试
npm run build
npx vitest run
```

**门禁**: 测试必须全部通过，否则停止并报告问题。

### Phase 2: 确定版本号

根据变更内容决定版本号：

| 变更类型 | 版本号变化 |
|---------|-----------|
| 新功能（Feature） | minor（0.x.0 → 0.x+1.0）或 patch |
| Bug 修复 | patch（0.x.y → 0.x.y+1） |
| 破坏性变更 | major（0.x.y → 1.0.0） |
| 仅文档更新 | patch |

```bash
# 更新版本号
npm version patch --no-git-tag-version  # 或 minor / major
```

### Phase 3: 文档同步（CRITICAL - 必须执行）

**文档更新是发版的必要步骤，不可跳过！**

Agent 必须更新以下文件：

#### README.md 和 README.en.md

检查并更新所有版本相关内容：

1. **徽章版本号**（第 2、8 行）：
   ```markdown
   <img src="https://img.shields.io/badge/version-{VERSION}-orange?style=flat-square" />
   <img src="https://img.shields.io/badge/npm-{VERSION}-cb3837?style=flat-square&logo=npm" />
   ```

2. **标题版本号**（第 11 行）：
   ```markdown
   # SCALE Engine v{VERSION}
   ```

3. **测试数量徽章**（如有变化）：
   ```markdown
   <img src="https://img.shields.io/badge/tests-{COUNT}-passing-brightgreen?style=flat-square" />
   ```

4. **平台数量徽章**（如有变化）：
   ```markdown
   <img src="https://img.shields.io/badge/platforms-{COUNT}-blue?style=flat-square" />
   ```

5. **更新日志**：添加新版本说明：
   ```markdown
   ## v{VERSION} 更新
   
   - [列出本次变更内容]
   - 测试数量：{COUNT} 通过
   ```

#### package.json

更新 description 字段（如果主要功能有变化）：
```json
"description": "SCALE Engine v{VERSION} - [功能摘要]"
```

**验证文档同步**：
```bash
# 检查 README 版本号是否与 package.json 一致
grep -E "version-|npm-|# SCALE Engine v" README.md | grep "{VERSION}"
grep -E "version-|npm-|# SCALE Engine v" README.en.md | grep "{VERSION}"
```

### Phase 4: 构建和发布

```bash
# 1. 构建
npm run build

# 2. 运行完整测试
npx vitest run

# 3. 发布到 npm（公开包）
npm publish

# 4. 验证发布成功
curl -s "https://registry.npmjs.org/@hongmaple0820/scale-engine/latest" | grep version
```

### Phase 5: Git 推送

```bash
# 1. 提交所有更改
git add README.md README.en.md package.json package-lock.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
chore: release v{VERSION}

- Update README badges and version headers
- Update package.json description
- [其他变更内容]
EOF
)"

# 2. 推送到双仓库
git push origin master
git push github master

# 3. 验证推送成功
git log -1 --oneline
```

### Phase 6: 验证 npmmirror 同步

```bash
# 检查淘宝镜像同步状态（约 10 分钟后）
curl -s "https://registry.npmmirror.com/@hongmaple0820/scale-engine/latest" | grep version
```

告诉用户：
> npmmirror（淘宝镜像）会自动同步，约 10 分钟后可用。
> 用户可通过 `npm install --registry=https://registry.npmmirror.com` 快速安装。

---

## Common Mistakes to Avoid

| 错误 | 说明 |
|------|------|
| ❌ 忘记更新 README 徽章 | npm 包的 README 是发布时打包的，必须重新发布才能更新 |
| ❌ 版本号不一致 | README 徽章、标题、package.json 必须全部同步 |
| ❌ 不运行测试 | 测试失败时禁止发布 |
| ❌ 忽略 npmmirror | 中国用户依赖镜像，需告知同步状态 |

---

## Quick Reference Card

```
发版流程 = 验证 → 版本号 → 文档同步 → 构建 → 测试 → npm发布 → Git推送 → 验证镜像

文档同步必须更新：
  ✅ README.md 徽章版本号（第 2、8 行）
  ✅ README.md 标题版本号（第 11 行）
  ✅ README.en.md 徽章版本号（第 2、8 行）
  ✅ README.en.md 标题版本号（第 11 行）
  ✅ package.json description
  ✅ 更新日志新增版本说明

门禁：
  🚫 测试未全部通过 → 禁止发布
  🚫 文档版本号不一致 → 禁止发布
```

---

## Notes

1. **npm 包的 README 不会自动同步 GitHub**：发布时打包的 README 是静态的，需要重新发布才能更新 npmjs 上的文档。

2. **npmmirror 自动同步**：无需手动推送，约 10 分钟自动同步。

3. **双仓库推送**：Gitee（origin）和 GitHub（github）都需要推送。
