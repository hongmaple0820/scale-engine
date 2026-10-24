# SCALE Engine 产出治理重构方案（Q2：Output Governance）

- 日期：2026-10-24
- 任务等级：L（跨 install/init/adapter/hooks/scripts 多模块，触目标项目写盘契约，需迁移与兼容策略）
- 状态：已立项（待评审）
- 目标版本：0.57.0（minor——布局变化 + 新命令，读写双兼容期保证不破坏）
- 问题陈述：SCALE 在目标项目里的产出（治理状态、临时文件、脚本、文档、平台集成）散落多个根目录、无清单、无清理、无版本化布局——治理工具自己成为被治理对象时不及格。

---

## 0. 结论先行

用户项目里的 SCALE 产出目前分布在 **五个根**（`.scale/`、`.planning/`、`.agent/`、各平台目录、`docs/workflow/` 模板）加**游离临时目录**（`.tmp-scale-workspace-*` 直接落项目根）。本方案分四阶段收敛为「**单一受管根 `.scale/` + manifest 写入登记 + TTL 自愈 + clean/doctor 可视化**」，全程读写双兼容，0.57.0 落地核心（manifest + tmp 收敛 + clean），0.58.0 完成全量迁移。

**不做的事**：不改变平台集成文件的落点（`.claude/settings.json` 等是各宿主的约定俗成，动了反而破坏集成）——但它们必须**登记进 manifest**，使 uninstall/doctor 可管理。

---

## 1. 现状盘点（2026-10-24 实测证据）

### 1.1 写盘根清单（本仓库自身即样本）

| 根 | 顶层条目 | 写者 | 问题 |
| --- | --- | --- | --- |
| `.scale/` | **37 个**顶层文件/目录（config.yaml、policy.yaml、events/、evidence/、instincts/、ledger/、memory/、metrics/、phases/、release/、judges/、evals/ …） | install/init/runtime 各处 | 结构扁平无分区；核心（evidence/specs）与可再生（cache/reports）混在顶层；无版本标识 |
| `.planning/` | `tasks/<date>-<name>/` × 11 个模板文档 | `scripts/workflow/plan.sh`/`new-task.sh`（随 npm 分发） | 第二个状态根；用户 gitignore 之外可见 |
| `.agent/` | `state/current.json`、`project.json`、logs/ | 同上脚本 | 第三个状态根 |
| 平台目录 | `.claude/`、`.codex/`、`.zcode/`、`.deepseek/` …（23 平台） | `scale init --agent <id>`（`src/api/quickstart.ts:141-149`） | 合理必要，但**无登记清单**：装了什么、能否整体回收，无据可查 |
| `docs/workflow/` | README + 11 模板 | 安装链路（`src/api/doctor.ts:421-429` 断言其存在） | 生成文档进用户 docs/ ——「非核心产出侵占用户注意力」的直接实例 |
| 项目根游离 | `.tmp-scale-workspace-*` × 54（53 个产于 2026-09-12 单日）、`.tmp-tests/`（1.6M） | 历史代码路径（当前 src 已无此字面量）+ `tests/api/officialDemoWorkflow.test.ts:14`、`tests/hooks/workflowHooks.test.ts:14`（mkdtemp 落 cwd 而非系统 tmpdir） | 最脏一类：无 TTL、无固定根、tests 违反自身纪律 |

### 1.2 现有纪律的正面盘点（保留并放大）

- `src/` 内现行 mkdtemp **已守规矩**：`shieldCommands.ts:287`、`GateSystem.ts:561` 均用系统 `tmpdir()` ✓
- `AGENTS.md` 合并已有幂等标记 `<!-- SCALE:BEGIN/END -->` ✓（扩展此模式）
- `.gitignore` 已覆盖 `.tmp-*/`、`.planning/`、`.agent/logs|state` ✓（但 ignore 不等于治理——磁盘仍在累积）
- `RuntimeEvidenceLedger` 单文件追加、`EventBus` append-only——并发安全面已有局部好实践

### 1.3 缺失的能力

1. **无 manifest**：没有任何地方能回答「SCALE 在这个项目写了什么」
2. **无 uninstall / clean**：`grep uninstall src/api/cli.ts` 零命中
3. **无 TTL**：临时产物永生
4. **无布局版本**：`.scale/` 内无版本字段，迁移无从谈起

---

## 2. 目标设计

### 2.1 目录布局（目标态，0.58.0 全量达成）

```
.scale/
├── manifest.json          # 唯一登记处（见 2.2）
├── layout.json            # { "version": 2, "migratedAt": "..." }
├── config/                # 用户可编辑：config.yaml、policy.yaml、thresholds、output-policy …
├── state/                 # 运行期状态：events/、phases/、ledger/、agents/、release/、judges/、evals/
├── evidence/              # 治理核心（不可再生）：runtime/、command-runs/、tool-runs/
├── specs/                 # 治理核心（不可再生）：规范文档 + myspec/
├── reports/               # 可再生输出：按 <date>-<name>/ 归档
├── tmp/                   # 唯一临时根（72h TTL）
└── cache/                 # 可再生缓存（vectors/、worktrees/、scale.db*）
```

**归类规则**（写入时的强制判断，落为共享函数 `classifyScalePath()`）：

| 问题 | 归属 |
| --- | --- |
| 删了会丢治理证据/规范吗？ | `evidence/`、`specs/` —— 永不自动清理 |
| 用户会手工编辑吗？ | `config/` —— 迁移命令提示用户 diff |
| 随时可再生吗？ | `cache/`、`reports/`、`tmp/` —— clean 候选 |
| 其它运行状态？ | `state/` —— clean --all 候选 |

### 2.2 manifest.json（写入即登记协议）

```jsonc
{
  "version": 1,
  "scaleVersion": "0.57.0",
  "projectRoot": "E:/...",
  "writings": [
    // .scale/ 之外的一切写入必须登记；.scale/ 内部只登记 config/ 层
    { "path": ".claude/settings.json", "kind": "platform-config", "platform": "claude-code",
      "idempotent": { "type": "json-merge", "keys": ["hooks"] }, "writtenAt": "...", "by": "scale init" },
    { "path": "AGENTS.md", "kind": "doc-section", "idempotent": { "type": "markers", "begin": "<!-- SCALE:BEGIN -->" } },
    { "path": "docs/workflow/README.md", "kind": "generated-docs", "regenerable": true }
  ]
}
```

协议：**写 `.scale/` 之外任何路径前必须先 append 登记**（先登记后写入，崩溃时留下的孤儿登记无害）；登记由 `ScaleSurface.write()` 统一入口完成——所有 installer/adapter 的写盘点分批收敛到该入口（见 §4 T1）。

### 2.3 临时产物规则

1. 一切 mkdtemp/mkdir 临时目录：`.scale/tmp/`（继承系统 tmpdir 语义的用例除外——gate 隔离等保持系统 tmpdir）
2. 启动时（`getEngine()` 引导）顺手清理 `.scale/tmp/` 中 mtime > 72h 的条目（异步、失败静默）
3. **lint 规则**：`mkdtemp(join(process.cwd()…` / `join(cwd, '.tmp` 模式 = error（进 eslint 自定义规则或 grep 门禁，先做 grep 门禁 `scripts/workflow/check-tmp-discipline.mjs` 进 gate-quality）
4. tests 一律 `tmpdir()`，禁 cwd（修 `officialDemoWorkflow.test.ts`、`workflowHooks.test.ts` 两个违例）

### 2.4 新命令

| 命令 | 语义 |
| --- | --- |
| `scale doctor --surface` | 按「治理核心 / 平台集成 / 可再生产物 / 临时」四类列出本项目全部 SCALE 产出，标注可删性 |
| `scale clean --dry-run`（默认 dry-run） | 列出 tmp/（>72h）、cache/、reports/（>30d 可选）清理项；`--exec` 执行；**永不触碰 evidence/specs/config** |
| `scale migrate --layout v2` | 旧布局 → 新布局迁移（见 §3） |
| `scale uninstall` | 按 manifest 回收登记项 + 删除 `.scale/`（二次确认 + `--keep-evidence` 默认保留证据归档 tar） |

---

## 3. 兼容与迁移策略（关键风险控制）

1. **双读期**（0.57.0–0.58.0）：所有读取路径经 `resolveScalePath(name)` —— 有 `layout.json(version 2)` 用新布局，否则用旧布局。**禁止**直接 `join(scaleDir, 'evidence')` 字面量（grep 门禁覆盖）。
2. **写入策略**：0.57.0 起**新写入**走新布局（`layout.json` 首次写入即建 v2 目录），旧目录内容不搬（读旧写新）；`scale migrate --layout v2` 一次性搬运 + 改写 layout.json + 旧目录改名 `.scale.legacy-<date>/`（可回滚）。
3. **`.planning/` + `.agent/` 收编**：plan.sh/new-task.sh 改写到 `.scale/state/planning/`（保留 `.agent/project.json` 兼容读取一个版本）。脚本随 npm 分发，注意**旧版脚本 + 新布局**的反向兼容：脚本探测 `.scale/state` 存在则用之，否则用旧路径（双写不引入，探测式单写）。
4. **docs/workflow 模板**：0.57.0 起安装到 `.scale/reports/templates/` 不再进用户 `docs/`；doctor 检查点同步改（`doctor.ts:421-429`）；已存在的旧位置只读兼容一个版本。
5. **回滚**：`scale migrate --layout v2 --rollback` 恢复 `.scale.legacy-*`；npm 层面 0.57.x → 0.56.x 降级即回到全旧行为（双读保证旧布局始终可读）。

---

## 4. 分阶段实施

### T0 — manifest 与登记入口（0.57.0，1.5 天）
- `ScaleSurface` 模块（登记 + classifyScalePath + resolveScalePath 双读）
- install/init/23 个 adapter 写盘点收敛到统一入口（机械替换 + 测试）
- `scale doctor --surface` MVP（读 manifest + 兜底扫描已知模式）

### T1 — tmp 纪律与 clean（0.57.0，1 天）
- tmp 收敛 + TTL 自愈 + grep 门禁 `check-tmp-discipline.mjs` 进 gate-quality
- 修 2 个测试违例；删除本仓 55 个历史 `.tmp-*`
- `scale clean --dry-run/--exec`

### T2 — 布局 v2 与迁移（0.58.0，2 天）
- resolveScalePath 全量替换直接路径拼接（全仓 grep 清零）
- `scale migrate --layout v2 [--rollback]`
- `.planning/`/`.agent/` 收编 + 脚本探测式切换
- docs/workflow 模板迁 `.scale/reports/templates/`

### T3 — uninstall 与收尾（0.58.0，1 天）
- `scale uninstall`（manifest 驱动回收 + 证据归档）
- 文档：`docs/04-INTEGRATION.md` 增「产出与回收」节；README 增 clean/doctor 示例

**验收标准（可测）**：
- [ ] 新装项目：`scale doctor --surface` 四类清单完整，`git status`（用户项目）除平台配置与 AGENTS.md 段落外**零游离文件**
- [ ] `mkdtemp(join(process.cwd()` 模式全仓 grep 零命中（门禁生效）
- [ ] `.scale/tmp/` 72h 条目在下次命令运行时自动消失
- [ ] `scale clean --dry-run` 永不列出 evidence/specs/config 路径（负向测试）
- [ ] 0.56.0 创建的旧布局项目在 0.57/0.58 下全功能可用（迁移前后 e2e 对比：doctor/shield status/evidence 读取）
- [ ] `scale uninstall` 后：manifest 登记项全部消失、`.scale/` 移除、AGENTS.md SCALE 段落摘除、平台 hooks 配置还原

---

## 5. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 双读路径遗漏（某处仍硬拼旧路径） | T2 的 grep 清零是门禁项，不是自觉项 |
| 旧版脚本 + 新布局互相踩 | 脚本探测式单写；npm engines 提示升级 |
| 迁移中断产生混合布局 | 迁移按「拷贝→校验→改名 legacy」三段，中断时旧目录未动，可重跑 |
| adapter 写入收敛引入回归 | T0 逐 adapter 替换 + 各平台已有 init 测试兜底（agent-platform-expansion.test.ts 等） |
| 用户已 gitignore `.planning/` | 迁移后在旧位置留 README 指引（一次性） |

## 6. 未决问题（评审时定）

1. `.scale/` 37 顶层条目中有若干单文件 json（assets.json、frameworks.json…）——归 config 还是 state？默认：可编辑归 config，机器生成归 state。
2. `evidence/` 是否要进用户 git（治理证据随仓库走）还是本地留存？当前 gitignore 了 evidence/——维持现状，在 doctor --surface 标注提示。
3. reports/ 30d 自动清理默认开还是关？默认关（只列不删，--exec 才删）。
