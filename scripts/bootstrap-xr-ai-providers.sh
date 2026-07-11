#!/usr/bin/env bash
set -euo pipefail

# Bootstrap OpenCLI Admin model providers/AI agents for the XR Hermes routing stack.
#
# Required for cloud providers:
#   MINIMAX_CN_API_KEY
#   STEPFUN_API_KEY
#
# Optional:
#   OPENCLI_ADMIN_API=http://localhost:8031/api/v1
#   MINIMAX_CN_BASE_URL=https://api.minimaxi.com/anthropic
#   STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
#   XR_OLLAMA_BASE_URL=http://127.0.0.1:11434
#   XR_OLLAMA_MODEL=gemma4-coder:12b-q4-64k

python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request


API = os.environ.get("OPENCLI_ADMIN_API", "http://localhost:8031/api/v1").rstrip("/")


def request(method: str, path: str, payload: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
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
    return parsed.get("data")


def list_by_name(path: str) -> dict[str, dict]:
    items = request("GET", path) or []
    return {item["name"]: item for item in items}


def without_empty_secret(payload: dict) -> dict:
    clean = dict(payload)
    if not clean.get("api_key"):
        clean.pop("api_key", None)
    return clean


def upsert_provider(existing: dict[str, dict], payload: dict) -> dict:
    name = payload["name"]
    old = existing.get(name)
    body = without_empty_secret(payload)
    if old:
        provider = request("PATCH", f"/providers/{old['id']}", body)
        print(f"updated provider: {name}")
    else:
        provider = request("POST", "/providers", payload)
        print(f"created provider: {name}")
    existing[name] = provider
    return provider


def upsert_agent(existing: dict[str, dict], payload: dict) -> dict:
    name = payload["name"]
    old = existing.get(name)
    if old:
        agent = request("PATCH", f"/agents/{old['id']}", payload)
        print(f"updated agent: {name}")
    else:
        agent = request("POST", "/agents", payload)
        print(f"created agent: {name}")
    existing[name] = agent
    return agent


def main() -> int:
    providers = list_by_name("/providers")
    agents = list_by_name("/agents")

    minimax = upsert_provider(
        providers,
        {
            "name": "XR MiniMax CN",
            "provider_type": "claude",
            "base_url": os.environ.get("MINIMAX_CN_BASE_URL", "https://api.minimaxi.com/anthropic"),
            "api_key": os.environ.get("MINIMAX_CN_API_KEY", ""),
            "default_model": os.environ.get("MINIMAX_CN_MODEL", "MiniMax-M3"),
            "notes": "XR cloud provider, Anthropic-compatible MiniMax endpoint.",
            "enabled": True,
        },
    )
    stepfun = upsert_provider(
        providers,
        {
            "name": "XR StepFun",
            "provider_type": "openai",
            "base_url": os.environ.get("STEPFUN_BASE_URL", "https://api.stepfun.com/step_plan/v1"),
            "api_key": os.environ.get("STEPFUN_API_KEY", ""),
            "default_model": os.environ.get("STEPFUN_MODEL", "step-3.7-flash"),
            "notes": "XR StepFun Step Plan endpoint.",
            "enabled": True,
        },
    )
    local = upsert_provider(
        providers,
        {
            "name": "XR Ollama Local",
            "provider_type": "local",
            "base_url": os.environ.get("XR_OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            "default_model": os.environ.get("XR_OLLAMA_MODEL", "gemma4-coder:12b-q4-64k"),
            "notes": "XR local Ollama provider for large or low-value batch processing.",
            "enabled": True,
        },
    )

    prompt = (
        "你是数据采集后的清洗和摘要助手。请从记录中提取标题、摘要、标签、风险和后续动作，"
        "优先输出 JSON。记录标题：{{title}}\n记录正文：{{content}}\n来源链接：{{url}}"
    )
    upsert_agent(
        agents,
        {
            "name": "XR Smart Default - MiniMax",
            "description": "Default high-value enrichment for collected records.",
            "processor_type": "claude",
            "model": minimax.get("default_model") or "MiniMax-M3",
            "prompt_template": prompt,
            "processor_config": {"max_tokens": 1200},
            "enabled": True,
            "provider_id": minimax["id"],
        },
    )
    upsert_agent(
        agents,
        {
            "name": "XR StepFun Planner",
            "description": "StepFun route for planning-style enrichment.",
            "processor_type": "openai",
            "model": stepfun.get("default_model") or "step-3.7-flash",
            "prompt_template": prompt,
            "processor_config": {"max_tokens": 1200},
            "enabled": True,
            "provider_id": stepfun["id"],
        },
    )
    upsert_agent(
        agents,
        {
            "name": "XR Local Bulk",
            "description": "Local Ollama route for large, cheap, or sensitive batch enrichment.",
            "processor_type": "local",
            "model": local.get("default_model") or "gemma4-coder:12b-q4-64k",
            "prompt_template": prompt,
            "processor_config": {"api_style": "openai", "timeout": 240},
            "enabled": True,
            "provider_id": local["id"],
        },
    )

    print("XR AI providers and agents are ready.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"bootstrap failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
PY
