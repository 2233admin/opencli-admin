"""Pipeline Step 5: Dispatch notifications based on rules."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.notification import NotificationLog, NotificationRule
from backend.models.record import CollectedRecord
from backend.notifiers.base import NotificationPayload, NotificationSendResult
from backend.notifiers.registry import get_notifier


def _ack_secret(config: dict) -> str:
    return str(config.get("ack_secret") or "")


def _normalize_send_result(result: bool | NotificationSendResult) -> tuple[bool, dict | None]:
    if isinstance(result, NotificationSendResult):
        return result.success, result.response_data
    return bool(result), None


async def dispatch_notifications(
    session: AsyncSession,
    source_id: str,
    records: list[CollectedRecord],
    trigger_event: str = "on_new_record",
) -> None:
    """Find matching notification rules and dispatch."""
    if not records:
        return

    result = await session.execute(
        select(NotificationRule).where(
            NotificationRule.enabled.is_(True),
            NotificationRule.trigger_event == trigger_event,
            (NotificationRule.source_id == source_id)
            | (NotificationRule.source_id.is_(None)),
        )
    )
    rules = result.scalars().all()

    for rule in rules:
        try:
            notifier = get_notifier(rule.notifier_type)
        except ValueError:
            continue

        for record in records:
            log = NotificationLog(
                rule_id=rule.id,
                record_id=record.id,
                status="pending",
                ack_status="not_required",
            )
            session.add(log)
            await session.flush()

            payload = NotificationPayload(
                event=trigger_event,
                source_id=source_id,
                delivery_id=log.id,
                record_id=record.id,
                data=record.normalized_data,
                ai_enrichment=record.ai_enrichment,
            )
            try:
                success, response_data = _normalize_send_result(
                    await notifier.send(rule.notifier_config, payload)
                )
                status = "sent" if success else "failed"
                error_msg = None
            except Exception as exc:
                status = "failed"
                response_data = None
                error_msg = str(exc)

            log.status = status
            log.response_data = response_data
            log.error_message = error_msg
            if status == "sent" and _ack_secret(rule.notifier_config):
                log.ack_status = "pending"
