"""BrowserActChannel — the generic browser-act pack manifest interpreter
(GOAL-7 PR-C; see GOAL-7.md architecture decisions #1, #4, #5, #6, #8, #10).

Drives a vendored pack (backend/browser_act_packs/<category>/<pack>/,
PR-A) through its channel.manifest.json (PR-A schema, backend/
browser_act_packs/manifest.py) by replaying manifest.steps against a
browser-act CLI session (PR-B, backend/browser_act/cli.py). There is no
per-pack code here -- this class is a generic interpreter of the manifest,
nothing more (decision #1: deterministic script-runner, no LLM/perceive-
gate-act loop).

Two subprocess hops per ``eval_script`` step, both argv-only (decision #6,
never shell):
1. ``python <pack>/scripts/x.py <argv>`` (backend.browser_act.scripts.
   run_pack_script) -> stdout is a JS string.
2. ``browser-act --session <n> eval <js>`` (backend.browser_act.cli.
   BrowserActSession.eval) -> stdout is a JSON string the pack's JS computed
   from the live DOM.

Login walls / anti-bot challenges are NOT automated (decision #4): when a
script's JSON result reports ``{"error": true, "message": "..."}`` and the
message matches an auth/anti-bot keyword, collect() returns
``error_type="needs_human"`` and stops immediately -- it never retries or
attempts a bypass. Any other reported error is a generic ``"error"``.

Pagination (decision #5) is only partially interpretable in general: this
channel understands ``pagination.mode == "url_page"`` (navigate to
``pagination.url_template`` for page 2+) and a narrow ``stop_when`` shape
(``"result_count < N"`` / ``"<="``). Anything else falls back to a fixed
``max_pages`` cap and an "a page returned 0 items" stop signal -- documented
limitation, not silently pretended to be complete (see ``_stop_when_triggered``).
"""

import json
import logging
import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from backend.browser_act import cli as browser_act_cli
from backend.browser_act.scripts import ScriptError, run_pack_script
from backend.browser_act_packs.catalog import PackCatalog, PackInfo
from backend.browser_act_packs.manifest import PackManifest, load_manifest
from backend.channels.base import AbstractChannel, Capabilities, ChannelResult
from backend.channels.registry import register_channel

logger = logging.getLogger(__name__)

_VALID_MODES = {"chrome-direct", "stealth"}

#: Hard cap on pages fetched when channel_config doesn't override it via
#: "max_pages". PackManifest's Pagination model (PR-A) has no max_pages
#: field of its own (mode/url_template/page_param/stop_when only) -- this is
#: a channel-level safety net, not something a pack manifest declares.
_DEFAULT_MAX_PAGES = 5

#: Login-wall / anti-bot keywords (decision #4). A script's reported error
#: message matching one of these (case-insensitive substring match) is an
#: operational boundary, not a bug -- collect() fails loudly with
#: error_type="needs_human" rather than guessing or retrying past it.
_AUTH_KEYWORDS = (
    "login",
    "log in",
    "sign in",
    "captcha",
    "verify",
    "verification",
    "robot",
    "blocked",
    "forbidden",
    "登录",
    "验证",
    "人机",
)

#: Minimal stop_when interpreter: only the "result_count < N" / "<= N" shape
#: (the one every vendored SKILL.md pagination note seen so far uses, e.g.
#: taobao-keyword-search's "result count < 10") is understood.
_STOP_WHEN_RE = re.compile(r"result_count\s*(<=|<)\s*(\d+)")


def _classify_error(message: str) -> str:
    """Classify a pack script's reported error message.

    Returns "needs_human" when the message matches a login/anti-bot keyword
    (see ``_AUTH_KEYWORDS``) -- decision #4: these are collection boundaries,
    not bugs, and must never be retried or bypassed. Everything else is a
    plain "error" (selector drift, page structure change, etc.).
    """
    lowered = message.lower()
    return "needs_human" if any(kw in lowered for kw in _AUTH_KEYWORDS) else "error"


def _stop_when_triggered(stop_when: str | None, page_item_count: int) -> bool:
    """Minimally interpret a manifest's ``pagination.stop_when`` expression.

    Only "result_count < N" / "result_count <= N" is parsed. Anything else
    is NOT recognized as a stop signal here -- callers must still rely on
    ``max_pages`` and the "a page returned 0 items" fallback to terminate
    pagination for stop_when expressions this can't interpret (documented
    limitation, GOAL-7 PR-C -- full stop_when grammar is out of scope).
    """
    if not stop_when:
        return False
    match = _STOP_WHEN_RE.search(stop_when)
    if not match:
        return False
    op, threshold = match.group(1), int(match.group(2))
    return page_item_count <= threshold if op == "<=" else page_item_count < threshold


class _CollectAbort(Exception):
    """Internal control-flow signal: stop the collect() pagination loop and
    report this outcome as a ChannelResult. Never escapes collect()."""

    def __init__(self, error_type: str, message: str) -> None:
        self.error_type = error_type
        self.message = message
        super().__init__(message)


@register_channel
class BrowserActChannel(AbstractChannel):
    """Generic browser-act pack manifest interpreter (see module docstring)."""

    channel_type = "browser_act"
    capabilities = Capabilities(paginated=True, session_affinity=True)

    def __init__(self, catalog: PackCatalog | None = None) -> None:
        # The registered singleton (via @register_channel, which calls cls()
        # with no args at import time) always gets the real vendored-packs
        # root. Tests inject a PackCatalog(root=tmp_path) here to exercise a
        # synthetic pack without depending on PR-D's real manifests or a
        # real browser.
        self.catalog = catalog if catalog is not None else PackCatalog()

    # ── config / manifest resolution ────────────────────────────────────

    def _resolve_pack_info(
        self, config: dict[str, Any]
    ) -> tuple[PackInfo | None, str | None]:
        """Resolve channel_config's pack selector to a PackInfo.

        Accepts either ``{"pack": "<category>/<name>"}`` or
        ``{"domain": ..., "capability": ...}`` (decision #8). Returns
        (PackInfo, None) on success or (None, <error string>) on failure --
        never raises, so validate_config and collect() can share it.
        """
        pack = config.get("pack")
        domain = config.get("domain")
        capability = config.get("capability")
        if pack:
            parts = str(pack).split("/", 1)
            if len(parts) != 2:
                return None, f"invalid 'pack' value {pack!r}: expected '<category>/<name>'"
            domain, capability = parts
        if not domain or not capability:
            return None, (
                "channel_config must specify 'pack': '<category>/<name>' or "
                "both 'domain' and 'capability'"
            )
        info = self.catalog.get_pack(domain, capability)
        if info is None:
            return None, (
                f"no browser-act pack found for domain={domain!r} capability={capability!r}"
            )
        return info, None

    def _load_pack_manifest(
        self, pack_info: PackInfo
    ) -> tuple[Path, PackManifest | None, str | None]:
        """Locate + load a resolved pack's channel.manifest.json.

        Returns (pack_dir, manifest, None) on success or
        (pack_dir, None, <error string>) when the manifest is missing or
        invalid (JSON or schema).
        """
        pack_dir = self.catalog.root / pack_info.path
        manifest_path = pack_dir / "channel.manifest.json"
        if not manifest_path.exists():
            return pack_dir, None, (
                f"pack {pack_info.path!r} has no channel.manifest.json "
                "(authored in PR-D)"
            )
        try:
            manifest = load_manifest(manifest_path)
        except (json.JSONDecodeError, ValidationError) as exc:
            return pack_dir, None, (
                f"pack {pack_info.path!r} has an invalid channel.manifest.json: {exc}"
            )
        return pack_dir, manifest, None

    async def validate_config(self, config: dict[str, Any]) -> list[str]:
        """Validate channel_config; only checks what config alone can prove:
        pack resolvability, mode legality, and required params NOT
        satisfiable from config['params'] + the manifest's own defaults.
        Runtime ``parameters`` (from a task trigger) aren't known yet at
        validate_config time -- collect() re-checks with those included."""
        errors: list[str] = []

        mode = config.get("mode", "chrome-direct")
        if mode not in _VALID_MODES:
            errors.append(f"invalid mode {mode!r}: must be one of {sorted(_VALID_MODES)}")

        pack_info, pack_error = self._resolve_pack_info(config)
        if pack_error:
            errors.append(pack_error)
            return errors

        _pack_dir, manifest, manifest_error = self._load_pack_manifest(pack_info)
        if manifest_error:
            errors.append(manifest_error)
            return errors

        caller_params = config.get("params") or {}
        for spec in manifest.param_schema:
            if spec.required and spec.name not in caller_params and spec.default is None:
                errors.append(
                    f"missing required param {spec.name!r} for pack {pack_info.path!r}"
                )

        return errors

    # ── collect() ────────────────────────────────────────────────────────

    async def collect(
        self, config: dict[str, Any], parameters: dict[str, Any]
    ) -> ChannelResult:
        pack_info, pack_error = self._resolve_pack_info(config)
        if pack_error:
            return ChannelResult(success=False, error_type="error", error=pack_error)

        pack_dir, manifest, manifest_error = self._load_pack_manifest(pack_info)
        if manifest_error:
            return ChannelResult(success=False, error_type="error", error=manifest_error)
        assert manifest is not None  # manifest_error is None => manifest is set

        mode = config.get("mode", "chrome-direct")
        if mode not in _VALID_MODES:
            return ChannelResult(
                success=False,
                error_type="error",
                error=f"invalid mode {mode!r}: must be one of {sorted(_VALID_MODES)}",
            )

        caller_params = {**(config.get("params") or {}), **parameters}
        merged_params: dict[str, Any] = {}
        missing: list[str] = []
        for spec in manifest.param_schema:
            if spec.name in caller_params:
                merged_params[spec.name] = caller_params[spec.name]
            elif spec.default is not None:
                merged_params[spec.name] = spec.default
            elif spec.required:
                missing.append(spec.name)
        if missing:
            return ChannelResult(
                success=False,
                error_type="error",
                error=f"missing required param(s): {', '.join(missing)}",
            )

        max_pages = config.get("max_pages") or _DEFAULT_MAX_PAGES

        # Credential injection is PR-E's job (decision #7: SourceCredential /
        # AuthManager, key_name="browser_act_api_key"). This hook exists so
        # PR-E only has to fill session_env -- the loop below doesn't change.
        session_env: dict[str, str] | None = None
        session_name = f"browser-act-{pack_info.domain}-{pack_info.capability}"

        items: list[dict[str, Any]] = []
        pages_fetched = 0

        try:
            async with browser_act_cli.session(session_name, env=session_env) as sess:
                for page_num in range(1, max_pages + 1):
                    ctx = {**caller_params, **merged_params, "page": page_num}
                    page_items = await self._run_page(sess, pack_dir, manifest, ctx, page_num)
                    pages_fetched += 1
                    items.extend(page_items)

                    if not page_items:
                        # Documented pagination-stop fallback: an empty page
                        # always ends collection, regardless of stop_when.
                        break
                    if _stop_when_triggered(manifest.pagination.stop_when, len(page_items)):
                        break
                    if manifest.pagination.mode != "url_page":
                        # Only "url_page" pagination is interpreted here; any
                        # other/absent mode is single-page (documented
                        # limitation -- see module docstring).
                        break
        except _CollectAbort as exc:
            return ChannelResult(
                success=False,
                error_type=exc.error_type,
                error=exc.message,
                metadata={"pack": pack_info.path, "pages_fetched": pages_fetched},
            )
        except (
            browser_act_cli.BrowserActError,
            ScriptError,
            json.JSONDecodeError,
            TimeoutError,
            # A manifest step's url_template/args referencing a param name
            # absent from ctx (param_schema/step mismatch -- an authoring
            # bug in the pack's channel.manifest.json) raises KeyError from
            # str.format(**ctx); caught here so a bad manifest still returns
            # a ChannelResult instead of crashing collect() uncaught.
            KeyError,
        ) as exc:
            return ChannelResult(
                success=False,
                error_type="error",
                error=f"browser-act collection failed: {exc}",
                metadata={"pack": pack_info.path, "pages_fetched": pages_fetched},
            )

        if manifest.success.required_field:
            field = manifest.success.required_field
            before = len(items)
            # Filter+warn rather than hard-fail: a batch where most items
            # have the field but a few don't shouldn't discard the whole
            # collection outright (min_count below still catches "too few
            # survived" as a real failure).
            items = [it for it in items if isinstance(it, dict) and it.get(field)]
            filtered = before - len(items)
            if filtered:
                logger.warning(
                    "browser_act pack %s: filtered %d/%d item(s) missing "
                    "required_field %r",
                    pack_info.path,
                    filtered,
                    before,
                    field,
                )

        if len(items) < manifest.success.min_count:
            return ChannelResult(
                success=False,
                error_type="error",
                error=(
                    f"collected {len(items)} item(s), below "
                    f"success.min_count={manifest.success.min_count}"
                ),
                metadata={"pack": pack_info.path, "pages_fetched": pages_fetched},
            )

        return ChannelResult(
            success=True,
            items=items,
            metadata={"pack": pack_info.path, "pages_fetched": pages_fetched, "mode": mode},
        )

    async def _run_page(
        self,
        sess: Any,
        pack_dir: Path,
        manifest: PackManifest,
        ctx: dict[str, Any],
        page_num: int,
    ) -> list[dict[str, Any]]:
        """Run manifest.steps once (one page). ``page_num > 1`` with
        ``pagination.mode == "url_page"`` replaces the first navigate step's
        URL with ``pagination.url_template`` (which carries the page param)
        -- a step's own ``url_template`` is only used for the initial
        navigation (page 1)."""
        items: list[dict[str, Any]] = []
        for step in manifest.steps:
            if step.op == "navigate":
                if (
                    page_num > 1
                    and manifest.pagination.mode == "url_page"
                    and manifest.pagination.url_template
                ):
                    url = manifest.pagination.url_template.format(**ctx)
                else:
                    url = (step.url_template or "").format(**ctx)
                await sess.navigate(url)
            elif step.op == "wait":
                await sess.wait(step.wait_mode or "stable")
            elif step.op == "eval_script":
                script_path = pack_dir / (step.script or "")
                templated_args = [str(a).format(**ctx) for a in (step.args or [])]
                js = await run_pack_script(script_path, templated_args)
                raw = await sess.eval(js)
                parsed = json.loads(raw)
                if isinstance(parsed, dict) and parsed.get("error"):
                    message = str(parsed.get("message", "unknown pack script error"))
                    raise _CollectAbort(_classify_error(message), message)
                items = parsed if isinstance(parsed, list) else [parsed]
            elif step.op == "click" and step.index is not None:
                await sess.click(step.index)
            elif step.op == "input" and step.index is not None:
                value = (step.value or "").format(**ctx)
                await sess.input(step.index, value)
        return items

    async def health_check(
        self, config: dict[str, Any] | None = None, source_id: str | None = None
    ) -> bool:
        """Liveness probe: ``browser-act --version``. False on any failure
        (binary missing -> OSError, non-zero exit/timeout -> BrowserActError)
        -- never raises."""
        try:
            await browser_act_cli.version()
            return True
        except (browser_act_cli.BrowserActError, OSError):
            return False
