# ODP Rust — 热路径服务

企业级 ingest / store / egress 的 Rust 实现，与 Python `backend/` 控制面解耦。

## 构建

```bash
cd odp-rs
cargo build --release
```

## 运行 ingest（Phase 0）

```bash
ODP_REDIS_URL=redis://127.0.0.1:6379/2 ODP_INGEST_PORT=8040 ./target/release/odp-ingest

# Store writer (needs Postgres)
ODP_REDIS_URL=redis://127.0.0.1:6379/2 \
ODP_DATABASE_URL=postgresql://opencli:opencli_secret@127.0.0.1:5432/opencli_admin \
./target/release/odp-store

# Docker stack
docker compose --profile odp up -d redis postgres odp-ingest odp-store
```

```bash
curl -s http://127.0.0.1:8040/health
curl -s -X POST http://127.0.0.1:8040/v1/ingest/batch \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"schema_version":1,"provider":"test/ping","source_id":"550e8400-e29b-41d4-a716-446655440000","event_id":"e1","ingest_mode":"stream","source_ts":"2026-06-18T12:00:00Z","payload":{"content":"hi"}}]}'
```

## 架构

见 [docs/PLAN_odp_enterprise.md](../docs/PLAN_odp_enterprise.md)。