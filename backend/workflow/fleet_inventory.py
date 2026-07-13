"""Project existing agent/browser infrastructure as workflow fleet capacity."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend import ws_agent_manager
from backend.browser_pool import LocalBrowserPool, RedisBrowserPool, get_pool
from backend.models.browser import BrowserBinding, BrowserInstance
from backend.models.edge_node import EdgeNode
from backend.schemas.workflow import (
    WorkflowFleetAgent,
    WorkflowFleetCapabilityCandidate,
    WorkflowFleetCapabilityMatchRequest,
    WorkflowFleetCapabilityMatchResponse,
    WorkflowFleetInventoryResponse,
    WorkflowFleetSiteBinding,
    WorkflowOpenCLIAdapterNode,
)
from backend.workflow.opencli_adapter_nodes import (
    list_opencli_adapter_nodes,
    resolve_opencli_adapter_node,
)

_LOCAL_OPENCLI_ENDPOINT = "local-opencli"
_COOKIE_STRATEGIES = {"cookie", "session", "login", "auth", "authenticated"}


@dataclass
class _FleetAgentDraft:
    endpoint: str
    label: str = ""
    mode: str = "bridge"
    node_type: str = "docker"
    agent_url: str | None = None
    agent_protocol: str | None = None
    status: str = "unknown"
    connected: bool = False
    available: bool = False
    sites: set[str] = field(default_factory=set)
    runtimes: set[str] = field(default_factory=set)
    source: str = "runtime"


async def build_workflow_fleet_inventory(
    session: AsyncSession,
) -> WorkflowFleetInventoryResponse:
    """Return a unified runtime view over existing browser/agent state."""

    pool = _read_pool()
    connected_ws = set(ws_agent_manager.list_connected())
    instances = list((await session.execute(select(BrowserInstance))).scalars().all())
    edge_nodes = list((await session.execute(select(EdgeNode))).scalars().all())
    bindings = list((await session.execute(select(BrowserBinding))).scalars().all())

    drafts: dict[str, _FleetAgentDraft] = {}
    pool_endpoints = _pool_endpoints(pool)

    for endpoint in pool_endpoints:
        draft = _ensure_draft(drafts, endpoint)
        draft.source = "pool"
        draft.available = _pool_available_for(pool, endpoint)
        draft.connected = True
        draft.mode = _pool_mode(pool, endpoint)
        draft.node_type = _pool_node_type(pool, endpoint)
        draft.agent_url = _pool_agent_url(pool, endpoint)
        draft.agent_protocol = _pool_agent_protocol(pool, endpoint)
        draft.status = "online"

    for instance in instances:
        draft = _ensure_draft(drafts, instance.endpoint)
        draft.source = _merge_source(draft.source, "browser_instance")
        draft.label = instance.label or draft.label
        draft.mode = instance.mode or draft.mode
        draft.agent_url = instance.agent_url or draft.agent_url
        draft.agent_protocol = instance.agent_protocol or draft.agent_protocol

    for edge in edge_nodes:
        endpoint = edge.url
        draft = _ensure_draft(drafts, endpoint)
        draft.source = _merge_source(draft.source, "edge_node")
        draft.label = edge.label or draft.label
        draft.mode = edge.mode or draft.mode
        draft.node_type = edge.node_type or draft.node_type
        draft.agent_url = edge.url
        draft.agent_protocol = edge.protocol or draft.agent_protocol
        draft.status = edge.status or draft.status
        draft.connected = draft.connected or edge.status == "online"
        if edge.runtimes:
            draft.runtimes.update(str(runtime) for runtime in edge.runtimes)

    for agent_url in connected_ws:
        draft = _ensure_draft(drafts, agent_url)
        draft.source = _merge_source(draft.source, "ws_agent")
        draft.agent_url = agent_url
        draft.agent_protocol = "ws"
        draft.connected = True
        draft.status = "online"

    for binding in bindings:
        draft = _ensure_draft(drafts, binding.browser_endpoint)
        draft.source = _merge_source(draft.source, "site_binding")
        draft.sites.add(binding.site)

    agents = [_to_agent(draft) for draft in drafts.values()]
    agents.sort(key=lambda item: (not item.connected, item.endpoint))
    site_bindings = [
        WorkflowFleetSiteBinding(
            site=binding.site,
            browserEndpoint=binding.browser_endpoint,
            notes=binding.notes,
        )
        for binding in sorted(bindings, key=lambda item: (item.site, item.browser_endpoint))
    ]
    return WorkflowFleetInventoryResponse(
        summary={
            "clusterModel": "private-agent-pod",
            "routingPolicy": "site_binding_agent_first",
            "capabilityNamespaces": ["agent", "browser", "runtime", "site"],
            "agents": len(agents),
            "connected": sum(1 for agent in agents if agent.connected),
            "available": sum(1 for agent in agents if agent.available),
            "siteBindings": len(site_bindings),
            "poolEndpoints": len(pool_endpoints),
            "wsConnected": len(connected_ws),
        },
        agents=agents,
        siteBindings=site_bindings,
    )


async def match_workflow_fleet_capability(
    session: AsyncSession,
    request: WorkflowFleetCapabilityMatchRequest,
) -> WorkflowFleetCapabilityMatchResponse:
    """Find the best existing fleet target for an OpenCLI adapter capability."""

    adapter = _resolve_requested_adapter(request)
    if adapter is None:
        return WorkflowFleetCapabilityMatchResponse(
            matched=False,
            adapterNodeId=request.adapterNodeId,
            site=request.site,
            command=request.command,
            missing=["opencli_adapter_node"],
        )

    requires_site_binding = _requires_site_binding(adapter)
    if not adapter.browser:
        candidate = WorkflowFleetCapabilityCandidate(
            endpoint=_LOCAL_OPENCLI_ENDPOINT,
            label="Local OpenCLI",
            mode="direct",
            agentProtocol="local",
            status="runnable",
            connected=True,
            available=True,
            score=100,
            reasons=["adapter_does_not_require_browser"],
        )
        return WorkflowFleetCapabilityMatchResponse(
            matched=True,
            adapterNodeId=adapter.id,
            site=adapter.site,
            command=adapter.command,
            requiresBrowser=False,
            requiresSiteBinding=False,
            selected=candidate,
            candidates=[candidate],
        )

    inventory = await build_workflow_fleet_inventory(session)
    candidates = [
        _score_browser_candidate(agent, adapter, requires_site_binding)
        for agent in inventory.agents
        if agent.mode in {"bridge", "cdp"}
    ]
    candidates.sort(key=lambda item: (-item.score, item.endpoint))
    selected = next((candidate for candidate in candidates if not candidate.missing), None)
    missing = _fleet_match_missing(adapter, candidates, requires_site_binding)
    return WorkflowFleetCapabilityMatchResponse(
        matched=selected is not None,
        adapterNodeId=adapter.id,
        site=adapter.site,
        command=adapter.command,
        requiresBrowser=True,
        requiresSiteBinding=requires_site_binding,
        selected=selected,
        candidates=candidates,
        missing=[] if selected else missing,
    )


def _resolve_requested_adapter(
    request: WorkflowFleetCapabilityMatchRequest,
) -> WorkflowOpenCLIAdapterNode | None:
    if request.adapterNodeId:
        return resolve_opencli_adapter_node(request.adapterNodeId)
    if not request.site or not request.command:
        return None
    response = list_opencli_adapter_nodes(site=request.site, include_write=True, limit=None)
    return next(
        (
            node
            for node in response.nodes
            if node.command.lower() == request.command.lower()
        ),
        None,
    )


def _score_browser_candidate(
    agent: WorkflowFleetAgent,
    adapter: WorkflowOpenCLIAdapterNode,
    requires_site_binding: bool,
) -> WorkflowFleetCapabilityCandidate:
    score = 0
    reasons: list[str] = []
    missing: list[str] = []

    if agent.connected:
        score += 20
        reasons.append("agent_connected")
    else:
        missing.append("agent_offline")

    if agent.available:
        score += 10
        reasons.append("browser_endpoint_available")
    else:
        reasons.append("browser_endpoint_may_wait_for_slot")
        missing.append("profile_lock" if adapter.access == "write" else "worker_capacity")

    if agent.agentProtocol == "ws":
        score += 8
        reasons.append("reverse_ws_agent")
    elif agent.agentProtocol == "http":
        score += 5
        reasons.append("http_agent")
    else:
        score += 3
        reasons.append("local_browser_pool")

    if adapter.site in agent.sites:
        score += 100
        reasons.append("site_binding")
    elif requires_site_binding:
        missing.append(f"site_binding:{adapter.site}")
    else:
        reasons.append("site_binding_not_required")

    return WorkflowFleetCapabilityCandidate(
        endpoint=agent.endpoint,
        label=agent.label,
        mode=agent.mode,
        agentUrl=agent.agentUrl,
        agentProtocol=agent.agentProtocol,
        status=agent.status,
        connected=agent.connected,
        available=agent.available,
        score=score,
        reasons=reasons,
        missing=missing,
        sites=agent.sites,
    )


def _fleet_match_missing(
    adapter: WorkflowOpenCLIAdapterNode,
    candidates: list[WorkflowFleetCapabilityCandidate],
    requires_site_binding: bool,
) -> list[str]:
    missing: list[str] = []
    if not candidates:
        missing.append("browser_agent")
    if not any(candidate.connected for candidate in candidates):
        missing.append("online_browser_agent")
    if requires_site_binding and not any(
        adapter.site in candidate.sites for candidate in candidates
    ):
        missing.append(f"site_binding:{adapter.site}")
    return missing


def _requires_site_binding(adapter: WorkflowOpenCLIAdapterNode) -> bool:
    strategy = (adapter.strategy or "").lower()
    return adapter.access == "write" or strategy in _COOKIE_STRATEGIES


def _read_pool() -> LocalBrowserPool | RedisBrowserPool | None:
    try:
        return get_pool()
    except RuntimeError:
        return None


def _pool_endpoints(pool: LocalBrowserPool | RedisBrowserPool | None) -> list[str]:
    return pool.endpoints if pool is not None else []


def _pool_available_for(
    pool: LocalBrowserPool | RedisBrowserPool | None,
    endpoint: str,
) -> bool:
    return bool(pool and pool.available_for(endpoint))


def _pool_mode(pool: LocalBrowserPool | RedisBrowserPool | None, endpoint: str) -> str:
    if isinstance(pool, LocalBrowserPool):
        return pool.get_mode(endpoint)
    return "bridge"


def _pool_node_type(pool: LocalBrowserPool | RedisBrowserPool | None, endpoint: str) -> str:
    if isinstance(pool, LocalBrowserPool):
        return pool.get_node_type(endpoint)
    return "docker"


def _pool_agent_url(
    pool: LocalBrowserPool | RedisBrowserPool | None,
    endpoint: str,
) -> str | None:
    if isinstance(pool, LocalBrowserPool):
        return pool.get_agent_url(endpoint)
    return None


def _pool_agent_protocol(
    pool: LocalBrowserPool | RedisBrowserPool | None,
    endpoint: str,
) -> str | None:
    if isinstance(pool, LocalBrowserPool):
        return pool.get_agent_protocol(endpoint)
    return None


def _ensure_draft(
    drafts: dict[str, _FleetAgentDraft],
    endpoint: str,
) -> _FleetAgentDraft:
    draft = drafts.get(endpoint)
    if draft is None:
        draft = _FleetAgentDraft(endpoint=endpoint)
        drafts[endpoint] = draft
    return draft


def _merge_source(existing: str, addition: str) -> str:
    if not existing or existing == "runtime":
        return addition
    parts = set(existing.split("+"))
    parts.add(addition)
    return "+".join(sorted(parts))


def _to_agent(draft: _FleetAgentDraft) -> WorkflowFleetAgent:
    sites = sorted(draft.sites)
    runtimes = sorted(draft.runtimes)
    capabilities = _agent_capabilities(draft, sites, runtimes)
    return WorkflowFleetAgent(
        endpoint=draft.endpoint,
        label=draft.label,
        mode=draft.mode,
        nodeType=draft.node_type,
        agentUrl=draft.agent_url,
        agentProtocol=draft.agent_protocol,
        status=draft.status,
        connected=draft.connected,
        available=draft.available,
        sites=sites,
        runtimes=runtimes,
        capabilities=capabilities,
        source=draft.source,
    )


def _agent_capabilities(
    draft: _FleetAgentDraft,
    sites: list[str],
    runtimes: list[str],
) -> list[str]:
    capabilities = [f"browser.{draft.mode}"]
    if draft.agent_protocol:
        capabilities.append(f"agent.{draft.agent_protocol}")
    capabilities.extend(f"site.{site}" for site in sites)
    capabilities.extend(f"runtime.{runtime}" for runtime in runtimes)
    return sorted(set(capabilities))
