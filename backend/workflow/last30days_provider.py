"""Adapter for the pinned upstream last30days research engine.

The adapter keeps the MIT upstream engine replaceable and invokes it without a
shell. OpenCLI-native domestic collection remains available in the built-in
situation-awareness executor; this provider is for strict upstream parity.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

LAST30DAYS_ENGINE_COMMIT = "249c7a4c040558a903d6838dee31012980d4946d"
LAST30DAYS_ENGINE_ENV = "LAST30DAYS_ENGINE_PATH"
LAST30DAYS_HOME_ENV = "LAST30DAYS_HOME"
LAST30DAYS_PYTHON_ENV = "LAST30DAYS_PYTHON"


class Last30DaysProviderError(RuntimeError):
    """Raised when the upstream engine cannot return its JSON contract."""


def execute_last30days_research(params: dict[str, Any]) -> dict[str, Any]:
    """Run the pinned engine's stable JSON export through a local provider."""

    engine = _resolve_engine_path(params)
    topic = _read_string(params.get("query")) or _read_string(params.get("topic"))
    if not topic:
        raise Last30DaysProviderError("last30days provider requires toolParams.query")
    python_executable = _read_string(os.environ.get(LAST30DAYS_PYTHON_ENV)) or sys.executable
    command = [
        python_executable,
        str(engine),
        topic,
        "--days",
        str(_bounded_int(params.get("windowDays"), default=30, minimum=1, maximum=365)),
        "--emit",
        "json",
        "--json-profile",
        _read_string(params.get("jsonProfile")) or "raw",
    ]
    if as_of := _read_string(params.get("asOf")):
        command.extend(["--as-of", as_of])
    sources = _string_list(params.get("sources"))
    if sources:
        command.extend(["--search", ",".join(sources)])
    depth = (_read_string(params.get("depth")) or "default").lower()
    if depth == "quick":
        command.append("--quick")
    elif depth == "deep":
        command.append("--deep")
    if params.get("verifyFreshness") is True:
        command.append("--verify-freshness")
    if params.get("noBrowserCookies") is True:
        command.append("--no-browser-cookies")
    if plan := params.get("plan"):
        command.extend(
            [
                "--plan",
                json.dumps(plan, ensure_ascii=False) if isinstance(plan, dict) else str(plan),
            ]
        )

    timeout_seconds = _bounded_int(
        params.get("timeoutSeconds"),
        default=300,
        minimum=10,
        maximum=3600,
    )
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            check=False,
            env={**os.environ, "PYTHONUTF8": "1"},
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise Last30DaysProviderError(f"last30days provider failed to start: {exc}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()[-1000:]
        raise Last30DaysProviderError(
            f"last30days provider exited with {completed.returncode}: {detail}"
        )
    payload = _parse_json_output(completed.stdout)
    return {
        "schema": "recent-research.provider.v1",
        "source": "last30days",
        "eventType": "recent.research.completed",
        "status": "completed",
        "provider": {
            "id": "last30days",
            "mode": "local-plugin",
            **_engine_provenance(engine),
            "enginePath": str(engine),
        },
        "report": payload,
    }


def _resolve_engine_path(params: dict[str, Any]) -> Path:
    configured = _read_string(os.environ.get(LAST30DAYS_ENGINE_ENV))
    if configured:
        path = Path(configured).expanduser().resolve()
    else:
        home = _read_string(os.environ.get(LAST30DAYS_HOME_ENV))
        if not home:
            raise Last30DaysProviderError(
                f"last30days provider is not installed: set {LAST30DAYS_ENGINE_ENV} "
                f"or {LAST30DAYS_HOME_ENV}"
            )
        path = (
            Path(home).expanduser().resolve()
            / "skills"
            / "last30days"
            / "scripts"
            / "last30days.py"
        )
    if not path.is_file():
        raise Last30DaysProviderError(f"last30days engine not found at {path}")
    return path


def _engine_provenance(engine: Path) -> dict[str, Any]:
    repository = _find_git_repository(engine.parent)
    observed_commit: str | None = None
    working_tree_clean: bool | None = None
    if repository is not None:
        git_environment = {
            "PATH": os.environ.get("PATH", ""),
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        }
        try:
            completed = subprocess.run(
                ["git", "-C", str(repository), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
                check=False,
                env=git_environment,
            )
        except (OSError, subprocess.SubprocessError):
            completed = None
        if completed and completed.returncode == 0:
            observed_commit = completed.stdout.strip() or None
            try:
                status = subprocess.run(
                    ["git", "-C", str(repository), "status", "--porcelain"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                    check=False,
                    env=git_environment,
                )
            except (OSError, subprocess.SubprocessError):
                status = None
            if status and status.returncode == 0:
                working_tree_clean = not bool(status.stdout.strip())
    return {
        "expectedUpstreamCommit": LAST30DAYS_ENGINE_COMMIT,
        "observedUpstreamCommit": observed_commit,
        "workingTreeClean": working_tree_clean,
        "versionVerified": (
            observed_commit == LAST30DAYS_ENGINE_COMMIT and working_tree_clean is True
        ),
    }


def _find_git_repository(start: Path) -> Path | None:
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def _parse_json_output(stdout: str) -> dict[str, Any]:
    text = stdout.strip()
    candidates = [text, *reversed([line.strip() for line in text.splitlines() if line.strip()])]
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise Last30DaysProviderError("last30days provider returned no JSON object")


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _read_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _bounded_int(value: object, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    return min(max(parsed, minimum), maximum)
