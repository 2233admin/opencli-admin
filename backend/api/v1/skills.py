"""Skills API — the human-triggered **correct** leg (ADR-0003 D7, D8).

The dock's ``重蒸技能`` action POSTs a failing ``journey_trace_v1`` trace here;
this endpoint re-distills the skill into version *n+1* via
:func:`backend.skills.correction.re_distill` (re-distillation, never a
hand-patch). Per **D8**, re-distill is **human-triggered only** in v1 — there is
no automatic "N fails → re-distill" path anywhere; this router is the sole entry.

Auth: this router mirrors the other v1 write endpoints (e.g. ``/chat/confirm``),
which take ``Depends(get_db)`` and rely on the same app-level protection — so the
redistill endpoint is no less protected than they are.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.skill import Skill
from backend.schemas.common import ApiResponse, PaginationMeta
from backend.skills import correction

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["skills"])


def _skill_brief(s: Skill) -> dict[str, Any]:
    """Compact skill projection for the dock (no full skill_md body)."""
    return {
        "id": s.id,
        "domain": s.domain,
        "capability": s.capability,
        "name": s.name,
        "version": s.version,
        "status": s.status,
        "enabled": s.enabled,
        "evidence_count": len(s.evidence or []),
    }


@router.get("", response_model=ApiResponse[list[dict]])
async def list_skills(
    domain: str | None = None,
    enabled: bool | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    """List distilled skills (compact). Read-only; used by the dock to pick a
    skill to re-distill."""
    stmt = select(Skill)
    count_stmt = select(Skill)
    if domain is not None:
        stmt = stmt.where(Skill.domain == domain)
        count_stmt = count_stmt.where(Skill.domain == domain)
    if enabled is not None:
        stmt = stmt.where(Skill.enabled.is_(enabled))
        count_stmt = count_stmt.where(Skill.enabled.is_(enabled))

    total = len((await db.execute(count_stmt)).scalars().all())
    stmt = stmt.order_by(Skill.updated_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return ApiResponse.ok(
        data=[_skill_brief(s) for s in rows],
        meta=PaginationMeta(total=total, page=page, limit=limit, pages=max(1, -(-total // limit))),
    )


@router.post("/{skill_id}/redistill", response_model=ApiResponse[dict])
async def redistill_skill(
    skill_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    """Re-distill a failing skill from its trace → version *n+1* (D7).

    Body: ``{"trace": <journey_trace_v1 dict>}`` (or ``{"traces": [...]}``). The
    failing trace is fed back through the distiller; ``version`` bumps by 1,
    ``evidence`` gains one ``"corrected"`` entry, and ``skill_md`` / ``elements``
    are replaced from the fresh distillation. Returns the new version.
    """
    skill = await db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail=f"技能 {skill_id} 不存在")

    traces = body.get("trace") or body.get("traces")
    if not traces:
        raise HTTPException(
            status_code=400, detail="redistill 需要 body.trace (journey_trace_v1)"
        )

    try:
        skill = await correction.re_distill(db, skill, traces)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # distiller / provider failure
        logger.error("redistill failed | skill=%s err=%s", skill_id, exc)
        raise HTTPException(status_code=502, detail=f"重蒸馏失败: {exc}") from exc

    return ApiResponse.ok(
        {
            "skill_id": skill.id,
            "version": skill.version,
            "domain": skill.domain,
            "capability": skill.capability,
        }
    )
