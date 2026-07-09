# HANDOFF — opencli-admin 渠道系统 Strangler Fig 重构

> 用法：开一个**新 session**（本窗已过 smart zone），先读这份文件 + 读 memory
> `opencli-admin-channel-runner-refactor`，然后从 **PR2** 接着干。一口气做完一刀再 commit。

---

## 0. 一句话北极星

接一个新数据源 ≈ 100 行，只写它独有的「发一次请求 + 解析成条目」。刷 token / 翻页 / 限速 / 存游标 / 写目的地 —— 全归框架，渠道不碰。

迁移打法 = **Strangler Fig**：旧路径不破坏、新路径旁路验证、逐源切主路。**绝不为新架构破坏旧行为。**

---

## 1. 坐标

- 机器：5090，`D:\projects\opencli-admin`（FastAPI Python）
- 分支：`refactor/thin-channel-thick-runner`
- remotes：`origin`=xjh1994(上游，**零接触**)、`fork`=2233admin(我们的，已推)、`gitea`=Curry 镜像
- 测试：`uv run --directory D:\projects\opencli-admin pytest tests/unit --no-cov -q`（现 **325 passed**）
- ⚠️ 同仓 `backend/api/v1/chat.py`(M) + `PR-DESCRIPTION.md`(??) = 用户 dock WIP，**不碰、不提交、不 stage**。

---

## 2. 已落（提交在分支上，已推 fork）

| commit | 内容 |
|---|---|
| `b33416a` | **PR1** — LegacyDbSink 写缝（行为零变） |
| `56fa0c4` | Phase 1a — 厚 runner 地基（cursor store + 限速重试 client + 翻页） |
| `de52c25` | Phase 0 — 加厚渠道契约（Capabilities/FetchContext/FetchResult） |

「Phase 0/1a」= runner 层（`channel_runner.py`/`cursor_store.py`/`http_client.py`），仍有效复用。

### PR1 装了什么（写缝）

`backend/pipeline/sinks/`：
- `base.py` — `ItemSink` Protocol（一个方法 `write_batch(ctx, items) -> SinkResult`）+ `RunContext`(task_id/source_id/provider/ingest_mode/run_id) + `SinkResult`(accepted/duplicates/rejected/normalized/**records**/errors)。
  - `SinkResult.records` 回带 ORM 行 —— `pipeline.py` 后续 ai/notify 依赖它。**必须存在**，否则 PR1 不是行为零变。
  - accepted/duplicates/rejected 语义按**各 sink 自己的 durable 边界**写死（legacy accepted=已插入行 ≠ odp accepted=已入队）。
- `legacy_db_sink.py` — `LegacyDbSink` 包现有 `normalizer.normalize_items` + `storer.store_records`，行为照旧。
- `pipeline.py` — step2+3 改成 `active_sink.write_batch()`；`run_pipeline` 加 `sink=` 注入口（默认 LegacyDbSink）。

---

## 3. ⚠️ 双发陷阱（最大坑，PR3 必解）

`backend/pipeline/storer.py:34-45` 在 `ODP_INGEST_URL` 设了时**已经 forward 到 ODP**（这是上游 fork 里既有的 shadow，不是我们加的）。

所以 **`LegacyDbSink` 现在不是纯 legacy** —— 它经 storer，带着这个 ODP forward。PR1 故意保留（行为零变）。

后果：将来 `DualSink(LegacyDbSink + OdpSink)` 会**对 ODP 双发** → 污染 shadow 对比指标。

解法（PR3）：`LegacyDbSink(forward_to_odp: bool = True)` 加 gate；DualSink 用 `forward_to_odp=False` + `OdpSink`。`legacy_db_sink.py` 已留 `TODO(PR3)` 在 storer 调用处。

---

## 4. 剩余路线（**顺序依赖，不是独立可抢** —— 别拆 /to-issues）

- **PR2（下一刀）** = 锁旧契约 + mapper，**不搬 forward**：
  1. 读死 `storer.py` 当前 ODP forward 的 payload shape（经 `odp_client.forward_triples`）。
  2. 给该 forward 加 **characterization test**：`ODP_INGEST_URL` 设了时 `store_records()` 会 forward，payload 与当前一致。锁旧行为，证明 PR3 搬迁前后等价。
  3. 新增 `backend/odp/schemas.py`：`RecordEvent` / `OdpIngestResponse`，字段对齐 Rust `odp-rs/crates/odp-contracts`（RecordEvent v2）+ `IngestBatchResponse`(accepted/duplicates/rejected/errors)。
  4. 新增 `RecordEventMapper`，输入**对齐 normalized record**（沿用现有 normalizer 结果），**别从 raw collector item 另起一套语义**（否则 legacy DB 字段语义 ≠ ODP payload 语义）。
  5. **暂不搬** storer 的 forward；只把 mapper/client 备好。`backend/pipeline/odp_client.py` **已存在**（commit 97b8d93）→ 扩展，别重建。
  6. 全 `tests/unit` 保持绿。
- **PR3** = ODP forward 从 storer 搬进 `OdpSink` + `LegacyDbSink(forward_to_odp)` gate + DualSink 不双发。验收：legacy 模式同 PR1；odp_shadow=legacy 写 DB + ODP 发**一次**；ODP 失败不阻断 legacy。
- **PR4** = `data_sources.write_strategy` 状态机(legacy / odp_shadow / odp_dual_required / odp_primary / odp_only)→选 sink。一旦显式策略，ODP forward 不能再藏 storer 里。
- **PR5** = RSS 真实竖切。并入原计划「Phase 1b」：`source_cursors` 表 + alembic migration + `DBCursorStore`；`RSSChannel.fetch()` 走 etag/If-None-Match 增量(304=无新条目)；`identity()`=item id。规则：cursor **只在数据进了可靠写入层才前进**；prod 的 odp-ingest 不能 memory-only 假 202。
- 其后：AuthManager + 加密凭据（堵 `channel_config` 明文 key）；会话亲和 `pipeline.py:45-56` 特判 → `Capabilities.session_affinity` 泛化 + 按域名并发上限。

---

## 5. 工作纪律（用户定，硬约束）

- 回复中文、代码/路径/commit 英文；caveman 简洁。
- **接到明确方向就端到端做完**（自己 build/test/真验证再交），中途不一步一问、不开菜单挑下一步；只真分叉才问。
- **只在用户说 "commit" 时提交**；stage 时显式列路径，**绝不** stage `chat.py` / `PR-DESCRIPTION.md`。
- 不向上游 PR，自己 fork 开发。「PR1/PR2」只是每刀的叫法 = 本地 commit。

---

## 6. 指针

- 路线 + 双发陷阱全文：memory `opencli-admin-channel-runner-refactor`（新窗自动 recall）。
- odp-rs Rust 热路径子系统简报（给 GPT 调研）：本机 scratchpad `odp-rs-briefing.md`（2 二进制 odp-ingest:8040/odp-store + 3 crate contracts/bus/store；Redis Streams + Postgres odp_records；两层去重；缺 XAUTOCLAIM/DLQ/outbox）。
- 关键源：`backend/pipeline/{pipeline,collector,normalizer,storer,odp_client,channel_runner,cursor_store,http_client}.py`、`backend/pipeline/sinks/`、`backend/channels/base.py`、`backend/models/{record,source}.py`。
