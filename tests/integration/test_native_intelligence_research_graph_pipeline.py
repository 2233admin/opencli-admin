from datetime import UTC, datetime

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.database import Base
from backend.models.intelligence import IntelligenceArtifact
from backend.workflow.intelligence.stages import NativeIntelligenceStages
from backend.workflow.intelligence_store import IntelligenceReferenceError, IntelligenceStore
from backend.workflow.native_intelligence_state import IntelligenceState


@pytest.fixture
async def stage_db(tmp_path):
    path = (tmp_path / "stages.db").as_posix()
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")

    @event.listens_for(engine.sync_engine, "connect")
    def _foreign_keys(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield sessions
    await engine.dispose()


FIXTURE = [
    {
        "title": "Agents trend #agents",
        "url": "https://example.test/agents",
        "source_id": "twitter",
        "published_at": "2026-07-20T12:00:00Z",
        "likes": 10,
    }
]
PARAMS = {"now": "2026-07-21T00:00:00Z", "query": "agents"}


@pytest.mark.asyncio
async def test_restart_pipeline_transitions_and_idempotency(stage_db):
    sessions = stage_db
    now = datetime(2026, 7, 21, tzinfo=UTC)
    async with sessions.begin() as session:
        await IntelligenceStore(session).create_session(
            session_id="pipeline", idempotency_key="create"
        )

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        research_result, research = await stages.research(
            session_id="pipeline",
            expected_version=0,
            input_items=FIXTURE,
            params=PARAMS,
            seed=7,
            now=now,
        )
        assert research_result.state == IntelligenceState.RESEARCH_READY

    async with sessions.begin() as session:
        store = IntelligenceStore(session)
        research = await store.load_artifact("pipeline", research.artifact_id)
        stages = NativeIntelligenceStages(store)
        ontology_result, ontology = await stages.build_ontology(
            session_id="pipeline",
            expected_version=research_result.version,
            research=research,
            seed=7,
        )
        assert ontology_result.state == IntelligenceState.ONTOLOGY_READY

    async with sessions.begin() as session:
        store = IntelligenceStore(session)
        research = await store.load_artifact("pipeline", research.artifact_id)
        ontology = await store.load_artifact("pipeline", ontology.artifact_id)
        stages = NativeIntelligenceStages(store)
        graph_result, graph = await stages.build_graph(
            session_id="pipeline",
            expected_version=ontology_result.version,
            research=research,
            ontology=ontology,
            seed=7,
        )
        assert graph_result.state == IntelligenceState.GRAPH_READY

    async with sessions.begin() as session:
        store = IntelligenceStore(session)
        research = await store.load_artifact("pipeline", research.artifact_id)
        ontology = await store.load_artifact("pipeline", ontology.artifact_id)
        graph = await store.load_artifact("pipeline", graph.artifact_id)
        assert graph.grounding_artifact_ids == [
            research.artifact_id,
            ontology.artifact_id,
        ]
        stages = NativeIntelligenceStages(store)
        prepared_result, personas = await stages.prepare(
            session_id="pipeline",
            expected_version=graph_result.version,
            research=research,
            ontology=ontology,
            graph=graph,
            persona_count=1,
            seed=7,
        )
        assert prepared_result.state == IntelligenceState.PREPARED

    async with sessions.begin() as session:
        store = IntelligenceStore(session)
        research = await store.load_artifact("pipeline", research.artifact_id)
        ontology = await store.load_artifact("pipeline", ontology.artifact_id)
        graph = await store.load_artifact("pipeline", graph.artifact_id)
        stages = NativeIntelligenceStages(store)
        replay, replay_personas = await stages.prepare(
            session_id="pipeline",
            expected_version=graph_result.version,
            research=research,
            ontology=ontology,
            graph=graph,
            persona_count=1,
            seed=7,
        )
        assert replay.idempotent_replay is True
        assert replay_personas.artifact_id == personas.artifact_id
        with pytest.raises(IntelligenceReferenceError) as error:
            await store.load_artifact("another-session", research.artifact_id)
        assert getattr(error.value, "code", None) == "intelligence_artifact_not_found"
        rows = (
            await session.scalars(
                select(IntelligenceArtifact).where(
                    IntelligenceArtifact.session_id == "pipeline"
                )
            )
        ).all()
        assert [row.kind for row in rows] == [
            "research",
            "ontology",
            "graph",
            "persona",
        ]
