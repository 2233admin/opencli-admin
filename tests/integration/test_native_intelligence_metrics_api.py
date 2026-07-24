from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event

from backend.models.intelligence import IntelligenceOutbox, IntelligenceSession
from backend.workflow.intelligence_store import (
    IntelligenceConflictError,
    IntelligenceIdempotencyConflictError,
    IntelligenceLeaseConflictError,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    IntelligenceCommand,
    IntelligenceCommandName,
    ResearchArtifact,
)
from backend.workflow.native_intelligence_executor import (
    _ACTION_HANDLERS,
    NATIVE_INTELLIGENCE_ACTION_BY_NAME,
    native_intelligence_action_manifest,
)
from backend.workflow.native_intelligence_metrics import reset_for_tests
from backend.workflow.native_intelligence_state import (
    IntelligenceState,
    workflow_projection,
)


@pytest.mark.asyncio
async def test_native_intelligence_metrics_are_bounded_and_outbox_is_durable(
    client,
    db_engine,
    db_session,
):
    reset_for_tests()

    IntelligenceConflictError("lost compare-and-swap")
    IntelligenceConflictError("invalid transition", metric_reason="state")
    IntelligenceIdempotencyConflictError("request changed")
    IntelligenceLeaseConflictError("lease held")
    with pytest.raises(ValueError, match="artifact_simulation_flag_invalid"):
        ResearchArtifact(
            artifact_id="research_invalid",
            session_id="11111111-1111-4111-8111-111111111111",
            payload={},
            simulated=True,
            provenance=ArtifactProvenance(source="test"),
            algorithm_version="test-v1",
            seed=0,
        )
    with pytest.raises(ValueError, match="run context"):
        IntelligenceCommand(
            command=IntelligenceCommandName.RESEARCH,
            session_id="11111111-1111-4111-8111-111111111111",
            expected_version=0,
            idempotency_key="metrics-command",
            run_id="run-only",
        )

    research_handler = _ACTION_HANDLERS.pop("research")
    try:
        manifest = native_intelligence_action_manifest(
            NATIVE_INTELLIGENCE_ACTION_BY_NAME["research"]
        )
        assert manifest["readiness"]["missingReasons"] == ["executor_registered"]
    finally:
        _ACTION_HANDLERS["research"] = research_handler

    session_id = "22222222-2222-4222-8222-222222222222"
    db_session.add(
        IntelligenceSession(
            id=session_id,
            state=IntelligenceState.CREATED,
            version=0,
            transition_sequence=0,
            workflow_projection=workflow_projection(IntelligenceState.CREATED),
        )
    )
    db_session.add(
        IntelligenceOutbox(
            event_id="metrics-pending-event",
            session_id=session_id,
            topic="intelligence.transition",
            payload={},
            state="pending",
            attempts=3,
            available_at=datetime.now(UTC) - timedelta(seconds=10),
            last_error="temporary delivery failure",
        )
    )
    db_session.add_all(
        [
            IntelligenceOutbox(
                event_id=f"metrics-delivered-event-{index}",
                session_id=session_id,
                topic="intelligence.transition",
                payload={},
                state="delivered",
                attempts=100,
                available_at=datetime.now(UTC) - timedelta(days=365),
                delivered_at=datetime.now(UTC),
                last_error="historical failure",
            )
            for index in range(500)
        ]
    )
    await db_session.commit()

    statements: list[str] = []

    def capture_statement(
        _connection,
        _cursor,
        statement,
        _parameters,
        _context,
        _executemany,
    ):
        statements.append(statement)

    event.listen(db_engine.sync_engine, "before_cursor_execute", capture_statement)
    try:
        response = await client.get("/api/v1/control/native-intelligence-state")
    finally:
        event.remove(
            db_engine.sync_engine,
            "before_cursor_execute",
            capture_statement,
        )

    assert response.status_code == 200
    snapshot = response.json()["data"]
    assert snapshot["schema"] == "native-intelligence.metrics.v1"
    assert snapshot["counters"]["scope"] == "process"
    assert snapshot["counters"]["processInstanceId"]
    datetime.fromisoformat(snapshot["counters"]["processStartedAt"])
    assert set(snapshot["counters"]["transitionConflicts"]) == {
        "version",
        "idempotency",
        "lease",
        "state",
        "other",
    }
    assert snapshot["counters"]["transitionConflicts"] == {
        "version": 1,
        "idempotency": 1,
        "lease": 1,
        "state": 1,
        "other": 0,
    }
    assert snapshot["counters"]["rejectedContracts"]["artifact_invariant"] == 1
    assert snapshot["counters"]["rejectedContracts"]["command_contract"] == 1
    assert snapshot["counters"]["readinessBlocked"]["executor_registered"] == 1
    assert snapshot["outbox"]["pendingCount"] == 1
    assert snapshot["outbox"]["oldestPendingAgeSeconds"] >= 9
    assert snapshot["outbox"]["retryCount"] == 2
    assert snapshot["outbox"]["failureCount"] == 1

    outbox_statement = next(
        statement
        for statement in statements
        if "FROM intelligence_outbox" in statement
    ).lower()
    assert "count(" in outbox_statement
    assert "min(" in outbox_statement
    assert outbox_statement.count("sum(") == 2
    assert "where intelligence_outbox.state =" in outbox_statement

    second = (await client.get("/api/v1/control/native-intelligence-state")).json()[
        "data"
    ]
    assert second["counters"]["scope"] == "process"
    assert (
        second["counters"]["processInstanceId"]
        == snapshot["counters"]["processInstanceId"]
    )
    assert (
        second["counters"]["processStartedAt"]
        == snapshot["counters"]["processStartedAt"]
    )
