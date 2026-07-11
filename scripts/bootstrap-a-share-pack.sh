#!/usr/bin/env bash
set -euo pipefail

# Node-aware A-share collection pack bootstrap for OpenCLI Admin.
#
# Optional:
#   OPENCLI_ADMIN_API=http://localhost:8031/api/v1
#   A_SHARE_PACK_FILE=configs/a-share-quant-pack.json
#   A_SHARE_CREATE_SCHEDULES=1
#   A_SHARE_TRIGGER_SMOKE=1
#   A_SHARE_BINDING_XUEQIU_ENDPOINT=http://agent-or-cdp-endpoint
#   A_SHARE_BINDING_EASTMONEY_ENDPOINT=http://agent-or-cdp-endpoint

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export A_SHARE_PACK_FILE="${A_SHARE_PACK_FILE:-$REPO_DIR/configs/a-share-quant-pack.json}"

python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request


API = os.environ.get("OPENCLI_ADMIN_API", "http://localhost:8031/api/v1").rstrip("/")
PACK_FILE = os.environ["A_SHARE_PACK_FILE"]
CREATE_SCHEDULES = os.environ.get("A_SHARE_CREATE_SCHEDULES", "1") == "1"
TRIGGER_SMOKE = os.environ.get("A_SHARE_TRIGGER_SMOKE", "0") == "1"


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


def list_paged(path: str, key: str = "name") -> dict[str, dict]:
    result: dict[str, dict] = {}
    page = 1
    while True:
        parsed = request("GET", f"{path}?page={page}&limit=100")
        for item in parsed.get("data") or []:
            result[item[key]] = item
        meta = parsed.get("meta") or {}
        if page >= int(meta.get("pages") or 1):
            break
        page += 1
    return result


def list_unpaged(path: str, key: str = "name") -> dict[str, dict]:
    parsed = request("GET", path)
    return {item[key]: item for item in parsed.get("data") or []}


def upsert_source(existing: dict[str, dict], source_def: dict) -> dict:
    body = {
        "name": source_def["name"],
        "description": source_def.get("description"),
        "channel_type": source_def["channel_type"],
        "channel_config": source_def["channel_config"],
        "enabled": source_def.get("enabled", True),
        "tags": source_def.get("tags", []),
        "ai_config": source_def.get("ai_config"),
    }
    old = existing.get(body["name"])
    if old:
        item = request("PATCH", f"/sources/{old['id']}", body)["data"]
        print(f"updated source: {body['name']}")
    else:
        item = request("POST", "/sources", body)["data"]
        print(f"created source: {body['name']}")
    existing[body["name"]] = item
    return item


def upsert_schedule(existing: dict[str, dict], source: dict, agent: dict | None, schedule_def: dict) -> dict:
    body = {
        "source_id": source["id"],
        "name": schedule_def["name"],
        "cron_expression": schedule_def["cron_expression"],
        "timezone": schedule_def.get("timezone", "Asia/Shanghai"),
        "parameters": schedule_def.get("parameters", {}),
        "enabled": schedule_def.get("enabled", True),
        "is_one_time": schedule_def.get("is_one_time", False),
        "agent_id": agent["id"] if agent else None,
    }
    old = existing.get(body["name"])
    if old:
        item = request("PATCH", f"/schedules/{old['id']}", body)["data"]
        print(f"updated schedule: {body['name']}")
    else:
        item = request("POST", "/schedules", body)["data"]
        print(f"created schedule: {body['name']}")
    existing[body["name"]] = item
    return item


def sync_bindings(pack: dict) -> None:
    bindings = list_unpaged("/browsers/bindings", key="site")
    for binding_def in pack.get("bindings", []):
        endpoint = os.environ.get(binding_def.get("browser_endpoint_env", ""), "").strip()
        if not endpoint:
            print(f"skipped binding: {binding_def['site']} (env not set)")
            continue
        desired = {
            "browser_endpoint": endpoint.rstrip("/"),
            "site": binding_def["site"],
            "notes": binding_def.get("notes", ""),
        }
        old = bindings.get(desired["site"])
        if old and old.get("browser_endpoint") == desired["browser_endpoint"]:
            print(f"kept binding: {desired['site']} -> {desired['browser_endpoint']}")
            continue
        if old:
            request("DELETE", f"/browsers/bindings/{old['id']}")
            print(f"deleted stale binding: {desired['site']}")
        item = request("POST", "/browsers/bindings", desired)["data"]
        bindings[desired["site"]] = item
        print(f"created binding: {desired['site']} -> {desired['browser_endpoint']}")


def trigger_smoke(pack: dict, sources: dict[str, dict], agents: dict[str, dict]) -> None:
    for task in pack.get("immediate_tasks", []):
        if not task.get("enabled_by_default") and not TRIGGER_SMOKE:
            continue
        source = sources.get(task["source"])
        if not source:
            print(f"skipped smoke task: missing source {task['source']}")
            continue
        agent = agents.get(task.get("agent", ""))
        body = {
            "source_id": source["id"],
            "parameters": task.get("parameters", {}),
            "priority": task.get("priority", 5),
            "agent_id": agent["id"] if agent else None,
        }
        result = request("POST", "/tasks/trigger", body)["data"]
        print(f"triggered smoke task: {task['source']} -> {result}")


def main() -> int:
    with open(PACK_FILE, "r", encoding="utf-8") as f:
        pack = json.load(f)

    agents = list_unpaged("/agents", key="name")
    sources = list_paged("/sources", key="name")
    schedules = list_paged("/schedules", key="name")

    for source_def in pack.get("sources", []):
        source = upsert_source(sources, source_def)
        agent = agents.get(source_def.get("ai_agent", ""))
        if source_def.get("ai_agent") and not agent:
            print(f"warning: missing AI agent {source_def['ai_agent']!r} for {source_def['name']}")
        if CREATE_SCHEDULES:
            for schedule_def in source_def.get("schedules", []):
                upsert_schedule(schedules, source, agent, schedule_def)

    sync_bindings(pack)
    trigger_smoke(pack, sources, agents)

    print(
        "A-share collection pack ready: "
        f"sources={len(pack.get('sources', []))} "
        f"schedules={'enabled' if CREATE_SCHEDULES else 'skipped'}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"bootstrap failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
PY
