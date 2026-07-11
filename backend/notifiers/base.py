from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class NotificationPayload:
    event: str
    source_id: str
    delivery_id: str | None = None
    record_id: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    ai_enrichment: dict[str, Any] | None = None


@dataclass
class NotificationSendResult:
    success: bool
    response_data: dict[str, Any] | None = None

    def __bool__(self) -> bool:
        """Keep legacy boolean notifier callers aligned with ``success``."""
        return self.success


class AbstractNotifier(ABC):
    notifier_type: str

    @abstractmethod
    async def send(
        self,
        config: dict[str, Any],
        payload: NotificationPayload,
    ) -> bool | NotificationSendResult: ...
