"""Load MiniFlow workflow files with an upstream-compatible import alias."""

from __future__ import annotations

import importlib.util
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


def load_workflow_file(path: str | Path) -> Any:
    """Import ``path`` and return its module-level ``workflow`` object.

    The load temporarily exposes ``backend.miniflow`` as ``miniflow`` so files
    written for ``EternallLight/miniflow`` can run without installing that
    package on every fleet node.
    """

    workflow_path = Path(path)
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
