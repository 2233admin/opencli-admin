import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.models.intelligence import (
    IntelligenceArtifact,
    IntelligenceCommandRecord,
    IntelligenceTransition,
)
from backend.workflow.intelligence.stages import NativeIntelligenceStages
from backend.workflow.intelligence_store import (
    IntelligenceConflictError,
    IntelligenceLeaseConflictError,
    IntelligenceReferenceError,
    IntelligenceStore,
    run_intelligence_transaction,
)
from backend.workflow.native_intelligence_contracts import canonical_hash
from backend.workflow.native_intelligence_state import IntelligenceState
from tests.integration.test_native_intelligence_simulation import _prepare

pytest_plugins = ("tests.integration.test_native_intelligence_simulation",)


async def _complete_simulation(
    sessions,
    session_id: str,
    *,
    persona_count: int = 1,
    simulation_seed: int = 41,
):
    prepared, personas = await _prepare(
        sessions, session_id, persona_count=persona_count
    )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.start_simulation(
            session_id=session_id,
            expected_version=prepared.version,
            persona_artifact_id=personas.artifact_id,
            seed=simulation_seed,
            max_rounds=2,
        )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        simulated, simulation = await stages.run_simulation(
            session_id=session_id,
            expected_version=started.version,
        )
    return simulated, personas, simulation


@pytest.mark.asyncio
async def test_interview_report_answer_close_survive_restarts(simulation_db):
    sessions = simulation_db
    simulated, personas, simulation = await _complete_simulation(
        sessions, "report-lifecycle"
    )
    persona_id = personas.payload["personas"][0]["personaId"]

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        interview_started = await stages.interviews.one(
            session_id="report-lifecycle",
            expected_version=simulated.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            persona_id=persona_id,
            question="What changed?",
            seed=43,
        )

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        interviewed, interviews = await stages.run_interviews(
            session_id="report-lifecycle",
            expected_version=interview_started.version,
        )
        assert interviewed.state == IntelligenceState.SIMULATED
        assert len(interviews) == 1
        first_interview = interviews[0]
        assert simulation.artifact_id in first_interview.grounding_artifact_ids

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        before_artifacts, before_transitions = await _row_counts(
            session, "report-lifecycle"
        )
        replayed, replayed_interviews = await stages.run_interviews(
            session_id="report-lifecycle",
            expected_version=interview_started.version,
        )
        after_artifacts, after_transitions = await _row_counts(
            session, "report-lifecycle"
        )
        assert replayed.idempotent_replay is True
        assert [item.artifact_id for item in replayed_interviews] == [
            first_interview.artifact_id
        ]
        assert (after_artifacts, after_transitions) == (
            before_artifacts,
            before_transitions,
        )

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        history_started = await stages.interviews.one(
            session_id="report-lifecycle",
            expected_version=interviewed.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            persona_id=persona_id,
            question="What remains uncertain?",
            history_artifact_ids=[first_interview.artifact_id],
            seed=47,
        )
        history_complete, history_items = await stages.run_interviews(
            session_id="report-lifecycle",
            expected_version=history_started.version,
        )
        assert "Prior interview context" in history_items[0].payload["answer"]

    interview_ids = [first_interview.artifact_id, history_items[0].artifact_id]
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        report_started = await stages.start_report(
            session_id="report-lifecycle",
            expected_version=history_complete.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            interview_artifact_ids=interview_ids,
            seed=53,
        )

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        first_progress, report = await stages.step_report(
            session_id="report-lifecycle",
            expected_version=report_started.version,
        )
        assert report is None
        progress = await stages.report_progress(session_id="report-lifecycle")
        assert progress["completed"] == ["executive_summary"]

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        reported, report = await stages.run_report(
            session_id="report-lifecycle",
            expected_version=first_progress.version,
        )
        assert reported.state == IntelligenceState.REPORTED
        assert report.grounding_artifact_ids == [
            personas.artifact_id,
            personas.payload["graphArtifactId"],
            simulation.artifact_id,
            *sorted(interview_ids),
        ]
        report_hash = canonical_hash(report.model_dump(mode="json"))

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        loaded = await stages.reports.read(session_id="report-lifecycle")
        assert canonical_hash(loaded.model_dump(mode="json")) == report_hash
        before_artifacts, before_transitions = await _row_counts(
            session, "report-lifecycle"
        )
        report_replay, replayed_report = await stages.run_report(
            session_id="report-lifecycle",
            expected_version=report_started.version,
        )
        after_artifacts, after_transitions = await _row_counts(
            session, "report-lifecycle"
        )
        assert report_replay.idempotent_replay is True
        assert replayed_report.artifact_id == report.artifact_id
        assert (after_artifacts, after_transitions) == (
            before_artifacts,
            before_transitions,
        )
        answered, answer = await stages.ask_report(
            session_id="report-lifecycle",
            expected_version=reported.version,
            report_artifact_id=report.artifact_id,
            question="What is the dominant action?",
            seed=59,
        )
        assert report.artifact_id in answer.payload["groundedArtifactIds"]
        replay, replay_answer = await stages.ask_report(
            session_id="report-lifecycle",
            expected_version=reported.version,
            report_artifact_id=report.artifact_id,
            question="What is the dominant action?",
            seed=59,
        )
        assert replay.idempotent_replay is True
        assert replay_answer.artifact_id == answer.artifact_id
        closed, close_artifact = await stages.close(
            session_id="report-lifecycle",
            expected_version=answered.version,
        )
        assert closed.state == IntelligenceState.CLOSED
        close_replay, replay_close = await stages.close(
            session_id="report-lifecycle",
            expected_version=closed.version,
        )
        assert close_replay.idempotent_replay is True
        assert replay_close.artifact_id == close_artifact.artifact_id
        before_closed_replay = await _row_counts(session, "report-lifecycle")
        replayed_interview_result, replayed_interview_items = (
            await stages.run_interviews(
                session_id="report-lifecycle",
                expected_version=interview_started.version,
            )
        )
        replayed_report_result, replayed_report_artifact = await stages.run_report(
            session_id="report-lifecycle",
            expected_version=report_started.version,
        )
        assert replayed_interview_result.idempotent_replay is True
        assert [item.artifact_id for item in replayed_interview_items] == [
            first_interview.artifact_id
        ]
        assert replayed_report_result.idempotent_replay is True
        assert replayed_report_artifact.artifact_id == report.artifact_id
        assert await _row_counts(session, "report-lifecycle") == before_closed_replay


@pytest.mark.asyncio
async def test_cross_session_and_invalid_references_do_not_mutate(simulation_db):
    sessions = simulation_db
    first, personas, simulation = await _complete_simulation(sessions, "refs-first")
    await _complete_simulation(sessions, "refs-second", simulation_seed=42)
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        before = await stages.store.load_session("refs-second")
        with pytest.raises(IntelligenceReferenceError):
            await stages.start_interviews(
                session_id="refs-second",
                expected_version=before.version,
                persona_artifact_id=personas.artifact_id,
                simulation_artifact_id=simulation.artifact_id,
            )
        after = await stages.store.load_session("refs-second")
        assert after.version == before.version
        assert after.state == IntelligenceState.SIMULATED

        with pytest.raises(ValueError, match="interview_persona_not_found"):
            await stages.interviews.one(
                session_id="refs-first",
                expected_version=first.version,
                persona_artifact_id=personas.artifact_id,
                simulation_artifact_id=simulation.artifact_id,
                persona_id="missing-persona",
            )
        unchanged = await stages.store.load_session("refs-first")
        assert unchanged.version == first.version


@pytest.mark.asyncio
async def test_interview_and_report_recover_from_first_missing_checkpoint(simulation_db):
    sessions = simulation_db
    simulated, personas, simulation = await _complete_simulation(
        sessions, "recover-lifecycle", persona_count=2
    )
    start_time = datetime(2026, 7, 23, 1, tzinfo=UTC)
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.interviews.all(
            session_id="recover-lifecycle",
            expected_version=simulated.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            now=start_time,
        )
        progressed, first = await stages.step_interviews(
            session_id="recover-lifecycle",
            expected_version=started.version,
            now=start_time,
        )
        assert first is not None

    recovery_time = start_time + timedelta(minutes=6)
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        with pytest.raises(IntelligenceLeaseConflictError):
            await stages.step_interviews(
                session_id="recover-lifecycle",
                expected_version=progressed.version,
                now=recovery_time,
            )
        expired_checkpoint = (
            await stages.store.load_session("recover-lifecycle")
        ).checkpoint_manifest
        assert len(expired_checkpoint["completed"]) == 1
        with pytest.raises(IntelligenceLeaseConflictError):
            await stages.interviews.recover(
                session_id="recover-lifecycle",
                expected_version=progressed.version,
                new_owner="too-early",
                now=start_time + timedelta(minutes=1),
            )
        recovered = await stages.interviews.recover(
            session_id="recover-lifecycle",
            expected_version=progressed.version,
            new_owner="recovered-interviews",
            now=recovery_time,
        )
        aggregate = await stages.store.load_session("recover-lifecycle")
        assert len(aggregate.checkpoint_manifest["completed"]) == 1

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(
            IntelligenceStore(session), worker_id="recovered-interviews"
        )
        interviewed, remaining = await stages.run_interviews(
            session_id="recover-lifecycle",
            expected_version=recovered.version,
            now=recovery_time,
        )
        assert len(remaining) == 1
        completed_interviews = [first, *remaining]
        interview_ids = [item.artifact_id for item in completed_interviews]
        interview_hashes = [
            canonical_hash(item.model_dump(mode="json"))
            for item in completed_interviews
        ]

    engine_url = str(sessions.kw["bind"].url)
    replay_engine = create_async_engine(engine_url)
    replay_sessions = async_sessionmaker(
        replay_engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with replay_sessions.begin() as session:
            stages = NativeIntelligenceStages(IntelligenceStore(session))
            before_counts = await _row_counts(session, "recover-lifecycle")
            before = await stages.store.load_session("recover-lifecycle")
            replayed, replayed_items = await stages.run_interviews(
                session_id="recover-lifecycle",
                expected_version=started.version,
            )
            after = await stages.store.load_session("recover-lifecycle")
            assert replayed.idempotent_replay is True
            assert [item.artifact_id for item in replayed_items] == interview_ids
            assert [
                canonical_hash(item.model_dump(mode="json"))
                for item in replayed_items
            ] == interview_hashes
            assert await _row_counts(session, "recover-lifecycle") == before_counts
            assert (after.version, after.checkpoint_manifest) == (
                before.version,
                before.checkpoint_manifest,
            )
    finally:
        await replay_engine.dispose()

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        report_started = await stages.start_report(
            session_id="recover-lifecycle",
            expected_version=interviewed.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            interview_artifact_ids=interview_ids,
            now=recovery_time,
        )

    report_recovery_time = recovery_time + timedelta(minutes=6)
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        with pytest.raises(IntelligenceLeaseConflictError):
            await stages.step_report(
                session_id="recover-lifecycle",
                expected_version=report_started.version,
                now=report_recovery_time,
            )
        recovered_report = await stages.reports.recover(
            session_id="recover-lifecycle",
            expected_version=report_started.version,
            new_owner="recovered-report",
            now=report_recovery_time,
        )
        checkpoint = (
            await stages.store.load_session("recover-lifecycle")
        ).checkpoint_manifest
        assert checkpoint["completed"] == []

    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(
            IntelligenceStore(session), worker_id="recovered-report"
        )
        reported, report = await stages.run_report(
            session_id="recover-lifecycle",
            expected_version=recovered_report.version,
            now=report_recovery_time,
        )
        assert reported.state == IntelligenceState.REPORTED
        assert report.payload["sectionPlan"] == [
            section["name"] for section in report.payload["sections"]
        ]
        answered, _ = await stages.ask_report(
            session_id="recover-lifecycle",
            expected_version=reported.version,
            report_artifact_id=report.artifact_id,
            question="What did recovery preserve?",
        )
        closed, _ = await stages.close(
            session_id="recover-lifecycle",
            expected_version=answered.version,
        )
        assert closed.state == IntelligenceState.CLOSED
        report_hash = canonical_hash(report.model_dump(mode="json"))

    replay_engine = create_async_engine(engine_url)
    replay_sessions = async_sessionmaker(
        replay_engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with replay_sessions.begin() as session:
            stages = NativeIntelligenceStages(IntelligenceStore(session))
            before_counts = await _row_counts(session, "recover-lifecycle")
            before = await stages.store.load_session("recover-lifecycle")
            replayed, replayed_report = await stages.run_report(
                session_id="recover-lifecycle",
                expected_version=report_started.version,
            )
            after = await stages.store.load_session("recover-lifecycle")
            assert replayed.idempotent_replay is True
            assert canonical_hash(
                replayed_report.model_dump(mode="json")
            ) == report_hash
            assert await _row_counts(session, "recover-lifecycle") == before_counts
            assert (after.version, after.checkpoint_manifest) == (
                before.version,
                before.checkpoint_manifest,
            )
    finally:
        await replay_engine.dispose()


@pytest.mark.asyncio
async def test_report_interview_race_has_one_winner_and_no_stranding(simulation_db):
    sessions = simulation_db
    simulated, personas, simulation = await _complete_simulation(sessions, "race-report")
    persona_id = personas.payload["personas"][0]["personaId"]
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.interviews.one(
            session_id="race-report",
            expected_version=simulated.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            persona_id=persona_id,
        )
        interviewed, items = await stages.run_interviews(
            session_id="race-report", expected_version=started.version
        )

    async def start_interview(store):
        return await NativeIntelligenceStages(store).interviews.one(
            session_id="race-report",
            expected_version=interviewed.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            persona_id=persona_id,
            question="Second interview",
        )

    async def start_report(store):
        return await NativeIntelligenceStages(store).start_report(
            session_id="race-report",
            expected_version=interviewed.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            interview_artifact_ids=[items[0].artifact_id],
        )

    async def race(operation):
        try:
            return await run_intelligence_transaction(sessions, operation)
        except IntelligenceConflictError:
            return None

    winners = await asyncio.gather(race(start_interview), race(start_report))
    assert len([winner for winner in winners if winner is not None]) == 1
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        aggregate = await stages.store.load_session("race-report")
        if aggregate.state == IntelligenceState.INTERVIEWING:
            completed, _ = await stages.run_interviews(
                session_id="race-report", expected_version=aggregate.version
            )
            assert completed.state == IntelligenceState.SIMULATED
        else:
            assert aggregate.state == IntelligenceState.REPORTING


@pytest.mark.asyncio
async def test_cancel_interview_then_close_rejects_further_progress(simulation_db):
    sessions = simulation_db
    simulated, personas, simulation = await _complete_simulation(
        sessions, "cancel-interview"
    )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.interviews.all(
            session_id="cancel-interview",
            expected_version=simulated.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
        )
        with pytest.raises(IntelligenceConflictError):
            await stages.close(
                session_id="cancel-interview",
                expected_version=started.version,
            )
        in_flight = await stages.store.load_session("cancel-interview")
        assert in_flight.state == IntelligenceState.INTERVIEWING
        assert in_flight.version == started.version
        cancelled = await stages.cancel_interviews(
            session_id="cancel-interview", expected_version=started.version
        )
        transition_count = len(
            (
                await session.scalars(
                    select(IntelligenceTransition).where(
                        IntelligenceTransition.session_id == "cancel-interview"
                    )
                )
            ).all()
        )
        with pytest.raises(ValueError, match="interview_not_in_progress"):
            await stages.step_interviews(
                session_id="cancel-interview",
                expected_version=cancelled.version,
            )
        aggregate = await stages.store.load_session("cancel-interview")
        assert aggregate.version == cancelled.version
        assert aggregate.checkpoint_manifest is None
        assert (
            len(
                (
                    await session.scalars(
                        select(IntelligenceTransition).where(
                            IntelligenceTransition.session_id == "cancel-interview"
                        )
                    )
                ).all()
            )
            == transition_count
        )
        closed, _ = await stages.close(
            session_id="cancel-interview", expected_version=cancelled.version
        )
        assert closed.state == IntelligenceState.CLOSED


@pytest.mark.asyncio
async def test_foreign_worker_cannot_advance_interview_or_report_on_new_engine(
    simulation_db,
):
    sessions = simulation_db
    simulated, personas, simulation = await _complete_simulation(
        sessions, "foreign-worker"
    )
    start_time = datetime(2026, 7, 23, 2, tzinfo=UTC)
    async with sessions.begin() as session:
        owner_a = NativeIntelligenceStages(
            IntelligenceStore(session), worker_id="owner-a"
        )
        interview_started = await owner_a.interviews.all(
            session_id="foreign-worker",
            expected_version=simulated.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
            now=start_time,
        )

    engine_url = str(sessions.kw["bind"].url)
    reopened_engine = create_async_engine(engine_url)
    reopened_sessions = async_sessionmaker(
        reopened_engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with reopened_sessions.begin() as session:
            owner_b = NativeIntelligenceStages(
                IntelligenceStore(session), worker_id="owner-b"
            )
            before = await owner_b.store.load_session("foreign-worker")
            before_checkpoint = canonical_hash(before.checkpoint_manifest)
            before_counts = await _row_counts(session, "foreign-worker")
            with pytest.raises(
                IntelligenceLeaseConflictError,
                match="operation is owned by another worker",
            ):
                await owner_b.step_interviews(
                    session_id="foreign-worker",
                    expected_version=interview_started.version,
                    now=start_time + timedelta(minutes=1),
                )
            after = await owner_b.store.load_session("foreign-worker")
            assert (after.state, after.version) == (before.state, before.version)
            assert canonical_hash(after.checkpoint_manifest) == before_checkpoint
            assert await _row_counts(session, "foreign-worker") == before_counts

        async with sessions.begin() as session:
            owner_a = NativeIntelligenceStages(
                IntelligenceStore(session), worker_id="owner-a"
            )
            interviewed, interviews = await owner_a.run_interviews(
                session_id="foreign-worker",
                expected_version=interview_started.version,
                now=start_time + timedelta(minutes=1),
            )
            report_started = await owner_a.start_report(
                session_id="foreign-worker",
                expected_version=interviewed.version,
                persona_artifact_id=personas.artifact_id,
                simulation_artifact_id=simulation.artifact_id,
                interview_artifact_ids=[item.artifact_id for item in interviews],
                now=start_time + timedelta(minutes=1),
            )

        async with reopened_sessions.begin() as session:
            owner_b = NativeIntelligenceStages(
                IntelligenceStore(session), worker_id="owner-b"
            )
            before = await owner_b.store.load_session("foreign-worker")
            before_checkpoint = canonical_hash(before.checkpoint_manifest)
            before_counts = await _row_counts(session, "foreign-worker")
            with pytest.raises(
                IntelligenceLeaseConflictError,
                match="operation is owned by another worker",
            ):
                await owner_b.step_report(
                    session_id="foreign-worker",
                    expected_version=report_started.version,
                    now=start_time + timedelta(minutes=2),
                )
            after = await owner_b.store.load_session("foreign-worker")
            assert (after.state, after.version) == (before.state, before.version)
            assert canonical_hash(after.checkpoint_manifest) == before_checkpoint
            assert await _row_counts(session, "foreign-worker") == before_counts
    finally:
        await reopened_engine.dispose()


@pytest.mark.asyncio
async def test_incomplete_interview_completion_replay_is_rejected(simulation_db):
    sessions = simulation_db
    simulated, personas, simulation = await _complete_simulation(
        sessions, "incomplete-replay", persona_count=2
    )
    async with sessions.begin() as session:
        stages = NativeIntelligenceStages(IntelligenceStore(session))
        started = await stages.interviews.all(
            session_id="incomplete-replay",
            expected_version=simulated.version,
            persona_artifact_id=personas.artifact_id,
            simulation_artifact_id=simulation.artifact_id,
        )
        _, artifacts = await stages.run_interviews(
            session_id="incomplete-replay",
            expected_version=started.version,
        )
        completion = await session.scalar(
            select(IntelligenceCommandRecord).where(
                IntelligenceCommandRecord.session_id == "incomplete-replay",
                IntelligenceCommandRecord.command == "interview_complete",
            )
        )
        completion.result_artifact_ids = [artifacts[0].artifact_id]
        await session.flush()
        before_counts = await _row_counts(session, "incomplete-replay")
        with pytest.raises(ValueError, match="interview_replay_incomplete"):
            await stages.run_interviews(
                session_id="incomplete-replay",
                expected_version=started.version,
            )
        assert await _row_counts(session, "incomplete-replay") == before_counts


async def _row_counts(session, session_id: str) -> tuple[int, int]:
    artifacts = await session.scalar(
        select(func.count())
        .select_from(IntelligenceArtifact)
        .where(IntelligenceArtifact.session_id == session_id)
    )
    transitions = await session.scalar(
        select(func.count())
        .select_from(IntelligenceTransition)
        .where(IntelligenceTransition.session_id == session_id)
    )
    return int(artifacts or 0), int(transitions or 0)
