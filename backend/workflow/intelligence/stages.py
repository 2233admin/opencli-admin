"""Aggregate-backed handlers for research through persona preparation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from backend.workflow.intelligence.graph import build_graph_artifact
from backend.workflow.intelligence.interviews import NativeInterviewStages
from backend.workflow.intelligence.ontology import build_ontology_artifact
from backend.workflow.intelligence.personas import build_persona_artifact
from backend.workflow.intelligence.reports import NativeReportStages
from backend.workflow.intelligence.research import build_research_artifact
from backend.workflow.intelligence.simulation import NativeSimulationStages
from backend.workflow.intelligence_store import IntelligenceCommandResult, IntelligenceStore
from backend.workflow.native_intelligence_contracts import (
    GraphArtifact,
    IntelligenceCommand,
    IntelligenceCommandName,
    OntologyArtifact,
    OperationLease,
    PersonaArtifact,
    ResearchArtifact,
    canonical_hash,
)


class NativeIntelligenceStages:
    """Small deterministic command adapter over the centralized store."""

    def __init__(self, store: IntelligenceStore, *, worker_id: str = "native-intelligence"):
        self.store = store
        self.worker_id = worker_id
        self.simulation = NativeSimulationStages(store)
        self.interviews = NativeInterviewStages(store, worker_id=worker_id)
        self.reports = NativeReportStages(store, worker_id=worker_id)

    async def start_simulation(self, **kwargs: Any):
        return await self.simulation.start(**kwargs)

    async def step_simulation(self, **kwargs: Any):
        return await self.simulation.step(**kwargs)

    async def run_simulation(self, **kwargs: Any):
        return await self.simulation.run(**kwargs)

    async def stop_simulation(self, **kwargs: Any):
        return await self.simulation.stop(**kwargs)

    async def resume_simulation(self, **kwargs: Any):
        return await self.simulation.resume(**kwargs)

    async def cancel_simulation(self, **kwargs: Any):
        return await self.simulation.cancel(**kwargs)

    async def simulation_status(self, **kwargs: Any):
        return await self.simulation.status(**kwargs)

    async def simulation_actions(self, **kwargs: Any):
        return await self.simulation.actions(**kwargs)

    async def simulation_timeline(self, **kwargs: Any):
        return await self.simulation.timeline(**kwargs)

    async def simulation_stats(self, **kwargs: Any):
        return await self.simulation.stats(**kwargs)

    async def start_interviews(self, **kwargs: Any):
        return await self.interviews.start(**kwargs)

    async def interview_one(self, **kwargs: Any):
        return await self.interviews.one(**kwargs)

    async def interview_batch(self, **kwargs: Any):
        return await self.interviews.batch(**kwargs)

    async def interview_all(self, **kwargs: Any):
        return await self.interviews.all(**kwargs)

    async def step_interviews(self, **kwargs: Any):
        return await self.interviews.step(**kwargs)

    async def run_interviews(self, **kwargs: Any):
        return await self.interviews.run(**kwargs)

    async def interview_history(self, **kwargs: Any):
        return await self.interviews.history(**kwargs)

    async def recover_interviews(self, **kwargs: Any):
        return await self.interviews.recover(**kwargs)

    async def cancel_interviews(self, **kwargs: Any):
        return await self.interviews.cancel(**kwargs)

    async def start_report(self, **kwargs: Any):
        return await self.reports.start(**kwargs)

    async def step_report(self, **kwargs: Any):
        return await self.reports.step(**kwargs)

    async def run_report(self, **kwargs: Any):
        return await self.reports.run(**kwargs)

    async def report_progress(self, **kwargs: Any):
        return await self.reports.progress(**kwargs)

    async def read_report(self, **kwargs: Any):
        return await self.reports.read(**kwargs)

    async def recover_report(self, **kwargs: Any):
        return await self.reports.recover(**kwargs)

    async def cancel_report(self, **kwargs: Any):
        return await self.reports.cancel(**kwargs)

    async def ask_report(self, **kwargs: Any):
        return await self.reports.ask(**kwargs)

    async def report_answers(self, **kwargs: Any):
        return await self.reports.answers(**kwargs)

    async def close(self, **kwargs: Any):
        return await self.reports.close(**kwargs)

    async def research(
        self,
        *,
        session_id: str,
        expected_version: int,
        input_items: list[dict[str, Any]],
        params: dict[str, Any] | None = None,
        seed: int = 0,
        now: datetime | None = None,
    ) -> tuple[IntelligenceCommandResult, ResearchArtifact]:
        artifact = build_research_artifact(
            session_id=session_id,
            input_items=input_items,
            params=params,
            seed=seed,
        )
        request = {
            "inputHash": canonical_hash(input_items),
            "params": params or {},
            "seed": seed,
        }
        started = await self.store.apply(
            _command(
                IntelligenceCommandName.RESEARCH,
                session_id,
                expected_version,
                "research-start",
                request,
            ),
            now=now,
        )
        aggregate = await self.store.load_session(session_id)
        lease = _current_lease(aggregate, now=now)
        completed = await self.store.apply(
            _command(
                IntelligenceCommandName.RESEARCH_COMPLETE,
                session_id,
                started.version,
                "research-complete",
                {"artifactId": artifact.artifact_id},
                lease=lease,
            ),
            artifacts=[artifact],
            now=now,
        )
        return completed, artifact

    async def build_ontology(
        self,
        *,
        session_id: str,
        expected_version: int,
        research: ResearchArtifact,
        seed: int = 0,
    ) -> tuple[IntelligenceCommandResult, OntologyArtifact]:
        artifact = build_ontology_artifact(
            session_id=session_id, research=research, seed=seed
        )
        result = await self.store.apply(
            _command(
                IntelligenceCommandName.BUILD_ONTOLOGY,
                session_id,
                expected_version,
                "build-ontology",
                {"researchArtifactId": research.artifact_id, "seed": seed},
            ),
            artifacts=[artifact],
        )
        return result, artifact

    async def build_graph(
        self,
        *,
        session_id: str,
        expected_version: int,
        research: ResearchArtifact,
        ontology: OntologyArtifact,
        seed: int = 0,
    ) -> tuple[IntelligenceCommandResult, GraphArtifact]:
        artifact = build_graph_artifact(
            session_id=session_id,
            research=research,
            ontology=ontology,
            seed=seed,
        )
        result = await self.store.apply(
            _command(
                IntelligenceCommandName.BUILD_GRAPH,
                session_id,
                expected_version,
                "build-graph",
                {
                    "researchArtifactId": research.artifact_id,
                    "ontologyArtifactId": ontology.artifact_id,
                    "seed": seed,
                },
            ),
            artifacts=[artifact],
        )
        return result, artifact

    async def prepare(
        self,
        *,
        session_id: str,
        expected_version: int,
        research: ResearchArtifact,
        ontology: OntologyArtifact,
        graph: GraphArtifact,
        persona_count: int = 5,
        seed: int = 0,
    ) -> tuple[IntelligenceCommandResult, PersonaArtifact]:
        artifact = build_persona_artifact(
            session_id=session_id,
            research=research,
            ontology=ontology,
            graph=graph,
            count=persona_count,
            seed=seed,
        )
        result = await self.store.apply(
            _command(
                IntelligenceCommandName.PREPARE,
                session_id,
                expected_version,
                "prepare-personas",
                {
                    "researchArtifactId": research.artifact_id,
                    "ontologyArtifactId": ontology.artifact_id,
                    "graphArtifactId": graph.artifact_id,
                    "personaCount": persona_count,
                    "seed": seed,
                },
            ),
            artifacts=[artifact],
        )
        return result, artifact


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
        idempotency_key=f"native:{suffix}:{canonical_hash(request)}",
        request=request,
        lease=lease,
    )


def _current_lease(aggregate: Any, *, now: datetime | None) -> OperationLease:
    expires_at = aggregate.lease_expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return OperationLease(
        operation_id=aggregate.operation_id,
        owner=aggregate.lease_owner,
        expires_at=expires_at or ((now or datetime.now(UTC)) + timedelta(minutes=5)),
        attempt=aggregate.operation_attempt,
        checkpoint_manifest=aggregate.checkpoint_manifest or {},
    )


__all__ = ["NativeIntelligenceStages"]
