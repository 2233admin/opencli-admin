"""Shared OpenCLI executable resolution for probes and execution."""

import os
import shutil


def configured_opencli_bin() -> str:
    """Return the operator-selected executable, evaluated at call time."""
    return os.environ.get("OPENCLI_BIN") or "opencli"


def resolve_opencli_bin() -> str:
    """Resolve the selected executable through PATH when possible."""
    configured = configured_opencli_bin()
    return shutil.which(configured) or configured
