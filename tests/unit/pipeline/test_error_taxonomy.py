"""Unit tests for the retryable-vs-permanent error classification."""

import pytest

from backend.pipeline.error_taxonomy import is_retryable, is_retryable_http_status


@pytest.mark.parametrize("error_type", [
    "TimeoutException",
    "ConnectError",
    "ConnectionError",
    "ReadError",
    "RemoteProtocolError",
    "OSError",
])
def test_transient_faults_are_retryable(error_type):
    assert is_retryable(error_type) is True


@pytest.mark.parametrize("error_type", [
    "ValueError",
    "KeyError",
    "TypeError",
    "FileNotFoundError",
    "JSONDecodeError",
])
def test_deterministic_faults_are_permanent(error_type):
    assert is_retryable(error_type) is False


def test_unknown_error_type_defaults_to_permanent():
    assert is_retryable("SomeBrandNewExceptionNobodyClassifiedYet") is False


def test_none_error_type_is_permanent():
    assert is_retryable(None) is False


@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_leaked_429_and_5xx_are_retryable(status):
    assert is_retryable_http_status(status) is True


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_client_4xx_are_permanent(status):
    assert is_retryable_http_status(status) is False
