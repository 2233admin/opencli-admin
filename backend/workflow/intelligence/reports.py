"""Deterministic report, report-Q&A, and closure stages."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from backend.workflow.intelligence_store import (
    IntelligenceCommandResult,
    IntelligenceLeaseConflictError,
    IntelligenceStore,
    IntelligenceStoreError,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactKind,
    ArtifactProvenance,
    CloseArtifact,
    GraphArtifact,
    IntelligenceCommand,
    IntelligenceCommandName,
    InterviewArtifact,
    OperationLease,
    PersonaArtifact,
    ReportAnswerArtifact,
    ReportArtifact,
    SimulationArtifact,
    canonical_hash,
    deterministic_id,
)
from backend.workflow.native_intelligence_state import IntelligenceState

ALGORITHM_VERSION = "native-reports-v1"
ANSWER_ALGORITHM_VERSION = "native-report-answer-v1"
CLOSE_ALGORITHM_VERSION = "native-close-v1"
MAX_REPORT_SECTIONS = 12
MAX_REPORT_SECTION_LENGTH = 8_000
MAX_REPORT_QUESTION_LENGTH = 1_000
MAX_REPORT_ANSWER_LENGTH = 4_000
MAX_REPORT_INTERVIEWS = 50
DEFAULT_SECTION_PLAN = (
    "executive_summary",
    "evidence",
    "simulation",
    "interviews",
    "conclusions",
)


class OptionalReportEnhancer(Protocol):
    """Optional adapter boundary; native output never depends on this interface."""

    async def enhance(self, report: dict[str, Any]) -> dict[str, Any]: ...


class NativeReportStages:
    """Checkpointed reports, offline Q&A, and terminal closure."""

    def __init__(self, store: IntelligenceStore, *, worker_id: str = "native-reports"):
        self.store = store
        self.worker_id = worker_id

    async def start(
        self,
        *,
        session_id: str,
        expected_version: int,
        persona_artifact_id: str,
        simulation_artifact_id: str,
        interview_artifact_ids: list[str],
        section_plan: list[str] | None = None,
        seed: int = 0,
        now: datetime | None = None,
    ) -> IntelligenceCommandResult:
        personas, graph, simulation, interviews = await self._inputs(
            session_id=session_id,
            persona_artifact_id=persona_artifact_id,
            simulation_artifact_id=simulation_artifact_id,
            interview_artifact_ids=interview_artifact_ids,
        )
        planned = _section_plan(section_plan)
        seed = _seed(seed)
        manifest = {
            "schema": "intelligence.report.checkpoint.v1",
            "personaArtifactId": personas.artifact_id,
            "graphArtifactId": graph.artifact_id,
            "simulationArtifactId": simulation.artifact_id,
            "interviewArtifactIds": [item.artifact_id for item in interviews],
            "seed": seed,
            "planned": planned,
            "completed": [],
            "sections": [],
            "progress_sequence": 0,
        }
        request = {
            key: manifest[key]
            for key in (
                "personaArtifactId",
                "graphArtifactId",
                "simulationArtifactId",
                "interviewArtifactIds",
                "seed",
                "planned",
            )
        }
        operation_id = deterministic_id(
            "operation",
            {
                "session_id": session_id,
                "command": IntelligenceCommandName.REPORT,
                "request": request,
            },
        )
        instant = now or datetime.now(UTC)
        return await self.store.apply(
            _command(
                IntelligenceCommandName.REPORT,
                session_id,
                expected_version,
                f"report-start:{canonical_hash(request)}",
                request,
                lease=OperationLease(
                    operation_id=operation_id,
                    owner=self.worker_id,
                    expires_at=instant + timedelta(minutes=5),
                    checkpoint_manifest=manifest,
                ),
            ),
            now=instant,
        )

    async def step(
        self,
        *,
        session_id: str,
        expected_version: int,
        now: datetime | None = None,
    ) -> tuple[IntelligenceCommandResult, ReportArtifact | None]:
        aggregate = await self.store.load_session(session_id)
        key = f"native:report-step:{session_id}:{expected_version}"
        if aggregate.state == IntelligenceState.REPORTED:
            artifact = await self.store.load_latest_artifact(
                session_id, ArtifactKind.REPORT
            )
            if not isinstance(artifact, ReportArtifact):
                raise ValueError("report_artifact_missing")
            return (
                IntelligenceCommandResult(
                    session_id=session_id,
                    state=aggregate.state,
                    version=aggregate.version,
                    transition_event_id=None,
                    artifact_ids=(artifact.artifact_id,),
                    idempotent_replay=True,
                ),
                artifact,
            )
        replay = await self.store.load_command_result(session_id, key)
        if replay is not None:
            return replay, None
        if aggregate.state != IntelligenceState.REPORTING:
            raise ValueError("report_not_in_progress")
        manifest = _manifest(aggregate.checkpoint_manifest)
        personas, graph, simulation, interviews = await self._inputs(
            session_id=session_id,
            persona_artifact_id=manifest["personaArtifactId"],
            simulation_artifact_id=manifest["simulationArtifactId"],
            interview_artifact_ids=manifest["interviewArtifactIds"],
        )
        remaining = [
            section for section in manifest["planned"] if section not in manifest["completed"]
        ]
        if not remaining:
            artifact = _build_report(
                session_id=session_id,
                personas=personas,
                graph=graph,
                simulation=simulation,
                interviews=interviews,
                manifest=manifest,
                operation_id=aggregate.operation_id,
            )
            completed = await self.store.apply(
                _command(
                    IntelligenceCommandName.REPORT_COMPLETE,
                    session_id,
                    expected_version,
                    f"report-complete:{aggregate.operation_id}",
                    {"artifactId": artifact.artifact_id},
                    lease=_lease(aggregate, manifest, self.worker_id),
                ),
                artifacts=[artifact],
                now=now,
            )
            return completed, artifact
        section_name = remaining[0]
        section = _build_section(
            name=section_name,
            personas=personas,
            graph=graph,
            simulation=simulation,
            interviews=interviews,
        )
        next_manifest = {
            **manifest,
            "completed": [*manifest["completed"], section_name],
            "sections": [*manifest["sections"], section],
            "progress_sequence": manifest["progress_sequence"] + 1,
        }
        progressed = await self.store.apply(
            _command(
                IntelligenceCommandName.REPORT_PROGRESS,
                session_id,
                expected_version,
                f"report-step:{session_id}:{expected_version}",
                {
                    "operationId": aggregate.operation_id,
                    "section": section_name,
                    "progressSequence": next_manifest["progress_sequence"],
                },
                lease=_lease(aggregate, next_manifest, self.worker_id),
            ),
            now=now,
        )
        if len(next_manifest["completed"]) < len(next_manifest["planned"]):
            return progressed, None
        artifact = _build_report(
            session_id=session_id,
            personas=personas,
            graph=graph,
            simulation=simulation,
            interviews=interviews,
            manifest=next_manifest,
            operation_id=aggregate.operation_id,
        )
        completed = await self.store.apply(
            _command(
                IntelligenceCommandName.REPORT_COMPLETE,
                session_id,
                progressed.version,
                f"report-complete:{aggregate.operation_id}",
                {"artifactId": artifact.artifact_id},
                lease=_lease(aggregate, next_manifest, self.worker_id),
            ),
            artifacts=[artifact],
            now=now,
        )
        return completed, artifact

    async def run(
        self,
        *,
        session_id: str,
        expected_version: int,
        now: datetime | None = None,
    ) -> tuple[IntelligenceCommandResult, ReportArtifact]:
        replay = await self._completed_replay(session_id, expected_version)
        if replay is not None:
            return replay
        version = expected_version
        while True:
            result, artifact = await self.step(
                session_id=session_id,
                expected_version=version,
                now=now,
            )
            version = result.version
            if artifact is not None:
                return result, artifact

    async def _completed_replay(
        self, session_id: str, expected_version: int
    ) -> tuple[IntelligenceCommandResult, ReportArtifact] | None:
        operation_id = await self.store.load_operation_id(
            session_id,
            IntelligenceCommandName.REPORT,
            expected_version,
        )
        if operation_id is None:
            return None
        completed = await self.store.load_command_result(
            session_id, f"native:report-complete:{operation_id}"
        )
        if completed is None:
            return None
        if len(completed.artifact_ids) != 1:
            raise ValueError("report_replay_incomplete")
        try:
            artifact = await self.store.load_artifact(
                session_id, completed.artifact_ids[0]
            )
        except IntelligenceStoreError as exc:
            raise ValueError("report_replay_incomplete") from exc
        if (
            not isinstance(artifact, ReportArtifact)
            or artifact.payload.get("operationId") != operation_id
        ):
            raise ValueError("report_replay_incomplete")
        return completed, artifact

    async def recover(
        self,
        *,
        session_id: str,
        expected_version: int,
        new_owner: str,
        now: datetime,
    ) -> IntelligenceCommandResult:
        return await self.store.recover_lease(
            _command(
                IntelligenceCommandName.RECOVER,
                session_id,
                expected_version,
                f"report-recover:{new_owner}:{expected_version}",
                {"newOwner": new_owner},
            ),
            new_owner=new_owner,
            expires_at=now + timedelta(minutes=5),
            now=now,
        )

    async def cancel(
        self, *, session_id: str, expected_version: int
    ) -> IntelligenceCommandResult:
        aggregate = await self.store.load_session(session_id)
        manifest = aggregate.checkpoint_manifest or {}
        return await self.store.apply(
            _command(
                IntelligenceCommandName.CANCEL,
                session_id,
                expected_version,
                f"report-cancel:{aggregate.operation_id}:{canonical_hash(manifest)}",
                {
                    "operationId": aggregate.operation_id,
                    "checkpointHash": canonical_hash(manifest),
                },
            )
        )

    async def progress(self, *, session_id: str) -> dict[str, Any]:
        aggregate = await self.store.load_session(session_id)
        artifact = await self.store.load_latest_artifact(
            session_id, ArtifactKind.REPORT
        )
        if isinstance(artifact, ReportArtifact):
            return {
                "state": aggregate.state.value,
                "version": aggregate.version,
                "planned": artifact.payload["sectionPlan"],
                "completed": artifact.payload["sectionPlan"],
                "sections": artifact.payload["sections"],
                "artifactId": artifact.artifact_id,
                "complete": True,
            }
        manifest = _manifest(aggregate.checkpoint_manifest)
        return {
            "state": aggregate.state.value,
            "version": aggregate.version,
            "planned": manifest["planned"],
            "completed": manifest["completed"],
            "sections": manifest["sections"],
            "artifactId": None,
            "complete": False,
        }

    async def read(
        self, *, session_id: str, artifact_id: str | None = None
    ) -> ReportArtifact:
        artifact = (
            await self.store.load_artifact(session_id, artifact_id)
            if artifact_id
            else await self.store.load_latest_artifact(session_id, ArtifactKind.REPORT)
        )
        if not isinstance(artifact, ReportArtifact):
            raise ValueError("report_artifact_missing")
        return artifact

    async def ask(
        self,
        *,
        session_id: str,
        expected_version: int,
        report_artifact_id: str,
        question: str,
        seed: int = 0,
    ) -> tuple[IntelligenceCommandResult, ReportAnswerArtifact]:
        report = await self.store.load_artifact(session_id, report_artifact_id)
        if not isinstance(report, ReportArtifact):
            raise ValueError("report_question_requires_report_artifact")
        question = _question(question)
        seed = _seed(seed)
        artifact = _answer(
            session_id=session_id,
            report=report,
            question=question,
            seed=seed,
        )
        request = {
            "reportArtifactId": report.artifact_id,
            "question": question,
            "seed": seed,
        }
        result = await self.store.apply(
            _command(
                IntelligenceCommandName.ASK_REPORT,
                session_id,
                expected_version,
                f"report-answer:{canonical_hash(request)}",
                request,
            ),
            artifacts=[artifact],
        )
        return result, artifact

    async def answers(
        self,
        *,
        session_id: str,
        offset: int = 0,
        limit: int = 20,
    ) -> list[ReportAnswerArtifact]:
        if offset < 0 or not 1 <= limit <= 100:
            raise ValueError("report_answer_query_bounds_invalid")
        artifacts = await self.store.load_artifacts(
            session_id,
            ArtifactKind.REPORT_ANSWER,
            offset=offset,
            limit=limit,
        )
        return [item for item in artifacts if isinstance(item, ReportAnswerArtifact)]

    async def close(
        self,
        *,
        session_id: str,
        expected_version: int,
        seed: int = 0,
    ) -> tuple[IntelligenceCommandResult, CloseArtifact]:
        aggregate = await self.store.load_session(session_id)
        if aggregate.state == IntelligenceState.CLOSED:
            artifact = await self.store.load_latest_artifact(
                session_id, ArtifactKind.CLOSE
            )
            if not isinstance(artifact, CloseArtifact):
                raise ValueError("close_artifact_missing")
            return (
                IntelligenceCommandResult(
                    session_id=session_id,
                    state=aggregate.state,
                    version=aggregate.version,
                    transition_event_id=None,
                    artifact_ids=(artifact.artifact_id,),
                    idempotent_replay=True,
                    no_op=True,
                ),
                artifact,
            )
        seed = _seed(seed)
        grounding: list[str] = []
        for kind in (
            ArtifactKind.PERSONA,
            ArtifactKind.GRAPH,
            ArtifactKind.SIMULATION,
            ArtifactKind.REPORT,
        ):
            artifact = await self.store.load_latest_artifact(session_id, kind)
            if artifact is not None:
                grounding.append(artifact.artifact_id)
        grounding = sorted(set(grounding))
        payload = {
            "schema": "intelligence.close.v1",
            "finalState": aggregate.state.value,
            "artifactIds": grounding,
            "simulated": False,
        }
        artifact = CloseArtifact(
            artifact_id=deterministic_id(
                "close",
                {"algorithm": CLOSE_ALGORITHM_VERSION, "seed": seed, "payload": payload},
            ),
            session_id=session_id,
            payload=payload,
            grounding_artifact_ids=grounding,
            simulated=False,
            provenance=ArtifactProvenance(
                source="opencli-native-deterministic",
                evidence_artifact_ids=grounding,
            ),
            algorithm_version=CLOSE_ALGORITHM_VERSION,
            seed=seed,
        )
        result = await self.store.apply(
            _command(
                IntelligenceCommandName.CLOSE,
                session_id,
                expected_version,
                f"close:{artifact.artifact_id}",
                {"artifactId": artifact.artifact_id, "finalState": aggregate.state.value},
            ),
            artifacts=[artifact],
        )
        return result, artifact

    async def _inputs(
        self,
        *,
        session_id: str,
        persona_artifact_id: str,
        simulation_artifact_id: str,
        interview_artifact_ids: list[str],
    ) -> tuple[
        PersonaArtifact,
        GraphArtifact,
        SimulationArtifact,
        list[InterviewArtifact],
    ]:
        if not 1 <= len(interview_artifact_ids) <= MAX_REPORT_INTERVIEWS:
            raise ValueError("report_interview_count_out_of_bounds")
        if len(set(interview_artifact_ids)) != len(interview_artifact_ids):
            raise ValueError("duplicate_report_interview_reference")
        personas = await self.store.load_artifact(session_id, persona_artifact_id)
        simulation = await self.store.load_artifact(session_id, simulation_artifact_id)
        if not isinstance(personas, PersonaArtifact):
            raise ValueError("report_requires_persona_artifact")
        if not isinstance(simulation, SimulationArtifact):
            raise ValueError("report_requires_simulation_artifact")
        graph_id = personas.payload.get("graphArtifactId")
        if (
            not isinstance(graph_id, str)
            or graph_id not in personas.grounding_artifact_ids
            or graph_id not in simulation.grounding_artifact_ids
        ):
            raise ValueError("report_requires_graph_grounding")
        graph = await self.store.load_artifact(session_id, graph_id)
        if not isinstance(graph, GraphArtifact):
            raise ValueError("report_requires_graph_grounding")
        interviews: list[InterviewArtifact] = []
        for artifact_id in interview_artifact_ids:
            artifact = await self.store.load_artifact(session_id, artifact_id)
            if not isinstance(artifact, InterviewArtifact):
                raise ValueError("report_requires_interview_artifacts")
            if (
                artifact.payload.get("personaArtifactId") != personas.artifact_id
                or artifact.payload.get("simulationArtifactId") != simulation.artifact_id
                or graph.artifact_id not in artifact.grounding_artifact_ids
            ):
                raise ValueError("report_interview_grounding_mismatch")
            interviews.append(artifact)
        return personas, graph, simulation, sorted(
            interviews, key=lambda item: item.artifact_id
        )


def _build_section(
    *,
    name: str,
    personas: PersonaArtifact,
    graph: GraphArtifact,
    simulation: SimulationArtifact,
    interviews: list[InterviewArtifact],
) -> dict[str, Any]:
    stats = simulation.payload.get("stats", {})
    graph_labels = sorted(
        str(node["label"])
        for node in graph.payload.get("nodes", [])
        if node.get("label")
    )[:8]
    interview_points = sorted(
        str(item.payload.get("answer", ""))[:240] for item in interviews
    )[:8]
    content_by_name = {
        "executive_summary": (
            f"The deterministic simulation completed "
            f"{simulation.payload.get('roundsCompleted', 0)} rounds with "
            f"{stats.get('actionCount', 0)} actions across "
            f"{stats.get('agentCount', 0)} personas."
        ),
        "evidence": (
            f"The analysis is grounded in graph topics: "
            f"{', '.join(graph_labels) or 'none'}."
        ),
        "simulation": (
            f"Support={stats.get('supportRatio', 0):.3f}, "
            f"oppose={stats.get('opposeRatio', 0):.3f}, "
            f"neutral={stats.get('neutralRatio', 0):.3f}, "
            f"polarization={stats.get('polarization', 0):.3f}."
        ),
        "interviews": " ".join(interview_points) or "No interview observations.",
        "conclusions": (
            f"The dominant simulated action is "
            f"{stats.get('dominantAction', 'none')}; this is a simulated, "
            "evidence-grounded scenario rather than a factual prediction."
        ),
    }
    content = content_by_name.get(
        name,
        (
            f"Section {name} summarizes {len(personas.payload.get('personas', []))} "
            f"personas, {len(graph_labels)} graph topics, and "
            f"{len(interviews)} interviews."
        ),
    )[:MAX_REPORT_SECTION_LENGTH]
    return {
        "sectionId": deterministic_id(
            "report_section",
            {
                "name": name,
                "personaArtifactId": personas.artifact_id,
                "simulationArtifactId": simulation.artifact_id,
                "interviewArtifactIds": [item.artifact_id for item in interviews],
            },
        ),
        "name": name,
        "content": content,
        "groundedArtifactIds": [
            personas.artifact_id,
            graph.artifact_id,
            simulation.artifact_id,
            *[item.artifact_id for item in interviews],
        ],
    }


def _build_report(
    *,
    session_id: str,
    personas: PersonaArtifact,
    graph: GraphArtifact,
    simulation: SimulationArtifact,
    interviews: list[InterviewArtifact],
    manifest: dict[str, Any],
    operation_id: str,
) -> ReportArtifact:
    if manifest["completed"] != manifest["planned"]:
        raise ValueError("report_sections_incomplete")
    grounding = [
        personas.artifact_id,
        graph.artifact_id,
        simulation.artifact_id,
        *[item.artifact_id for item in interviews],
    ]
    payload = {
        "schema": "intelligence.report.v1",
        "personaArtifactId": personas.artifact_id,
        "graphArtifactId": graph.artifact_id,
        "simulationArtifactId": simulation.artifact_id,
        "interviewArtifactIds": [item.artifact_id for item in interviews],
        "operationId": operation_id,
        "sectionPlan": manifest["planned"],
        "sections": manifest["sections"],
        "simulated": True,
    }
    return ReportArtifact(
        artifact_id=deterministic_id(
            "report",
            {
                "algorithm": ALGORITHM_VERSION,
                "seed": manifest["seed"],
                "payload": payload,
            },
        ),
        session_id=session_id,
        payload=payload,
        grounding_artifact_ids=grounding,
        simulated=True,
        provenance=ArtifactProvenance(
            source="opencli-native-deterministic",
            evidence_artifact_ids=grounding,
        ),
        algorithm_version=ALGORITHM_VERSION,
        seed=manifest["seed"],
    )


def _answer(
    *,
    session_id: str,
    report: ReportArtifact,
    question: str,
    seed: int,
) -> ReportAnswerArtifact:
    terms = {
        token.strip(".,:;!?()[]{}").lower()
        for token in question.split()
        if token.strip(".,:;!?()[]{}")
    }
    ranked = sorted(
        report.payload.get("sections", []),
        key=lambda section: (
            -sum(
                term in str(section.get("content", "")).lower() for term in terms
            ),
            str(section.get("name", "")),
        ),
    )
    selected = ranked[: min(3, len(ranked))]
    answer = " ".join(
        f"{section['name']}: {section['content']}" for section in selected
    )[:MAX_REPORT_ANSWER_LENGTH]
    grounding = sorted(
        {
            report.artifact_id,
            *report.grounding_artifact_ids,
            *(
                artifact_id
                for section in selected
                for artifact_id in section.get("groundedArtifactIds", [])
            ),
        }
    )
    payload = {
        "schema": "intelligence.report-answer.v1",
        "reportArtifactId": report.artifact_id,
        "question": question,
        "answer": answer,
        "sectionIds": [section["sectionId"] for section in selected],
        "groundedArtifactIds": grounding,
        "simulated": True,
    }
    return ReportAnswerArtifact(
        artifact_id=deterministic_id(
            "report_answer",
            {"algorithm": ANSWER_ALGORITHM_VERSION, "seed": seed, "payload": payload},
        ),
        session_id=session_id,
        payload=payload,
        grounding_artifact_ids=grounding,
        simulated=True,
        provenance=ArtifactProvenance(
            source="opencli-native-deterministic",
            evidence_artifact_ids=grounding,
        ),
        algorithm_version=ANSWER_ALGORITHM_VERSION,
        seed=seed,
    )


def _section_plan(value: list[str] | None) -> list[str]:
    planned = list(DEFAULT_SECTION_PLAN) if value is None else value
    if not isinstance(planned, list) or not 1 <= len(planned) <= MAX_REPORT_SECTIONS:
        raise ValueError("report_section_count_out_of_bounds")
    normalized: list[str] = []
    for item in planned:
        if not isinstance(item, str) or not item.strip() or len(item.strip()) > 100:
            raise ValueError("invalid_report_section")
        normalized.append(item.strip())
    if len(set(normalized)) != len(normalized):
        raise ValueError("duplicate_report_section")
    return normalized


def _question(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("report_question_required")
    value = value.strip()
    if len(value) > MAX_REPORT_QUESTION_LENGTH:
        raise ValueError("report_question_too_long")
    return value


def _seed(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError("report_seed_out_of_bounds")
    return value


def _manifest(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value or value.get("schema") != "intelligence.report.checkpoint.v1":
        raise ValueError("invalid_report_checkpoint")
    return dict(value)


def _lease(
    aggregate: Any, manifest: dict[str, Any], worker_id: str
) -> OperationLease:
    if aggregate.lease_owner != worker_id:
        raise IntelligenceLeaseConflictError("operation is owned by another worker")
    expires_at = aggregate.lease_expires_at
    if expires_at is None:
        raise ValueError("report_lease_missing")
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return OperationLease(
        operation_id=aggregate.operation_id,
        owner=worker_id,
        expires_at=expires_at,
        attempt=aggregate.operation_attempt,
        checkpoint_manifest=manifest,
    )


def _command(
    name: IntelligenceCommandName,
    session_id: str,
    version: int,
    suffix: str,
    request: dict[str, Any],
    *,
    lease: OperationLease | None = None,
) -> IntelligenceCommand:
    return IntelligenceCommand(
        command=name,
        session_id=session_id,
        expected_version=version,
        idempotency_key=f"native:{suffix}",
        request=request,
        lease=lease,
    )


__all__ = [
    "ALGORITHM_VERSION",
    "ANSWER_ALGORITHM_VERSION",
    "DEFAULT_SECTION_PLAN",
    "MAX_REPORT_INTERVIEWS",
    "MAX_REPORT_SECTIONS",
    "NativeReportStages",
    "OptionalReportEnhancer",
]
