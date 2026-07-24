import asyncio
from contextlib import AsyncExitStack
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.database import Base, commit_session
from backend.models.intelligence import (
    IntelligenceArtifact,
    IntelligenceArtifactReference,
    IntelligenceOutbox,
    IntelligenceSession,
    IntelligenceTransition,
)
from backend.models.workflow_run import WorkflowRun, WorkflowRunEvent
from backend.workflow.intelligence_outbox import IntelligenceOutboxDispatcher
from backend.workflow.intelligence_store import (
    IntelligenceArtifactInvariantError,
    IntelligenceConflictError,
    IntelligenceIdempotencyConflictError,
    IntelligenceLeaseConflictError,
    IntelligenceStore,
    run_intelligence_transaction,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    IntelligenceCommand,
    IntelligenceCommandName,
    OperationLease,
    ResearchArtifact,
    canonical_hash,
)
from backend.workflow.native_intelligence_state import IntelligenceState
from tests.postgres_conformance import temporary_postgres_database


@pytest.fixture(
    params=(
        pytest.param("sqlite", id="sqlite"),
        pytest.param(
            "postgresql",
            id="postgresql",
            marks=pytest.mark.postgres_conformance,
        ),
    )
)
async def intelligence_db(request, tmp_path):
    async with AsyncExitStack() as resources:
        if request.param == "sqlite":
            path = (tmp_path / "intelligence.db").as_posix()
            engine = create_async_engine(
                f"sqlite+aiosqlite:///{path}",
                connect_args={"check_same_thread": False, "timeout": 30},
            )

            @event.listens_for(engine.sync_engine, "connect")
            def _foreign_keys(dbapi_connection, _):
                dbapi_connection.execute("PRAGMA foreign_keys=ON")
                dbapi_connection.execute("PRAGMA journal_mode=WAL")
        else:
            database_url = await resources.enter_async_context(
                temporary_postgres_database("intelligence_store")
            )
            engine = create_async_engine(database_url)

        resources.push_async_callback(engine.dispose)
        sessions = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield sessions


def _run(run_id: str = "run-intelligence") -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        workflow_id="workflow-intelligence",
        trace_id=f"trace-{run_id}",
        status="running",
        valid=True,
        request={},
        projection={},
    )


def _command(
    name: IntelligenceCommandName,
    version: int,
    key: str,
    *,
    request=None,
    run=False,
    lease=None,
    session_id="session-intelligence",
    node_id="intelligence-node",
) -> IntelligenceCommand:
    context = (
        {
            "run_id": "run-intelligence",
            "workflow_id": "workflow-intelligence",
            "trace_id": "trace-run-intelligence",
            "node_id": node_id,
        }
        if run
        else {}
    )
    return IntelligenceCommand(
        command=name,
        session_id=session_id,
        expected_version=version,
        idempotency_key=key,
        request=request or {},
        lease=lease,
        **context,
    )


def _research_artifact(session_id="session-intelligence", artifact_id="research-1"):
    return ResearchArtifact(
        artifact_id=artifact_id,
        session_id=session_id,
        payload={"brief": "bounded", "simulated": False},
        simulated=False,
        provenance=ArtifactProvenance(source="fixture"),
        algorithm_version="research-test-v1",
        seed=7,
    )


@pytest.mark.asyncio
async def test_artifact_provenance_invariant_rejects_before_write_and_on_reload(
    intelligence_db,
):
    sessions = intelligence_db
    invalid = ResearchArtifact.model_construct(
        artifact_id="research-invalid",
        session_id="session-intelligence",
        kind="research",
        payload={"brief": "invalid"},
        grounding_artifact_ids=[],
        simulated=True,
        provenance=ArtifactProvenance(source="fixture"),
        algorithm_version="test",
        seed=1,
        schema_version="intelligence.artifact.v1",
    )
    async with sessions() as session:
        await IntelligenceStore(session).create_session(
            session_id="session-intelligence",
            idempotency_key="create-invalid-artifact",
        )
        with pytest.raises(
            IntelligenceArtifactInvariantError,
            match="artifact violates provenance invariants",
        ):
            await IntelligenceStore(session)._append_artifacts([invalid])
        assert (
            await session.scalar(select(func.count()).select_from(IntelligenceArtifact))
        ) == 0

        malformed_payload = invalid.model_dump(mode="json")
        session.add(
            IntelligenceArtifact(
                session_id="session-intelligence",
                artifact_id="research-corrupt",
                schema_version="intelligence.artifact.v1",
                kind="research",
                payload={"brief": "corrupt"},
                simulated=True,
                provenance={"source": "fixture", "evidence_artifact_ids": []},
                algorithm_version="test",
                seed=1,
                content_hash=canonical_hash(
                    {
                        **malformed_payload,
                        "artifact_id": "research-corrupt",
                        "payload": {"brief": "corrupt"},
                    }
                ),
            )
        )
        await session.flush()
        with pytest.raises(
            IntelligenceArtifactInvariantError,
            match="persisted artifact violates provenance invariants",
        ):
            await IntelligenceStore(session).load_artifact(
                "session-intelligence",
                "research-corrupt",
            )


@pytest.mark.asyncio
async def test_atomic_transition_artifact_workflow_event_outbox_and_restart(
    intelligence_db,
):
    sessions = intelligence_db
    research_lease = OperationLease(
        operation_id="research-operation",
        owner="research-worker",
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    async with sessions() as setup:
        setup.add(_run())
        store = IntelligenceStore(setup)
        await store.create_session(
            session_id="session-intelligence",
            idempotency_key="create-1",
            created_by_run_id="run-intelligence",
        )
        await setup.commit()

    async with sessions() as first_process:
        result = await IntelligenceStore(first_process).apply(
            _command(
                IntelligenceCommandName.RESEARCH,
                0,
                "research-start",
                run=True,
                lease=research_lease,
            )
        )
        await first_process.commit()
    assert result.state == IntelligenceState.RESEARCHING

    async with sessions() as restarted_process:
        completed = await IntelligenceStore(restarted_process).apply(
            _command(
                IntelligenceCommandName.RESEARCH_COMPLETE,
                1,
                "research-complete",
                run=True,
                lease=research_lease,
            ),
            artifacts=[_research_artifact()],
        )
        await restarted_process.commit()

    async with sessions() as verification:
        aggregate = await verification.get(IntelligenceSession, "session-intelligence")
        transitions = await verification.scalar(
            select(func.count()).select_from(IntelligenceTransition)
        )
        outbox = await verification.scalar(
            select(func.count()).select_from(IntelligenceOutbox)
        )
        events = (
            await verification.scalars(
                select(WorkflowRunEvent).order_by(WorkflowRunEvent.sequence)
            )
        ).all()
        artifact = await verification.scalar(select(IntelligenceArtifact))
    assert completed.version == 2
    assert aggregate is not None and aggregate.state == IntelligenceState.RESEARCH_READY
    assert transitions == outbox == 2
    assert [event.sequence for event in events] == [1, 2]
    assert events[-1].payload["details"]["artifactIds"] == ["research-1"]
    assert len(str(events[-1].payload)) < 16_384
    assert artifact is not None
    assert artifact.payload == {"brief": "bounded", "simulated": False}


@pytest.mark.asyncio
async def test_idempotency_stale_version_and_payload_mismatch(intelligence_db):
    sessions = intelligence_db
    async with sessions() as session:
        store = IntelligenceStore(session)
        await store.create_session(
            session_id="session-intelligence", idempotency_key="create-1"
        )
        command = _command(IntelligenceCommandName.RESEARCH, 0, "research-1")
        initial = await store.apply(command)
        replay = await store.apply(command)
        assert replay.idempotent_replay
        assert replay.transition_event_id == initial.transition_event_id
        with pytest.raises(IntelligenceIdempotencyConflictError):
            await store.apply(command.model_copy(update={"request": {"changed": True}}))
        with pytest.raises(IntelligenceConflictError):
            await store.apply(
                _command(IntelligenceCommandName.RESEARCH_COMPLETE, 0, "stale")
            )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "boundary",
    [
        "after_cas",
        "after_artifact_append",
        "after_transition_append",
        "after_workflow_event_append",
        "after_outbox_append",
    ],
)
async def test_crash_boundaries_roll_back_every_authoritative_row(
    intelligence_db, boundary
):
    sessions = intelligence_db
    async with sessions() as setup:
        setup.add(_run())
        await IntelligenceStore(setup).create_session(
            session_id="session-intelligence", idempotency_key="create-1"
        )
        await setup.commit()

    def crash(stage):
        if stage == boundary:
            raise RuntimeError(f"crash:{stage}")

    async with sessions() as session:
        with pytest.raises(RuntimeError, match=boundary):
            await IntelligenceStore(session, fault_hook=crash).apply(
                _command(IntelligenceCommandName.RESEARCH, 0, "research-1", run=True)
            )
        await session.rollback()

    async with sessions() as verification:
        aggregate = await verification.get(IntelligenceSession, "session-intelligence")
        assert aggregate is not None and aggregate.version == 0
        assert await verification.scalar(
            select(func.count()).select_from(IntelligenceTransition)
        ) == 0
        assert await verification.scalar(
            select(func.count()).select_from(WorkflowRunEvent)
        ) == 0
        assert await verification.scalar(
            select(func.count()).select_from(IntelligenceOutbox)
        ) == 0


@pytest.mark.asyncio
async def test_failure_resume_preserves_original_operation_identity(intelligence_db):
    sessions = intelligence_db
    expires = datetime.now(UTC) + timedelta(minutes=1)
    lease = OperationLease(
        operation_id="operation-stable",
        owner="worker-a",
        expires_at=expires,
        checkpoint_manifest={"planned": ["a", "b"], "completed": ["a"]},
    )
    async with sessions() as session:
        store = IntelligenceStore(session)
        await store.create_session(
            session_id="session-intelligence", idempotency_key="create-1"
        )
        await store.apply(
            _command(
                IntelligenceCommandName.RESEARCH,
                0,
                "research-original",
                lease=lease,
            )
        )
        failed = await store.apply(
            _command(
                IntelligenceCommandName.FAIL,
                1,
                "research-fail",
                request={"retryable": True},
            )
        )
        resumed = await store.apply(
            _command(IntelligenceCommandName.RESUME, 2, "research-resume")
        )
        aggregate = await store.load_session("session-intelligence")
    assert failed.state == IntelligenceState.FAILED
    assert resumed.state == IntelligenceState.RESEARCHING
    assert aggregate.operation_id == "operation-stable"
    assert aggregate.operation_idempotency_key == "research-original"
    assert aggregate.checkpoint_manifest["completed"] == ["a"]


@pytest.mark.asyncio
async def test_expired_lease_has_one_recovery_winner(intelligence_db):
    sessions = intelligence_db
    future = datetime.now(UTC) + timedelta(minutes=5)
    async with sessions() as setup:
        store = IntelligenceStore(setup)
        await store.create_session(
            session_id="session-intelligence", idempotency_key="create-1"
        )
        await store.apply(
            _command(
                IntelligenceCommandName.RESEARCH,
                0,
                "research-1",
                lease=OperationLease(
                    operation_id="operation-1",
                    owner="worker-a",
                    expires_at=future,
                    checkpoint_manifest={"remaining": ["research"]},
                ),
            )
        )
        await setup.commit()

    async with sessions() as before_expiry:
        with pytest.raises(IntelligenceLeaseConflictError):
            await IntelligenceStore(before_expiry).recover_lease(
                _command(IntelligenceCommandName.RECOVER, 1, "recover-early"),
                new_owner="worker-b",
                expires_at=future + timedelta(minutes=5),
            )
        await before_expiry.rollback()

    async with sessions() as expire:
        aggregate = await expire.get(IntelligenceSession, "session-intelligence")
        aggregate.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await expire.commit()

    async def recover(owner):
        async with sessions() as session:
            try:
                result = await IntelligenceStore(session).recover_lease(
                    _command(IntelligenceCommandName.RECOVER, 1, f"recover-{owner}"),
                    new_owner=owner,
                    expires_at=datetime.now(UTC) + timedelta(minutes=5),
                )
                await session.commit()
                return result
            except (IntelligenceConflictError, IntelligenceLeaseConflictError):
                await session.rollback()
                return None

    winners = await asyncio.gather(recover("worker-b"), recover("worker-c"))
    assert len([winner for winner in winners if winner is not None]) == 1
    async with sessions() as verification:
        aggregate = await verification.get(IntelligenceSession, "session-intelligence")
    assert aggregate is not None and aggregate.version == 2
    assert aggregate.operation_id == "operation-1"
    assert aggregate.operation_attempt == 2


@pytest.mark.asyncio
async def test_database_composite_foreign_key_rejects_cross_session_reference(
    intelligence_db,
):
    sessions = intelligence_db
    async with sessions() as session:
        for session_id in ("session-a", "session-b"):
            await IntelligenceStore(session).create_session(
                session_id=session_id, idempotency_key="create"
            )
            session.add(
                IntelligenceArtifact(
                    session_id=session_id,
                    artifact_id=f"artifact-{session_id[-1]}",
                    schema_version="intelligence.artifact.v1",
                    kind="research",
                    payload={},
                    simulated=False,
                    provenance={"source": "fixture"},
                    algorithm_version="v1",
                    seed=1,
                    content_hash="a" * 64,
                )
            )
        await session.flush()
        session.add(
            IntelligenceArtifactReference(
                session_id="session-a",
                source_artifact_id="artifact-a",
                target_artifact_id="artifact-b",
                relation="grounded_by",
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()


@pytest.mark.asyncio
async def test_outbox_dispatch_is_after_commit_deduped_and_retry_safe(intelligence_db):
    sessions = intelligence_db
    attempts = []

    async def publisher(event_id, payload):
        attempts.append((event_id, payload))
        if len(attempts) == 1:
            raise RuntimeError("mirror unavailable")

    dispatcher = IntelligenceOutboxDispatcher(sessions, publisher)
    async with sessions() as session:
        await IntelligenceStore(session).create_session(
            session_id="session-intelligence", idempotency_key="create-1"
        )
        await session.commit()
    async with sessions() as session:
        await IntelligenceStore(session, outbox_dispatcher=dispatcher).apply(
            _command(IntelligenceCommandName.RESEARCH, 0, "research-1")
        )
        await commit_session(session)

    async with sessions() as verification:
        row = await verification.scalar(select(IntelligenceOutbox))
        assert row is not None and row.state == "pending" and row.attempts == 1
    assert await dispatcher.dispatch_pending() == 1
    assert await dispatcher.dispatch_pending() == 0
    async with sessions() as verification:
        row = await verification.scalar(select(IntelligenceOutbox))
        assert row is not None and row.state == "delivered" and row.attempts == 2


@pytest.mark.asyncio
async def test_outbox_batch_dispatch_reports_failed_delivery(intelligence_db, caplog):
    sessions = intelligence_db

    async def unavailable_publisher(event_id, payload):
        raise RuntimeError("mirror unavailable")

    dispatcher = IntelligenceOutboxDispatcher(sessions, unavailable_publisher)
    async with sessions() as session:
        await IntelligenceStore(session).create_session(
            session_id="session-intelligence", idempotency_key="create-1"
        )
        await session.commit()
    async with sessions() as session:
        await IntelligenceStore(session, outbox_dispatcher=dispatcher).apply(
            _command(IntelligenceCommandName.RESEARCH, 0, "research-1")
        )
        await commit_session(session)

    caplog.clear()
    caplog.set_level("WARNING", logger="backend.workflow.intelligence_outbox")
    assert await dispatcher.dispatch_pending() == 0
    assert "Native intelligence outbox delivery failed" in caplog.text

    async with sessions() as verification:
        row = await verification.scalar(select(IntelligenceOutbox))
        assert row is not None and row.state == "pending" and row.attempts == 2
        assert row.last_error == "mirror unavailable"


@pytest.mark.asyncio
async def test_step_and_stop_race_has_one_cas_winner(intelligence_db):
    sessions = intelligence_db
    async with sessions() as setup:
        setup.add(
            IntelligenceSession(
                id="session-intelligence",
                state=IntelligenceState.RUNNING,
                version=0,
                transition_sequence=0,
                workflow_projection={"status": "running", "domain_state": "running"},
            )
        )
        await setup.commit()

    async def execute(name, key):
        try:
            return await run_intelligence_transaction(
                sessions,
                lambda store: store.apply(_command(name, 0, key)),
            )
        except IntelligenceConflictError:
            return None

    outcomes = await asyncio.gather(
        execute(IntelligenceCommandName.STEP, "step-1"),
        execute(IntelligenceCommandName.STOP, "stop-1"),
    )
    assert len([outcome for outcome in outcomes if outcome is not None]) == 1
    async with sessions() as verification:
        aggregate = await verification.get(IntelligenceSession, "session-intelligence")
        transitions = (
            await verification.scalars(select(IntelligenceTransition))
        ).all()
    assert aggregate is not None and aggregate.version == 1
    assert len(transitions) == 1


@pytest.mark.asyncio
async def test_two_sessions_share_gap_free_workflow_event_allocator(intelligence_db):
    sessions = intelligence_db
    async with sessions() as setup:
        setup.add(_run())
        for session_id in ("session-a", "session-b"):
            await IntelligenceStore(setup).create_session(
                session_id=session_id, idempotency_key="create"
            )
        await setup.commit()

    async def start(session_id, node_id):
        return await run_intelligence_transaction(
            sessions,
            lambda store: store.apply(
                _command(
                    IntelligenceCommandName.RESEARCH,
                    0,
                    "research",
                    run=True,
                    session_id=session_id,
                    node_id=node_id,
                )
            ),
        )

    await asyncio.gather(start("session-a", "node-a"), start("session-b", "node-b"))
    async with sessions() as verification:
        events = (
            await verification.scalars(
                select(WorkflowRunEvent).order_by(WorkflowRunEvent.sequence)
            )
        ).all()
        run = await verification.get(WorkflowRun, "run-intelligence")
    assert [event.sequence for event in events] == [1, 2]
    assert {event.node_id for event in events} == {"node-a", "node-b"}
    assert run is not None and run.next_event_sequence == 3


@pytest.mark.asyncio
async def test_cancel_and_close_are_durable_idempotent_terminals(intelligence_db):
    sessions = intelligence_db
    async with sessions() as session:
        session.add(
            IntelligenceSession(
                id="session-intelligence",
                state=IntelligenceState.RUNNING,
                version=0,
                transition_sequence=0,
                workflow_projection={"status": "running", "domain_state": "running"},
            )
        )
        await session.commit()

    async with sessions() as session:
        store = IntelligenceStore(session)
        cancelled = await store.apply(
            _command(IntelligenceCommandName.CANCEL, 0, "cancel-1")
        )
        repeated_cancel = await store.apply(
            _command(IntelligenceCommandName.CANCEL, 1, "cancel-2")
        )
        closed = await store.apply(
            _command(IntelligenceCommandName.CLOSE, 1, "close-1")
        )
        repeated_close = await store.apply(
            _command(IntelligenceCommandName.CLOSE, 2, "close-2")
        )
        with pytest.raises(IntelligenceConflictError):
            await store.apply(_command(IntelligenceCommandName.STEP, 2, "post-close"))
        await session.commit()

    assert cancelled.state == IntelligenceState.CANCELLED
    assert repeated_cancel.no_op
    assert closed.state == IntelligenceState.CLOSED
    assert repeated_close.no_op
    async with sessions() as verification:
        aggregate = await verification.get(IntelligenceSession, "session-intelligence")
        transition_count = await verification.scalar(
            select(func.count()).select_from(IntelligenceTransition)
        )
    assert aggregate is not None and aggregate.version == 2
    assert aggregate.workflow_projection["terminal"] is True
    assert transition_count == 2


@pytest.mark.asyncio
async def test_reporting_progress_checkpoint_is_owner_scoped_and_monotonic(
    intelligence_db,
):
    sessions = intelligence_db
    expiry = datetime.now(UTC) + timedelta(minutes=5)
    async with sessions() as session:
        session.add(
            IntelligenceSession(
                id="session-intelligence",
                state=IntelligenceState.REPORTING,
                version=0,
                transition_sequence=0,
                workflow_projection={"status": "running", "domain_state": "reporting"},
                operation_id="report-operation",
                operation_command="report",
                operation_idempotency_key="report-1",
                operation_request_hash="a" * 64,
                lease_owner="report-worker",
                lease_expires_at=expiry,
                operation_attempt=1,
                checkpoint_manifest={
                    "planned": ["intro", "findings"],
                    "completed": [],
                    "progress_sequence": 0,
                },
            )
        )
        await session.commit()

    progress_lease = OperationLease(
        operation_id="report-operation",
        owner="report-worker",
        expires_at=expiry,
        checkpoint_manifest={
            "planned": ["intro", "findings"],
            "completed": ["intro"],
            "progress_sequence": 1,
        },
    )
    async with sessions() as session:
        store = IntelligenceStore(session)
        progressed = await store.apply(
            _command(
                IntelligenceCommandName.REPORT_PROGRESS,
                0,
                "progress-1",
                lease=progress_lease,
            )
        )
        assert progressed.state == IntelligenceState.REPORTING
        with pytest.raises(IntelligenceConflictError):
            await store.apply(
                _command(
                    IntelligenceCommandName.REPORT_PROGRESS,
                    1,
                    "progress-stale",
                    lease=progress_lease,
                )
            )
        with pytest.raises(IntelligenceLeaseConflictError):
            await store.apply(
                _command(
                    IntelligenceCommandName.REPORT_PROGRESS,
                    1,
                    "progress-foreign",
                    lease=progress_lease.model_copy(update={"owner": "other-worker"}),
                )
            )
        await session.commit()


@pytest.mark.asyncio
async def test_running_fail_resume_preserves_start_identity_without_duplicates(
    intelligence_db,
):
    sessions = intelligence_db
    async with sessions() as setup:
        setup.add(_run())
        await setup.flush()
        setup.add(
            IntelligenceSession(
                id="session-intelligence",
                created_by_run_id="run-intelligence",
                state=IntelligenceState.PREPARED,
                version=0,
                transition_sequence=0,
                workflow_projection={"status": "running", "domain_state": "prepared"},
            )
        )
        await setup.commit()

    async with sessions() as session:
        store = IntelligenceStore(session)
        started = await store.apply(
            _command(IntelligenceCommandName.START, 0, "simulation-start", run=True)
        )
        aggregate = await store.load_session("session-intelligence")
        start_operation_id = aggregate.operation_id
        failed = await store.apply(
            _command(
                IntelligenceCommandName.FAIL,
                1,
                "simulation-fail",
                request={"retryable": True},
                run=True,
            )
        )
        resumed = await store.apply(
            _command(
                IntelligenceCommandName.RESUME,
                2,
                "simulation-resume",
                run=True,
            )
        )
        replay = await store.apply(
            _command(
                IntelligenceCommandName.RESUME,
                2,
                "simulation-resume",
                run=True,
            )
        )
        await session.commit()

    assert started.state == IntelligenceState.RUNNING
    assert failed.state == IntelligenceState.FAILED
    assert resumed.state == IntelligenceState.RUNNING
    assert replay.idempotent_replay
    async with sessions() as verification:
        aggregate = await verification.get(IntelligenceSession, "session-intelligence")
        transitions = (
            await verification.scalars(
                select(IntelligenceTransition).order_by(IntelligenceTransition.sequence)
            )
        ).all()
        events = (
            await verification.scalars(
                select(WorkflowRunEvent).order_by(WorkflowRunEvent.sequence)
            )
        ).all()
        artifacts = await verification.scalar(
            select(func.count()).select_from(IntelligenceArtifact)
        )
    assert aggregate is not None
    assert aggregate.operation_id == start_operation_id
    assert aggregate.operation_command == IntelligenceCommandName.START.value
    assert aggregate.operation_idempotency_key == "simulation-start"
    assert aggregate.retry_metadata is None
    assert [transition.command for transition in transitions] == [
        "start",
        "fail",
        "resume",
    ]
    assert [event.sequence for event in events] == [1, 2, 3]
    assert artifacts == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("state", "command_name", "expected_state"),
    [
        (
            IntelligenceState.RESEARCHING,
            IntelligenceCommandName.RESEARCH_COMPLETE,
            IntelligenceState.RESEARCH_READY,
        ),
        (
            IntelligenceState.INTERVIEWING,
            IntelligenceCommandName.INTERVIEW_COMPLETE,
            IntelligenceState.SIMULATED,
        ),
        (
            IntelligenceState.REPORTING,
            IntelligenceCommandName.REPORT_COMPLETE,
            IntelligenceState.REPORTED,
        ),
    ],
)
async def test_completion_requires_current_non_expired_operation_owner(
    intelligence_db,
    state,
    command_name,
    expected_state,
):
    sessions = intelligence_db
    future = datetime.now(UTC) + timedelta(minutes=5)
    operation_id = f"{state.value}-operation"
    async with sessions() as setup:
        setup.add(
            IntelligenceSession(
                id="session-intelligence",
                state=state,
                version=0,
                transition_sequence=0,
                workflow_projection={"status": "running", "domain_state": state.value},
                operation_id=operation_id,
                operation_command=command_name.value.removesuffix("_complete"),
                operation_idempotency_key=f"{state.value}-start",
                operation_request_hash="a" * 64,
                lease_owner="current-worker",
                lease_expires_at=future,
                operation_attempt=1,
                checkpoint_manifest={},
            )
        )
        await setup.commit()

    foreign_lease = OperationLease(
        operation_id=operation_id,
        owner="foreign-worker",
        expires_at=future,
    )
    async with sessions() as foreign:
        with pytest.raises(IntelligenceLeaseConflictError) as exc_info:
            await IntelligenceStore(foreign).apply(
                _command(command_name, 0, "foreign-complete", lease=foreign_lease)
            )
        assert exc_info.value.code == "operation_in_progress"
        await foreign.rollback()

    matching_lease = foreign_lease.model_copy(update={"owner": "current-worker"})
    async with sessions() as expire:
        aggregate = await expire.get(IntelligenceSession, "session-intelligence")
        aggregate.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await expire.commit()
    async with sessions() as expired:
        with pytest.raises(IntelligenceLeaseConflictError):
            await IntelligenceStore(expired).apply(
                _command(command_name, 0, "expired-complete", lease=matching_lease)
            )
        await expired.rollback()

    recovered_expiry = datetime.now(UTC) + timedelta(minutes=5)
    async with sessions() as reclaim:
        recovered = await IntelligenceStore(reclaim).recover_lease(
            _command(IntelligenceCommandName.RECOVER, 0, "recover-expired"),
            new_owner="recovery-worker",
            expires_at=recovered_expiry,
        )
        await reclaim.commit()
    assert recovered.version == 1
    recovered_lease = OperationLease(
        operation_id=operation_id,
        owner="recovery-worker",
        expires_at=recovered_expiry,
        attempt=2,
    )
    async with sessions() as current:
        completed = await IntelligenceStore(current).apply(
            _command(command_name, 1, "current-complete", lease=recovered_lease)
        )
        await current.commit()
    assert completed.state == expected_state


@pytest.mark.asyncio
async def test_high_63_bit_seed_round_trips(intelligence_db):
    sessions = intelligence_db
    high_seed = 2**63 - 1
    async with sessions() as session:
        await IntelligenceStore(session).create_session(
            session_id="session-intelligence", idempotency_key="create"
        )
        session.add(
            IntelligenceArtifact(
                session_id="session-intelligence",
                artifact_id="high-seed",
                schema_version="intelligence.artifact.v1",
                kind="simulation",
                payload={},
                simulated=True,
                provenance={"source": "fixture"},
                algorithm_version="v1",
                seed=high_seed,
                content_hash="a" * 64,
            )
        )
        await session.commit()
    async with sessions() as verification:
        artifact = await verification.scalar(
            select(IntelligenceArtifact).where(
                IntelligenceArtifact.artifact_id == "high-seed"
            )
        )
    assert artifact is not None and artifact.seed == high_seed
