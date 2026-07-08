# ODP Enterprise — 高性能解耦架构（第一性原理）

**状态**：方向锁定 · 2026-06-18  
**原则**：吞吐与解耦优先；安全、审计、多租户后置  
**品类**：OpenBB 式异构数据源平台（ODP），非舆情 SaaS

---

## 0. 第一性原理：平台最小闭环

企业级数据平台的热路径只有四件事：

| 要素 | 职责 | 失败模式 |
|------|------|----------|
| **Ingress** | 接收事件/批次，校验契约，幂等去重 | 丢消息、重复写、背压缺失 |
| **Buffer** | 削峰、解耦生产者与消费者 | 下游慢拖死上游 |
| **Persist** | 批量落库、可查询、可回放 | 逐条 insert、SQLite 锁 |
| **Egress** | 推送到 webhook/队列，ACK 闭环 | 发了就算、无法重放 |

**不在热路径上的**：Chrome 会话、opencli 子进程、AI 打标、UI、源配置 CRUD。

结论：**重没关系** — 可以上 Redis Streams / NATS JetStream / Postgres / 独立 Rust 服务；关键是 **把重的东西放在对的层**，且 **层与层只通过契约 + 总线说话**。

---

## 1. 目标吞吐（企业级对标，非当前实测）

| 平面 | 目标（单机 NAS+LAN 起步，可横向扩） | 说明 |
|------|-------------------------------------|------|
| Stream ingest API | **≥ 5k events/s** 突发，**≥ 500/s**  sustained | 群聊、webhook 入站 |
| Snapshot 批次 | **≥ 50k records/min** 批量写入 | 热榜/RSS 拉取后一次 flush |
| Ingest → bus p99 | **< 20ms**（不含持久化） | 先 ACK 入队再异步写 |
| Persist 批次 | **≥ 2k rows/batch**，COPY/UNNEST | Postgres 为主存储 |
| Egress dispatch | **≥ 1k deliveries/s** worker 池 | 带重试与 dead-letter |
| 查询 API | **≥ 200 req/s** 分页读 | 读路径可与写路径分库 |

当前 Python monolith：**~1–2 opencli 任务/min/Chrome**，SQLite 逐条写 — **差 2–3 个数量级**。改造后热路径不经过 Python ORM。

---

## 2. 服务边界（强制解耦）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE (可 Python)                         │
│  admin-api: 源注册、cron 配置、Chrome 池、任务 UI、coverage 元数据          │
│  不写 records 热路径；只发「采集意图」到 bus                               │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ commands (collect.schedule)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     COLLECTOR PLANE (混合)                               │
│  collector-opencli (Python): CDP/子进程，慢，按 Chrome 槽位互斥           │
│  collector-fast (Rust): RSS/API/静态 HTTP，高并发 tokio                   │
│  stream-listener (Rust): QQ/TG/飞书 WS → 直接打 ingest                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ RecordEvent (contract)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     DATA PLANE (Rust 为主)                               │
│  odp-ingest:  HTTP/gRPC 批量接入、幂等、schema 校验、入队                 │
│  odp-bus:     Redis Streams / NATS JetStream（可换，接口固定）            │
│  odp-store:   批量写 Postgres；可选 ClickHouse 冷分析                    │
│  odp-egress:  webhook 投递、ACK、DLQ、重放                               │
│  odp-query:   只读 API（cursor 分页、export）                             │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ webhooks / streams
                                ▼
                    n8n · quant · 群分析 · Obsidian consumer
```

### 2.1 禁止的耦合（硬规则）

1. **Collector 不得直接 `session.add(CollectedRecord)`** — 必须 `POST /v1/ingest/events` 或 publish 到 bus。
2. **admin-api 与 odp-store 不共享进程内 DB session** — 控制面读元数据；记录读 `odp-query`。
3. **AI / notify 不得阻塞 ingest** — 消费 `record.committed` 主题，独立 worker。
4. **契约版本化** — `odp-contracts` crate + JSON Schema；破坏性变更升 `schema_version`。

---

## 3. 语言分工（能 Rust 就 Rust）

| 组件 | 语言 | 理由 |
|------|------|------|
| `odp-ingest` | **Rust** (axum) | 高并发 HTTP、零拷贝 JSON、校验 |
| `odp-bus` adapter | **Rust** (redis/nats crate) | 长连接、背压 |
| `odp-store` writer | **Rust** (sqlx + COPY) | 批量写、连接池 |
| `odp-egress` | **Rust** | 大量并发 HTTP 出站 |
| `odp-scheduler` | **Rust** | 亚秒 tick、分布式锁 |
| `odp-query` | **Rust** | 只读路径隔离 |
| `collector-fast` | **Rust** | RSS/API 万级 fetch |
| `stream-listener` | **Rust** | WS 长连接 |
| `collector-opencli` | **Python** | opencli 生态、CDP 现成 |
| `admin-api` + UI | **Python + TS** | CRUD、运维面板 |
| `ai-enricher` | **Python** | LLM I/O  bound，非 CPU hot path |
| 极致性能可选 | **C** | 仅当有成熟 C 库且 Rust 绑定成熟（如 simd json、特定 codec）；默认不手写 C |

**不重写**：opencli adapter、Browser Bridge、OhMyOpenCLI 工具链 — 通过 **ingest 契约** 汇入平台。

---

## 4. 契约：Record v2（`odp-contracts`）

```json
{
  "schema_version": 1,
  "provider": "qq/group",
  "source_id": "uuid",
  "event_id": "msg_id_or_url_hash",
  "ingest_mode": "stream",
  "source_ts": "2026-06-18T12:00:00Z",
  "cursor": "last_seq",
  "payload": { "title": "", "content": "", "group_id": "", "sender": "" },
  "raw_data": {},
  "trace_id": "uuid"
}
```

幂等键：`(source_id, event_id)`；快照源可退化为 `(source_id, content_hash)`。

批量接口：

```
POST /v1/ingest/events
Content-Type: application/x-ndjson
或 POST /v1/ingest/batch  { "events": [...] }
→ 202 Accepted { "accepted": N, "duplicates": M, "rejected": K }
```

---

## 5. 消息主题（bus 抽象，实现可换）

| 主题 | 生产者 | 消费者 | 用途 |
|------|--------|--------|------|
| `odp.ingest.raw` | ingest | store-writer | 待持久化 |
| `odp.record.committed` | store | egress, ai-enricher | 落库完成 |
| `odp.egress.delivery` | egress | — | 投递状态 |
| `odp.collect.command` | scheduler | collectors | 触发 snapshot |
| `odp.dlq.*` | 各层 | 运维重放 | 失败隔离 |

**背压**：consumer lag 超阈值 → ingest 返回 `503` + `Retry-After`；NiFi 同款思路。

---

## 6. 存储

| 层 | 技术 | 用途 |
|----|------|------|
| 热记录 | **Postgres 16**（分区表 `records` by `source_id` 或按月） | 事务、索引、导出 |
| 队列 | **Redis Streams** 起步 → **NATS JetStream** 可选 | 运维简单 vs 企业持久化 |
| 分析冷存 | ClickHouse / Parquet 归档（P2） | 群聊全量回放、quant |
| 控制元数据 | Postgres `sources` / `schedules` / `coverage` | admin-api 独占 |

**废弃默认**：SQLite 作为 records 主库（仅 dev profile 保留）。

---

## 7. 与现 opencli-admin 的迁移策略

### Phase 0 — 契约 + 空壳（本周）

- [x] `odp-rs/` workspace：`odp-contracts`, `odp-ingest`（health + ingest stub）
- [x] JSON Schema 发布到 `contracts/record_v2.schema.json`
- [x] docker-compose `profile: odp` 加 `odp-ingest` + `redis` + `postgres`

### Phase 1 — 热路径切流（2–3 周）

- [x] `odp-bus` Redis Streams + `odp-ingest` 入队 `odp.ingest.raw`
- [x] `odp-store` 批量写 Postgres + `odp.record.committed`
- [x] Python pipeline `storer` → `ODP_INGEST_URL` 转发（SQLite 暂留 AI/notify）
- [ ] `odp-egress` webhook + ACK 表
- [ ] 关闭 pipeline 内同步 AI/notify（改异步 consumer）

### Phase 2 — Stream + 调度（2–4 周）

- [ ] `odp-scheduler` 替代 60s Python loop（毫秒级 due 扫描）
- [ ] 第一个 `stream-listener` 试点（QQ 或 TG）
- [ ] `collector-fast` Rust 接管 RSS/API channel

### Phase 3 — 企业化（持续）

- [ ] 读写在 `odp-query` 分离；可选 replicas
- [ ] metrics（Prometheus）：ingest rate, lag, egress success, chrome slot util
- [ ] 水平扩：`odp-ingest` / `odp-store` / `odp-egress` 无状态多副本

### 保持不动（解耦）

- Frontend、agent-1 Chrome 侧car、OhMyOpenCLI、opencli L0

---

## 8. 借鉴矩阵（企业级 ODP，非舆情）

| 项目 | 借什么 | 不借什么 |
|------|--------|----------|
| OpenBB ODP | Provider/TET、Data 模型、coverage | 金融 API 假设 |
| Airbyte | workload 分离、connector 健康 | K8s 全家桶默认 |
| NiFi | backpressure、provenance | 重型 UI flow |
| Kafka Connect | source/sink 边界 | 过重运维（除非量到了） |
| Meltano | cursor/state | 批处理-only |

---

## 9. 观测与验收（先性能，后安全）

| 指标 | 验收 |
|------|------|
| ingest sustained | ≥ 500 evt/s @ 1k payload bytes，CPU < 70% |
| duplicate rate | 幂等重放 0 重复行 |
| chrome 路径 | 与现网一致，不拖慢 ingest |
| egress | 下游 5xx 自动重试，DLQ 可重放 |
| 解耦 | `kill odp-ingest` 后 collector 只堆积 bus，不丢（持久队列） |

---

## 10. 仓库布局（新增）

```
opencli-admin/
  backend/              # 控制面 + opencli collector（逐步瘦身）
  frontend/
  odp-rs/                 # Rust workspace（热路径）
    Cargo.toml
    crates/
      odp-contracts/
      odp-ingest/
      odp-store/          # Phase 1
      odp-egress/         # Phase 1
      odp-scheduler/      # Phase 2
  contracts/
    record_v2.schema.json
  docs/
    PLAN_odp_enterprise.md  # 本文件
```

---

## 11. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06-18 | 初稿：企业级吞吐目标、Rust 热路径、强制解耦、分阶段迁移 |