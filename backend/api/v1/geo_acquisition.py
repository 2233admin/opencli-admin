from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.schemas.acquisition import (
    AcquisitionExecutionRead,
    AcquisitionSubmission,
    CapabilityDescriptor,
    CapabilityList,
)
from backend.services import acquisition_service

router = APIRouter(
    prefix="/internal/geo-acquisition", tags=["internal-geo-acquisition"]
)

_CAPABILITIES = (
    CapabilityDescriptor(
        capability_id="managed-acquisition.handshake",
        capability_version="1.0.0",
        output_schema_version="1",
        ready=True,
    ),
)


def _validate_capability(body: AcquisitionSubmission) -> None:
    same_id = [c for c in _CAPABILITIES if c.capability_id == body.capability.id]
    if not same_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "unsupported_capability", "message": body.capability.id},
        )
    same_version = [
        c for c in same_id if c.capability_version == body.capability.version
    ]
    if not same_version:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unsupported_capability_version",
                "message": body.capability.version,
            },
        )
    if not any(
        c.output_schema_version == body.output_schema_version for c in same_version
    ):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unsupported_output_schema_version",
                "message": body.output_schema_version,
            },
        )


@router.get("/capabilities", response_model=CapabilityList)
async def list_capabilities() -> CapabilityList:
    return CapabilityList(capabilities=list(_CAPABILITIES))


@router.post(
    "/executions", response_model=AcquisitionExecutionRead, status_code=202
)
async def submit_execution(
    body: AcquisitionSubmission,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AcquisitionExecutionRead:
    _validate_capability(body)
    outcome = await acquisition_service.submit_execution(db, body)
    if not outcome.idempotency_match:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "idempotency_conflict",
                "message": "The idempotency key already identifies different work",
            },
        )
    if not outcome.created:
        response.status_code = 200
    return AcquisitionExecutionRead.from_execution(outcome.execution)


@router.get(
    "/executions/{execution_id}", response_model=AcquisitionExecutionRead
)
async def get_execution(
    execution_id: str, db: AsyncSession = Depends(get_db)
) -> AcquisitionExecutionRead:
    execution = await acquisition_service.get_execution(db, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Acquisition execution not found")
    return AcquisitionExecutionRead.from_execution(execution)


@router.post(
    "/executions/{execution_id}/cancel", response_model=AcquisitionExecutionRead
)
async def cancel_execution(
    execution_id: str, db: AsyncSession = Depends(get_db)
) -> AcquisitionExecutionRead:
    execution = await acquisition_service.get_execution(db, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Acquisition execution not found")
    if not execution.status.accepts_cancel_request:
        raise HTTPException(
            status_code=409,
            detail={"code": "execution_not_cancellable", "message": execution.status},
        )
    cancelled = await acquisition_service.cancel_execution(db, execution)
    return AcquisitionExecutionRead.from_execution(cancelled)
