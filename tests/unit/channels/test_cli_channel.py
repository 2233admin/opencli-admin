"""Unit tests for the CLI channel."""

import sys

import pytest

from backend.channels.cli_channel import CLIChannel, _render_template


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


@pytest.mark.asyncio
async def test_collect_binary_not_found(channel):
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
    """asyncio.TimeoutError returns failed ChannelResult with timeout message."""
    from unittest.mock import AsyncMock, patch
    import asyncio

    mock_proc = AsyncMock()
    with (
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


@pytest.mark.asyncio
async def test_collect_generic_exception(channel):
    """Generic exception during subprocess exec returns failed ChannelResult."""
    from unittest.mock import patch

    with patch("asyncio.create_subprocess_exec", side_effect=OSError("unexpected error")):
        result = await channel.collect(
            {"binary": sys.executable, "command": ["-c", "print('hi')"]},
            {},
        )

    assert result.success is False
    assert "CLI execution failed" in result.error


@pytest.mark.asyncio
async def test_collect_nonzero_exit_code(channel):
    """Non-zero exit code from subprocess returns failed ChannelResult."""
    result = await channel.collect(
        {"binary": sys.executable, "command": ["-c", "import sys; sys.exit(1)"]},
        {},
    )
    assert result.success is False
    assert "exited with code" in result.error.lower()


@pytest.mark.asyncio
async def test_collect_invalid_json_output(channel):
    """Invalid JSON output returns failed ChannelResult."""
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
