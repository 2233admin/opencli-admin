---
name: opencli-admin-agent-access
description: Query opencli-admin's public content (curated + all, filterable by category/time/keyword) via REST, Atom/RSS, or daily-digest endpoints — no auth, no API key, IP rate-limited.
---

# opencli-admin — Agent Access Skill

This skill lets an AI agent read **publicly exposed** content collected and
curated by opencli-admin, without authentication. It mirrors the
"Skill / RSS / REST, anonymous, intent-routed" pattern used by
https://aihot.virxact.com/agent, adapted to opencli-admin's own taxonomy and
routes.

**This file is generated — do not hand-edit it.** It is produced by
`backend/scripts/generate_skill_md.py` from `backend/taxonomy.py` (the
closed category set) and the live route definitions under
`backend/api/public/` (PR-E `items.py`, PR-F `rss.py`, PR-G `daily.py`). A CI
check re-runs the generator and fails the build if this file is out of date
— see that script's module docstring for exactly which changes trigger it.

## What this skill lets an agent do

- List public content items, optionally filtered by curation mode, top-level
  category, a time lower bound, or a keyword — `GET /api/public/items`.
- Subscribe to the same filtered result set as an Atom feed —
  `GET /api/public/rss`.
- Read daily digest snapshots (today's, a specific past date, or a list of
  recent dates) — `GET /api/public/daily`, `/api/public/daily/{digest_date}`,
  `/api/public/dailies`.

All three surfaces are read-only, anonymous (no token/API key), and share one
underlying filter (a record is only ever visible here if its source has been
explicitly marked public). Every response field is drawn from an explicit
whitelist (`id/title/url/summary/source_name/published_at/category/subtags`)
— internal fields (`raw_data`, `normalized_data`, source configuration) are
never exposed.

## Base URL

Replace `<BASE_URL>` in every example below with this deployment's actual
origin (deployment target is not yet fixed — see GOAL-5.md's 坐标 section).

## Categories (closed set, from `backend/taxonomy.py`)

Every `category` filter value must be exactly one of:

- `模型能力`
- `产品动态`
- `行业资讯`
- `研究论文`
- `工程实践`
- `其它`

Passing any other value returns `400` with the valid-value list.

## Intent routing table

Map a natural-language query intent to the endpoint + params to call:

| Query intent | Endpoint | Suggested params |
|---|---|---|
| 给我人工精选内容 / curated highlights only | `GET /api/public/items` | `mode=selected` (default) |
| 给我全部内容,不只是精选 / everything, not just curated | `GET /api/public/items` | `mode=all` |
| 只看「模型能力」分类 / only the "模型能力" category | `GET /api/public/items` | `category=模型能力` |
| 只看「产品动态」分类 / only the "产品动态" category | `GET /api/public/items` | `category=产品动态` |
| 只看「行业资讯」分类 / only the "行业资讯" category | `GET /api/public/items` | `category=行业资讯` |
| 只看「研究论文」分类 / only the "研究论文" category | `GET /api/public/items` | `category=研究论文` |
| 只看「工程实践」分类 / only the "工程实践" category | `GET /api/public/items` | `category=工程实践` |
| 只看「其它」分类 / only the "其它" category | `GET /api/public/items` | `category=其它` |
| 只看某个时间点之后的内容 / only content since a point in time | `GET /api/public/items` | `since=<ISO-8601 datetime>` |
| 关键词搜索 / keyword search | `GET /api/public/items` | `q=<keyword>` |
| 限制返回条数 / cap the number of results | `GET /api/public/items` | `take=<n>` (default 50, hard cap 200) |
| 我要一个可持续订阅的信息流 / give me a subscribable live feed | `GET /api/public/rss` | same params as `/api/public/items` above; response is Atom XML |
| 今天的日报/摘要 / today's daily digest | `GET /api/public/daily` | (no params — latest built digest) |
| 某一天的历史日报 / a specific past day's digest | `GET /api/public/daily/{digest_date}` | `digest_date=YYYY-MM-DD` |
| 最近几天的日报列表 / list of recent digest dates | `GET /api/public/dailies` | `take=<n>` (default 30) |

## Endpoint reference

Introspected directly from the live FastAPI route definitions — param
defaults/descriptions below are the actual ones enforced by the API, not a
paraphrase.

### `GET /api/public/items`
- `mode` (query param, optional, default `selected`): 'selected' (curated only) or 'all'
- `category` (query param, optional): Top-level taxonomy category name
- `since` (query param, optional): ISO-8601 lower bound on ingestion time
- `q` (query param, optional): Case-insensitive keyword search
- `take` (query param, optional): Max rows (default 50, hard cap 200)

### `GET /api/public/rss`
- `mode` (query param, optional, default `selected`): 'selected' (curated only) or 'all'
- `category` (query param, optional): Top-level taxonomy category name
- `since` (query param, optional): ISO-8601 lower bound on ingestion time
- `q` (query param, optional): Case-insensitive keyword search
- `take` (query param, optional): Max rows (default 50, hard cap 200)

### `GET /api/public/daily`
- (no parameters)

### `GET /api/public/daily/{digest_date}`
- `digest_date` (path param, required): ISO-8601 calendar date, e.g. `2026-07-08` (format: YYYY-MM-DD).

### `GET /api/public/dailies`
- `take` (query param, optional, default `30`): Max number of digest dates to return (most recent first)

## Rate limiting

Every `/api/public/*` route is IP rate-limited (in-memory token bucket, 60
requests/minute/IP by default). Exceeding it returns `429` with a
`Retry-After` header (seconds); back off and retry after that many seconds.

## Usage examples

```bash
# Curated items in one category, newest first, capped at 20
curl "<BASE_URL>/api/public/items?mode=selected&category=模型能力&take=20"

# Everything (not just curated) matching a keyword
curl "<BASE_URL>/api/public/items?mode=all&q=<keyword>"

# Subscribe as an Atom feed
curl "<BASE_URL>/api/public/rss?mode=selected" -o feed.xml

# Today's (or most recently built) daily digest
curl "<BASE_URL>/api/public/daily"

# A specific past day's digest
curl "<BASE_URL>/api/public/daily/2026-07-08"

# Recent digest dates
curl "<BASE_URL>/api/public/dailies?take=10"
```

## Response shapes

- `GET /api/public/items` and `GET /api/public/daily*` responses are wrapped
  in the standard `{"success": true, "data": ...}` envelope
  (`backend.schemas.common.ApiResponse`); list endpoints put an array under
  `data`, single-digest endpoints put an object under `data`.
- `GET /api/public/rss` returns `application/atom+xml` (Atom, not RSS 2.0 —
  the path segment says "rss" for parity with the AIHOT reference, but the
  wire format is Atom per GOAL-5.md 架构决策 #8). On any internal failure it
  still returns `200` with a valid, empty feed shell rather than a `500`.
- Every item, wherever it appears (items/rss/daily), has the same shape:
  `id`, `title`, `url`, `summary`, `source_name`, `published_at` (nullable),
  `category` (nullable), `subtags` (list).
