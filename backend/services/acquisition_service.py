import hashlib
import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.acquisition import AcquisitionExecution, AcquisitionExecutionStatus
from backend.schemas.acquisition import AcquisitionSubmission


@dataclass(frozen=True)
class SubmissionOutcome:
    execution: AcquisitionExecution
    idempotency_match: bool
    created: bool


def request_fingerprint(body: AcquisitionSubmission) -> str:
    canonical = json.dumps(
        body.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


async def get_by_idempotency_key(
    db: AsyncSession, idempotency_key: str
) -> AcquisitionExecution | None:
    result = await db.execute(
        select(AcquisitionExecution).where(
            AcquisitionExecution.idempotency_key == idempotency_key
        )
    )
    return result.scalar_one_or_none()


async def get_execution(
    db: AsyncSession, execution_id: str
) -> AcquisitionExecution | None:
    return await db.get(AcquisitionExecution, execution_id)


async def submit_execution(
    db: AsyncSession, body: AcquisitionSubmission
) -> SubmissionOutcome:
    fingerprint = request_fingerprint(body)
    existing = await get_by_idempotency_key(db, body.idempotency_key)
    if existing is not None:
        return SubmissionOutcome(
            execution=existing,
            idempotency_match=existing.request_fingerprint == fingerprint,
            created=False,
        )

    execution = AcquisitionExecution(
        request_id=body.request_id,
        idempotency_key=body.idempotency_key,
        request_fingerprint=fingerprint,
        capability_id=body.capability.id,
        capability_version=body.capability.version,
        output_schema_version=body.output_schema_version,
        input_payload=body.input,
        environment=body.environment,
        required_artifacts=body.required_artifacts,
        geo_refs=body.geo_refs,
        status=AcquisitionExecutionStatus.ACCEPTED,
        artifact_refs=[],
    )
    db.add(execution)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await get_by_idempotency_key(db, body.idempotency_key)
        if existing is None:
            raise
        return SubmissionOutcome(
            execution=existing,
            idempotency_match=existing.request_fingerprint == fingerprint,
            created=False,
        )
    await db.refresh(execution)
    return SubmissionOutcome(
        execution=execution, idempotency_match=True, created=True
    )


async def cancel_execution(
    db: AsyncSession, execution: AcquisitionExecution
) -> AcquisitionExecution:
    next_status = execution.status.cancel()
    if next_status != execution.status:
        execution.status = next_status
        await db.commit()
        await db.refresh(execution)
    return execution
