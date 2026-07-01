"""Retryable-vs-permanent classification for collect/sink failures.

Used by ``pipeline.py`` to decide whether an exception should propagate (so
the celery task's ``max_retries`` policy applies) or be swallowed into a
failed ``PipelineResult`` (retrying would just fail again the same way).
"""

# Transient faults: the same request will likely succeed on a later attempt.
_RETRYABLE = frozenset({
    "TimeoutException",
    "TimeoutError",
    "ConnectTimeout",
    "ReadTimeout",
    "WriteTimeout",
    "PoolTimeout",
    "ConnectError",
    "ConnectionError",
    "ReadError",
    "WriteError",
    "RemoteProtocolError",
    "NetworkError",
    "OSError",
})

# Deterministic faults: retrying with the same input reproduces the same
# failure. No point burning a celery retry slot on these.
_PERMANENT = frozenset({
    "ValueError",
    "KeyError",
    "TypeError",
    "FileNotFoundError",
    "JSONDecodeError",
    "ValidationError",
})


def is_retryable(error_type: str | None) -> bool:
    """Classify a failure by its exception class name.

    Unknown/unlisted types default to permanent (the conservative choice —
    an unrecognized error shouldn't silently start consuming retry budget).
    """
    if not error_type:
        return False
    if error_type in _RETRYABLE:
        return True
    if error_type in _PERMANENT:
        return False
    return False


def is_retryable_http_status(status_code: int) -> bool:
    """429/5xx are handled by RateLimitedClient's own backoff before ever
    reaching the pipeline layer; if one leaks through anyway, treat it as
    retryable (transient server-side condition). Other 4xx are permanent —
    retrying the same malformed/unauthorized request won't change the
    outcome."""
    if status_code == 429 or status_code >= 500:
        return True
    return False
