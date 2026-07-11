import hashlib
import hmac
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.notification import NotificationLog, NotificationRule
from backend.models.record import CollectedRecord
from backend.schemas.common import ApiResponse, PaginationMeta
from backend.schemas.notification import (
    NotificationAckRequest,
    NotificationLogRead,
    NotificationRuleCreate,
    NotificationRuleRead,
    NotificationRuleUpdate,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _verify_hmac(body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _ack_secret(rule: NotificationRule) -> str:
    return str(rule.notifier_config.get("ack_secret") or "")


@router.get("/rules", response_model=ApiResponse[list[NotificationRuleRead]])
async def list_rules(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    total = (await db.execute(select(func.count()).select_from(NotificationRule))).scalar_one()
    result = await db.execute(
        select(NotificationRule).offset((page - 1) * limit).limit(limit)
    )
    rules = result.scalars().all()
    return ApiResponse.ok(
        data=[NotificationRuleRead.model_validate(r) for r in rules],
        meta=PaginationMeta(total=total, page=page, limit=limit, pages=max(1, -(-total // limit))),
    )


@router.post("/rules", response_model=ApiResponse[NotificationRuleRead], status_code=201)
async def create_rule(
    body: NotificationRuleCreate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    rule = NotificationRule(**body.model_dump())
    db.add(rule)
    await db.flush()
    await db.refresh(rule)
    return ApiResponse.ok(NotificationRuleRead.model_validate(rule))


@router.get("/rules/{rule_id}", response_model=ApiResponse[NotificationRuleRead])
async def get_rule(rule_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse:
    result = await db.execute(select(NotificationRule).where(NotificationRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return ApiResponse.ok(NotificationRuleRead.model_validate(rule))


@router.patch("/rules/{rule_id}", response_model=ApiResponse[NotificationRuleRead])
async def update_rule(
    rule_id: str, body: NotificationRuleUpdate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    result = await db.execute(select(NotificationRule).where(NotificationRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(rule, key, value)
    await db.flush()
    await db.refresh(rule)
    return ApiResponse.ok(NotificationRuleRead.model_validate(rule))


@router.delete("/rules/{rule_id}", response_model=ApiResponse[None])
async def delete_rule(rule_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse:
    result = await db.execute(select(NotificationRule).where(NotificationRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    return ApiResponse.ok(None)


@router.get("/logs", response_model=ApiResponse[list[NotificationLogRead]])
async def list_logs(
    rule_id: str | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    query = select(NotificationLog).order_by(NotificationLog.created_at.desc())
    count_query = select(func.count()).select_from(NotificationLog)
    if rule_id:
        query = query.where(NotificationLog.rule_id == rule_id)
        count_query = count_query.where(NotificationLog.rule_id == rule_id)
    total = (await db.execute(count_query)).scalar_one()
    result = await db.execute(query.offset((page - 1) * limit).limit(limit))
    logs = result.scalars().all()
    return ApiResponse.ok(
        data=[NotificationLogRead.model_validate(log) for log in logs],
        meta=PaginationMeta(total=total, page=page, limit=limit, pages=max(1, -(-total // limit))),
    )


@router.post("/logs/{log_id}/ack", response_model=ApiResponse[NotificationLogRead])
async def ack_log(
    log_id: str,
    body: NotificationAckRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    result = await db.execute(select(NotificationLog).where(NotificationLog.id == log_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="Notification log not found")

    rule = await db.get(NotificationRule, log.rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Notification rule not found")

    secret = _ack_secret(rule)
    if not secret:
        raise HTTPException(
            status_code=400, detail="Notification rule has no ack_secret configured"
        )

    signature = request.headers.get("X-Signature-256", "")
    raw_body = await request.body()
    if not signature or not _verify_hmac(raw_body, signature, secret):
        raise HTTPException(status_code=401, detail="Invalid ACK signature")

    log.ack_status = body.status
    log.ack_data = body.ack_data
    log.acked_at = datetime.now(UTC)

    if log.record_id:
        record = await db.get(CollectedRecord, log.record_id)
        if record:
            if body.status == "acked":
                record.status = "notified"
                record.error_message = None
            else:
                record.status = "error"
                record.error_message = str(body.ack_data.get("error") or "Downstream ACK failed")

    await db.flush()
    await db.refresh(log)
    return ApiResponse.ok(NotificationLogRead.model_validate(log))
