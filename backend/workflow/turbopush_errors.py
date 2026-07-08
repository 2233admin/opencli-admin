"""TurboPush workflow runtime errors."""

from __future__ import annotations

from typing import Any


class TurboPushPublishError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        status: str = "failed",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        self.status = status
