#!/usr/bin/env bash
set -euo pipefail

# Upsert A-share quant data sources into OpenCLI Admin.
#
# Optional:
#   OPENCLI_ADMIN_API=http://localhost:8031/api/v1
#   A_SHARE_SOURCES_FILE=configs/a-share-quant-sources.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export A_SHARE_SOURCES_FILE="${A_SHARE_SOURCES_FILE:-$REPO_DIR/configs/a-share-quant-sources.json}"

python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


API = os.environ.get("OPENCLI_ADMIN_API", "http://localhost:8031/api/v1").rstrip("/")
SOURCES_FILE = os.environ["A_SHARE_SOURCES_FILE"]


def request(method: str, path: str, payload: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{API}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed: HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {path} failed: {exc.reason}") from exc
    parsed = json.loads(body)
    if not parsed.get("success"):
        raise RuntimeError(f"{method} {path} failed: {parsed.get('error')}")
    return parsed


def list_sources() -> dict[str, dict]:
    by_name: dict[str, dict] = {}
    page = 1
    while True:
        parsed = request("GET", f"/sources?page={page}&limit=100")
        for item in parsed.get("data") or []:
            by_name[item["name"]] = item
        meta = parsed.get("meta") or {}
        if page >= int(meta.get("pages") or 1):
            break
        page += 1
    return by_name


def main() -> int:
    with open(SOURCES_FILE, "r", encoding="utf-8") as f:
        desired = json.load(f)
    existing = list_sources()
    created = 0
    updated = 0
    for source in desired:
        old = existing.get(source["name"])
        if old:
            request("PATCH", f"/sources/{old['id']}", source)
            updated += 1
            print(f"updated source: {source['name']}")
        else:
            request("POST", "/sources", source)
            created += 1
            print(f"created source: {source['name']}")
    print(f"A-share sources ready: created={created} updated={updated} total={len(desired)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"bootstrap failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
PY
