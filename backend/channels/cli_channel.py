"""Generic CLI tool channel with Jinja2 template support."""

import asyncio
import json
import os
import re
import shlex
import shutil
from typing import Any

from backend.channels.base import AbstractChannel, ChannelResult
from backend.channels.registry import register_channel

_TEMPLATE_RE = re.compile(r"\{\{(\w+)\}\}")


def _render_template(value: str, context: dict[str, Any]) -> str:
    """Simple {{key}} template rendering."""
    return _TEMPLATE_RE.sub(lambda m: str(context.get(m.group(1), m.group(0))), value)


def _binary_allowed(binary: str, allowlist: list[str]) -> bool:
    """Exact match after path normalization (separators, case on Windows).

    Deliberately no basename matching and no PATH resolution: the operator
    allowlists the precise string/path they intend to run, nothing looser.
    """
    target = os.path.normcase(os.path.normpath(binary))
    return any(os.path.normcase(os.path.normpath(a)) == target for a in allowlist)


@register_channel
class CLIChannel(AbstractChannel):
    """Collect data by running an arbitrary CLI tool."""

    channel_type = "cli"

    async def collect(
        self, config: dict[str, Any], parameters: dict[str, Any]
    ) -> ChannelResult:
        binary: str = config.get("binary", "")
        command_template: list[str] = config.get("command", [])
        output_format: str = config.get("output_format", "json")
        timeout: int = config.get("timeout", 60)
        env_vars: dict[str, str] = config.get("env", {})

        # ADR-0005 (audit P0-4): this channel is an arbitrary-binary-execution
        # surface, so it only runs binaries the operator explicitly allowlisted
        # (CLI_CHANNEL_ALLOWED_BINARIES; empty default = deny all). Enforced
        # before any subprocess is spawned; the rejection is a permanent error
        # (see pipeline/error_taxonomy.py) so runs fail fast and honestly
        # instead of burning retry budget on a deterministic denial.
        from backend.config import get_settings

        if not _binary_allowed(binary, get_settings().cli_allowed_binaries):
            return ChannelResult.fail(
                f"Binary {binary!r} is not on the CLI channel allowlist "
                "(CLI_CHANNEL_ALLOWED_BINARIES; empty = deny all, ADR-0005)",
                error_type="BinaryNotAllowedError",
            )

        context = {**config.get("defaults", {}), **parameters}
        rendered_cmd = [
            _render_template(part, context) for part in command_template
        ]
        full_cmd = [binary, *rendered_cmd]

        env = {**os.environ, **env_vars}

        try:
            proc = await asyncio.create_subprocess_exec(
                *full_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            # Don't orphan the child: wait_for only cancels communicate();
            # the subprocess itself keeps running until explicitly killed.
            proc.kill()
            try:
                await proc.wait()
            except Exception:
                pass
            return ChannelResult.fail(
                f"CLI command timed out after {timeout}s", error_type=type(exc).__name__
            )
        except FileNotFoundError as exc:
            return ChannelResult.fail(
                f"Binary not found: {binary!r}", error_type=type(exc).__name__
            )
        except Exception as exc:
            return ChannelResult.fail(f"CLI execution failed: {exc}", error_type=type(exc).__name__)

        if proc.returncode != 0:
            return ChannelResult.fail(
                f"CLI exited with code {proc.returncode}: {stderr.decode()[:500]}"
            )

        output = stdout.decode()
        if output_format == "json":
            try:
                data = json.loads(output)
                items = data if isinstance(data, list) else [data]
            except json.JSONDecodeError as exc:
                return ChannelResult.fail(f"Failed to parse CLI JSON output: {exc}")
        else:
            # Plain text: each line is a record
            items = [{"line": line} for line in output.splitlines() if line.strip()]

        return ChannelResult.ok(items, binary=binary, command=full_cmd)

    async def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        if not config.get("binary"):
            errors.append("'binary' is required for cli channel")
        if not config.get("command"):
            errors.append("'command' is required for cli channel")
        return errors

    async def health_check(
        self, config: dict[str, Any] | None = None, source_id: str | None = None
    ) -> bool:
        return True  # Binary existence checked per-collect
