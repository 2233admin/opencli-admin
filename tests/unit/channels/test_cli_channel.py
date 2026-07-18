"""Core unit tests for the CLI channel."""

import pytest

from backend.channels.cli_channel import CLIChannel, _render_template


@pytest.fixture
def channel():
    return CLIChannel()


def test_render_template_basic():
    assert _render_template("hello {{name}}", {"name": "world"}) == "hello world"


def test_render_template_missing_key():
    assert _render_template("{{missing}}", {}) == "{{missing}}"


def test_render_template_multiple_keys():
    result = _render_template("{{a}} and {{b}}", {"a": "foo", "b": "bar"})
    assert result == "foo and bar"


@pytest.mark.asyncio
async def test_validate_config_missing_binary(channel):
    errors = await channel.validate_config({"command": ["search"]})
    assert any("binary" in error for error in errors)


@pytest.mark.asyncio
async def test_validate_config_missing_command(channel):
    errors = await channel.validate_config({"binary": "mycli"})
    assert any("command" in error for error in errors)


@pytest.mark.asyncio
async def test_validate_config_valid(channel):
    errors = await channel.validate_config(
        {
            "binary": "mycli",
            "command": ["search", "--keyword", "test"],
        }
    )
    assert errors == []


@pytest.mark.asyncio
async def test_health_check(channel):
    """health_check always returns True (binary checked per collect)."""
    result = await channel.health_check()
    assert result is True
