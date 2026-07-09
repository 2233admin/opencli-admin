# GOAL — opencli-admin strangler-fig 自动环

> `/loop` 自驱目标文件。**每轮重读本文件** → 取下个未完 PR → 端到端做(码+测) →
> pytest 绿闸 → 自动 commit(仅列出路径) → 勾掉状态+记一行进度 → 下一轮。
> 命中任一停止条件 → 停+报，**别瞎猜**。

---

## 北极星
接一个正经数据源 ≈ 100 行，只写它独有的「发一次请求 + 解析成条目」。
横切脏活(刷 token / 翻页 / 限速 / 存游标 / 写目的地)全归框架，渠道不碰。
迁移 = **Strangler Fig**：旧路径不破坏、新路径旁路验证、逐源切主路。
**绝不为新架构破坏旧行为。**

## 坐标
- repo: `D:\projects\opencli-admin`  分支: `refactor/thin-channel-thick-runner`
- 测试闸: `uv run pytest tests/unit --no-cov -q`（须全绿，当前基线 347）
- 跑测试用 PowerShell（`cd D:\projects\opencli-admin; uv run ...`）；Bash 被 RTK hook 改写易炸。
- ⚠️ **永不 stage**: `backend/api/v1/chat.py`、`PR-DESCRIPTION.md`、`HANDOFF-strangler-fig.md`、`GOAL.md`（用户 dock WIP + 本控制文件）。

## 提交策略（用户 2026-07-01 授权，仅限此 goal）
每 PR 绿即**自动 commit**。granular，一 PR 一 commit。提交前**显式 `git add <精确路径>` + `git diff --cached --name-only` 自检**，绝不 `git add -A`/`add .`。**push 仍等用户**。

---

## 状态机（每轮更新）
- [x] **PR1** — LegacyDbSink 写缝（`b33416a`，行为零变）
- [x] **PR2** — 锁旧 ODP 契约 + `backend/odp/`{schemas,mapper} + odp_client 走 mapper（`532291b`）
- [x] **PR3** — ODP forward→`OdpSink` + `LegacyDbSink(forward_to_odp)` gate + `DualSink` 不双发（`74ac704`，355 passed）
- [x] **PR4** — `write_strategy` 状态机→选 sink + column/migration `o5j6k7l8m9n0`（`db10450`，365 passed）
- [x] **PR5a** — DB cursor 表+migration `p6k7l8m9n0o1` + `DBCursorStore` + RSS `fetch()` etag/304 增量 + `identity()`=item id（`9cbfb80`，374 passed；纯加性，未碰 live pipeline）
- [x] **PR5b** — collect `collect()`→`run_channel()`(incremental opt-in) + cursor 后置 commit(sink durable 后)（`09e4860`，379 passed）

> ✅ **GOAL 完成**（2026-07-01）：strangler-fig 重构 PR2→PR5b 全落，325→**379 passed**，零回归，每刀行为零变。**未 push**（push 等用户）。范围外后续：AuthManager+加密凭据、session affinity 泛化。

### ✅ PR5b 分叉（已决议 2026-07-01：安全切——仅 incremental opt-in + cursor 后置 commit）
1. **路由范围**：(a) 仅 `capabilities.incremental` 渠道走 run_channel(opt-in strangler，RSS先)；(b) 全渠道切 run_channel；(c) 仅 RSS 显式特判。
2. **cursor 前进时机**：现 `run_channel` 每页 fetch 后立即 save(channel_runner.py:82-84)。规则要「只在进可靠写入层才前进」→ 需重构：(a) run_channel 返回 (items, pending_cursor)，pipeline sink 写成功后才 commit cursor；(b) 把 sink 注入 run_channel，每页写+commit(保翻页 resumability 但耦合 runner↔sink)。
3. **durability 判据**：odp_only/odp_primary 下「durable」= ODP 真落(Redis Stream queued 算不算？)；memory-only 假 202 不能让 cursor 前进。

## 每 PR 验收（DoD）
1. 全 `tests/unit` 绿（≥ 上一基线）
2. 旧路径行为零变 / 新路径有 characterization 或新测护栏
3. commit（仅码+测路径，自检 staged 集）
4. 更新本文件状态框 + 一行进度

## 停止条件（任一 → 停+报）
- 全 PR 完
- pytest 红且 2 轮内修不动
- **真分叉**：设计有多条不等价路 / 必须破坏旧行为 / 缺凭据或外部依赖 / 要碰 WIP 文件
- 需要 push（push 永远等用户）

---

## PR 详细规格（出自 HANDOFF §4 + memory `opencli-admin-channel-runner-refactor`）

### PR3 — OdpSink + 双发陷阱解
- **双发陷阱**：`storer.py:34-45` 在 `ODP_INGEST_URL` 设了时已 forward 到 ODP（上游既有 shadow）。所以 `LegacyDbSink` 现含此 forward。将来 `DualSink(LegacyDbSink+OdpSink)` 会**双发** → 污染 shadow。
- **做**：
  1. `LegacyDbSink(forward_to_odp: bool = True)` 加 gate；storer 的 forward 受此控制（默认 True = 行为零变）。
  2. 新 `backend/pipeline/sinks/odp_sink.py` `OdpSink`：normalize → `odp_client.forward_triples`（复用 PR2 mapper），`SinkResult.records=[]`（forward-only，AI/notify no-op）。accepted=queued、duplicates、rejected 按 ODP 响应。
  3. 新 `DualSink(legacy=LegacyDbSink(forward_to_odp=False), odp=OdpSink)`：legacy 写 DB（不 forward）+ OdpSink 发**一次**；ODP 失败不阻断 legacy。
- **验收**：legacy 模式同 PR1；odp_shadow=legacy 写 DB + ODP 发一次（非两次）；ODP 失败 legacy 照常。

### PR4 — write_strategy 状态机
- `data_sources.write_strategy` ∈ {legacy / odp_shadow / odp_dual_required / odp_primary / odp_only} → 选 sink。
- 一旦显式策略，ODP forward 不能再藏 storer 里（PR3 已把它收进 sink）。
- 选 sink 的工厂 + pipeline 注入点（`run_pipeline(sink=)` 已存在）。

### PR5 — RSS 真实竖切（含原 Phase 1b）
- `source_cursors` 表 + alembic migration + `DBCursorStore`（实现 PR1a 的 `CursorStore` Protocol）。
- `RSSChannel.fetch()` 走 etag/If-None-Match 增量（304 = 无新条目）；`identity()` = item id。
- **规则**：cursor **只在数据进了可靠写入层才前进**；prod 的 odp-ingest 不能 memory-only 假 202。

## 其后（不在本 goal 范围，到此停）
AuthManager + 加密凭据（堵 `channel_config` 明文 key）；会话亲和 `pipeline.py:45-56` 特判 → `Capabilities.session_affinity` 泛化 + 按域名并发上限。
