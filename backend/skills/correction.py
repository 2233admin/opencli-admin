"""The **correct** leg — re-distill a failing skill from its execution trace.

ADR-0003 **D7**: *correction is re-distillation, never a hand-patch.* When a skill
fails (or a human triggers it from the dock), the failing ``journey_trace_v1``
trace(s) plus the current SKILL.md are fed back through the **same** distiller
(:func:`backend.skills.distill.distill_trace`) that produced version *n*, and the
result becomes version *n+1*:

  * ``version`` is bumped by exactly 1,
  * one ``evidence`` entry (``event="corrected"``) is appended,
  * ``skill_md`` / ``elements`` / ``distill_model`` / ``source_trace`` are
    **replaced** from :func:`backend.skills.distill.to_skill_fields` — no field is
    set by hand. The only manual mutations are the version bump and the evidence
    append (the closed-loop bookkeeping the :class:`~backend.models.skill.Skill`
    model exists for).

Per **D8**, v1 re-distill is **human-triggered only** (endpoint / dock). This
module exposes the *service*; it never wires an automatic "N consecutive fails →
re-distill" policy (that is v2).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.provider import ModelProvider
from backend.models.skill import Skill
from backend.skills.distill import (
    _DEFAULT_PROVIDER,
    distill_trace,
    provider_from_model,
    to_skill_fields,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


async def resolve_distill_provider(session: AsyncSession) -> dict[str, Any]:
    """Resolve the distill provider config the same way the run path does.

    Mirrors :func:`backend.pipeline.runner.run_collection_pipeline` /
    ``api.v1.chat._pick_provider``: the first **enabled** :class:`ModelProvider`
    ordered by ``created_at`` (configure-once, just-works), mapped through
    :func:`provider_from_model`. Falls back to
    :data:`backend.skills.distill._DEFAULT_PROVIDER` when none is configured.
    """
    result = await session.execute(
        select(ModelProvider)
        .where(ModelProvider.enabled.is_(True))
        .order_by(ModelProvider.created_at.asc())
    )
    mp = result.scalars().first()
    if mp is not None:
        return provider_from_model(mp)
    return dict(_DEFAULT_PROVIDER)


async def re_distill(
    session: AsyncSession,
    skill: Skill,
    traces: dict[str, Any] | list[dict[str, Any]],
    provider: dict[str, Any] | None = None,
) -> Skill:
    """Re-distill ``skill`` from its failing trace(s) into version *n+1*.

    Parameters
    ----------
    session:
        An open :class:`AsyncSession`; this function commits it.
    skill:
        The **existing** :class:`Skill` row to correct (loaded by the caller).
    traces:
        One ``journey_trace_v1`` dict, or a list of them. v1 keeps it simple:
        the most recent trace is distilled (the list's last entry). The caller
        (endpoint / dock) passes the failing trace inline.
    provider:
        Optional distill-provider config override. When ``None``, resolved via
        :func:`resolve_distill_provider` (first enabled ModelProvider → default).

    Returns
    -------
    Skill
        The same row, now at version *n+1* with ``skill_md`` / ``elements``
        replaced from the fresh distillation and one appended ``evidence`` entry.

    Notes
    -----
    Hard rule (ADR-0003 D7): ``skill_md`` / ``elements`` come **only** from
    :func:`to_skill_fields`. The only hand-set fields are ``version`` (+1) and
    the appended ``evidence`` entry.
    """
    if isinstance(traces, dict):
        trace = traces
    else:
        if not traces:
            raise ValueError("re_distill requires at least one trace")
        trace = traces[-1]  # v1: distill the most recent failing trace

    if provider is None:
        provider = await resolve_distill_provider(session)

    from_version = skill.version

    # Re-distill through the same kernel that produced version n (D7).
    spec = await distill_trace(trace, provider)
    fields = to_skill_fields(spec)

    # Replace body wholesale from the distilled fields — NO hand-patching.
    skill.skill_md = fields["skill_md"]
    skill.elements = dict(fields["elements"])  # reassign for JSON change-tracking
    skill.distill_model = fields["distill_model"]
    skill.source_trace = fields["source_trace"]

    # The only manual mutations: version bump + evidence append (closed loop).
    skill.version = from_version + 1
    evidence = list(skill.evidence or [])
    evidence.append(
        {
            "event": "corrected",
            "from_version": from_version,
            "to_version": skill.version,
            "trace_id": trace.get("trace_id"),
            "at": _now_iso(),
        }
    )
    skill.evidence = evidence  # reassign so SQLAlchemy detects the JSON mutation

    await session.commit()
    logger.info(
        "re_distill | skill=%s %s -> v%s model=%s trace=%s",
        skill.id, from_version, skill.version, skill.distill_model, trace.get("trace_id"),
    )
    return skill
