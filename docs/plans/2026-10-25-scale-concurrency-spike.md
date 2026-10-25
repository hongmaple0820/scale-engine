# SCALE `.scale/` 并发安全 spike（P2）

- 日期：2026-10-25
- 任务等级：L（架构级，本文件为 spike 产出：现状证据 + 方案对比 + 分期建议，不含实施）
- 背景评估：Q3 评估将「单机假设 / 并发 last-writer-wins」列为架构级短板；DSH 插件接入实测新增了一个并发写者（多 agent 会话 + CLI + 插件同仓操作是现实场景）

---

## 0. 结论先行

不需要引入重型协调组件。**分期走**：先补一个跨进程文件锁原语（mkdir 原子语义，零依赖）保护仅有的一个真丢更新点（InstinctStore 读-改-写），SQLite 已有 WAL 无需动，EventBus 追加写经查风险低于预估（每行单次 write 系统调用，OS 级追加原子性覆盖）——文档化接受 + 读侧容错即可。**否决**单写者 daemon 方案（DSH 有自己的调度，重复建设且引入新运维面）。

## 1. 写者盘点（2026-10-25 实测源码）

| 写者 | 模式 | 并发安全评估 | 证据 |
| --- | --- | --- | --- |
| `EventBus` | `appendFileSync(file, line)` 每事件一次 | 🟡 **低风险，可接受**。每次 append 是单条完整 JSON 行、单次 write 调用；POSIX O_APPEND 小写入原子，Windows `FILE_APPEND_DATA` 同样按调用序列化。残余风险：超长行撕裂、磁盘满中途写——读侧已按行解析，坏行跳过即可（需确认读侧容错，见 §4-A） | `src/core/eventBus.ts:140` |
| `InstinctStore.save` | **读-改-写**：`findByKey` 读旧值（去重/合并 observations）→ `writeFileSync` 整文件覆盖；dedup-merge 还会 `unlinkSync` 旧文件 | 🔴 **真实丢更新**（last-writer-wins）：两个进程同 trigger 并发 save，后写覆盖前写的 observations 合并；unlink+write 间隙读者读到缺失 | `src/cortex/InstinctStore.ts:453-461` |
| `RuntimeEvidenceLedger` | 唯一文件名一次性写（`RTE-<ts>-<rand>.json`） | ✅ 安全（id 冲突概率可忽略）；sequence 是进程内计数器、仅排序辅助（排序已按 createdAt，计划 §3.2 确认过） | `src/runtime/RuntimeEvidenceLedger.ts` |
| `SQLiteArtifactStore` | better-sqlite3，`journal_mode=WAL` + `busy_timeout=5000` | ✅ 多进程读写并发已有基本保障（WAL 读写不互斥；写写 5s 忙等）。注意：WAL 下多**进程**写仍会串行化，吞吐不是问题（治理写频率低） | `src/artifact/sqliteStore.ts:132-134` |
| FSM 锁 | `Map<artifactId, Promise>` | ⚠️ **仅进程内**——跨进程的 `scale transition` 并发仍可能双写状态（低频，接受并记录） | `src/artifact/fsm.ts:97-109` |
| 其余 JSON 状态（thresholds/skills.json/config…） | 整文件覆盖写 | 🟡 低频人工编辑 + 命令级写，暂无自动高频并发写者；产出治理 manifest 已把写入收敛到登记入口，将来加锁有单一挂点 | — |

**结论**：唯一的「必须修」是 InstinctStore；唯一「需要确认」的是 EventBus 读侧容错；其余或已安全或风险可接受。

## 2. 方案对比

| 方案 | 覆盖 | 成本 | 判定 |
| --- | --- | --- | --- |
| A. mkdir 文件锁原语 + 关键点接入 | 读-改-写、多文件事务 | ~100 行零依赖（`mkdir` 失败=已锁，TTL 防死锁持有者崩溃，退出释放） | ✅ **采用（一期）** |
| B. 全状态走 SQLite（复用 WAL） | 一切 | 大改（EventBus/Instinct/Ledger 迁库），破坏"肉眼可读的治理文件"卖点 | ❌ 否决 |
| C. 单写者 daemon（orchestrator 扩权） | 一切 | 新常驻进程 + 全客户端改 RPC；与 DSH 自身调度冲突（计划 §4 映射矩阵已明确不接） | ❌ 否决 |
| D. 文件锁 + 事件流分片（per-writer 文件名） | A + EventBus 理论撕裂 | 每写者一个 jsonl，读侧合并——增加复杂度解决一个单次 write 原子性已覆盖的问题 | ⏸ 备用（仅当实测出现撕裂行） |

## 3. 分期建议

- **一期（~0.5 天）**：`src/core/FileLock.ts`（mkdir 锁：`acquire(key, {ttlMs})` → `{release}`，含 stale 检测与抢占）；`InstinctStore.save/removeInstinctFile` 包入锁；单测（并发 20 写者最终一致、崩溃残留锁可被 TTL 抢占、POSIX/Windows 双跑）。
- **二期（确认项，spike 时已验证 A）**：A. ✅ EventBus 读侧对坏行已容错（`eventBus.ts:101-106` 按行 try/catch 跳过）——D 方案彻底失去必要性；B. `scale transition` 跨进程锁（挂 FSM store 层，可选）。
- **不做**：B/C 方案；`.scale/` 全目录锁（粒度过粗）。

## 4. 验收（一期实施时）

- [ ] 并发压测：N=20 并发 `save` 同 trigger，最终 observations = 各写者之和（无丢失）
- [ ] kill -9 持锁进程后，TTL 内第二写者可获锁
- [ ] Windows（junction/杀进程语义差异）实测通过
- [ ] 既有 InstinctStore 测试零回归
