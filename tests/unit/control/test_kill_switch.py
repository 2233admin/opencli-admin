"""Unit tests for backend.control.kill_switch (issue 03 / PR-Control-4).

Config-default vs runtime-override precedence, in isolation from the gate/
cycle that consumes it (see test_gate.py / test_cycle.py for the
short-circuit behavior).
"""

import pytest

from backend.control import kill_switch


@pytest.fixture(autouse=True)
def _reset():
    kill_switch.reset()
    yield
    kill_switch.reset()


def test_defaults_to_config_value(monkeypatch):
    from backend.config import get_settings

    monkeypatch.setenv("CONTROL_KILL_SWITCH", "false")
    get_settings.cache_clear()
    try:
        assert kill_switch.is_engaged() is False
    finally:
        get_settings.cache_clear()


def test_config_default_true_engages(monkeypatch):
    from backend.config import get_settings

    monkeypatch.setenv("CONTROL_KILL_SWITCH", "true")
    get_settings.cache_clear()
    try:
        assert kill_switch.is_engaged() is True
    finally:
        get_settings.cache_clear()


def test_runtime_override_takes_precedence_over_config(monkeypatch):
    from backend.config import get_settings

    monkeypatch.setenv("CONTROL_KILL_SWITCH", "false")
    get_settings.cache_clear()
    try:
        kill_switch.set_override(True)
        assert kill_switch.is_engaged() is True
    finally:
        get_settings.cache_clear()


def test_reset_falls_back_to_config():
    kill_switch.set_override(True)
    assert kill_switch.is_engaged() is True
    kill_switch.reset()
    assert kill_switch.current_state()["runtime_override"] is None


def test_current_state_shape():
    kill_switch.set_override(False)
    state = kill_switch.current_state()
    assert state == {
        "engaged": False,
        "runtime_override": False,
        "config_default": state["config_default"],
    }
