"""Unit tests for the backend.cli skill CLI (record→distill wizard).

Interrupt contract (PR #4 review finding, hardened by issue 05): the started
recording session holds the pool's per-endpoint mutex until /stop releases
it, so ANY exit path — Ctrl+C, EOF, unexpected exception — must still reach
/stop; an interrupt then exits non-zero (130) without offering distill.
"""

import argparse
from unittest.mock import patch

import pytest

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


def _stop_call(fake: _FakeClient) -> tuple[str, dict]:
    return next(p for p in fake.posts if p[0].endswith("/stop"))


def test_cmd_record_normal_flow_uses_chosen_status():
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=["", ""]),
    ):
        cli_mod.cmd_record(_make_args())

    stop_call = _stop_call(fake)
    assert stop_call[0] == "/skills/record/sess-1/stop"
    assert stop_call[1]["status"] == "success"


def test_cmd_record_marks_failed_when_user_answers_no():
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=["", "n"]),
    ):
        cli_mod.cmd_record(_make_args())

    assert _stop_call(fake)[1]["status"] == "failed"


def test_cmd_record_keyboard_interrupt_still_stops_session_and_exits_130(capsys):
    """Ctrl+C during either input() prompt must not skip /stop — and the
    process exits non-zero instead of carrying on into the distill flow."""
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=KeyboardInterrupt),
    ):
        with pytest.raises(SystemExit) as excinfo:
            cli_mod.cmd_record(_make_args())

    assert excinfo.value.code == 130
    posts = [p[0] for p in fake.posts]
    assert "/skills/record/start" in posts
    stop_call = _stop_call(fake)
    assert stop_call[0] == "/skills/record/sess-1/stop"
    assert stop_call[1]["status"] == "failed"
    assert "interrupted" in capsys.readouterr().err


def test_cmd_record_eof_during_second_prompt_still_stops_session_and_exits_130():
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=["", EOFError]),
    ):
        with pytest.raises(SystemExit) as excinfo:
            cli_mod.cmd_record(_make_args())

    assert excinfo.value.code == 130
    assert _stop_call(fake)[1]["status"] == "failed"


def test_cmd_record_unexpected_exception_still_stops_session():
    """Not just Ctrl+C/EOF: ANY exception between /start and /stop must
    still release the session (the finally seam), then propagate."""
    fake = _FakeClient()
    with (
        patch.object(cli_mod, "_client", return_value=fake),
        patch("builtins.input", side_effect=RuntimeError("boom")),
    ):
        with pytest.raises(RuntimeError, match="boom"):
            cli_mod.cmd_record(_make_args())

    assert _stop_call(fake)[1]["status"] == "failed"


def test_main_keyboard_interrupt_exits_130_without_traceback(capsys):
    """Top-level contract for every subcommand: Ctrl+C exits cleanly —
    non-zero code, short message on stderr, no traceback."""
    with patch.object(cli_mod, "cmd_list", side_effect=KeyboardInterrupt):
        with pytest.raises(SystemExit) as excinfo:
            cli_mod.main(["list"])

    assert excinfo.value.code == 130
    assert "interrupted" in capsys.readouterr().err
