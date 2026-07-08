"""Unit tests for the CLI channel.

The cli channel executes arbitrary binaries (ADR-0005, audit P0-4), so every
execution test must explicitly allowlist its binary via ``_allow`` — the
default (empty allowlist) denies everything.
"""

import sys
from unittest.mock import AsyncMock, Mock, patch

import pytest

from backend.channels.cli_channel import CLIChannel, _binary_allowed, _render_template
from backend.config import Settings


def _allow(*binaries: str):
    """Patch settings with the given binary allowlist for the test's duration."""
    return patch(
        "backend.config.get_settings",
        return_value=Settings(cli_channel_allowed_binaries=",".join(binaries)),
    )


def test_render_template_basic():
    assert _render_template("hello {{name}}", {"name": "world"}) == "hello world"


def test_render_template_missing_key():
    assert _render_template("{{missing}}", {}) == "{{missing}}"


def test_render_template_multiple_keys():
    result = _render_template("{{a}} and {{b}}", {"a": "foo", "b": "bar"})
    assert result == "foo and bar"


@pytest.fixture
def channel():
    return CLIChannel()


@pytest.mark.asyncio
async def test_validate_config_missing_binary(channel):
    errors = await channel.validate_config({"command": ["search"]})
    assert any("binary" in e for e in errors)


@pytest.mark.asyncio
async def test_validate_config_missing_command(channel):
    errors = await channel.validate_config({"binary": "mycli"})
    assert any("command" in e for e in errors)


@pytest.mark.asyncio
async def test_validate_config_valid(channel):
    errors = await channel.validate_config({
        "binary": "mycli",
        "command": ["search", "--keyword", "test"],
    })
    assert errors == []


# ── Binary allowlist (ADR-0005, issue 05) ────────────────────────────────────


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
    """Enforcement happens BEFORE execution — no process is ever created."""
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
    """End-to-end at the runner seam: fetch() wraps the rejection in
    ChannelFetchError carrying error_type, and the taxonomy classifies it
    non-retryable — no parallel error path."""
    from backend.channels.base import ChannelFetchError, FetchContext
    from backend.pipeline.error_taxonomy import effective_error_type, is_retryable

    with _allow():
        with pytest.raises(ChannelFetchError) as excinfo:
            await channel.fetch(
                FetchContext(
                    config={"binary": sys.executable, "command": ["-c", "print(1)"]},
                    params={},
                )
            )
    assert is_retryable(effective_error_type(excinfo.value)) is False


# ── Execution behaviour (binaries explicitly allowlisted) ────────────────────


@pytest.mark.asyncio
async def test_collect_binary_not_found(channel):
    with _allow("nonexistent_binary_xyz"):
        result = await channel.collect(
            {"binary": "nonexistent_binary_xyz", "command": ["run"]},
            {},
        )
    assert result.success is False
    assert "not found" in result.error.lower()


@pytest.mark.asyncio
async def test_collect_json_output(channel):
    import json
    data = [{"title": "Test"}, {"title": "Other"}]
    json_str = json.dumps(data)

    with _allow(sys.executable):
        result = await channel.collect(
            {
                "binary": sys.executable,
                "command": ["-c", f"print({json_str!r})"],
                "output_format": "json",
            },
            {},
        )
    assert result.success is True
    assert len(result.items) == 2


@pytest.mark.asyncio
async def test_collect_text_output(channel):
    with _allow(sys.executable):
        result = await channel.collect(
            {
                "binary": sys.executable,
                "command": ["-c", "print('line1'); print('line2'); print('line3')"],
                "output_format": "text",
            },
            {},
        )
    assert result.success is True
    assert len(result.items) == 3


@pytest.mark.asyncio
async def test_collect_timeout(channel):
    """asyncio.TimeoutError returns failed ChannelResult and kills the child
    so a timed-out subprocess is never orphaned (issue 05)."""
    import asyncio

    mock_proc = AsyncMock()
    mock_proc.kill = Mock()
    with (
        _allow(sys.executable),
        patch("asyncio.create_subprocess_exec", return_value=mock_proc),
        patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()),
    ):
        result = await channel.collect(
            {
                "binary": sys.executable,
                "command": ["-c", "import time; time.sleep(10)"],
                "timeout": 1,
            },
            {},
        )

    assert result.success is False
    assert "timed out" in result.error.lower()
    mock_proc.kill.assert_called_once()


@pytest.mark.asyncio
async def test_collect_generic_exception(channel):
    """Generic exception during subprocess exec returns failed ChannelResult."""
    with (
        _allow(sys.executable),
        patch("asyncio.create_subprocess_exec", side_effect=OSError("unexpected error")),
    ):
        result = await channel.collect(
            {"binary": sys.executable, "command": ["-c", "print('hi')"]},
            {},
        )

    assert result.success is False
    assert "CLI execution failed" in result.error


@pytest.mark.asyncio
async def test_collect_nonzero_exit_code(channel):
    """Non-zero exit code from subprocess returns failed ChannelResult."""
    with _allow(sys.executable):
        result = await channel.collect(
            {"binary": sys.executable, "command": ["-c", "import sys; sys.exit(1)"]},
            {},
        )
    assert result.success is False
    assert "exited with code" in result.error.lower()


@pytest.mark.asyncio
async def test_collect_invalid_json_output(channel):
    """Invalid JSON output returns failed ChannelResult."""
    with _allow(sys.executable):
        result = await channel.collect(
            {
                "binary": sys.executable,
                "command": ["-c", "print('not valid json')"],
                "output_format": "json",
            },
            {},
        )
    assert result.success is False
    assert "parse" in result.error.lower()


@pytest.mark.asyncio
async def test_health_check(channel):
    """health_check always returns True (binary checked per collect)."""
    result = await channel.health_check()
    assert result is True
