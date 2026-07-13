"""Live black-box certification for the pinned managed OpenCLI runtime."""

import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


@pytest.mark.live
def test_dead_explicit_cdp_endpoint_never_falls_back_to_default_bridge():
    binary = os.environ.get("MANAGED_OPENCLI_BIN")
    if not binary:
        pytest.skip("MANAGED_OPENCLI_BIN is not configured")

    requests: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            requests.append(self.path)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"ok":true,"extensionConnected":true}')

        def do_POST(self):  # noqa: N802
            requests.append(self.path)
            self.send_response(500)
            self.end_headers()

        def log_message(self, format, *args):  # noqa: A002
            return

    try:
        daemon = ThreadingHTTPServer(("127.0.0.1", 19825), Handler)
    except OSError:
        pytest.skip("localhost:19825 is already owned by a real OpenCLI daemon")
    thread = threading.Thread(target=daemon.serve_forever, daemon=True)
    thread.start()
    try:
        env = os.environ.copy()
        env["OPENCLI_CDP_ENDPOINT"] = "http://127.0.0.1:9"
        env["OPENCLI_DAEMON_HOST"] = "127.0.0.1"
        env.pop("OPENCLI_DAEMON_PORT", None)
        completed = subprocess.run(
            [
                binary,
                "official-site",
                "observe",
                "--url",
                "https://example.invalid",
                "-f",
                "json",
            ],
            capture_output=True,
            text=True,
            env=env,
            timeout=20,
            check=False,
        )
    finally:
        daemon.shutdown()
        daemon.server_close()
        thread.join(timeout=2)

    output = completed.stdout + completed.stderr
    assert completed.returncode != 0
    assert "CDP not reachable at http://127.0.0.1:9" in output
    assert requests == []
