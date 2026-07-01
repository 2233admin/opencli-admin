"""Record-leg API (2026-07-01 addendum, ADR-0003) — the human-triggered
**record** leg: attach to a live Chrome, capture a demonstration, review the
assembled trace, then explicitly distill it into the first version of a Skill.

Mirrors the ``redistill`` endpoint's propose→confirm shape: capture never
auto-creates a Skill row — the human reviews the trace ``/record/{id}/stop``
returns before ``/distill`` commits it.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from backend.database import AsyncSessionLocal
from backend.models.skill import Skill
from backend.schemas.common import ApiResponse
from backend.skills import record as record_module
from backend.skills.distill import distill_trace, to_skill_fields

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["skills-record"])

# session_id -> (RecordSession, held browser_pool acquire()-contextmanager).
# In-process only — this whole subsystem is single-user/local (ADR-0003), same
# assumption backend.skills.correction/skill_channel's short-lived-session
# helpers already make. The pool contextmanager is entered manually (not via
# `async with`) because it must stay held across TWO separate HTTP requests
# (start → human interacts → stop), not one call.
_SESSIONS: dict[str, tuple[record_module.RecordSession, Any]] = {}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class RecordStartBody(BaseModel):
    domain: str
    capability: str
    cdp_endpoint: str | None = None


class RecordStopBody(BaseModel):
    status: str = "success"
    note: str | None = None


class DistillBody(BaseModel):
    trace: dict[str, Any]
    domain: str | None = None
    capability: str | None = None
    provider: dict[str, Any] | None = None


@router.post("/record/start", response_model=ApiResponse[dict])
async def record_start(body: RecordStartBody) -> ApiResponse:
    """Attach to a live (headed) Chrome and start capturing. ``cdp_endpoint``
    optional — falls back to the shared browser_pool's default acquisition
    (same endpoint resolution the execute leg uses via
    ``backend.channels.skill_channel``), so a human can demo against whatever
    Chrome instance is already registered without knowing its exact address.

    Holds the pool's per-endpoint mutex for the session's lifetime (released on
    ``/stop``) — the same one-task-per-Chrome guarantee the execute leg gets
    from ``async with pool.acquire()``, just spanning two HTTP calls instead of
    one function call.
    """
    from backend.browser_pool import get_pool

    # This subsystem is single-user/local (ADR-0003) — at most one recording is
    # ever meant to be in flight. A session whose /stop was never called (human
    # abandoned the tab, browser crashed) would otherwise hold its browser_pool
    # slot forever; clear any such leftovers before acquiring a new one.
    for stale_id in list(_SESSIONS.keys()):
        stale_session, stale_acquire_cm = _SESSIONS.pop(stale_id)
        try:
            await stale_session.page.aclose()
        except Exception as exc:
            logger.warning("record start | closing stale session %s page failed: %s", stale_id, exc)
        try:
            await stale_acquire_cm.__aexit__(None, None, None)
        except Exception as exc:
            logger.warning("record start | releasing stale session %s failed: %s", stale_id, exc)

    pool = get_pool()
    acquire_cm = pool.acquire(endpoint=body.cdp_endpoint)
    try:
        cdp_endpoint = await acquire_cm.__aenter__()
    except Exception as exc:
        logger.error("record start | pool acquire failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"无法获取浏览器: {exc}") from exc

    try:
        session = await record_module.start_recording(
            cdp_endpoint, domain=body.domain, capability=body.capability
        )
    except Exception as exc:
        # Acquire succeeded but attach/capture-wiring failed — release the slot
        # before surfacing the error (never leak a held Chrome on failure).
        await acquire_cm.__aexit__(type(exc), exc, exc.__traceback__)
        logger.error("record start | attach failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"无法连接浏览器录制: {exc}") from exc

    _SESSIONS[session.session_id] = (session, acquire_cm)
    return ApiResponse.ok({"session_id": session.session_id, "cdp_endpoint": cdp_endpoint})


@router.post("/record/{session_id}/stop", response_model=ApiResponse[dict])
async def record_stop(session_id: str, body: RecordStopBody) -> ApiResponse:
    """Human marks the demo done — assemble + return the ``journey_trace_v1``
    trace for review (no Skill row created yet; see ``/skills/distill``).
    Releases the held Chrome back to the pool and closes the CDP connection.
    """
    entry = _SESSIONS.pop(session_id, None)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"录制会话 {session_id} 不存在")
    session, acquire_cm = entry

    try:
        trace = await session.stop(status=body.status, note=body.note)
    finally:
        try:
            await session.page.aclose()
        except Exception as exc:  # best-effort teardown
            logger.warning("record stop | page close failed: %s", exc)
        await acquire_cm.__aexit__(None, None, None)

    return ApiResponse.ok({"trace": trace})


@router.post("/distill", response_model=ApiResponse[dict])
async def distill_skill(body: DistillBody) -> ApiResponse:
    """Feed a ``journey_trace_v1`` (recorded via ``/record/*`` or hand-crafted)
    through the distiller and create the **first** version of a Skill
    (``version=1``, ``status="draft"``). ``domain``/``capability`` override the
    trace's own ``summary.domain``/``label`` when the human wants to rename the
    skill from what the distiller inferred.

    Distinct from ``/skills/{id}/redistill`` (ADR-0003 D7): that endpoint
    re-distills an **existing** Skill into version *n+1*; this one creates
    version 1. Both share the same distiller (:func:`distill_trace`) — no
    hand-patched fields, per the same D7 rule.
    """
    try:
        spec = await distill_trace(body.trace, body.provider)
    except Exception as exc:
        logger.error("distill failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"蒸馏失败: {exc}") from exc

    fields = to_skill_fields(spec)
    if body.domain:
        fields["domain"] = body.domain
    if body.capability:
        fields["capability"] = body.capability

    async with AsyncSessionLocal() as session:
        existing = (
            await session.execute(
                select(Skill).where(
                    Skill.domain == fields["domain"], Skill.capability == fields["capability"]
                )
            )
        ).scalars().first()
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"技能 {fields['domain']}/{fields['capability']} 已存在"
                    f"(id={existing.id})——用 /redistill 重蒸,不是新建"
                ),
            )

        skill = Skill(
            **fields,
            evidence=[
                {
                    "event": "distilled",
                    "trace_id": body.trace.get("trace_id"),
                    "at": _now_iso(),
                }
            ],
            version=1,
            status="draft",
        )
        session.add(skill)
        await session.commit()
        await session.refresh(skill)

    return ApiResponse.ok(
        {
            "id": skill.id,
            "domain": skill.domain,
            "capability": skill.capability,
            "name": skill.name,
            "version": skill.version,
            "status": skill.status,
        }
    )
