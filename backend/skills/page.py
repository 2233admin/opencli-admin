"""CDP page wrapper — drive a browser_pool Chrome over Playwright (ADR-0003 D1).

Connects **over CDP** (``chromium.connect_over_cdp(cdp_endpoint)``) to an
**already-running** Chrome supplied by ``backend.browser_pool`` — the same
substrate the opencli channel relies on. ``connect_over_cdp`` *attaches* to the
existing browser context, so a logged-in page (site cookies already present in
that Chrome) is reused; it does **not** launch a new browser. Local + LAN
endpoints only (ADR-0003 D1); driving NAT edge nodes via ``agent_server`` is v2.

``SkillPage`` exposes only the raw page ops the fixed verb set (#02) calls —
``goto / click / type / select / scroll / inner_text / extract`` — all
``ref``-addressed (a ``ref`` is the ``N`` that ``perception.snapshot()`` wrote
as ``data-skill-ref="N"``). It makes **no** risk decisions and exposes **no**
model-facing ``evaluate(js)`` escape hatch (ADR-0003 D2/D3); the single internal
``evaluate`` (for ``scroll``) stays server-side and is never surfaced to the
model.

The caller owns the pool-slot lifetime: pass in the endpoint string that
``browser_pool.get_pool().acquire(endpoint=...)`` yields; do **not** acquire the
slot inside ``SkillPage``. On close we drop the **CDP connection** (and stop the
Playwright driver) — we never close the underlying Chrome owned by the pool.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _ref_selector(ref: str | int) -> str:
    """CSS selector resolving an element strictly by its data-skill-ref.

    A ``ref`` is the ``N`` ``perception.snapshot()`` assigned as
    ``data-skill-ref="N"``. Resolving strictly by that attribute means a stale
    ref fails loudly (no element) rather than silently clicking the wrong one.
    """
    return f'[data-skill-ref="{ref}"]'


class SkillPage:
    """Thin async wrapper around a CDP-attached Playwright page.

    Holds the Playwright handle, the connected browser, and the active page.
    Build it via :func:`open_skill_page`; use it as an async context manager so
    the loop (#03) can ``async with open_skill_page(ep) as sp:``.
    """

    def __init__(self, pw: Any, browser: Any, page: Any) -> None:
        self._pw = pw
        self._browser = browser
        self.page = page

    # ── lifecycle ─────────────────────────────────────────────────────────
    async def __aenter__(self) -> "SkillPage":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Drop the CDP connection and stop the Playwright driver.

        We close the Playwright **connection** to the browser (for
        ``connect_over_cdp`` this detaches the client; it does not terminate the
        shared Chrome owned by the pool) and then stop the driver. Best-effort:
        connection teardown never raises out of here.
        """
        try:
            if self._browser is not None:
                await self._browser.close()
        except Exception as exc:  # pragma: no cover - teardown best-effort
            logger.debug("SkillPage: browser connection close failed: %s", exc)
        finally:
            self._browser = None
            try:
                if self._pw is not None:
                    await self._pw.stop()
            except Exception as exc:  # pragma: no cover - teardown best-effort
                logger.debug("SkillPage: playwright stop failed: %s", exc)
            finally:
                self._pw = None

    # ── raw page ops (the verb set #02 dispatches to) ─────────────────────
    async def goto(self, url: str) -> None:
        """Navigate to ``url`` and return when navigation settles."""
        await self.page.goto(url)

    async def click(self, ref: str | int) -> None:
        """Click the element tagged ``data-skill-ref="<ref>"``."""
        await self.page.locator(_ref_selector(ref)).click()

    async def type(self, ref: str | int, text: str, submit: bool = False) -> None:
        """Fill the ``ref`` element with ``text``; optionally press Enter."""
        locator = self.page.locator(_ref_selector(ref))
        await locator.fill(text)
        if submit:
            await locator.press("Enter")

    async def select(self, ref: str | int, value: str) -> None:
        """Select ``value`` in the ``ref`` ``<select>`` element."""
        await self.page.locator(_ref_selector(ref)).select_option(value)

    async def scroll(self, direction: str) -> None:
        """Scroll one viewport up/down.

        The only internal ``page.evaluate`` use besides perception; it is **not**
        exposed to the model (ADR-0003 D3 forbids a model-facing ``evaluate``).
        """
        sign = -1 if str(direction).lower() in ("up", "top", "-1") else 1
        await self.page.evaluate(
            "(s) => window.scrollBy(0, s * window.innerHeight)", sign
        )

    async def inner_text(self) -> str:
        """Return the page's visible text (for the ``extract`` verb). Text, not HTML."""
        return await self.page.inner_text("body")

    async def extract(self) -> str:
        """Alias of :meth:`inner_text` — the ``extract`` verb's text payload."""
        return await self.inner_text()


async def open_skill_page(cdp_endpoint: str) -> SkillPage:
    """Connect to an already-running Chrome over CDP and return a ``SkillPage``.

    ``cdp_endpoint`` is exactly the value
    ``browser_pool.get_pool().acquire(endpoint=...)`` yields (a CDP endpoint URL
    string). Attaches via ``chromium.connect_over_cdp`` to the **existing**
    browser context — reusing the logged-in session — and picks the existing
    context/page when present (``browser.contexts[0]`` → its first ``page``),
    only creating one if none exists. Does **not** launch a browser.
    """
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_endpoint)

    context = browser.contexts[0] if browser.contexts else await browser.new_context()
    page = context.pages[0] if context.pages else await context.new_page()

    logger.info("SkillPage: connected over CDP to %s", cdp_endpoint)
    return SkillPage(pw, browser, page)
