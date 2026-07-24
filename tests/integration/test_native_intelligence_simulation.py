import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.database import Base
from backend.models.intelligence import IntelligenceTransition
from backend.workflow.intelligence.stages import NativeIntelligenceStages
from backend.workflow.intelligence_store import (
    IntelligenceConflictError,
    IntelligenceReferenceError,
    IntelligenceStore,
    run_intelligence_transaction,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    PersonaArtifact,
    canonical_hash,
)
from backend.workflow.native_intelligence_state import IntelligenceState

FIXTURE = [
    {
        "title": "Deterministic agents",
        "url": "https://example.test/agents",
        "source_id": "test",
        "published_at": "2026-07-20T12:00:00Z",
        "likes": 10,
    },
    {
        "title": "Evidence governance",
        "url": "https://example.test/governance",
        "source_id": "test",
        "published_at": "2026-07-20T13:00:00Z",
        "likes": 8,
    },
]
PARAMS = {"now": "2026-07-21T00:00:00Z", "query": "agents"}


@pytest.fixture
async def simulation_db(tmp_path):
    path = (tmp_path / "simulation.db").as_posix()
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")

    @event.listens_for(engine.sync_engine, "connect")
    def _foreign_keys(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield sessions
    await engine.dispose()


async def _prepare(sessions, session_id: str, *, persona_count: int = 1):
    async with sessions.begin() as session:
        await IntelligenceStore(session).create_session(
            session_id=session_id, idempotency_key="create"
        )
    now = datetime(2026, 7, 21, tzinfo=UTC)
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        result, research = await stages.research(
            session_id=session_id,
            expected_version=0,
            input_items=FIXTURE,
            params=PARAMS,
            seed=7,
            now=now,
        )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        result, ontology = await stages.build_ontology(
            session_id=session_id,
            expected_version=result.version,
            research=research,
            seed=7,
        )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        result, graph = await stages.build_graph(
            session_id=session_id,
            expected_version=result.version,
            research=research,
            ontology=ontology,
            seed=7,
        )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        result, personas = await stages.prepare(
            session_id=session_id,
            expected_version=result.version,
            research=research,
            ontology=ontology,
            graph=graph,
            persona_count=persona_count,
            seed=7,
        )
    return result, personas


@pytest.mark.asyncio
async def test_restart_stop_resume_and_queries_are_persisted(simulation_db):
    sessions = simulation_db
    prepared, personas = await _prepare(sessions, "simulation-restart")
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.start_simulation(
            session_id="simulation-restart",
            expected_version=prepared.version,
            persona_artifact_id=personas.artifact_id,
            seed=31,
            max_rounds=3,
        )
        operation_id = (
            await stages.store.load_session("simulation-restart")
        ).operation_id

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        stepped, artifact = await stages.step_simulation(
            session_id="simulation-restart", expected_version=started.version
        )
        assert artifact is None

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        replay, artifact = await stages.step_simulation(
            session_id="simulation-restart", expected_version=started.version
        )
        assert replay.idempotent_replay is True
        assert replay.version == stepped.version
        assert artifact is None

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        stopped = await stages.stop_simulation(
            session_id="simulation-restart", expected_version=stepped.version
        )
        stopped_aggregate = await stages.store.load_session("simulation-restart")
        assert stopped_aggregate.operation_id == operation_id
        assert stopped_aggregate.checkpoint_manifest["currentRound"] == 1

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        resumed = await stages.resume_simulation(
            session_id="simulation-restart", expected_version=stopped.version
        )
        resumed_aggregate = await stages.store.load_session("simulation-restart")
        assert resumed_aggregate.operation_id == operation_id

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        completed, artifact = await stages.run_simulation(
            session_id="simulation-restart", expected_version=resumed.version
        )
        assert completed.state == IntelligenceState.SIMULATED
        assert artifact.payload["roundsCompleted"] == 3
        assert artifact.grounding_artifact_ids == [
            personas.artifact_id,
            personas.payload["graphArtifactId"],
        ]
        expected_hash = canonical_hash(artifact.model_dump(mode="json"))

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        completion_replay, replay_artifact = await stages.step_simulation(
            session_id="simulation-restart",
            expected_version=completed.version - 2,
        )
        assert completion_replay.idempotent_replay is True
        assert replay_artifact.artifact_id == artifact.artifact_id
        loaded = await stages.store.load_artifact(
            "simulation-restart", artifact.artifact_id
        )
        assert canonical_hash(loaded.model_dump(mode="json")) == expected_hash
        status = await stages.simulation_status(session_id="simulation-restart")
        assert status["complete"] is True
        assert len(
            await stages.simulation_timeline(session_id="simulation-restart", limit=3)
        ) == 3
        assert (
            await stages.simulation_stats(session_id="simulation-restart")
        )["agentCount"] == 1
        assert all(
            action["simulated"]
            for action in await stages.simulation_actions(
                session_id="simulation-restart", limit=500
            )
        )


@pytest.mark.asyncio
async def test_concurrent_step_stop_has_one_cas_winner(simulation_db):
    sessions = simulation_db
    prepared, personas = await _prepare(sessions, "simulation-race")
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.start_simulation(
            session_id="simulation-race",
            expected_version=prepared.version,
            personas=personas,
            max_rounds=3,
        )

    async def step(store):
        return await NativeIntelligenceStages(store).step_simulation(
            session_id="simulation-race", expected_version=started.version
        )

    async def stop(store):
        return await NativeIntelligenceStages(store).stop_simulation(
            session_id="simulation-race", expected_version=started.version
        )

    async def race(operation):
        try:
            return await run_intelligence_transaction(sessions, operation)
        except IntelligenceConflictError:
            return None

    winners = await asyncio.gather(race(step), race(stop))
    assert len([winner for winner in winners if winner is not None]) == 1
    async with sessions() as session:
        transitions = (
            await session.scalars(
                select(IntelligenceTransition)
                .where(IntelligenceTransition.session_id == "simulation-race")
                .order_by(IntelligenceTransition.sequence)
            )
        ).all()
    race_commands = [
        transition.command for transition in transitions if transition.command in {"step", "stop"}
    ]
    assert len(race_commands) == 1


@pytest.mark.asyncio
async def test_cancel_during_simulation_is_terminal_for_steps(simulation_db):
    sessions = simulation_db
    prepared, personas = await _prepare(sessions, "simulation-cancel")
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.start_simulation(
            session_id="simulation-cancel",
            expected_version=prepared.version,
            personas=personas,
            max_rounds=2,
        )
        cancelled = await stages.cancel_simulation(
            session_id="simulation-cancel", expected_version=started.version
        )
        assert cancelled.state == IntelligenceState.CANCELLED
        cancelled_aggregate = await stages.store.load_session("simulation-cancel")
        assert cancelled_aggregate.checkpoint_manifest is None
        transition_count = len(
            (
                await session.scalars(
                    select(IntelligenceTransition).where(
                        IntelligenceTransition.session_id == "simulation-cancel"
                    )
                )
            ).all()
        )
        with pytest.raises(ValueError, match="simulation_not_running"):
            await stages.step_simulation(
                session_id="simulation-cancel",
                expected_version=cancelled.version,
            )
        unchanged = await stages.store.load_session("simulation-cancel")
        unchanged_transition_count = len(
            (
                await session.scalars(
                    select(IntelligenceTransition).where(
                        IntelligenceTransition.session_id == "simulation-cancel"
                    )
                )
            ).all()
        )
        assert unchanged.version == cancelled.version
        assert unchanged.checkpoint_manifest is None
        assert unchanged_transition_count == transition_count


@pytest.mark.asyncio
async def test_start_rejects_unpersisted_persona_without_state_change(simulation_db):
    sessions = simulation_db
    prepared, personas = await _prepare(sessions, "simulation-authority")
    unpersisted = PersonaArtifact(
        artifact_id="personas-unpersisted",
        session_id="simulation-authority",
        payload={
            **personas.payload,
            "graphArtifactId": personas.payload["graphArtifactId"],
        },
        grounding_artifact_ids=list(personas.grounding_artifact_ids),
        simulated=True,
        provenance=ArtifactProvenance(source="test"),
        algorithm_version="test",
        seed=0,
    )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        before = await stages.store.load_session("simulation-authority")
        with pytest.raises(IntelligenceReferenceError):
            await stages.start_simulation(
                session_id="simulation-authority",
                expected_version=prepared.version,
                personas=unpersisted,
            )
        with pytest.raises(
            ValueError, match="simulation_persona_artifact_content_mismatch"
        ):
            await stages.start_simulation(
                session_id="simulation-authority",
                expected_version=prepared.version,
                personas=personas.model_copy(update={"seed": personas.seed + 1}),
            )
        after = await stages.store.load_session("simulation-authority")
        transitions = (
            await session.scalars(
                select(IntelligenceTransition).where(
                    IntelligenceTransition.session_id == "simulation-authority"
                )
            )
        ).all()
        assert after.state == IntelligenceState.PREPARED
        assert after.version == before.version == prepared.version
        assert len(transitions) == prepared.version
