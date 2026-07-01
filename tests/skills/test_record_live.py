"""End-to-end ``live`` test: the record leg against a **real** Chrome.

The one thing the fake-page unit tests (``test_record.py``) cannot prove: that
Playwright's ``page.expose_binding`` + ``add_init_script`` genuinely deliver
real DOM click/change/submit events back into Python. Gated behind the
existing ``live`` pytest marker (same convention as
``test_execute_loop_live.py``) — the default ``pytest -m "not live"`` suite
never needs a browser.

What is real here: a real local Chrome reached over CDP
(``backend.skills.page.open_skill_page`` / ``connect_over_cdp``), a
deterministic local page served by an in-test ``ThreadingHTTPServer``, and
Playwright's own ``page.click()`` / ``page.fill()`` driving *real* browser
interaction — standing in for a human's mouse/keyboard (no literal human
required to prove the plumbing works). What's scripted: nothing else — this
is ``backend.skills.record`` directly, no pipeline/task spine involved (the
record leg is a standalone capture flow, not a ``CollectionTask``).

How to run (same env var as the execute leg's live test):
``SKILL_LIVE_CDP_ENDPOINT=http://127.0.0.1:9222 pytest -m live tests/skills/test_record_live.py``
"""

import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from backend.skills import record as record_module

pytestmark = pytest.mark.live

_PAGE_HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>Record Demo</title></head><body>
<h1>Record demo</h1>
<input id="email" aria-label="email address" placeholder="email" />
<select id="country" aria-label="country">
  <option value="US">US</option>
  <option value="CN">CN</option>
</select>
<button id="go" aria-label="Go">Go</button>
</body></html>"""


class _Handler(BaseHTTPRequestHandler):
    def _send(self, body: str) -> None:
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):  # noqa: N802 - http.server API name
        self._send(_PAGE_HTML)

    def log_message(self, *_args):
        return


@pytest.fixture(scope="module")
def local_site():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture(scope="module")
def cdp_endpoint():
    ep = os.environ.get("SKILL_LIVE_CDP_ENDPOINT") or os.environ.get("OPENCLI_CDP_ENDPOINT")
    if not ep:
        pytest.skip(
            "set SKILL_LIVE_CDP_ENDPOINT to a running Chrome --remote-debugging-port "
            "endpoint (e.g. http://127.0.0.1:9222) to run the live record e2e"
        )
    return ep


async def test_live_capture_records_navigate_type_select_click(cdp_endpoint, local_site):
    """Real Playwright interaction on a real page → real captured steps.

    Drives the page exactly like a human would (fill the email box, pick a
    country, click Go), then confirms the resulting ``journey_trace_v1`` trace
    contains a step per real interaction with the right verb/name/value — proof
    that ``expose_binding``/``add_init_script`` genuinely round-trips DOM events,
    not just the fake-page unit tests' simulated callback invocation.
    """
    session = await record_module.start_recording(
        cdp_endpoint, domain="record-live-test", capability="fill-form"
    )
    try:
        page = session.page.page
        await page.goto(local_site)
        await page.fill("#email", "demo@example.com")
        # `fill` sets value programmatically without necessarily firing a native
        # `change` event in all Playwright/Chromium combinations — press Tab to
        # blur and guarantee the browser's own `change` event fires, exactly
        # like a real human tabbing to the next field.
        await page.locator("#email").press("Tab")
        await page.select_option("#country", "CN")
        await page.click("#go")
        # `expose_binding` calls cross the CDP websocket asynchronously — give
        # the last binding call a moment to land before stopping (a real human
        # always leaves this much gap before clicking "stop recording"; this
        # is purely a fast-scripted-test artifact, not a product race).
        await page.wait_for_timeout(300)

        trace = await session.stop(status="success", note="filled the form")
    finally:
        # session.stopped is already True by the time stop() returns, so the
        # old `if not session.stopped` guard here skipped cleanup on exactly
        # the success path -- always close, same as the API's record_stop.
        await session.page.aclose()

    assert trace["schema"] == "journey_trace_v1"
    assert trace["outcome"]["status"] == "success"

    steps = trace["steps"]
    verbs = [s["verb"] for s in steps]
    # navigate (from goto) + type (email) + select (country) + click (go) + done.
    assert "navigate" in verbs
    assert "type" in verbs
    assert "select" in verbs
    assert "click" in verbs
    assert verbs[-1] == "done"

    type_step = next(s for s in steps if s["verb"] == "type")
    assert type_step["args"]["text"] == "demo@example.com"
    assert "email" in type_step["args"]["name"].lower()

    select_step = next(s for s in steps if s["verb"] == "select")
    assert select_step["args"]["value"] == "CN"

    click_step = next(s for s in steps if s["verb"] == "click")
    assert click_step["target"] == "Go"
