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
    # Stash v(n)'s body *before* overwriting it (2026-07-01 addendum) — the only
    # place a prior version's actual content survives; without this, a bad
    # re-distill was previously an irreversible, one-way mutation. See
    # :func:`rollback_correction`.
    prev_skill_md = skill.skill_md
    prev_elements = dict(skill.elements or {})
    prev_distill_model = skill.distill_model
    prev_source_trace = skill.source_trace

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
            # Rollback safety net (2026-07-01): v(n)'s actual body, not just its
            # version number, so a worse v(n+1) can be undone.
            "prev_skill_md": prev_skill_md,
            "prev_elements": prev_elements,
            "prev_distill_model": prev_distill_model,
            "prev_source_trace": prev_source_trace,
        }
    )
    skill.evidence = evidence  # reassign so SQLAlchemy detects the JSON mutation

    await session.commit()
    logger.info(
        "re_distill | skill=%s %s -> v%s model=%s trace=%s",
        skill.id, from_version, skill.version, skill.distill_model, trace.get("trace_id"),
    )
    return skill


async def rollback_correction(session: AsyncSession, skill: Skill) -> Skill:
    """Undo the most recent :func:`re_distill` — restore v(n)'s body (2026-07-01
    addendum, D7). Reads the last ``corrected`` evidence entry's stashed
    ``prev_skill_md`` / ``prev_elements`` / ``prev_distill_model`` /
    ``prev_source_trace``, writes them back, decrements ``version`` by 1, and
    appends one ``{"event": "rolled_back", ...}`` entry (never mutates or
    removes the ``corrected`` entry it rolled back — evidence is append-only).

    Raises ``ValueError`` if there is no ``corrected`` entry to roll back (never
    re-distilled), or the last one has already been rolled back (no double
    rollback / no rolling back past the version that was actually distilled).
    """
    evidence = list(skill.evidence or [])
    last_corrected_idx = None
    for i in range(len(evidence) - 1, -1, -1):
        if evidence[i].get("event") == "corrected":
            last_corrected_idx = i
            break
    if last_corrected_idx is None:
        raise ValueError(f"skill {skill.id} has no 'corrected' evidence to roll back")
    corrected = evidence[last_corrected_idx]

    # Already rolled back? A 'rolled_back' entry referencing this same
    # 'corrected' entry's to_version sitting after it means don't do it twice.
    to_version = corrected.get("to_version")
    for ev in evidence[last_corrected_idx + 1:]:
        if ev.get("event") == "rolled_back" and ev.get("from_version") == to_version:
            raise ValueError(
                f"skill {skill.id} v{to_version} was already rolled back"
            )

    from_version = skill.version
    skill.skill_md = corrected.get("prev_skill_md") or ""
    skill.elements = dict(corrected.get("prev_elements") or {})
    skill.distill_model = corrected.get("prev_distill_model")
    skill.source_trace = corrected.get("prev_source_trace")
    skill.version = corrected.get("from_version", from_version - 1)

    evidence.append(
        {
            "event": "rolled_back",
            "from_version": from_version,
            "to_version": skill.version,
            "at": _now_iso(),
        }
    )
    skill.evidence = evidence

    await session.commit()
    logger.info(
        "rollback_correction | skill=%s %s -> v%s",
        skill.id, from_version, skill.version,
    )
    return skill


# ── v2 auto-trigger: propose (never run) a re-distill (grilled 2026-07-01) ──────
# The counterpart this module's own docstring flagged as "that is v2": self_eval
# already logs `passed: false` into evidence, but nobody watched the log. This
# closes that gap *without* touching the D8 human-trigger rule above — it only
# ever appends a proposal marker; re_distill still only runs from the dock /
# endpoint.

# N consecutive `executed` + `passed: false` records since the last correction
# boundary → propose. Tunable constant, not surfaced as per-skill config (v2
# scope only handles the first failure streak; a v(n+1) that *still* fails
# straight through means distill itself is stuck — that's v3, human-rewrite
# territory, not another auto-proposal).
DEFAULT_FAIL_STREAK = 3


def _correction_boundary(evidence: list[dict[str, Any]]) -> int:
    """Index just past the most recent ``corrected`` / ``correction_dismissed``.

    Both a completed re-distill (new version gets its own fresh *n* chances) and
    a human dismissal ("this failure doesn't count") reset the consecutive-fail
    count. ``0`` when neither has ever fired — count from the start of history.
    """
    boundary = 0
    for i, ev in enumerate(evidence):
        if ev.get("event") in ("corrected", "correction_dismissed"):
            boundary = i + 1
    return boundary


def maybe_propose_correction(
    skill: Skill, evidence: list[dict[str, Any]], *, n: int = DEFAULT_FAIL_STREAK
) -> bool:
    """Flag — never run — a re-distill after *n* straight execution fails.

    Scans ``evidence`` (``skill.evidence``, already including the just-appended
    self-eval entry) for the most recent ``n`` ``event == "executed"`` records
    since :func:`_correction_boundary`, skipping ``loop_outcome == "error"`` runs
    (environment noise — a dropped CDP connection, a network blip; re-distilling
    rewrites ``skill_md``, it can't fix that). If every one of those ``n`` is
    ``passed: False``, appends one ``{"event": "correction_proposed",
    "trace_ids": [...], "prior_redistill_count": int, "at": ...}`` entry to
    ``evidence`` **in place** and returns ``True``. Per ADR-0003 D8 this never
    calls :func:`re_distill` itself — it only marks "a human should look at
    this"; the dock / ``/redistill`` endpoint remains the sole trigger. The
    caller (a short-lived session, mirroring ``skill_channel._append_self_eval``)
    owns ``skill.evidence = evidence`` + commit.

    ``prior_redistill_count`` (2026-07-01 addendum) is the total count of past
    ``corrected`` events across ``evidence`` (full history, not just since the
    boundary) — a skill re-distilled 4 times already and *still* failing is a
    signal the cheap distill model itself may be stuck, worth a human picking a
    stronger ``provider`` override on the next ``/redistill`` call (the endpoint
    already accepts one) rather than re-running the same model a 5th time.

    Returns ``False`` (no mutation) when the streak isn't met yet, or a proposal
    is already open past the boundary — no duplicate proposals, or a
    perpetually-broken skill would get one appended per run forever.
    """
    boundary = _correction_boundary(evidence)
    tail = evidence[boundary:]

    if any(ev.get("event") == "correction_proposed" for ev in tail):
        return False

    executed = [
        ev for ev in tail
        if ev.get("event") == "executed" and ev.get("loop_outcome") != "error"
    ]
    if len(executed) < n:
        return False

    streak = executed[-n:]
    if not all(ev.get("passed") is False for ev in streak):
        return False

    prior_redistill_count = sum(1 for ev in evidence if ev.get("event") == "corrected")
    evidence.append(
        {
            "event": "correction_proposed",
            "trace_ids": [ev.get("trace_id") for ev in streak],
            "prior_redistill_count": prior_redistill_count,
            "at": _now_iso(),
        }
    )
    logger.info(
        "maybe_propose_correction | skill=%s %s/%s proposed after %d consecutive fails",
        getattr(skill, "id", None),
        getattr(skill, "domain", None),
        getattr(skill, "capability", None),
        n,
    )
    return True
