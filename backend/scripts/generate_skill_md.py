"""Generate ``backend/skills/agent_access/SKILL.md`` — PR-H (GOAL-5.md).

架构决策 #9: SKILL.md is not hand-written. It is produced by this script from
two sources of truth and nothing else:

1. ``backend.taxonomy.TOP_LEVEL_CATEGORIES`` — the closed category set
   (imported, never re-typed as a literal list here).
2. The actual ``APIRouter`` objects defined in ``backend/api/public/{items,
   rss,daily}.py`` — introspected via FastAPI's ``route.dependant`` (query
   params + path params, including each one's live description/default), so
   this doc can never silently drift from what the real endpoints accept.

Usage (either invocation form works — both resolve paths relative to this
file, not the process's current working directory):

    uv run python backend/scripts/generate_skill_md.py            # (re)write the committed file
    uv run python backend/scripts/generate_skill_md.py --check     # exit 1 + diff if stale
    uv run python backend/scripts/generate_skill_md.py --stdout    # print without writing

CI: a "when will this go red" note — any change to ``TOP_LEVEL_CATEGORIES``,
or to a query/path parameter's name, default, or ``description=...`` text on
any ``/api/public/*`` route, changes this script's output. Whoever makes that
change must re-run the script and commit the regenerated
``backend/skills/agent_access/SKILL.md`` alongside it, or the drift check
(``tests/skills/test_skill_md_drift.py``, and the CI step described in
``.github/workflows/ci.yml``) fails the build.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

# --- Make `backend.*` importable regardless of invocation cwd -------------
# Works whether this file is run directly (`python backend/scripts/...py`,
# which puts *this file's* directory on sys.path, not the repo root), via
# `python -m backend.scripts.generate_skill_md`, or imported by pytest.
_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPT_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from pydantic_core import PydanticUndefined  # noqa: E402

from backend.api.public.daily import dailies_router as _dailies_router  # noqa: E402
from backend.api.public.daily import router as _daily_router  # noqa: E402
from backend.api.public.items import router as _items_router  # noqa: E402
from backend.api.public.rss import router as _rss_router  # noqa: E402
from backend.taxonomy import TOP_LEVEL_CATEGORIES  # noqa: E402

PUBLIC_PREFIX = "/api/public"
OUTPUT_PATH = _BACKEND_DIR / "skills" / "agent_access" / "SKILL.md"

# Path-param descriptions FastAPI has no `description=...` for (plain
# `date_type` path converters don't carry one). This is prose about a
# parameter's *format*, not a duplicate of any source-of-truth data list —
# the taxonomy import above remains the only place category names live.
_PATH_PARAM_NOTES = {
    "digest_date": "ISO-8601 calendar date, e.g. `2026-07-08` (format: YYYY-MM-DD).",
}


@dataclass(frozen=True)
class ParamInfo:
    name: str
    kind: str  # "query" | "path"
    default: object
    description: str | None

    @property
    def required(self) -> bool:
        return self.default is PydanticUndefined

    def render(self) -> str:
        if self.required:
            note = "required"
        elif self.default is None:
            note = "optional"
        else:
            note = f"optional, default `{self.default}`"
        desc = self.description or _PATH_PARAM_NOTES.get(self.name) or "(no description)"
        return f"- `{self.name}` ({self.kind} param, {note}): {desc}"


@dataclass(frozen=True)
class EndpointInfo:
    method: str
    path: str  # already includes the sub-router's own prefix, e.g. "/items"
    params: tuple[ParamInfo, ...]

    @property
    def full_path(self) -> str:
        return f"{PUBLIC_PREFIX}{self.path}"

    def render(self) -> str:
        lines = [f"### `{self.method} {self.full_path}`"]
        if self.params:
            lines.extend(p.render() for p in self.params)
        else:
            lines.append("- (no parameters)")
        return "\n".join(lines)


def _endpoints_from_router(router) -> list[EndpointInfo]:
    """Introspect one APIRouter's routes into EndpointInfo records, in the
    router's own route-declaration order (deterministic — FastAPI preserves
    the order routes were added in, which is the order they appear in the
    source file)."""
    endpoints: list[EndpointInfo] = []
    for route in router.routes:
        methods = sorted(route.methods or ())
        params: list[ParamInfo] = []
        for pp in route.dependant.path_params:
            params.append(
                ParamInfo(
                    name=pp.name,
                    kind="path",
                    default=pp.default,
                    description=pp.field_info.description,
                )
            )
        for qp in route.dependant.query_params:
            params.append(
                ParamInfo(
                    name=qp.name,
                    kind="query",
                    default=qp.default,
                    description=qp.field_info.description,
                )
            )
        for method in methods:
            endpoints.append(EndpointInfo(method=method, path=route.path, params=tuple(params)))
    return endpoints


def collect_endpoints() -> list[EndpointInfo]:
    """All public endpoints, in a fixed PR-E -> PR-F -> PR-G order (not
    dependent on dict/set iteration — each router's own .routes list order is
    used, and the four routers are visited in this explicit sequence)."""
    endpoints: list[EndpointInfo] = []
    endpoints += _endpoints_from_router(_items_router)
    endpoints += _endpoints_from_router(_rss_router)
    endpoints += _endpoints_from_router(_daily_router)
    endpoints += _endpoints_from_router(_dailies_router)
    return endpoints


def load_categories() -> tuple[str, ...]:
    """The single source of truth for category names — never re-typed as a
    literal list anywhere in this script or its generated output."""
    return TOP_LEVEL_CATEGORIES


_ITEMS_EP = "`GET /api/public/items`"


def _intent_table_rows(categories: tuple[str, ...]) -> str:
    rows: list[tuple[str, str, str]] = [
        ("给我人工精选内容 / curated highlights only", _ITEMS_EP, "`mode=selected` (default)"),
        (
            "给我全部内容,不只是精选 / everything, not just curated",
            _ITEMS_EP,
            "`mode=all`",
        ),
    ]
    for category in categories:
        intent = f'只看「{category}」分类 / only the "{category}" category'
        rows.append((intent, _ITEMS_EP, f"`category={category}`"))
    rows.extend(
        [
            (
                "只看某个时间点之后的内容 / only content since a point in time",
                _ITEMS_EP,
                "`since=<ISO-8601 datetime>`",
            ),
            ("关键词搜索 / keyword search", _ITEMS_EP, "`q=<keyword>`"),
            (
                "限制返回条数 / cap the number of results",
                _ITEMS_EP,
                "`take=<n>` (default 50, hard cap 200)",
            ),
            (
                "我要一个可持续订阅的信息流 / give me a subscribable live feed",
                "`GET /api/public/rss`",
                "same params as `/api/public/items` above; response is Atom XML",
            ),
            (
                "今天的日报/摘要 / today's daily digest",
                "`GET /api/public/daily`",
                "(no params — latest built digest)",
            ),
            (
                "某一天的历史日报 / a specific past day's digest",
                "`GET /api/public/daily/{digest_date}`",
                "`digest_date=YYYY-MM-DD`",
            ),
            (
                "最近几天的日报列表 / list of recent digest dates",
                "`GET /api/public/dailies`",
                "`take=<n>` (default 30)",
            ),
        ]
    )
    header = "| Query intent | Endpoint | Suggested params |\n|---|---|---|"
    body = "\n".join(f"| {intent} | {endpoint} | {params} |" for intent, endpoint, params in rows)
    return f"{header}\n{body}"


_SKILL_DESCRIPTION = (
    "Query opencli-admin's public content (curated + all, filterable by "
    "category/time/keyword) via REST, Atom/RSS, or daily-digest endpoints "
    "— no auth, no API key, IP rate-limited."
)


def render_skill_md(categories: tuple[str, ...], endpoints: list[EndpointInfo]) -> str:
    category_list = "\n".join(f"- `{c}`" for c in categories)
    endpoint_sections = "\n\n".join(e.render() for e in endpoints)

    return f"""---
name: opencli-admin-agent-access
description: {_SKILL_DESCRIPTION}
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
  recent dates) — `GET /api/public/daily`, `/api/public/daily/{{digest_date}}`,
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

{category_list}

Passing any other value returns `400` with the valid-value list.

## Intent routing table

Map a natural-language query intent to the endpoint + params to call:

{_intent_table_rows(categories)}

## Endpoint reference

Introspected directly from the live FastAPI route definitions — param
defaults/descriptions below are the actual ones enforced by the API, not a
paraphrase.

{endpoint_sections}

## Rate limiting

Every `/api/public/*` route is IP rate-limited (in-memory token bucket, 60
requests/minute/IP by default). Exceeding it returns `429` with a
`Retry-After` header (seconds); back off and retry after that many seconds.

## Usage examples

```bash
# Curated items in one category, newest first, capped at 20
curl "<BASE_URL>/api/public/items?mode=selected&category={categories[0]}&take=20"

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
  in the standard `{{"success": true, "data": ...}}` envelope
  (`backend.schemas.common.ApiResponse`); list endpoints put an array under
  `data`, single-digest endpoints put an object under `data`.
- `GET /api/public/rss` returns `application/atom+xml` (Atom, not RSS 2.0 —
  the path segment says "rss" for parity with the AIHOT reference, but the
  wire format is Atom per GOAL-5.md 架构决策 #8). On any internal failure it
  still returns `200` with a valid, empty feed shell rather than a `500`.
- Every item, wherever it appears (items/rss/daily), has the same shape:
  `id`, `title`, `url`, `summary`, `source_name`, `published_at` (nullable),
  `category` (nullable), `subtags` (list).
"""


def _write(content: str) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(content, encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--check",
        action="store_true",
        help="Don't write; exit 1 (and print a diff) if generated output != committed file.",
    )
    mode.add_argument(
        "--stdout",
        action="store_true",
        help="Print generated content to stdout instead of writing it.",
    )
    args = parser.parse_args(argv)

    content = render_skill_md(load_categories(), collect_endpoints())

    if args.stdout:
        print(content, end="")
        return 0

    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"DRIFT: {OUTPUT_PATH} does not exist yet.", file=sys.stderr)
            return 1
        committed = OUTPUT_PATH.read_text(encoding="utf-8")
        if committed != content:
            import difflib

            diff = "".join(
                difflib.unified_diff(
                    committed.splitlines(keepends=True),
                    content.splitlines(keepends=True),
                    fromfile=str(OUTPUT_PATH),
                    tofile="<regenerated>",
                )
            )
            print("DRIFT DETECTED — committed SKILL.md is stale:\n" + diff, file=sys.stderr)
            print(
                "Fix: uv run python backend/scripts/generate_skill_md.py  (then commit the file)",
                file=sys.stderr,
            )
            return 1
        print(f"OK: {OUTPUT_PATH} matches the generator output.")
        return 0

    _write(content)
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
