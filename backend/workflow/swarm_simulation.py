"""Swarm-simulation Tool Capability with local and MiroFish providers.

The public workflow contract is owned by OpenCLI Admin. MiroFish is integrated
as a replaceable provider sidecar, which keeps its long-running Flask/OASIS/Zep
lifecycle out of the workflow compiler while preserving upstream run handles.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from typing import Any

SWARM_SIMULATION_EXECUTOR = "swarm_simulation"
SWARM_SIMULATION_TOOL_CAPABILITY_ID = "tool.simulation.swarm-forecast"
MIROFISH_ENDPOINT_ENV = "MIROFISH_URL"
MIROFISH_ALLOW_ENDPOINT_OVERRIDE_ENV = "MIROFISH_ALLOW_ENDPOINT_OVERRIDE"
MIROFISH_UPSTREAM_COMMIT = "96096ea0ff42b1a30cbc41a1560b8c91090f9968"


class SwarmSimulationExecutionError(RuntimeError):
    """Raised when a simulation provider cannot execute the requested operation."""


def execute_swarm_simulation(
    input_items: list[dict[str, Any]],
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute a local forecast simulation or one bounded MiroFish API operation."""

    config = params or {}
    provider = (_read_string(config.get("provider")) or "local").lower()
    if provider == "mirofish":
        return _execute_mirofish_operation(input_items, config)
    if provider != "local":
        raise SwarmSimulationExecutionError(f'Unsupported swarm provider "{provider}"')
    return _execute_local_simulation(input_items, config)


def _execute_local_simulation(
    input_items: list[dict[str, Any]],
    params: dict[str, Any],
) -> dict[str, Any]:
    seed = _simulation_seed(input_items, params)
    requirement = (
        _read_string(params.get("requirement"))
        or _read_string(seed.get("query"))
        or "推演该事态在不同群体中的传播、立场变化和可能结果"
    )
    rounds = _bounded_int(params.get("maxRounds"), default=8, minimum=1, maximum=80)
    agent_count = _bounded_int(params.get("agentCount"), default=12, minimum=3, maximum=200)
    platforms = _platforms(params.get("platforms") or params.get("platform"))
    run_key = hashlib.sha256(
        json.dumps(
            {
                "seed": seed,
                "requirement": requirement,
                "rounds": rounds,
                "agentCount": agent_count,
                "platforms": platforms,
            },
            sort_keys=True,
            ensure_ascii=False,
            default=str,
        ).encode()
    ).hexdigest()
    rng = random.Random(run_key)
    profiles = _build_profiles(seed, agent_count=agent_count, rng=rng)
    timeline = _run_rounds(
        profiles,
        seed=seed,
        rounds=rounds,
        platforms=platforms,
        rng=rng,
    )
    outcomes = _outcomes(profiles, timeline)
    generated_at = (
        _read_string(params.get("now"))
        or _read_string(seed.get("generatedAt"))
        or datetime.now(tz=UTC).isoformat()
    )
    result = {
        "schema": "swarm.forecast.v1",
        "source": "opencli-admin",
        "eventType": "swarm.simulation.completed",
        "status": "completed",
        "provider": {
            "id": "opencli-local",
            "mode": "deterministic",
            "equivalenceLevel": "contract",
        },
        "simulated": True,
        "disclaimer": (
            "这是基于输入证据和显式规则生成的群体推演，不是对真实世界未来的事实预测。"
        ),
        "requirement": requirement,
        "seed": seed,
        "config": {
            "agentCount": agent_count,
            "maxRounds": rounds,
            "platforms": platforms,
            "enableGraphMemoryUpdate": False,
        },
        "run": {
            "simulationId": f"local_{run_key[:12]}",
            "canonicalState": "completed",
            "environmentAlive": False,
            "roundsCompleted": rounds,
            "actionCount": len(timeline),
        },
        "profiles": profiles,
        "timeline": timeline,
        "outcomes": outcomes,
        "generatedAt": generated_at,
    }
    result["report"] = _simulation_report(result)
    return result


def _simulation_seed(
    input_items: list[dict[str, Any]],
    params: dict[str, Any],
) -> dict[str, Any]:
    configured = params.get("seed")
    if isinstance(configured, dict):
        return configured
    for wrapped in reversed(input_items):
        for key in ("normalizedData", "raw"):
            candidate = wrapped.get(key)
            if not isinstance(candidate, dict):
                continue
            if candidate.get("schema") == "situation.report.v1":
                return candidate
            if candidate.get("schema") == "recent-research.provider.v1":
                upstream_report = candidate.get("report")
                if isinstance(upstream_report, dict):
                    return {
                        **upstream_report,
                        "schema": "simulation.seed.last30days.v1",
                        "query": _read_string(upstream_report.get("query")) or "",
                        "generatedAt": (
                            _read_string(upstream_report.get("generated_at"))
                            or _read_string(upstream_report.get("generatedAt"))
                        ),
                        "provider": candidate.get("provider"),
                    }
        if wrapped.get("schema") == "situation.report.v1":
            return wrapped
    titles: list[str] = []
    sources: set[str] = set()
    for wrapped in input_items[:50]:
        item = _unwrap_item(wrapped)
        title = _read_string(item.get("title"))
        if title:
            titles.append(title)
        source = _read_string(item.get("source_id")) or _read_string(item.get("source"))
        if source:
            sources.add(source)
    return {
        "schema": "simulation.seed.v1",
        "query": _read_string(params.get("topic")) or "",
        "counts": {"input": len(input_items)},
        "topics": [{"label": title, "mentionCount": 1} for title in titles[:8]],
        "platforms": [{"platform": source, "itemCount": 1} for source in sorted(sources)],
        "signals": [],
    }


def _build_profiles(
    seed: dict[str, Any],
    *,
    agent_count: int,
    rng: random.Random,
) -> list[dict[str, Any]]:
    topic_labels = [
        _read_string(row.get("label"))
        for row in _read_dict_list(seed.get("topics"))
        if _read_string(row.get("label"))
    ] or [_read_string(seed.get("query")) or "当前事件"]
    archetypes = (
        ("支持者", 0.68, "推动议题扩散并强调正向价值"),
        ("怀疑者", -0.55, "质疑证据、动机和可执行性"),
        ("观察者", 0.0, "等待更多信息后再形成稳定立场"),
        ("行业从业者", 0.25, "关注成本、落地路径和行业影响"),
        ("媒体节点", 0.1, "追踪高互动叙事并放大新信息"),
        ("风险管理者", -0.2, "优先识别合规、安全与声誉风险"),
    )
    profiles: list[dict[str, Any]] = []
    for index in range(agent_count):
        label, base_stance, motivation = archetypes[index % len(archetypes)]
        topic = topic_labels[index % len(topic_labels)]
        influence = round(0.2 + rng.random() * 0.8, 3)
        activity = round(0.25 + rng.random() * 0.75, 3)
        profiles.append(
            {
                "agentId": f"agent-{index + 1:03d}",
                "archetype": label,
                "interest": topic,
                "motivation": motivation,
                "influence": influence,
                "activity": activity,
                "stance": round(max(min(base_stance + rng.uniform(-0.2, 0.2), 1), -1), 3),
                "simulated": True,
            }
        )
    return profiles


def _run_rounds(
    profiles: list[dict[str, Any]],
    *,
    seed: dict[str, Any],
    rounds: int,
    platforms: list[str],
    rng: random.Random,
) -> list[dict[str, Any]]:
    signal_pressure = min(len(_read_dict_list(seed.get("signals"))) * 0.025, 0.15)
    timeline: list[dict[str, Any]] = []
    max_actions = 500
    for round_number in range(1, rounds + 1):
        mean_stance = sum(float(profile["stance"]) for profile in profiles) / len(profiles)
        for position, profile in enumerate(profiles):
            if len(timeline) >= max_actions:
                return timeline
            if rng.random() > float(profile["activity"]):
                continue
            social_pull = (mean_stance - float(profile["stance"])) * (
                0.08 + float(profile["influence"]) * 0.04
            )
            shock = rng.uniform(-0.08, 0.08) + signal_pressure
            profile["stance"] = round(
                max(min(float(profile["stance"]) + social_pull + shock, 1), -1),
                3,
            )
            action_type = _action_type(float(profile["stance"]), rng)
            timeline.append(
                {
                    "round": round_number,
                    "platform": platforms[(round_number + position) % len(platforms)],
                    "agentId": profile["agentId"],
                    "action": action_type,
                    "stance": profile["stance"],
                    "topic": profile["interest"],
                    "simulated": True,
                }
            )
    return timeline


def _action_type(stance: float, rng: random.Random) -> str:
    if abs(stance) < 0.18:
        return "observe" if rng.random() < 0.6 else "ask"
    if stance > 0:
        return "amplify" if rng.random() < 0.55 else "support"
    return "challenge" if rng.random() < 0.55 else "warn"


def _outcomes(
    profiles: list[dict[str, Any]],
    timeline: list[dict[str, Any]],
) -> dict[str, Any]:
    stances = [float(profile["stance"]) for profile in profiles]
    support = sum(stance > 0.2 for stance in stances)
    oppose = sum(stance < -0.2 for stance in stances)
    neutral = len(stances) - support - oppose
    polarization = (
        sum(abs(stance) for stance in stances) / len(stances) if stances else 0
    )
    actions = _count_values(row["action"] for row in timeline)
    dominant = max(actions, key=actions.get) if actions else "none"
    return {
        "supportRatio": round(support / len(stances), 3) if stances else 0,
        "opposeRatio": round(oppose / len(stances), 3) if stances else 0,
        "neutralRatio": round(neutral / len(stances), 3) if stances else 0,
        "polarization": round(polarization, 3),
        "dominantAction": dominant,
        "actionBreakdown": dict(sorted(actions.items())),
        "scenario": _scenario_label(support, oppose, neutral),
    }


def _count_values(values: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[str(value)] = counts.get(str(value), 0) + 1
    return counts


def _scenario_label(support: int, oppose: int, neutral: int) -> str:
    if support > oppose * 1.5 and support > neutral:
        return "支持叙事占优，但仍需验证关键证据"
    if oppose > support * 1.5 and oppose > neutral:
        return "风险与质疑叙事占优"
    if neutral >= max(support, oppose):
        return "观望占优，新的可信证据可能改变走势"
    return "多方叙事竞争，存在持续极化可能"


def _simulation_report(result: dict[str, Any]) -> str:
    outcome = result["outcomes"]
    return (
        f"# 群体智能推演：{result['requirement']}\n\n"
        f"- Provider: {result['provider']['id']} ({result['provider']['mode']})\n"
        f"- Agent: {result['config']['agentCount']}\n"
        f"- 轮次: {result['run']['roundsCompleted']}\n"
        f"- 行为: {result['run']['actionCount']}\n"
        f"- 支持/反对/观望: {outcome['supportRatio']:.1%} / "
        f"{outcome['opposeRatio']:.1%} / {outcome['neutralRatio']:.1%}\n"
        f"- 场景判断: {outcome['scenario']}\n\n"
        f"> {result['disclaimer']}"
    )


def _execute_mirofish_operation(
    input_items: list[dict[str, Any]],
    params: dict[str, Any],
) -> dict[str, Any]:
    endpoint_override = _read_string(params.get("endpoint")) or _read_string(
        params.get("baseUrl")
    )
    allow_override = (
        _read_string(os.environ.get(MIROFISH_ALLOW_ENDPOINT_OVERRIDE_ENV)) or ""
    ).lower() in {"1", "true", "yes"}
    if endpoint_override and not allow_override:
        raise SwarmSimulationExecutionError(
            "Workflow-supplied MiroFish endpoints are disabled. Configure "
            f"{MIROFISH_ENDPOINT_ENV} at deployment time; only operators may enable "
            f"{MIROFISH_ALLOW_ENDPOINT_OVERRIDE_ENV}."
        )
    endpoint = (
        endpoint_override if allow_override else None
    ) or _read_string(os.environ.get(MIROFISH_ENDPOINT_ENV))
    if not endpoint:
        raise SwarmSimulationExecutionError(
            f"MiroFish provider is not configured: set {MIROFISH_ENDPOINT_ENV} "
            "or pass toolParams.endpoint"
        )
    operation = _read_string(params.get("operation")) or "health"
    payload = dict(params.get("payload")) if isinstance(params.get("payload"), dict) else {}
    provider_params = dict(params)
    if operation == "ontology":
        seed = _simulation_seed(input_items, params)
        provider_params.setdefault(
            "seedText",
            _read_string(seed.get("brief"))
            or json.dumps(seed, ensure_ascii=False, default=str),
        )
        provider_params.setdefault(
            "requirement",
            _read_string(params.get("requirement"))
            or _read_string(seed.get("query"))
            or "推演该事态在不同群体中的传播、立场变化和可能结果",
        )
    for input_item in input_items:
        raw = input_item.get("raw")
        provider_info = raw.get("provider") if isinstance(raw, dict) else None
        if isinstance(provider_info, dict) and provider_info.get("id") == "mirofish":
            payload = {**_provider_handles(raw), **payload}
    client = MiroFishProviderClient(
        endpoint,
        timeout_seconds=_bounded_int(
            params.get("timeoutSeconds"), default=30, minimum=1, maximum=600
        ),
    )
    data = client.execute(operation, payload=payload, params=provider_params)
    reported_commit = _read_string(data.get("commit")) or _read_string(
        data.get("git_commit")
    )
    canonical_state = _canonical_mirofish_state(operation, data)
    return {
        "schema": "swarm.provider-operation.v1",
        "source": "mirofish",
        "eventType": f"swarm.provider.{operation}",
        "status": "failed" if canonical_state == "failed" else "completed",
        "provider": {
            "id": "mirofish",
            "mode": "sidecar",
            "expectedUpstreamCommit": MIROFISH_UPSTREAM_COMMIT,
            "reportedUpstreamCommit": reported_commit,
            "versionVerified": reported_commit == MIROFISH_UPSTREAM_COMMIT,
            "endpoint": endpoint,
        },
        "simulated": True,
        "operation": operation,
        "canonicalState": canonical_state,
        "handles": _provider_handles(data),
        "data": data,
        "generatedAt": datetime.now(tz=UTC).isoformat(),
    }


class MiroFishProviderClient:
    """Small HTTP client for the pinned MiroFish provider contract."""

    _OPERATIONS: dict[str, tuple[str, str]] = {
        "health": ("GET", "/health"),
        "start_graph": ("POST", "/api/graph/build"),
        "graph_status": ("GET", "/api/graph/task/{task_id}"),
        "create_simulation": ("POST", "/api/simulation/create"),
        "prepare_simulation": ("POST", "/api/simulation/prepare"),
        "prepare_status": ("POST", "/api/simulation/prepare/status"),
        "start_simulation": ("POST", "/api/simulation/start"),
        "stop_simulation": ("POST", "/api/simulation/stop"),
        "simulation_status": ("GET", "/api/simulation/{simulation_id}"),
        "profiles": ("GET", "/api/simulation/{simulation_id}/profiles/realtime"),
        "simulation_config": ("GET", "/api/simulation/{simulation_id}/config/realtime"),
        "run_status": ("GET", "/api/simulation/{simulation_id}/run-status"),
        "run_detail": ("GET", "/api/simulation/{simulation_id}/run-status/detail"),
        "actions": ("GET", "/api/simulation/{simulation_id}/actions"),
        "timeline": ("GET", "/api/simulation/{simulation_id}/timeline"),
        "agent_stats": ("GET", "/api/simulation/{simulation_id}/agent-stats"),
        "posts": ("GET", "/api/simulation/{simulation_id}/posts"),
        "comments": ("GET", "/api/simulation/{simulation_id}/comments"),
        "interview": ("POST", "/api/simulation/interview"),
        "interview_batch": ("POST", "/api/simulation/interview/batch"),
        "interview_all": ("POST", "/api/simulation/interview/all"),
        "interview_history": ("POST", "/api/simulation/interview/history"),
        "env_status": ("POST", "/api/simulation/env-status"),
        "close_env": ("POST", "/api/simulation/close-env"),
        "generate_report": ("POST", "/api/report/generate"),
        "report_status": ("POST", "/api/report/generate/status"),
        "get_report": ("GET", "/api/report/{report_id}"),
        "report_by_simulation": ("GET", "/api/report/by-simulation/{simulation_id}"),
        "report_progress": ("GET", "/api/report/{report_id}/progress"),
        "report_sections": ("GET", "/api/report/{report_id}/sections"),
        "report_chat": ("POST", "/api/report/chat"),
    }

    def __init__(self, endpoint: str, *, timeout_seconds: int = 30) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def execute(
        self,
        operation: str,
        *,
        payload: dict[str, Any],
        params: dict[str, Any],
    ) -> dict[str, Any]:
        if operation == "ontology":
            return self._ontology(payload=payload, params=params)
        route = self._OPERATIONS.get(operation)
        if route is None:
            raise SwarmSimulationExecutionError(
                f'Unsupported MiroFish operation "{operation}"'
            )
        method, path_template = route
        try:
            path = path_template.format(**payload)
        except KeyError as exc:
            raise SwarmSimulationExecutionError(
                f'MiroFish operation "{operation}" requires payload.{exc.args[0]}'
            ) from exc
        return self._request(method, path, payload if method == "POST" else None)

    def _ontology(
        self,
        *,
        payload: dict[str, Any],
        params: dict[str, Any],
    ) -> dict[str, Any]:
        requirement = (
            _read_string(payload.get("simulation_requirement"))
            or _read_string(params.get("requirement"))
        )
        seed_text = _read_string(params.get("seedText"))
        if not requirement or not seed_text:
            raise SwarmSimulationExecutionError(
                "MiroFish ontology requires toolParams.requirement and toolParams.seedText"
            )
        boundary = f"----OpenCLIAdmin{uuid.uuid4().hex}"
        fields = {
            "simulation_requirement": requirement,
            "project_name": _read_string(params.get("projectName")) or "OpenCLI Simulation",
            "additional_context": _read_string(params.get("additionalContext")) or "",
        }
        body = bytearray()
        for key, value in fields.items():
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            )
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            b'Content-Disposition: form-data; name="files"; filename="seed.txt"\r\n'
            b"Content-Type: text/plain; charset=utf-8\r\n\r\n"
        )
        body.extend(seed_text.encode("utf-8"))
        body.extend(f"\r\n--{boundary}--\r\n".encode())
        return self._request(
            "POST",
            "/api/graph/ontology/generate",
            raw_body=bytes(body),
            content_type=f"multipart/form-data; boundary={boundary}",
        )

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        raw_body: bytes | None = None,
        content_type: str = "application/json",
    ) -> dict[str, Any]:
        body = raw_body
        if body is None and payload is not None:
            body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint + path,
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": content_type,
                "User-Agent": "OpenCLI-Admin-MiroFish-Adapter/0.1",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                decoded = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            message = exc.read().decode("utf-8", errors="replace")[:500]
            raise SwarmSimulationExecutionError(
                f"MiroFish {method} {path} failed with HTTP {exc.code}: {message}"
            ) from exc
        except Exception as exc:
            raise SwarmSimulationExecutionError(
                f"MiroFish {method} {path} request failed: {exc}"
            ) from exc
        if not isinstance(decoded, dict):
            raise SwarmSimulationExecutionError(
                f"MiroFish {method} {path} returned a non-object response"
            )
        if decoded.get("success") is False:
            raise SwarmSimulationExecutionError(
                f"MiroFish {method} {path} failed: {decoded.get('error') or 'unknown error'}"
            )
        data = decoded.get("data")
        return data if isinstance(data, dict) else decoded


def _canonical_mirofish_state(operation: str, data: dict[str, Any]) -> str:
    status = str(
        data.get("status")
        or data.get("runner_status")
        or data.get("task_status")
        or ""
    ).lower()
    if operation == "health":
        return "failed" if status in {"failed", "error", "unhealthy"} else "provider_ready"
    if status in {"failed", "error"}:
        return "failed"
    if operation in {"ontology"}:
        return "ontology"
    if operation in {"start_graph", "graph_status"}:
        return "graph_ready" if status in {"completed", "success"} else "graph_building"
    if operation in {"prepare_simulation", "prepare_status"}:
        return "ready" if status in {"completed", "ready", "success"} else "preparing"
    if operation == "start_simulation":
        return "simulating"
    if operation in {"run_status", "run_detail"}:
        complete = bool(data.get("twitter_completed") or data.get("reddit_completed"))
        running = status == "running"
        if complete and running:
            return "simulated_env_alive"
        return "simulating" if running else ("completed" if complete else "ready")
    if operation in {"generate_report", "report_status"}:
        return "completed" if status == "completed" else "reporting"
    if operation == "get_report":
        return "completed"
    if operation == "close_env":
        return "completed"
    return status or "ready"


def _provider_handles(value: dict[str, Any]) -> dict[str, Any]:
    handles: dict[str, Any] = {}
    aliases = {
        "project_id": "project_id",
        "projectId": "project_id",
        "graph_id": "graph_id",
        "graphId": "graph_id",
        "simulation_id": "simulation_id",
        "simulationId": "simulation_id",
        "report_id": "report_id",
        "reportId": "report_id",
        "task_id": "task_id",
        "taskId": "task_id",
    }
    for key, canonical in aliases.items():
        if value.get(key):
            handles[canonical] = value[key]
    nested = value.get("handles")
    if isinstance(nested, dict):
        handles.update(nested)
    return handles


def _unwrap_item(wrapped: dict[str, Any]) -> dict[str, Any]:
    for key in ("normalizedData", "raw"):
        value = wrapped.get(key)
        if isinstance(value, dict):
            return value
    return wrapped


def _platforms(value: object) -> list[str]:
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = [item for item in value if isinstance(item, str)]
    else:
        values = ["twitter", "reddit"]
    cleaned = [item.strip().lower() for item in values if item.strip()]
    if "parallel" in cleaned:
        return ["twitter", "reddit"]
    accepted = [item for item in cleaned if item in {"twitter", "reddit"}]
    return accepted or ["twitter", "reddit"]


def _read_dict_list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _read_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _bounded_int(value: object, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    return min(max(parsed, minimum), maximum)
