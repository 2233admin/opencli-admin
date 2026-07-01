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
    # Explicit HTTP-status-derived classification (see is_retryable_http_status) —
    # set on ChannelFetchError.error_type by channels that already know the
    # status code, so it isn't lost behind the wrapper exception's own class name.
    "RetryableHTTPStatus",
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
    "PermanentHTTPStatus",
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


def effective_error_type(exc: BaseException) -> str:
    """The exception type name that should drive retry classification.

    ``ChannelFetchError`` is a generic wrapper (raised by the default fetch()
    adapter and by channels' own request-handling helpers); its own class name
    says nothing about whether the underlying fault was transient. Prefer its
    explicit ``error_type`` (set by a caller that already knows the fault
    category, e.g. an HTTP status) when present; otherwise unwrap to
    ``__cause__`` (set via ``raise ... from exc`` everywhere it's raised) so a
    wrapped ``TimeoutException`` still classifies as retryable.
    """
    from backend.channels.base import ChannelFetchError

    if isinstance(exc, ChannelFetchError):
        if exc.error_type is not None:
            return exc.error_type
        if exc.__cause__ is not None:
            return type(exc.__cause__).__name__
    return type(exc).__name__


def is_retryable_http_status(status_code: int) -> bool:
    """429/5xx are handled by RateLimitedClient's own backoff before ever
    reaching the pipeline layer; if one leaks through anyway, treat it as
    retryable (transient server-side condition). Other 4xx are permanent —
    retrying the same malformed/unauthorized request won't change the
    outcome."""
    if status_code == 429 or status_code >= 500:
        return True
    return False
