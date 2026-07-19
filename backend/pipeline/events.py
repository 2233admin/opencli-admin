"""Pipeline event writer — persists TaskRunEvent rows."""
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def emit(
    run_id: str,
    step: str,
    message: str,
    level: str = "info",
    detail: dict[str, Any] | None = None,
    elapsed_ms: int | None = None,
) -> None:
    """Write a single TaskRunEvent to the database (best-effort, never raises)."""
    try:
        from backend.database import AsyncSessionLocal
        from backend.models.task import TaskRunEvent
        async with AsyncSessionLocal() as session:
            event = TaskRunEvent(
                run_id=run_id,
                level=level,
                step=step,
                message=message,
                detail=detail,
                elapsed_ms=elapsed_ms,
            )
            session.add(event)
            await session.commit()
    except Exception as exc:
        logger.warning("emit event failed: %s", exc)


async def emit_many(run_id: str, events: list[dict[str, Any]]) -> None:
    """Write multiple TaskRunEvent rows for one run_id in a single session +
    bulk insert + one commit (AUDIT C24) — the batched counterpart to
    :func:`emit` for a caller that already has a whole step trace in hand
    (e.g. the skill channel's per-step spine events) instead of one commit
    (fsync) per event in a tight loop.

    Each item in ``events`` accepts the same keys as ``emit``'s kwargs:
    ``step`` and ``message`` (required), ``level``/``detail``/``elapsed_ms``
    (optional, same defaults as ``emit``). Best-effort: never raises, mirrors
    ``emit``. A no-op for an empty list (no session is even opened).
    """
    if not events:
        return
    try:
        from backend.database import AsyncSessionLocal
        from backend.models.task import TaskRunEvent
        async with AsyncSessionLocal() as session:
            session.add_all([
                TaskRunEvent(
                    run_id=run_id,
                    level=event.get("level", "info"),
                    step=event["step"],
                    message=event["message"],
                    detail=event.get("detail"),
                    elapsed_ms=event.get("elapsed_ms"),
                )
                for event in events
            ])
            await session.commit()
    except Exception as exc:
        logger.warning("emit_many event failed: %s", exc)
