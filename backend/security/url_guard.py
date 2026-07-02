"""Outbound-fetch SSRF guard.

Deployment context (see AUDIT item B3): this system runs on a LAN reachable
over a NetBird/WireGuard mesh, not exposed via public port-mapping — so
*inbound* auth is handled by the WG layer and is out of scope here. SSRF is an
*outbound* threat instead: a channel/notifier/processor fetches a URL that
came from a user or from DB-stored config (or, worse, from content a remote
server chose to return, e.g. a redirect Location), and the server itself ends
up reaching an internal fleet peer (100.80.x.x), a localhost service (redis,
postgres), or exfiltrating an LLM provider API key to an attacker-controlled
public host. WireGuard does not protect outbound traffic, which is exactly
why this module exists.

``validate_public_url`` is the single choke point every outbound-fetch call
site in this codebase should call before opening a connection to a
user/DB-supplied URL. It:

  * requires ``http``/``https`` scheme (rejects ``file://``, ``gopher://``,
    ``ftp://``, etc — these can hit local files or talk to unintended
    protocols on internal-only ports),
  * resolves the hostname and rejects the URL if *any* resolved address is
    loopback, private (RFC1918 / ULA), link-local (including the cloud
    metadata address ``169.254.169.254``), unspecified, multicast, or
    otherwise not "globally reachable",
  * rejects a raw-IP host in those same ranges without needing DNS at all.

Callers that also need the resolved IP (to pin a redirect-safe connection,
see the DNS-rebinding note below) can use :func:`validate_public_url_and_ip`.

DNS-rebinding limitation
------------------------
This module resolves and validates the hostname *once*, at call time. It does
not — and, with plain ``httpx`` used positionally in this codebase, currently
cannot cheaply — pin the TCP connection to the exact IP that was validated.
A sufficiently motivated attacker who controls DNS for the target hostname
could rebind the name to a private IP *between* our check and the actual
connect() a moment later (TOCTOU). Fully closing this requires either (a) an
``httpx.AsyncHTTPTransport`` with a custom ``resolver``/socket-level factory
that connects to the pinned IP while still sending the original ``Host``
header (SNI-safe for TLS), or (b) routing every fetch through a forward proxy
that itself enforces the allowlist. Neither is wired up in this pass — call
sites should treat this as "blocks the common case (config-time private URLs,
naive SSRF payloads, redirects to obviously-private hosts)" rather than a
fully rebind-proof sandbox. Flagged as a follow-up.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

__all__ = [
    "SSRFValidationError",
    "validate_public_url",
    "validate_public_url_and_ip",
    "is_ip_blocked",
    "resolve_hostname",
]

_ALLOWED_SCHEMES = {"http", "https"}

# RFC 6598 "Shared Address Space" (100.64.0.0/10), reserved for carrier-grade
# NAT. Not flagged by ipaddress.IPv4Address.is_private on all Python versions
# we support, but it MUST be blocked here: this is exactly the range NetBird
# (this deployment's WireGuard mesh) hands out to fleet peers (e.g.
# 100.80.x.x) — the deployment's own threat model calls these out as an SSRF
# target the WG layer does NOT protect against outbound.
_CGNAT_SHARED_SPACE = ipaddress.ip_network("100.64.0.0/10")


class SSRFValidationError(ValueError):
    """Raised when a URL fails the outbound-fetch safety check.

    Always a clear, actionable message — callers should surface this (or a
    wrapped version of it) rather than silently swallowing it, since a reject
    here is a security decision, not an ordinary network hiccup.
    """


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True if ``ip`` must not be reached by an outbound fetch.

    Blocks loopback (127.0.0.0/8, ::1), RFC1918 private ranges, link-local
    (169.254.0.0/16 — this includes the cloud-metadata address
    169.254.169.254 — and fe80::/10), IPv6 unique-local (fc00::/7),
    unspecified (0.0.0.0, ::), reserved, and multicast addresses. Anything not
    covered by one of those categories is treated as globally reachable and
    allowed.
    """
    if isinstance(ip, ipaddress.IPv4Address) and ip in _CGNAT_SHARED_SPACE:
        return True
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_unspecified
        or ip.is_multicast
        or ip.is_reserved
    )


def resolve_hostname(hostname: str) -> list[str]:
    """Resolve ``hostname`` to its IPv4/IPv6 addresses (blocking; run this off
    the event loop from async code — see :func:`validate_public_url`).

    Raises :class:`SSRFValidationError` if resolution fails (unknown host,
    DNS failure, etc.) — an unresolvable host can't be safely fetched either.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise SSRFValidationError(f"could not resolve host {hostname!r}: {exc}") from exc
    addrs = {info[4][0] for info in infos}
    if not addrs:
        raise SSRFValidationError(f"host {hostname!r} resolved to no addresses")
    return sorted(addrs)


def _check_host_and_ips(hostname: str, ips: list[str]) -> None:
    for raw_ip in ips:
        try:
            ip = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if is_ip_blocked(ip):
            raise SSRFValidationError(
                f"URL host {hostname!r} resolves to a non-public address "
                f"({raw_ip}) — blocked to prevent SSRF against internal "
                "services (localhost, LAN/fleet peers, cloud metadata, etc.)"
            )


def validate_public_url(url: str) -> str:
    """Validate ``url`` is safe to fetch from the server; return it normalized.

    Synchronous — performs a blocking DNS lookup. Call
    :func:`validate_public_url_and_ip` (or wrap this in
    ``asyncio.to_thread``/``run_in_executor``) from async code so a slow/
    hanging resolver doesn't stall the event loop.

    Raises :class:`SSRFValidationError` on any rejection:
      * missing/invalid URL, or a scheme other than http/https,
      * missing hostname,
      * hostname/raw-IP resolves to a loopback/private/link-local/
        unique-local/unspecified/multicast address.
    """
    return validate_public_url_and_ip(url)[0]


def validate_public_url_and_ip(url: str) -> tuple[str, list[str]]:
    """Like :func:`validate_public_url`, but also returns the resolved IP(s)
    (sorted) so a caller can pin a redirect-safe connection to them — see the
    module docstring's DNS-rebinding note for why that pinning isn't wired
    through httpx in this pass.
    """
    if not url or not isinstance(url, str):
        raise SSRFValidationError("URL is required")

    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise SSRFValidationError(
            f"URL scheme {parsed.scheme!r} is not allowed (only http/https) — "
            f"rejected: {url!r}"
        )

    hostname = parsed.hostname
    if not hostname:
        raise SSRFValidationError(f"URL has no hostname: {url!r}")

    # Raw-IP host: no DNS involved, but still must not be a blocked address.
    try:
        literal_ip = ipaddress.ip_address(hostname)
    except ValueError:
        literal_ip = None

    if literal_ip is not None:
        _check_host_and_ips(hostname, [str(literal_ip)])
        return url, [str(literal_ip)]

    ips = resolve_hostname(hostname)
    _check_host_and_ips(hostname, ips)
    return url, ips


async def avalidate_public_url(url: str) -> str:
    """Async-friendly wrapper: runs the (blocking DNS) validation off-thread
    via ``asyncio.to_thread`` so it never stalls the event loop. Prefer this
    from ``async def`` call sites; :func:`validate_public_url` remains for
    sync call sites (e.g. module-level helpers called before an event loop
    exists)."""
    return await asyncio.to_thread(validate_public_url, url)


async def avalidate_public_url_and_ip(url: str) -> tuple[str, list[str]]:
    """Async ``asyncio.to_thread`` wrapper around
    :func:`validate_public_url_and_ip`."""
    return await asyncio.to_thread(validate_public_url_and_ip, url)
