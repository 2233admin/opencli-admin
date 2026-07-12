from typing import Literal, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.validation_run import ValidationRun
from backend.models.workflow_authoring import WorkflowDraft, WorkflowVersion
from backend.schemas.workflow import WorkflowProject, WorkflowRunStartRequest
from backend.services.workflow_authoring_service import DraftRevisionConflictError
from backend.workflow.compiler import compile_workflow_project
from backend.workflow.conformance.contracts import (
    ConformanceCaseResult,
    ExpectedWorkflowRunEvent,
    build_runtime_passport,
    match_expected_events,
)
from backend.workflow.opencli_hda_tracer import list_workflow_run_events, start_workflow_run


class ValidationRunRequestError(ValueError):
    """Raised when a validation run is requested with an invalid mode/payload combination."""


class ValidationRunNotFoundError(ValueError):
    """Raised when a publish references a validation run that doesn't belong to the draft."""


class ValidationRunStaleError(ValueError):
    """Raised when a validation run was captured against a since-superseded draft revision."""


class ValidationRunNotPassedError(ValueError):
    """Raised when a publish references a validation run that never reached status 'passed'."""


class ValidationRunAlreadyConsumedError(ValueError):
    """Raised when a publish references a validation run a prior WorkflowVersion already used."""


async def run_validation(
    session: AsyncSession,
    draft: WorkflowDraft,
    *,
    mode: Literal["fixture", "passthrough"] = "passthrough",
    expected_events: Optional[list[ExpectedWorkflowRunEvent]] = None,
) -> ValidationRun:
    if mode == "fixture" and not expected_events:
        raise ValidationRunRequestError("fixture mode requires a non-empty expected_events list")

    project = WorkflowProject.model_validate(draft.snapshot)
    validation_run = ValidationRun(
        draft_id=draft.id,
        draft_revision=draft.revision,
        status="pending",
        compile_valid=False,
        conformance_mode=mode,
        expected_events=(
            [event.model_dump(mode="json") for event in expected_events]
            if expected_events
            else None
        ),
    )
    session.add(validation_run)
    await session.flush()

    compile_result = compile_workflow_project(project)
    validation_run.compile_valid = compile_result.valid
    validation_run.compile_errors = (
        [error.model_dump(mode="json") for error in compile_result.errors]
        if compile_result.errors
        else None
    )
    if not compile_result.valid:
        validation_run.status = "failed"
        validation_run.failure_reason = "compile_failed"
        await session.flush()
        await session.refresh(validation_run)
        return validation_run

    projection = await start_workflow_run(
        WorkflowRunStartRequest(project=project), session=session
    )
    validation_run.run_id = projection.runId

    events = await list_workflow_run_events(projection.runId, session=session) or []
    actual_events = [event.model_dump(mode="json") for event in events]

    if mode == "fixture":
        match_result = match_expected_events(actual_events, expected_events or [])
        passed = match_result.passed
        failures = match_result.failures
        conformance_result: dict = match_result.model_dump(mode="json")
    else:
        failed_events = [event for event in actual_events if event.get("eventType") == "failed"]
        failures = [
            f"node {event.get('nodeId')} reported a failed event" for event in failed_events
        ]
        passed = projection.valid and projection.status != "failed" and not failed_events
        conformance_result = {"passed": passed, "failures": failures}

    case_result = ConformanceCaseResult(
        id=draft.id,
        status="passed" if passed else "failed",
        failures=failures,
    )
    passport = build_runtime_passport([case_result])

    validation_run.conformance_result = conformance_result
    validation_run.runtime_passport = passport.model_dump(mode="json")
    validation_run.status = "passed" if passed else "failed"
    if not passed:
        validation_run.failure_reason = "conformance_failed"

    await session.flush()
    await session.refresh(validation_run)
    return validation_run


async def get_validation_run(session: AsyncSession, validation_run_id: str) -> Optional[ValidationRun]:
    result = await session.execute(
        select(ValidationRun).where(ValidationRun.id == validation_run_id)
    )
    return result.scalar_one_or_none()


async def publish_draft(
    session: AsyncSession,
    draft: WorkflowDraft,
    *,
    validation_run_id: str,
    expected_revision: int,
) -> WorkflowVersion:
    if draft.revision != expected_revision:
        raise DraftRevisionConflictError(
            f"draft revision {draft.revision} does not match expected {expected_revision}"
        )

    validation_run = await get_validation_run(session, validation_run_id)
    if validation_run is None or validation_run.draft_id != draft.id:
        raise ValidationRunNotFoundError(
            f"validation run {validation_run_id!r} not found for draft {draft.id!r}"
        )
    if validation_run.draft_revision != expected_revision:
        raise ValidationRunStaleError(
            "validation run was captured against a stale draft revision"
        )
    if validation_run.status != "passed":
        raise ValidationRunNotPassedError(
            f"validation run status is {validation_run.status!r}, expected 'passed'"
        )

    existing = await session.execute(
        select(WorkflowVersion).where(WorkflowVersion.validation_run_id == validation_run_id)
    )
    if existing.scalar_one_or_none() is not None:
        raise ValidationRunAlreadyConsumedError(
            f"validation run {validation_run_id!r} has already been published"
        )

    next_version_result = await session.execute(
        select(func.max(WorkflowVersion.version_number)).where(
            WorkflowVersion.project_id == draft.project_id
        )
    )
    next_version_number = (next_version_result.scalar_one_or_none() or 0) + 1

    version = WorkflowVersion(
        project_id=draft.project_id,
        draft_id=draft.id,
        version_number=next_version_number,
        source_revision=draft.revision,
        validation_run_id=validation_run.id,
        snapshot=draft.snapshot,
    )
    session.add(version)
    await session.flush()
    await session.refresh(version)
    return version
