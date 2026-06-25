# III control plane (M0 + M1 + M2 + M3)

III replaces opencli-admin's internal orchestration for ODP collection. Rust `odp-ingest` remains the data-plane hot path.

| Milestone | Worker | Functions |
|-----------|--------|-----------|
| M0 | `odp-ingest-bridge` | `odp.ingest::batch`, `odp.ingest::single`, `odp.ingest::health` |
| M1 | `collector-discord` | `odp.collect::discord_snapshot`, `discord::status`, `discord::guilds`, `discord::channels` |
| M2 | `schedule-bootstrap` | `odp.schedule::bootstrap`, `odp.schedule::list`, `odp.schedule::reload` + per-schedule cron wrappers |
| M3 | `collector-opencli` | `odp.collect::opencli_snapshot`, `opencli::status` (B站/小红书/Twitter 等) |

## Architecture

```
III engine (:49134 WS, :3111 HTTP)
  ├── iii-cron (engine module)
  ├── odp-ingest-bridge  →  POST /v1/ingest/batch
  ├── schedule-bootstrap →  cron → odp.schedule::{discord,opencli}/*
  ├── collector-discord  →  discord-cli (PC 边缘)
  └── collector-opencli  →  opencli + agent-1 Bridge (NAS)
                                    ↓
                            Rust odp-ingest (:8040)
                                    ↓
                            Redis odp.ingest.raw → odp-store → Postgres
```

Record v2 idempotency key: `(source_id, event_id)` where Discord `event_id = msg_id`.

## Prerequisites

- `iii` CLI — `C:\Users\Administrator\.local\iii\iii.exe` (0.19.4+)
- `pip install iii-sdk==0.19.4 httpx pyyaml`
- `discord` CLI authenticated (`discord status --json`)
- `DISCORD_TOKEN` in environment or `~/.env` (loaded by `start-local.ps1`)
- Rust `odp-ingest` built: `cd odp-rs && cargo build --release -p odp-ingest`

> **Windows note:** `iii worker add` is unavailable on Windows (no `iii-worker` binary). Run workers with `python workers/.../src/main.py` instead.

## M2 — Scheduled Discord collection

Edit `schedules/discord.yaml`:

```yaml
schedules:
  - id: test-channel
    enabled: true
    channel_id: "195654289811570688"
    limit: 20
    expression: "0 */5 * * * *"   # every 5 minutes (6-field cron)
```

`schedule-bootstrap` registers one cron trigger per enabled schedule. On each tick it calls `odp.collect::discord_snapshot` with `task_id=schedule:{id}`.

Cron format (III `iii-cron`): 6-field `second minute hour day month weekday`.

| Expression | Meaning |
|------------|---------|
| `0 */5 * * * *` | Every 5 minutes |
| `0 0 * * * *` | Every hour |
| `*/30 * * * * *` | Every 30 seconds (dev smoke only) |

Manual schedule ops:

```powershell
~\.local\iii\iii.exe trigger odp.schedule::list
~\.local\iii\iii.exe trigger odp.schedule::reload
~\.local\iii\iii.exe trigger odp.schedule::bootstrap
```

## Local smoke (Windows)

```powershell
cd opencli-admin\iii

# Terminal 1 — engine (includes iii-cron)
~\.local\iii\iii.exe --config config.yaml

# Terminal 2 — ingest (no Redis = in-memory accept only)
$env:ODP_INGEST_URL = "http://127.0.0.1:8040"
..\odp-rs\target\release\odp-ingest.exe

# Terminal 3 — bridge
$env:III_URL = "ws://127.0.0.1:49134"
$env:ODP_INGEST_URL = "http://127.0.0.1:8040"
python workers\odp-ingest-bridge\src\main.py

# Terminal 4 — discord collector
$env:III_URL = "ws://127.0.0.1:49134"
$env:DISCORD_CLI_BIN = "discord"
python workers\collector-discord\src\main.py

# Terminal 5 — schedule bootstrap (registers cron on start)
$env:III_URL = "ws://127.0.0.1:49134"
python workers\schedule-bootstrap\src\main.py
```

Or use the helper scripts (loads `~/.env` / repo `.env` into workers):

```powershell
.\scripts\start-local.ps1 -ChannelId 195654289811570688
.\scripts\restart-workers.ps1 -ReloadSchedules        # local full stack (dev)
.\scripts\restart-workers.ps1 -NasEdge                # PC edge → NAS engine (production)
.\scripts\start-edge-workers.ps1                      # same as -NasEdge
.\scripts\stop-workers.ps1                            # stop Python workers on this PC
```

NAS health checks use `iii trigger --address 192.168.50.130` (not `III_URL`).

> **Runs on your machine:** `start-local.ps1` / `restart-workers.ps1` spawn background
> `python` workers locally. Cron ticks only fire while III engine + workers are running.
> Data stays in-memory until Redis/Postgres (`docker compose --profile odp`).

Trigger functions:

```powershell
~\.local\iii\iii.exe trigger odp.ingest::health
~\.local\iii\iii.exe trigger discord::status
~\.local\iii\iii.exe trigger odp.collect::discord_snapshot channel_id=<DISCORD_CHANNEL_ID> limit=20
~\.local\iii\iii.exe trigger odp.schedule::list
```

## NAS 部署 (`192.168.50.130`) — 推荐

NAS 跑 **平台**（UI + API + agent-1 + ODP + III + opencli 采集）；PC 可选跑 **Discord 边缘**。

```bash
cd /volume1/docker/opencli-admin
cp .env.nas.example .env   # 改 POSTGRES_PASSWORD / SECRET_KEY
./iii/scripts/deploy-nas.sh
```

等价命令：

```bash
docker compose --profile nas up -d --build
```

`.env` 关键项：

| 变量 | NAS 值 |
|------|--------|
| `COLLECTION_ORCHESTRATOR` | `iii`（关闭 API 内置 scheduler） |
| `ODP_INGEST_URL` | `http://odp-ingest:8040` |
| `DATABASE_URL` | `postgresql+asyncpg://...@postgres:5432/...` |

定时任务编辑 `iii/schedules/opencli.yaml`（B站/小红书/Twitter）和 `iii/schedules/discord.yaml`（Discord 在 PC 跑时可留空或禁用）。

PC 边缘（Discord）：

```powershell
$env:III_URL = "ws://192.168.50.130:49134"
$env:ODP_INGEST_URL = "http://192.168.50.130:8040"
python workers\collector-discord\src\main.py
```

本地开发（全栈 Windows）仍可用 `--profile odp --profile iii` 或 `start-local.ps1`。

## Function reference

### `odp.collect::discord_snapshot`

| Field | Required | Description |
|-------|----------|-------------|
| `channel_id` | yes | Discord channel snowflake |
| `limit` | no | Recent messages cap (default 50) |
| `source_id` | no | Explicit UUID; else UUID5 from channel_id |
| `task_id` / `trace_id` | no | Auto-generated if omitted |
| `schedule_id` | no | Set by M2 cron wrapper |
| `channel_name` | no* | `discord recent -c` filter; from YAML or stats cache |

\*Required in `discord.yaml` for production schedules (see `.example`).

Flow: `dc sync CHANNEL_ID` → `recent -c CHANNEL_NAME -n N` → `odp.ingest::batch`.

### `odp.collect::opencli_snapshot`

| Field | Required | Description |
|-------|----------|-------------|
| `site` | yes | e.g. `bilibili`, `xiaohongshu`, `twitter` |
| `command` | yes | e.g. `hot`, `timeline`, `search` |
| `args` | no | CLI `--key value` map |
| `format` | no | Default `json` |
| `mode` | no | `bridge` (NAS default) or `cdp` |

Flow: `opencli <site> <command>` via agent-1 Bridge → `odp.ingest::batch`.

### `odp.ingest::batch`

| Field | Required | Description |
|-------|----------|-------------|
| `events` | yes | Array of Record v2 objects |
| `trace_id` / `task_id` | no | Applied to events missing these fields |

## Shared library

`iii/lib/` — `odp_record.py`, `discord_cli.py`, `schedules.py`
