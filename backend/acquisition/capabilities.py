"""Runtime-probed capability catalog for managed GEO acquisition."""

import asyncio
import os
import re

from backend.opencli_runtime import resolve_opencli_bin
from backend.schemas.acquisition import CapabilityDescriptor

OHMYOPENCLI_COMMIT = "8a087abe1805a9cff77b64ba80da12379afa184e"
OFFICIAL_SITE_CAPABILITY_COMMIT = "35b146e675a51f013f293d12d303cfedfac58495"
OPENCLI_VERSION = "1.8.5"
COMMAND_TIMEOUT_SECONDS = 15.0


async def _command(*args: str, env: dict[str, str] | None = None) -> tuple[int, str]:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        try:
            stdout, _ = await asyncio.wait_for(
                process.communicate(), timeout=COMMAND_TIMEOUT_SECONDS
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            return 1, ""
        return process.returncode or 0, stdout.decode(errors="replace")
    except OSError:
        return 1, ""


async def _runtime_is_installed() -> bool:
    from backend.config import get_settings

    root = os.path.abspath(get_settings().ohmyopencli_root)
    commit_rc, commit = await _command("git", "-C", root, "rev-parse", "HEAD")
    if commit_rc != 0 or commit.strip() != OHMYOPENCLI_COMMIT:
        return False

    source_rc, _ = await _command(
        "git",
        "-C",
        root,
        "merge-base",
        "--is-ancestor",
        OFFICIAL_SITE_CAPABILITY_COMMIT,
        "HEAD",
    )
    if source_rc != 0:
        return False

    dirty_rc, dirty_output = await _command(
        "git",
        "-C",
        root,
        "status",
        "--porcelain",
        "--untracked-files=no",
    )
    if dirty_rc != 0 or dirty_output.strip():
        return False

    opencli_bin = resolve_opencli_bin()
    version_rc, version_output = await _command(opencli_bin, "--version")
    versions = re.findall(r"\d+\.\d+\.\d+", version_output)
    if version_rc != 0 or OPENCLI_VERSION not in versions:
        return False

    command_rc, _ = await _command(
        opencli_bin, "official-site", "observe", "--help"
    )
    if command_rc != 0:
        return False

    patch_env = os.environ.copy()
    patch_env["OPENCLI_CDP_ENDPOINT"] = "http://127.0.0.1:9"
    patch_rc, patch_output = await _command(
        opencli_bin,
        "official-site",
        "observe",
        "--url",
        "https://example.invalid",
        "-f",
        "json",
        env=patch_env,
    )
    return patch_rc != 0 and "CDP not reachable at http://127.0.0.1:9" in patch_output


def _anonymous_profile_available() -> bool:
    from backend.browser_pool import get_pool

    try:
        pool = get_pool()
    except RuntimeError:
        return False
    return any(
        pool.get_profile_kind(endpoint) == "anonymous" for endpoint in pool.endpoints
    )


async def probe_capabilities() -> list[CapabilityDescriptor]:
    """Publish only the fixed runtime's real command registrations."""
    if not await _runtime_is_installed():
        return []

    ready = _anonymous_profile_available()
    return [
        CapabilityDescriptor(
            capability_id="official-site.observe",
            capability_version="1.0.0",
            output_schema_version="1",
            ready=ready,
            runtime={
                "ohmyopencli_repo_commit": OHMYOPENCLI_COMMIT,
                "capability_source_commit": OFFICIAL_SITE_CAPABILITY_COMMIT,
                "opencli_version": OPENCLI_VERSION,
            },
            unavailable_reason=None if ready else "no_clean_profile",
        )
    ]
