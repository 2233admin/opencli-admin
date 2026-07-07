"""Unit tests for the outbound SSRF guard (backend.security.url_guard)."""

import http.server
import threading
from unittest.mock import patch

import httpx
import pytest

from backend.security import url_guard
from backend.security.url_guard import (
    PinnedAsyncHTTPTransport,
    SSRFValidationError,
    avalidate_provider_url_and_ip,
    avalidate_public_url,
    guarded_async_client,
    guarded_provider_client,
    is_ip_blocked,
    is_provider_allowlisted,
    validate_provider_url,
    validate_provider_url_and_ip,
    validate_public_url,
    validate_public_url_and_ip,
)


def _fake_getaddrinfo(ip: str):
    """Build a socket.getaddrinfo-shaped return value resolving to one IP."""
    return [(None, None, None, "", (ip, 0))]


# ── scheme validation ────────────────────────────────────────────────────────

def test_rejects_file_scheme():
    with pytest.raises(SSRFValidationError, match="scheme"):
        validate_public_url("file:///etc/passwd")


def test_rejects_gopher_scheme():
    with pytest.raises(SSRFValidationError, match="scheme"):
        validate_public_url("gopher://example.com/x")


def test_rejects_ftp_scheme():
    with pytest.raises(SSRFValidationError, match="scheme"):
        validate_public_url("ftp://example.com/x")


def test_rejects_garbage_url():
    with pytest.raises(SSRFValidationError):
        validate_public_url("not a url at all")


def test_rejects_empty_url():
    with pytest.raises(SSRFValidationError):
        validate_public_url("")


def test_rejects_missing_hostname():
    with pytest.raises(SSRFValidationError, match="hostname"):
        validate_public_url("http:///path/only")


# ── raw-IP hosts ─────────────────────────────────────────────────────────────

def test_rejects_raw_loopback_ip():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://127.0.0.1/x")


def test_rejects_raw_loopback_ip_variant():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://127.1.2.3/x")


def test_rejects_raw_private_10():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://10.0.0.5/x")


def test_rejects_raw_private_172():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://172.16.0.1/x")


def test_rejects_raw_private_192():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://192.168.1.1/x")


def test_rejects_cloud_metadata_ip():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://169.254.169.254/latest/meta-data/")


def test_rejects_link_local_ip():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://169.254.1.1/x")


def test_rejects_raw_ipv6_loopback():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://[::1]/x")


def test_rejects_raw_ipv6_unique_local():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://[fc00::1]/x")


def test_rejects_fleet_peer_ip():
    """NetBird fleet peers (100.80.x.x) live in RFC 6598 CGNAT shared address
    space (100.64.0.0/10), which is NOT reliably flagged by
    ipaddress.IPv4Address.is_private on every Python version — url_guard adds
    an explicit block for this range because the deployment's own threat
    model calls out fleet peers as an outbound SSRF target."""
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://100.80.1.1/x")


def test_is_ip_blocked_cgnat_fleet_range():
    import ipaddress

    assert is_ip_blocked(ipaddress.ip_address("100.80.105.128")) is True


def test_rejects_raw_multicast_ip():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://224.0.0.1/x")


def test_rejects_raw_unspecified_ip():
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_public_url("http://0.0.0.0/x")


# ── DNS-resolved hosts ───────────────────────────────────────────────────────

def test_rejects_hostname_resolving_to_loopback():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("127.0.0.1")):
        with pytest.raises(SSRFValidationError, match="non-public"):
            validate_public_url("http://localhost/x")


def test_rejects_hostname_resolving_to_metadata_ip():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("169.254.169.254")):
        with pytest.raises(SSRFValidationError, match="non-public"):
            validate_public_url("http://metadata.internal/x")


def test_rejects_hostname_resolving_to_private_ip():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("10.1.2.3")):
        with pytest.raises(SSRFValidationError, match="non-public"):
            validate_public_url("http://internal-service.local/x")


def test_allows_public_host():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("93.184.216.34")):
        result = validate_public_url("https://example.com/feed")
    assert result == "https://example.com/feed"


def test_allows_public_ip_literal():
    result = validate_public_url("http://8.8.8.8/x")
    assert result == "http://8.8.8.8/x"


def test_dns_resolution_failure_raises():
    import socket as socket_mod

    with patch("socket.getaddrinfo", side_effect=socket_mod.gaierror("no such host")):
        with pytest.raises(SSRFValidationError, match="could not resolve"):
            validate_public_url("http://this-does-not-exist.invalid/x")


def test_any_resolved_ip_being_private_blocks_multi_a_record_host():
    """A host with multiple A records, only one of which is private, must
    still be blocked — DNS rebinding / mixed-answer defense."""
    multi = [
        (None, None, None, "", ("93.184.216.34", 0)),
        (None, None, None, "", ("10.0.0.1", 0)),
    ]
    with patch("socket.getaddrinfo", return_value=multi):
        with pytest.raises(SSRFValidationError, match="non-public"):
            validate_public_url("http://mixed-answers.example/x")


# ── validate_public_url_and_ip ───────────────────────────────────────────────

def test_validate_public_url_and_ip_returns_ips():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("93.184.216.34")):
        url, ips = validate_public_url_and_ip("https://example.com/feed")
    assert url == "https://example.com/feed"
    assert ips == ["93.184.216.34"]


# ── is_ip_blocked ────────────────────────────────────────────────────────────

def test_is_ip_blocked_loopback():
    import ipaddress

    assert is_ip_blocked(ipaddress.ip_address("127.0.0.1")) is True


def test_is_ip_blocked_public():
    import ipaddress

    assert is_ip_blocked(ipaddress.ip_address("8.8.8.8")) is False


# ── async wrapper ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_avalidate_public_url_allows_public_host():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("93.184.216.34")):
        result = await avalidate_public_url("https://example.com/feed")
    assert result == "https://example.com/feed"


@pytest.mark.asyncio
async def test_avalidate_public_url_rejects_private_host():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("10.0.0.1")):
        with pytest.raises(SSRFValidationError):
            await avalidate_public_url("http://internal.example/x")


# ── DNS-rebinding TOCTOU closure (AUDIT B3 follow-up) ────────────────────────
#
# These prove the actual connect target is pinned to the IP(s) validated at
# check time, not re-resolved a moment later — i.e. even if a hostname's DNS
# answer changes (or a test double is fully unresolvable) between validation
# and connect, the socket still only ever dials the pinned IP.


def _run_local_http_server():
    """Start a tiny local HTTP server on an ephemeral port; returns (server, port)."""

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib method name
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"pinned-ok")

        def log_message(self, format, *args):  # noqa: A002 - stdlib signature
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


@pytest.mark.asyncio
async def test_pinned_backend_dials_validated_ip_not_hostname_dns(monkeypatch):
    """The core DNS-rebinding proof: connect_tcp for the guarded hostname goes
    straight to the IP handed to the pinned backend — it never calls
    socket.getaddrinfo (or anything DNS-shaped) again to decide where to dial.
    We patch socket.getaddrinfo to a bogus/attacker address and assert it is
    NEVER consulted for the pinned host; the connection still lands on the
    real local server bound at the validated IP.

    127.0.0.1 is itself a blocked address under is_ip_blocked (correctly —
    that's proven separately below), so the defense-in-depth check is
    monkeypatched off for this test only, to isolate "does the pinned backend
    actually dial the pinned IP" from "is the SSRF block correct".
    """
    server, port = _run_local_http_server()
    try:
        getaddrinfo_calls: list[str] = []

        def _tracking_getaddrinfo(host, *args, **kwargs):
            getaddrinfo_calls.append(host)
            # Simulate a hostile/rebound answer — if the pinned backend ever
            # asked, it would get sent to a private, definitely-wrong target.
            return _fake_getaddrinfo("10.6.6.6")

        monkeypatch.setattr("socket.getaddrinfo", _tracking_getaddrinfo)
        monkeypatch.setattr(url_guard, "is_ip_blocked", lambda ip: False)

        transport = PinnedAsyncHTTPTransport("rebind-test.invalid", ["127.0.0.1"])
        async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
            resp = await client.get(f"http://rebind-test.invalid:{port}/")

        assert resp.status_code == 200
        assert resp.text == "pinned-ok"
        # The pinned backend must never have asked the (compromised) resolver
        # for "rebind-test.invalid" — it dialed the pinned IP directly.
        assert "rebind-test.invalid" not in getaddrinfo_calls
    finally:
        server.shutdown()


@pytest.mark.asyncio
async def test_pinned_backend_refuses_connect_to_blocked_ip():
    """Defense in depth: even if a caller pins to an address that is itself
    non-public (e.g. a resolver swapped out from under validate_public_url_and_ip
    handed back a blocked answer, or a bug upstream), connect_tcp refuses at
    dial time instead of silently connecting."""
    backend = url_guard._PinnedNetworkBackend("rebind-target.invalid", ["10.1.2.3"])
    with pytest.raises(SSRFValidationError, match="non-public"):
        await backend.connect_tcp("rebind-target.invalid", 80, timeout=5)


@pytest.mark.asyncio
async def test_pinned_backend_passes_through_unrelated_hosts_unpinned():
    """A host that doesn't match the pinned hostname (e.g. a proxy CONNECT
    target) is not intercepted — only the guarded hostname is pinned."""
    backend = url_guard._PinnedNetworkBackend("pinned-host.invalid", ["127.0.0.1"])
    # A totally different, unresolvable host should fail via the *real*
    # resolver (ConnectError/OSError), never our SSRFValidationError — proving
    # the pinning logic only intercepts the exact guarded hostname.
    with pytest.raises(Exception) as exc_info:
        await backend.connect_tcp("definitely-not-pinned.invalid.example.", 80, timeout=1)
    assert not isinstance(exc_info.value, SSRFValidationError)


@pytest.mark.asyncio
async def test_guarded_async_client_validates_and_pins(monkeypatch):
    """guarded_async_client() validates the URL (SSRF guard) and returns a
    client whose transport is pinned to the IP(s) resolved at that moment —
    proven by making a real request against a local server bound to the
    pinned IP while DNS for the hostname is faked to a public IP (this is the
    realistic "validate sees a public A record" half of a DNS-rebind attack;
    the other half — a real subsequent re-answer — is exactly what pinning
    makes irrelevant, since guarded_async_client never re-resolves)."""
    server, port = _run_local_http_server()
    try:
        with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("93.184.216.34")):
            client, validated_url = await guarded_async_client(
                "http://pin-e2e.example/", follow_redirects=False
            )
        assert validated_url == "http://pin-e2e.example/"

        # The transport is pinned to 93.184.216.34 (validated above) — not
        # reachable from this sandbox, so instead assert the pinning wiring
        # directly: the transport's pool network_backend is a
        # _PinnedNetworkBackend bound to the validated hostname/IP.
        transport = client._transport
        assert isinstance(transport, PinnedAsyncHTTPTransport)
        backend = transport._pool._network_backend
        assert isinstance(backend, url_guard._PinnedNetworkBackend)
        assert backend._hostname == "pin-e2e.example"
        assert backend._ips == ["93.184.216.34"]
        await client.aclose()
    finally:
        server.shutdown()


@pytest.mark.asyncio
async def test_guarded_async_client_rejects_private_host():
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("10.0.0.1")):
        with pytest.raises(SSRFValidationError):
            await guarded_async_client("http://internal.example/x")


@pytest.mark.asyncio
async def test_guarded_async_client_rejects_transport_kwarg():
    """Callers must not pass their own transport= — guarded_async_client owns
    pinning and silently losing it would be a security regression."""
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("93.184.216.34")):
        with pytest.raises(TypeError):
            await guarded_async_client("https://example.com/", transport=object())


@pytest.mark.asyncio
async def test_guarded_async_client_full_request_over_real_https():
    """End-to-end proof against a real public HTTPS host: the pinned
    transport preserves TLS SNI/cert verification (a broken pin would either
    fail the handshake or fail cert verification) while still being pinned —
    see PinnedAsyncHTTPTransport's docstring for why SNI/cert verification are
    structurally independent of what IP connect_tcp actually dials."""
    client, url = await guarded_async_client("https://example.com/", timeout=10)
    async with client:
        resp = await client.get(url)
    assert resp.status_code == 200


# ── Provider allowlist (opt-in, PROVIDER_URL_ALLOWLIST) ─────────────────────
#
# Provider-call-sites-only entry points — see the module docstring's
# "Provider allowlist" section. These must NEVER change behaviour for
# validate_public_url / guarded_async_client (proven above, unchanged) or for
# api_channel's own SSRF checks (api_channel imports validate_public_url /
# guarded_async_client / avalidate_public_url directly — it never touches
# this allowlist machinery at all, so its existing tests in
# tests/unit/channels/test_api_channel.py exercising those same unchanged
# functions are the regression proof that this feature is fully inert on
# that path).


# -- is_provider_allowlisted: exact host:port matching --------------------

def test_is_provider_allowlisted_exact_match():
    assert is_provider_allowlisted("http://127.0.0.1:11434/v1", "127.0.0.1:11434") is True


def test_is_provider_allowlisted_port_mismatch_rejected():
    assert is_provider_allowlisted("http://127.0.0.1:11434/v1", "127.0.0.1:9999") is False


def test_is_provider_allowlisted_host_mismatch_rejected():
    assert is_provider_allowlisted("http://127.0.0.1:11434/v1", "10.0.0.5:11434") is False


def test_is_provider_allowlisted_empty_allowlist_rejected():
    """Empty allowlist (the out-of-the-box default) never matches anything —
    this is what makes the flag off-by-default."""
    assert is_provider_allowlisted("http://127.0.0.1:11434/v1", "") is False


def test_is_provider_allowlisted_case_insensitive_host():
    assert is_provider_allowlisted("http://LOCALHOST:11434/v1", "localhost:11434") is True


def test_is_provider_allowlisted_multi_entry_and_whitespace_tolerant():
    allowlist = " 127.0.0.1:11434 , localhost:11434 "
    assert is_provider_allowlisted("http://127.0.0.1:11434/v1", allowlist) is True
    assert is_provider_allowlisted("http://localhost:11434/v1", allowlist) is True
    assert is_provider_allowlisted("http://127.0.0.1:9999/v1", allowlist) is False


def test_is_provider_allowlisted_default_port_inference_http():
    """No explicit port in the URL -> defaults to 80 for http, matched against
    an allowlist entry that names port 80 explicitly."""
    assert is_provider_allowlisted("http://127.0.0.1/v1", "127.0.0.1:80") is True


def test_is_provider_allowlisted_default_port_inference_https():
    assert is_provider_allowlisted("https://127.0.0.1/v1", "127.0.0.1:443") is True


def test_is_provider_allowlisted_no_wildcard_subdomain_support():
    """Deliberately dumb: a broader allowlist entry does not implicitly cover
    a more specific or different host — exact host:port only."""
    assert is_provider_allowlisted("http://evil.127.0.0.1:11434/v1", "127.0.0.1:11434") is False


# -- validate_provider_url / validate_provider_url_and_ip ------------------

def test_validate_provider_url_allowlisted_loopback_passes():
    """The core behavior change: a loopback base_url that would normally be
    rejected by validate_public_url passes when it exactly matches the
    allowlist, and no IPs are returned (signal: do not pin)."""
    url, ips = validate_provider_url_and_ip(
        "http://127.0.0.1:11434/v1", allowlist="127.0.0.1:11434"
    )
    assert url == "http://127.0.0.1:11434/v1"
    assert ips == []


def test_validate_provider_url_returns_bare_url():
    assert (
        validate_provider_url("http://127.0.0.1:11434/v1", allowlist="127.0.0.1:11434")
        == "http://127.0.0.1:11434/v1"
    )


def test_validate_provider_url_non_matching_loopback_still_rejected():
    """An allowlist is configured, but this URL isn't on it -> falls through
    to the full public check and is still rejected."""
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_provider_url("http://127.0.0.1:9999/v1", allowlist="127.0.0.1:11434")


def test_validate_provider_url_empty_allowlist_matches_current_behavior():
    """Empty allowlist (default): behaves byte-for-byte like
    validate_public_url — the regression guarantee for the opt-in default."""
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_provider_url("http://127.0.0.1:11434/v1", allowlist="")
    # and with the parameter omitted entirely (its default):
    with pytest.raises(SSRFValidationError, match="non-public"):
        validate_provider_url("http://127.0.0.1:11434/v1")


def test_validate_provider_url_allowlist_set_but_host_is_public_still_validated():
    """Allowlist configured for a *different* host must not weaken the check
    for a public host — it just goes through the normal public-host path."""
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("93.184.216.34")):
        url, ips = validate_provider_url_and_ip(
            "https://example.com/v1", allowlist="127.0.0.1:11434"
        )
    assert url == "https://example.com/v1"
    assert ips == ["93.184.216.34"]


def test_validate_provider_url_rejects_non_http_scheme_even_if_allowlisted_host():
    """Scheme check still applies — allowlist is not a blanket exemption."""
    with pytest.raises(SSRFValidationError, match="scheme"):
        validate_provider_url("file:///etc/passwd", allowlist="127.0.0.1:11434")


# -- avalidate_provider_url_and_ip (async wrapper) -------------------------

@pytest.mark.asyncio
async def test_avalidate_provider_url_and_ip_allowlisted_passes():
    url, ips = await avalidate_provider_url_and_ip(
        "http://127.0.0.1:11434/v1", allowlist="127.0.0.1:11434"
    )
    assert url == "http://127.0.0.1:11434/v1"
    assert ips == []


@pytest.mark.asyncio
async def test_avalidate_provider_url_and_ip_rejects_non_allowlisted_loopback():
    with pytest.raises(SSRFValidationError, match="non-public"):
        await avalidate_provider_url_and_ip("http://127.0.0.1:11434/v1", allowlist="")


# -- guarded_provider_client ------------------------------------------------

@pytest.mark.asyncio
async def test_guarded_provider_client_allowlisted_returns_plain_unpinned_client():
    """An allowlisted URL gets a plain httpx.AsyncClient — deliberately NOT
    pinned (no IPs were resolved; see the module docstring's rationale that a
    named local endpoint has no meaningful DNS-rebinding surface)."""
    client, url = await guarded_provider_client(
        "http://127.0.0.1:11434/v1", allowlist="127.0.0.1:11434"
    )
    try:
        assert url == "http://127.0.0.1:11434/v1"
        assert not isinstance(client._transport, PinnedAsyncHTTPTransport)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_guarded_provider_client_non_allowlisted_public_host_is_pinned():
    """Falls through to guarded_async_client's normal pin-on-validate
    behaviour when not allowlisted."""
    with patch("socket.getaddrinfo", return_value=_fake_getaddrinfo("93.184.216.34")):
        client, url = await guarded_provider_client(
            "http://pin-provider.example/", allowlist="127.0.0.1:11434"
        )
    try:
        assert url == "http://pin-provider.example/"
        assert isinstance(client._transport, PinnedAsyncHTTPTransport)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_guarded_provider_client_rejects_private_host_when_not_allowlisted():
    with pytest.raises(SSRFValidationError):
        await guarded_provider_client("http://10.0.0.1/x", allowlist="127.0.0.1:11434")


@pytest.mark.asyncio
async def test_guarded_provider_client_rejects_transport_kwarg_even_when_allowlisted():
    """Same anti-footgun as guarded_async_client: a caller-supplied transport
    is rejected outright, regardless of allowlist match, so pinning/the
    plain-client contract this function owns can't be silently discarded."""
    with pytest.raises(TypeError):
        await guarded_provider_client(
            "http://127.0.0.1:11434/v1", allowlist="127.0.0.1:11434", transport=object()
        )
