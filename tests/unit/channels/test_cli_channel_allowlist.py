"""Binary allowlist tests for the CLI channel (ADR-0005, issue 05)."""

import sys
from unittest.mock import patch

import pytest

from backend.channels.cli_channel import CLIChannel, _binary_allowed
from backend.config import Settings


@pytest.fixture
def channel():
    return CLIChannel()


def _allow(*binaries: str):
    """Patch settings with the given binary allowlist for a test."""
    return patch(
        "backend.config.get_settings",
        return_value=Settings(cli_channel_allowed_binaries=",".join(binaries)),
    )


def test_binary_allowed_normalizes_paths():
    assert _binary_allowed("./mycli", ["mycli"]) is True
    assert _binary_allowed("mycli", ["mycli"]) is True
    assert _binary_allowed("mycli", ["othercli"]) is False
    assert _binary_allowed("mycli", []) is False


@pytest.mark.asyncio
async def test_collect_empty_allowlist_rejects_all(channel):
    """Default deny: with no allowlist configured, nothing may run."""
    with _allow():
        result = await channel.collect(
            {"binary": sys.executable, "command": ["-c", "print('hi')"]},
            {},
        )
    assert result.success is False
    assert "allowlist" in result.error
    assert result.error_type == "BinaryNotAllowedError"


@pytest.mark.asyncio
async def test_collect_unlisted_binary_rejected(channel):
    """A non-empty allowlist still rejects any binary not on it."""
    with _allow("/usr/bin/some-other-tool"):
        result = await channel.collect(
            {"binary": sys.executable, "command": ["-c", "print('hi')"]},
            {},
        )
    assert result.success is False
    assert result.error_type == "BinaryNotAllowedError"


@pytest.mark.asyncio
async def test_collect_allowlisted_binary_executes(channel):
    with _allow(sys.executable):
        result = await channel.collect(
            {
                "binary": sys.executable,
                "command": ["-c", "print('[{\"ok\": true}]')"],
                "output_format": "json",
            },
            {},
        )
    assert result.success is True
    assert result.items == [{"ok": True}]


@pytest.mark.asyncio
async def test_allowlist_rejection_spawns_no_subprocess(channel):
    """Enforcement happens before execution, so no process is created."""
    with _allow(), patch("asyncio.create_subprocess_exec") as spawn:
        result = await channel.collect(
            {"binary": sys.executable, "command": ["-c", "print('hi')"]},
            {},
        )
    assert result.success is False
    spawn.assert_not_called()


def test_allowlist_rejection_is_permanent():
    """The taxonomy classifies the rejection non-retryable."""
    from backend.pipeline.error_taxonomy import is_retryable

    assert is_retryable("BinaryNotAllowedError") is False


@pytest.mark.asyncio
async def test_allowlist_rejection_permanent_through_fetch_seam(channel):
    """The fetch seam preserves the permanent allowlist rejection."""
    from backend.channels.base import ChannelFetchError, FetchContext
    from backend.pipeline.error_taxonomy import effective_error_type, is_retryable

    with _allow():
        with pytest.raises(ChannelFetchError) as excinfo:
            await channel.fetch(
                FetchContext(
                    config={
                        "binary": sys.executable,
                        "command": ["-c", "print(1)"],
                    },
                    params={},
                )
            )
    assert is_retryable(effective_error_type(excinfo.value)) is False
