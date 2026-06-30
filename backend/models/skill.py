from typing import Optional

from sqlalchemy import Boolean, Integer, String, Text, UniqueConstraint
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class Skill(TimestampMixin):
    """A reusable browser skill distilled from an execution trace.

    Identified by (domain, capability). `skill_md` is the human/agent-readable
    SKILL.md card; `elements` holds the structured 9-element spec (see
    backend.skills.distill.ELEMENT_KEYS); `evidence` accumulates closed-loop
    events (distilled / executed / corrected with outcomes) that feed the
    self-evaluation + correction round.
    """

    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("domain", "capability", name="uq_skill_domain_capability"),)

    # Identity
    domain: Mapped[str] = mapped_column(String(100), nullable=False)
    capability: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    scope: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Body
    skill_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Structured 9-element spec: preconditions, procedure, milestones,
    # terminal_conditions, false_terminal_states, recovery_policies,
    # anti_drift_boundaries, red_lines.
    elements: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Provenance + closed loop
    source_trace: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    distill_model: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    evidence: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Lifecycle: draft -> active -> deprecated; version bumps on re-distill.
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
