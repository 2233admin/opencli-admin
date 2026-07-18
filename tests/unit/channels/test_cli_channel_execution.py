"""Execution behaviour tests for explicitly allowlisted CLI binaries."""

import json
import sys
from unittest.mock import AsyncMock, Mock, patch

import pytest

from backend.channels.cli_channel import CLIChannel
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
    """Timeout kills the child so a subprocess is never orphaned."""
    mock_proc = AsyncMock()
    mock_proc.kill = Mock()

    async def timeout(awaitable, *, timeout):
        del timeout
        awaitable.close()
        raise TimeoutError

    with (
        _allow(sys.executable),
        patch("asyncio.create_subprocess_exec", return_value=mock_proc),
        patch("asyncio.wait_for", side_effect=timeout),
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
    """Generic subprocess exceptions return a failed ChannelResult."""
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
    """A non-zero exit code returns a failed ChannelResult."""
    with _allow(sys.executable):
        result = await channel.collect(
            {"binary": sys.executable, "command": ["-c", "import sys; sys.exit(1)"]},
            {},
        )
    assert result.success is False
    assert "exited with code" in result.error.lower()


@pytest.mark.asyncio
async def test_collect_invalid_json_output(channel):
    """Invalid JSON carries the error type needed by the SCHEMA_DRIFT chain."""
    from backend.control.error_kinds import ErrorKind, map_error_type

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
    assert result.error_type == "JSONDecodeError"
    assert map_error_type(result.error_type) is ErrorKind.SCHEMA_DRIFT
