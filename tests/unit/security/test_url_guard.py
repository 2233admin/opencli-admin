"""Unit tests for the outbound SSRF guard (backend.security.url_guard)."""

from unittest.mock import patch

import pytest

from backend.security.url_guard import (
    SSRFValidationError,
    avalidate_public_url,
    is_ip_blocked,
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
