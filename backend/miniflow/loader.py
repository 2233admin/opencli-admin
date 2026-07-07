"""Load MiniFlow workflow files with an upstream-compatible import alias."""

from __future__ import annotations

import importlib.util
import os
import sys
import threading
from pathlib import Path
from types import ModuleType
from typing import Any

import backend.miniflow as _builtin_miniflow
import backend.miniflow.audit as _audit
import backend.miniflow.model as _model
import backend.miniflow.runner as _runner

_MISSING = object()
_ALIASES: dict[str, ModuleType] = {
    "miniflow": _builtin_miniflow,
    "miniflow.audit": _audit,
    "miniflow.model": _model,
    "miniflow.runner": _runner,
}
_ALIAS_LOCK = threading.RLock()

# CRITICAL (arbitrary code execution / arbitrary file write): load_workflow_file
# runs spec_from_file_location + exec_module on a caller-supplied path, and
# callers (backend.agent_runtimes.miniflow_adapter) source that path from
# agent-task config that any fleet-token holder can set. confine_to_workflow_root
# below is the sole gate — fail closed (no configured root = reject everything),
# mirroring the Settings.cli_channel_allowed_binaries "empty = deny all" pattern.
_ROOT_ENV_VAR = "MINIFLOW_WORKFLOW_ROOT"


def _configured_root() -> Path | None:
    """Resolve the operator-configured MiniFlow workflow allowlist root.

    Prefers ``Settings.miniflow_workflow_root`` (backend.config) when that
    field exists, but tolerates it not being present and falls back to the
    ``MINIFLOW_WORKFLOW_ROOT`` env var directly — this gate must never be
    silently disabled by an import/attribute mismatch.
    """
    raw: Any = None
    try:
        from backend.config import get_settings

        raw = getattr(get_settings(), "miniflow_workflow_root", None)
    except Exception:
        raw = None
    if not raw:
        raw = os.environ.get(_ROOT_ENV_VAR)
    if not isinstance(raw, str) or not raw.strip():
        return None
    return Path(raw.strip()).expanduser().resolve()


def confine_to_workflow_root(path: str | Path, *, label: str = "path") -> Path:
    """Resolve ``path`` and verify it lives inside the configured allowlist root.

    Fails closed: with no root configured, every path is rejected. Used for
    ``workflow_path`` here and reused by ``miniflow_adapter`` for ``cwd`` and
    ``audit_log``, since all three are attacker-influenced via task config.
    """
    root = _configured_root()
    if root is None:
        raise ValueError(
            "MiniFlow workflow root is not configured (set "
            "Settings.miniflow_workflow_root or MINIFLOW_WORKFLOW_ROOT); "
            f"refusing to resolve {label} {str(path)!r}"
        )
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f"{label} escapes allowed root: {resolved} is not under {root}")
    return resolved


def load_workflow_file(path: str | Path) -> Any:
    """Import ``path`` and return its module-level ``workflow`` object.

    The load temporarily exposes ``backend.miniflow`` as ``miniflow`` so files
    written for ``EternallLight/miniflow`` can run without installing that
    package on every fleet node.

    ``path`` must resolve inside the configured MiniFlow allowlist root (see
    ``confine_to_workflow_root``) — this function executes the target file via
    ``exec_module``, so an unconfined path is arbitrary code execution.
    """

    workflow_path = confine_to_workflow_root(path, label="workflow_path")
    if not workflow_path.is_file():
        raise FileNotFoundError(f"MiniFlow workflow file not found: {workflow_path}")

    with _ALIAS_LOCK:
        previous = {name: sys.modules.get(name, _MISSING) for name in _ALIASES}
        try:
            sys.modules.update(_ALIASES)
            spec = importlib.util.spec_from_file_location(
                f"_opencli_miniflow_{workflow_path.stem}", workflow_path
            )
            if spec is None or spec.loader is None:
                raise ValueError(f"Could not load a MiniFlow workflow module from: {workflow_path}")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        finally:
            for name, value in previous.items():
                if value is _MISSING:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = value

    if not hasattr(module, "workflow"):
        raise ValueError(
            f"{workflow_path} does not define a module-level `workflow` "
            "(expected `workflow = Workflow(...)`)."
        )
    return module.workflow
