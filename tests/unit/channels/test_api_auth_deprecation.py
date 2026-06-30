"""api channel warns (deprecation) on inline plaintext secrets, stays quiet on
env indirection. The actual resolved header is unchanged either way."""

import logging

from backend.channels.api_channel import ApiChannel


def _deprecation_logged(caplog) -> bool:
    return any("deprecated" in r.getMessage() for r in caplog.records)


def test_inline_bearer_token_warns(caplog):
    chan = ApiChannel()
    with caplog.at_level(logging.WARNING):
        headers = chan._build_auth_headers({"type": "bearer", "token": "inline-secret"})
    assert headers == {"Authorization": "Bearer inline-secret"}
    assert _deprecation_logged(caplog)


def test_env_bearer_token_does_not_warn(caplog, monkeypatch):
    monkeypatch.setenv("MY_TOKEN", "from-env")
    chan = ApiChannel()
    with caplog.at_level(logging.WARNING):
        headers = chan._build_auth_headers({"type": "bearer", "token_env": "MY_TOKEN"})
    assert headers == {"Authorization": "Bearer from-env"}
    assert not _deprecation_logged(caplog)


def test_inline_api_key_warns(caplog):
    chan = ApiChannel()
    with caplog.at_level(logging.WARNING):
        chan._build_auth_headers({"type": "api_key", "key": "inline-key"})
    assert _deprecation_logged(caplog)


def test_inline_basic_password_warns(caplog):
    chan = ApiChannel()
    with caplog.at_level(logging.WARNING):
        chan._build_auth_headers({"type": "basic", "username": "u", "password": "pw"})
    assert _deprecation_logged(caplog)
