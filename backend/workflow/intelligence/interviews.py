"""Deterministic, aggregate-backed interviews over persisted simulation evidence."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from backend.workflow.intelligence_store import (
    IntelligenceCommandResult,
    IntelligenceLeaseConflictError,
    IntelligenceStore,
    IntelligenceStoreError,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactKind,
    ArtifactProvenance,
    GraphArtifact,
    IntelligenceCommand,
    IntelligenceCommandName,
    InterviewArtifact,
    OperationLease,
    PersonaArtifact,
    SimulationArtifact,
    canonical_hash,
    deterministic_id,
)
from backend.workflow.native_intelligence_state import IntelligenceState

ALGORITHM_VERSION = "native-interviews-v1"
MAX_INTERVIEW_BATCH = 50
MAX_INTERVIEW_HISTORY = 20
MAX_INTERVIEW_QUESTION_LENGTH = 1_000
MAX_INTERVIEW_ANSWER_LENGTH = 4_000
DEFAULT_QUESTION = "How do you interpret the simulated outcome and its evidence?"


class NativeInterviewStages:
    """Persisted interview batches with one checkpointed artifact per persona."""

    def __init__(self, store: IntelligenceStore, *, worker_id: str = "native-interviews"):
        self.store = store
        self.worker_id = worker_id

    async def start(
        self,
        *,
        session_id: str,
        expected_version: int,
        persona_artifact_id: str,
        simulation_artifact_id: str,
        persona_ids: list[str] | None = None,
        question: str = DEFAULT_QUESTION,
        history_artifact_ids: list[str] | None = None,
        seed: int = 0,
        now: datetime | None = None,
    ) -> IntelligenceCommandResult:
        personas, graph, simulation = await self._inputs(
            session_id=session_id,
            persona_artifact_id=persona_artifact_id,
            simulation_artifact_id=simulation_artifact_id,
        )
        question = _question(question)
        planned = _planned_personas(personas, persona_ids)
        history = await self._history(
            session_id, history_artifact_ids or [], persona_artifact_id
        )
        manifest = {
            "schema": "intelligence.interviews.checkpoint.v1",
            "personaArtifactId": personas.artifact_id,
            "graphArtifactId": graph.artifact_id,
            "simulationArtifactId": simulation.artifact_id,
            "question": question,
            "seed": _seed(seed),
            "planned": planned,
            "completed": [],
            "historyArtifactIds": [item.artifact_id for item in history],
            "progressSequence": 0,
        }
        request = {
            "personaArtifactId": personas.artifact_id,
            "graphArtifactId": graph.artifact_id,
            "simulationArtifactId": simulation.artifact_id,
            "question": question,
            "planned": planned,
            "historyArtifactIds": manifest["historyArtifactIds"],
            "seed": seed,
        }
        operation_id = deterministic_id(
            "operation",
            {
                "session_id": session_id,
                "command": IntelligenceCommandName.INTERVIEW,
                "request": request,
            },
        )
        instant = now or datetime.now(UTC)
        return await self.store.apply(
            _command(
                IntelligenceCommandName.INTERVIEW,
                session_id,
                expected_version,
                f"interview-start:{canonical_hash(request)}",
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

    async def one(
        self,
        *,
        persona_id: str,
        **kwargs: Any,
    ) -> IntelligenceCommandResult:
        return await self.start(persona_ids=[persona_id], **kwargs)

    async def batch(
        self,
        *,
        persona_ids: list[str],
        **kwargs: Any,
    ) -> IntelligenceCommandResult:
        return await self.start(persona_ids=persona_ids, **kwargs)

    async def all(self, **kwargs: Any) -> IntelligenceCommandResult:
        return await self.start(persona_ids=None, **kwargs)

    async def step(
        self,
        *,
        session_id: str,
        expected_version: int,
        now: datetime | None = None,
    ) -> tuple[IntelligenceCommandResult, InterviewArtifact | None]:
        aggregate = await self.store.load_session(session_id)
        key = f"native:interview-step:{session_id}:{expected_version}"
        if aggregate.state == IntelligenceState.SIMULATED:
            replay = await self.store.load_command_result(session_id, key)
            if replay is not None and replay.artifact_ids:
                artifact = await self.store.load_artifact(
                    session_id, replay.artifact_ids[0]
                )
                if isinstance(artifact, InterviewArtifact):
                    return replay, artifact
        replay = await self.store.load_command_result(session_id, key)
        if replay is not None:
            artifact = (
                await self.store.load_artifact(session_id, replay.artifact_ids[0])
                if replay.artifact_ids
                else None
            )
            return replay, artifact if isinstance(artifact, InterviewArtifact) else None
        if aggregate.state != IntelligenceState.INTERVIEWING:
            raise ValueError("interview_not_in_progress")
        manifest = _manifest(aggregate.checkpoint_manifest)
        remaining = [
            persona_id
            for persona_id in manifest["planned"]
            if persona_id not in {item["personaId"] for item in manifest["completed"]}
        ]
        if not remaining:
            completed = await self.store.apply(
                _command(
                    IntelligenceCommandName.INTERVIEW_COMPLETE,
                    session_id,
                    expected_version,
                    f"interview-complete:{aggregate.operation_id}",
                    {
                        "operationId": aggregate.operation_id,
                        "resultArtifactIds": [
                            item["artifactId"] for item in manifest["completed"]
                        ],
                    },
                    lease=_lease(aggregate, manifest, self.worker_id),
                ),
                now=now,
            )
            return completed, None
        persona_id = remaining[0]
        personas, graph, simulation = await self._inputs(
            session_id=session_id,
            persona_artifact_id=manifest["personaArtifactId"],
            simulation_artifact_id=manifest["simulationArtifactId"],
        )
        history = await self._history(
            session_id,
            manifest["historyArtifactIds"],
            personas.artifact_id,
        )
        artifact = _build_interview(
            session_id=session_id,
            personas=personas,
            graph=graph,
            simulation=simulation,
            persona_id=persona_id,
            question=manifest["question"],
            history=history,
            seed=manifest["seed"],
            sequence=len(manifest["completed"]) + 1,
            operation_id=aggregate.operation_id,
            batch_size=len(manifest["planned"]),
        )
        next_manifest = {
            **manifest,
            "completed": [
                *manifest["completed"],
                {"personaId": persona_id, "artifactId": artifact.artifact_id},
            ],
            "progressSequence": manifest["progressSequence"] + 1,
        }
        progressed = await self.store.apply(
            _command(
                IntelligenceCommandName.RENEW,
                session_id,
                expected_version,
                f"interview-step:{session_id}:{expected_version}",
                {
                    "operationId": aggregate.operation_id,
                    "personaId": persona_id,
                    "artifactId": artifact.artifact_id,
                },
                lease=_lease(aggregate, next_manifest, self.worker_id),
            ),
            artifacts=[artifact],
            now=now,
        )
        if len(next_manifest["completed"]) < len(next_manifest["planned"]):
            return progressed, artifact
        completed = await self.store.apply(
            _command(
                IntelligenceCommandName.INTERVIEW_COMPLETE,
                session_id,
                progressed.version,
                f"interview-complete:{aggregate.operation_id}",
                {
                    "operationId": aggregate.operation_id,
                    "resultArtifactIds": [
                        item["artifactId"] for item in next_manifest["completed"]
                    ],
                },
                lease=_lease(aggregate, next_manifest, self.worker_id),
            ),
            now=now,
        )
        return completed, artifact

    async def run(
        self,
        *,
        session_id: str,
        expected_version: int,
        now: datetime | None = None,
    ) -> tuple[IntelligenceCommandResult, list[InterviewArtifact]]:
        replay = await self._completed_replay(session_id, expected_version)
        if replay is not None:
            return replay
        version = expected_version
        artifacts: list[InterviewArtifact] = []
        while True:
            result, artifact = await self.step(
                session_id=session_id,
                expected_version=version,
                now=now,
            )
            version = result.version
            if artifact is not None:
                artifacts.append(artifact)
            if result.state == IntelligenceState.SIMULATED:
                return result, artifacts

    async def _completed_replay(
        self, session_id: str, expected_version: int
    ) -> tuple[IntelligenceCommandResult, list[InterviewArtifact]] | None:
        operation_id = await self.store.load_operation_id(
            session_id,
            IntelligenceCommandName.INTERVIEW,
            expected_version,
        )
        if operation_id is None:
            return None
        completed = await self.store.load_command_result(
            session_id, f"native:interview-complete:{operation_id}"
        )
        if completed is None:
            return None
        if not 1 <= len(completed.artifact_ids) <= MAX_INTERVIEW_BATCH:
            raise ValueError("interview_replay_incomplete")
        artifacts: list[InterviewArtifact] = []
        persona_ids: set[str] = set()
        batch_size: int | None = None
        for sequence, artifact_id in enumerate(completed.artifact_ids, start=1):
            try:
                artifact = await self.store.load_artifact(session_id, artifact_id)
            except IntelligenceStoreError as exc:
                raise ValueError("interview_replay_incomplete") from exc
            if (
                not isinstance(artifact, InterviewArtifact)
                or artifact.payload.get("operationId") != operation_id
                or artifact.payload.get("sequence") != sequence
            ):
                raise ValueError("interview_replay_incomplete")
            persona_id = artifact.payload.get("personaId")
            if not isinstance(persona_id, str) or persona_id in persona_ids:
                raise ValueError("interview_replay_incomplete")
            artifact_batch_size = artifact.payload.get("batchSize")
            if (
                not isinstance(artifact_batch_size, int)
                or isinstance(artifact_batch_size, bool)
                or artifact_batch_size < 1
            ):
                raise ValueError("interview_replay_incomplete")
            if batch_size is None:
                batch_size = artifact_batch_size
            elif artifact_batch_size != batch_size:
                raise ValueError("interview_replay_incomplete")
            persona_ids.add(persona_id)
            artifacts.append(artifact)
        if batch_size != len(artifacts):
            raise ValueError("interview_replay_incomplete")
        return completed, artifacts

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
                f"interview-recover:{new_owner}:{expected_version}",
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
                f"interview-cancel:{aggregate.operation_id}:{canonical_hash(manifest)}",
                {
                    "operationId": aggregate.operation_id,
                    "checkpointHash": canonical_hash(manifest),
                },
            )
        )

    async def history(
        self,
        *,
        session_id: str,
        offset: int = 0,
        limit: int = 20,
    ) -> list[InterviewArtifact]:
        _query_bounds(offset, limit)
        artifacts = await self.store.load_artifacts(
            session_id,
            ArtifactKind.INTERVIEW,
            offset=offset,
            limit=limit,
        )
        return [item for item in artifacts if isinstance(item, InterviewArtifact)]

    async def _inputs(
        self,
        *,
        session_id: str,
        persona_artifact_id: str,
        simulation_artifact_id: str,
    ) -> tuple[PersonaArtifact, GraphArtifact, SimulationArtifact]:
        personas = await self.store.load_artifact(session_id, persona_artifact_id)
        simulation = await self.store.load_artifact(session_id, simulation_artifact_id)
        if not isinstance(personas, PersonaArtifact):
            raise ValueError("interview_requires_persona_artifact")
        if not isinstance(simulation, SimulationArtifact):
            raise ValueError("interview_requires_simulation_artifact")
        graph_id = personas.payload.get("graphArtifactId")
        if (
            not isinstance(graph_id, str)
            or graph_id not in personas.grounding_artifact_ids
            or graph_id not in simulation.grounding_artifact_ids
        ):
            raise ValueError("interview_requires_graph_grounding")
        graph = await self.store.load_artifact(session_id, graph_id)
        if not isinstance(graph, GraphArtifact):
            raise ValueError("interview_requires_graph_grounding")
        if simulation.payload.get("personaArtifactId") != personas.artifact_id:
            raise ValueError("interview_simulation_persona_mismatch")
        return personas, graph, simulation

    async def _history(
        self,
        session_id: str,
        artifact_ids: list[str],
        persona_artifact_id: str,
    ) -> list[InterviewArtifact]:
        if len(artifact_ids) > MAX_INTERVIEW_HISTORY:
            raise ValueError("interview_history_limit_exceeded")
        if len(set(artifact_ids)) != len(artifact_ids):
            raise ValueError("duplicate_interview_history_reference")
        history: list[InterviewArtifact] = []
        for artifact_id in artifact_ids:
            artifact = await self.store.load_artifact(session_id, artifact_id)
            if not isinstance(artifact, InterviewArtifact):
                raise ValueError("interview_history_requires_interview_artifact")
            if artifact.payload.get("personaArtifactId") != persona_artifact_id:
                raise ValueError("interview_history_persona_artifact_mismatch")
            history.append(artifact)
        return sorted(history, key=lambda item: item.artifact_id)


def _build_interview(
    *,
    session_id: str,
    personas: PersonaArtifact,
    graph: GraphArtifact,
    simulation: SimulationArtifact,
    persona_id: str,
    question: str,
    history: list[InterviewArtifact],
    seed: int,
    sequence: int,
    operation_id: str,
    batch_size: int,
) -> InterviewArtifact:
    persona = next(
        item
        for item in personas.payload["personas"]
        if item["personaId"] == persona_id
    )
    actions = [
        item
        for item in simulation.payload.get("actions", [])
        if item.get("personaId") == persona_id
    ][-5:]
    graph_labels = sorted(
        {
            str(node.get("label"))
            for node in graph.payload.get("nodes", [])
            if node.get("label")
        }
    )[:5]
    history_summaries = [
        str(item.payload.get("answer", ""))[:200] for item in history[-3:]
    ]
    action_summary = ", ".join(
        f"r{item['round']}:{item['action']}({item['stance']:+.3f})"
        for item in actions
    ) or "no emitted actions"
    answer = (
        f"{persona.get('name', persona_id)} answers from the simulated "
        f"{persona.get('role', 'observer')} perspective. "
        f"Observed trajectory: {action_summary}. "
        f"Grounding topics: {', '.join(graph_labels) or 'none'}. "
        f"Question: {question}"
    )
    if history_summaries:
        answer += f" Prior interview context: {' | '.join(history_summaries)}"
    answer = answer[:MAX_INTERVIEW_ANSWER_LENGTH]
    grounding = [
        personas.artifact_id,
        graph.artifact_id,
        simulation.artifact_id,
        *[item.artifact_id for item in history],
    ]
    payload = {
        "schema": "intelligence.interview.v1",
        "personaArtifactId": personas.artifact_id,
        "graphArtifactId": graph.artifact_id,
        "simulationArtifactId": simulation.artifact_id,
        "personaId": persona_id,
        "question": question,
        "answer": answer,
        "historyArtifactIds": [item.artifact_id for item in history],
        "sequence": sequence,
        "operationId": operation_id,
        "batchSize": batch_size,
        "simulated": True,
    }
    return InterviewArtifact(
        artifact_id=deterministic_id(
            "interview",
            {"algorithm": ALGORITHM_VERSION, "seed": seed, "payload": payload},
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
        seed=seed,
    )


def _planned_personas(
    personas: PersonaArtifact, persona_ids: list[str] | None
) -> list[str]:
    available = {
        str(item["personaId"]) for item in personas.payload.get("personas", [])
    }
    planned = sorted(available if persona_ids is None else persona_ids)
    if not 1 <= len(planned) <= MAX_INTERVIEW_BATCH:
        raise ValueError("interview_batch_size_out_of_bounds")
    if len(set(planned)) != len(planned):
        raise ValueError("duplicate_interview_persona")
    if not set(planned) <= available:
        raise ValueError("interview_persona_not_found")
    return planned


def _question(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("interview_question_required")
    value = value.strip()
    if len(value) > MAX_INTERVIEW_QUESTION_LENGTH:
        raise ValueError("interview_question_too_long")
    return value


def _seed(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError("interview_seed_out_of_bounds")
    return value


def _manifest(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value or value.get("schema") != "intelligence.interviews.checkpoint.v1":
        raise ValueError("invalid_interview_checkpoint")
    return dict(value)


def _lease(
    aggregate: Any, manifest: dict[str, Any], worker_id: str
) -> OperationLease:
    if aggregate.lease_owner != worker_id:
        raise IntelligenceLeaseConflictError("operation is owned by another worker")
    expires_at = aggregate.lease_expires_at
    if expires_at is None:
        raise ValueError("interview_lease_missing")
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return OperationLease(
        operation_id=aggregate.operation_id,
        owner=worker_id,
        expires_at=expires_at,
        attempt=aggregate.operation_attempt,
        checkpoint_manifest=manifest,
    )


def _query_bounds(offset: int, limit: int) -> None:
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError("interview_query_offset_out_of_bounds")
    if (
        not isinstance(limit, int)
        or isinstance(limit, bool)
        or not 1 <= limit <= MAX_INTERVIEW_HISTORY
    ):
        raise ValueError("interview_query_limit_out_of_bounds")


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
    "DEFAULT_QUESTION",
    "MAX_INTERVIEW_BATCH",
    "MAX_INTERVIEW_HISTORY",
    "NativeInterviewStages",
]
