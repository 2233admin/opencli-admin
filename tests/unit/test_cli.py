"""Unit tests for the backend.cli skill CLI (record→distill wizard)."""

import argparse
from unittest.mock import patch

from backend import cli as cli_mod


class _FakeResponse:
    def __init__(self, data):
        self.status_code = 200
        self._data = data

    def json(self):
        return {"data": self._data}


class _FakeClient:
    """Stands in for httpx.Client: records every POST, no real network."""

    def __init__(self):
        self.posts: list[tuple[str, dict]] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, path, json=None, timeout=None):
        self.posts.append((path, json))
        if path == "/skills/record/start":
            return _FakeResponse({"session_id": "sess-1", "cdp_endpoint": "ws://chrome"})
        assert path == "/skills/record/sess-1/stop"
        return _FakeResponse({"trace": {"steps": []}})


def _make_args(**overrides):
    base = dict(base_url="http://x", domain="example.com", capability="cap", cdp_endpoint=None)
    base.update(overrides)
    return argparse.Namespace(**base)


def test_cmd_record_normal_flow_uses_chosen_status():
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=["", ""]),
    ):
        cli_mod.cmd_record(_make_args())

    stop_call = next(p for p in fake.posts if p[0].endswith("/stop"))
    assert stop_call[0] == "/skills/record/sess-1/stop"
    assert stop_call[1]["status"] == "success"


def test_cmd_record_marks_failed_when_user_answers_no():
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=["", "n"]),
    ):
        cli_mod.cmd_record(_make_args())

    stop_call = next(p for p in fake.posts if p[0].endswith("/stop"))
    assert stop_call[1]["status"] == "failed"


def test_cmd_record_keyboard_interrupt_still_stops_session():
    """Ctrl+C during either input() prompt must not skip /stop — the started
    session holds the pool's per-endpoint mutex until /stop releases it."""
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=KeyboardInterrupt),
    ):
        cli_mod.cmd_record(_make_args())

    posts = [p[0] for p in fake.posts]
    assert "/skills/record/start" in posts
    stop_call = next(p for p in fake.posts if p[0].endswith("/stop"))
    assert stop_call[0] == "/skills/record/sess-1/stop"
    assert stop_call[1]["status"] == "failed"


def test_cmd_record_eof_during_second_prompt_still_stops_session():
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=["", EOFError]),
    ):
        cli_mod.cmd_record(_make_args())

    stop_call = next(p for p in fake.posts if p[0].endswith("/stop"))
    assert stop_call[1]["status"] == "failed"
