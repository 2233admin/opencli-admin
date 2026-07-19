"""Execution behaviour tests for explicitly allowlisted CLI binaries."""

import json
import sys
from unittest.mock import AsyncMock, patch

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


async def _raise_timeout(awaitable, *, timeout):
    """Close the mocked communicate coroutine before simulating timeout."""
    del timeout
    awaitable.close()
    raise TimeoutError


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
    """Timeout kills the whole process tree so no descendant is orphaned."""
    mock_proc = AsyncMock()

    with (
        _allow(sys.executable),
        patch("asyncio.create_subprocess_exec", return_value=mock_proc),
        patch("asyncio.wait_for", side_effect=_raise_timeout),
        patch(
            "backend.channels.cli_channel._kill_subprocess",
            new=AsyncMock(),
        ) as kill_tree,
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
    kill_tree.assert_awaited_once_with(mock_proc)


@pytest.mark.asyncio
async def test_collect_timeout_logs_reap_failure(channel):
    """A process-tree reap failure is logged while timeout stays visible."""
    mock_proc = AsyncMock()
    with (
        _allow(sys.executable),
        patch("asyncio.create_subprocess_exec", return_value=mock_proc),
        patch("asyncio.wait_for", side_effect=_raise_timeout),
        patch(
            "backend.channels.cli_channel._kill_subprocess",
            new=AsyncMock(side_effect=RuntimeError("reap failed")),
        ),
        patch("backend.channels.cli_channel.logger") as mock_logger,
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
    mock_logger.warning.assert_called_once()


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
