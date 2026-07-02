"""Fleet-LAN static bearer-token auth (ADR-0005, control-closeout issue 04).

The deployment surface is the operator's NetBird fleet LAN, so network
reachability must not equal operability: once a token is configured
(``API_AUTH_TOKEN`` / ``Settings.api_auth_token``), every HTTP request under
``/api`` must carry ``Authorization: Bearer <token>``.

Dev posture: with no token configured (the default) the API stays open, and
``enforce_bind_guard`` only allows that posture on a localhost bind. The
existing test suite therefore runs unchanged with no token configured.

Exemptions (deliberate — issue 04: "exempt if and only if they leak nothing"):

- ``GET /health`` — liveness only. docker-compose's healthcheck curls it with
  no credentials, so it must stay open; its body is slimmed to
  ``{"status": "ok"}`` (see backend/main.py) so it leaks nothing. The
  config-bearing detail (task_executor, ...) lives at the authenticated
  ``GET /api/v1/system/config`` instead.
- ``/docs``, ``/redoc``, ``/openapi.json`` — outside the ``/api`` prefix.
  They disclose the API *schema* but no data; issue 04's scope is "every
  /api route". Tighten separately if schema disclosure becomes a concern.

Known gap (documented, not silently ignored): websocket endpoints under
``/api`` (the agent reverse channel in api/v1/nodes.py and browser/noVNC
streams in api/v1/browsers.py) are NOT guarded here — remote fleet agents
establish those connections without a token today, so guarding them in this
middleware would sever the fleet's own agents. That belongs to a follow-up on
the agent protocol.

The MCP server (backend/mcp_server.py) and CLI (backend/cli.py) are HTTP
*clients* of this API running as separate processes; they read
``API_AUTH_TOKEN`` from their own environment and attach the same header.
"""

from __future__ import annotations

import secrets
import sys
from collections.abc import Sequence

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from backend.config import get_settings

#: Path prefix guarded by :class:`FleetAuthMiddleware`.
PROTECTED_PREFIX = "/api"

_LOCALHOST_HOSTS = frozenset({"localhost", "::1"})


def is_localhost_host(host: str) -> bool:
    """True when *host* only accepts loopback connections (127/8, ::1, localhost)."""
    normalized = host.strip().strip("[]").lower()
    return normalized in _LOCALHOST_HOSTS or normalized.startswith("127.")


def resolve_uvicorn_host(argv: Sequence[str] | None = None) -> str:
    """Best-effort bind-host discovery for the running server process.

    The bind host is decided by uvicorn's own CLI — the Dockerfile CMD passes
    ``--host 0.0.0.0``; ``uv run uvicorn backend.main:app`` defaults to
    127.0.0.1 — and never reaches the ASGI app, so parse it back out of the
    process argv. No ``--host`` flag (pytest, programmatic ASGI transports,
    plain ``uvicorn app``) means uvicorn's default of 127.0.0.1.
    """
    args = sys.argv if argv is None else argv
    host = "127.0.0.1"
    for i, arg in enumerate(args):
        if arg == "--host" and i + 1 < len(args):
            host = args[i + 1]
        elif arg.startswith("--host="):
            host = arg.split("=", 1)[1]
    return host


def enforce_bind_guard(host: str, token: str) -> None:
    """Refuse to serve a non-localhost bind without a token (ADR-0005).

    Called at the top of the lifespan startup in backend/main.py; raising
    there aborts uvicorn startup before a single request is served.
    """
    if token.strip() or is_localhost_host(host):
        return
    raise RuntimeError(
        f"Refusing to bind {host!r} without an API auth token: the fleet-LAN "
        "deployment surface (ADR-0005) requires API_AUTH_TOKEN to be set for "
        "any non-localhost bind. Set API_AUTH_TOKEN, or bind 127.0.0.1 for "
        "local development."
    )


class FleetAuthMiddleware:
    """Pure-ASGI middleware validating a static bearer token on /api routes.

    Guards ``http`` scopes only — see module docstring for the documented
    websocket gap and the /health exemption rationale.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(PROTECTED_PREFIX):
            await self.app(scope, receive, send)
            return

        # Read per request: get_settings() is lru_cached (cheap), but
        # api/v1/system.py may cache_clear() it at runtime after a config
        # patch, so don't freeze the token at middleware construction time.
        token = get_settings().api_auth_token
        if not token:
            # Dev posture: no token configured -> API open. Only reachable on
            # a localhost bind thanks to enforce_bind_guard at startup.
            await self.app(scope, receive, send)
            return

        auth = Headers(scope=scope).get("authorization", "")
        scheme, _, credential = auth.partition(" ")
        if scheme.lower() == "bearer" and secrets.compare_digest(
            credential.strip().encode("utf-8"), token.encode("utf-8")
        ):
            await self.app(scope, receive, send)
            return

        response = JSONResponse(
            status_code=401,
            content={"success": False, "error": "Invalid or missing API token"},
            headers={"WWW-Authenticate": "Bearer"},
        )
        await response(scope, receive, send)
