"""Durable execution of runtime-probed acquisition capabilities."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.acquisition.capabilities import (
    OFFICIAL_SITE_CAPABILITY_COMMIT,
    OHMYOPENCLI_COMMIT,
    OPENCLI_VERSION,
)
from backend.browser_pool import LocalBrowserPool, NoCleanProfileError
from backend.models.acquisition import AcquisitionExecution, AcquisitionExecutionStatus
from backend.models.browser import BrowserInstance

_CAPABILITY_INVOCATIONS = {
    ("official-site.observe", "1.0.0", "1"): {
        "site": "official-site",
        "command": "observe",
        "format": "json",
    },
}


async def _managed_browser_pool(
    session_factory: async_sessionmaker[AsyncSession],
):
    """Initialize and hydrate the pool inside API or Celery worker processes."""
    from backend import browser_pool

    try:
        pool = browser_pool.get_pool()
    except RuntimeError:
        from backend.config import get_settings

        settings = get_settings()
        pool = browser_pool.init_pool(
            endpoints=settings.cdp_endpoints,
            use_redis=settings.task_executor == "celery",
            redis_url=settings.redis_url,
        )
        await browser_pool.ensure_ready()

    async with session_factory() as db:
        result = await db.execute(select(BrowserInstance))
        instances = list(result.scalars().all())

    for instance in instances:
        if instance.endpoint not in pool.endpoints:
            if isinstance(pool, LocalBrowserPool) and instance.agent_url:
                pool.add_endpoint(instance.endpoint)
            else:
                continue
        pool.set_mode(instance.endpoint, instance.mode)
        pool.set_profile_kind(instance.endpoint, instance.profile_kind)
        if isinstance(pool, LocalBrowserPool):
            pool.set_agent_url(instance.endpoint, instance.agent_url)
            pool.set_agent_protocol(instance.endpoint, instance.agent_protocol)
    return pool


async def recover_acquisition_executions(
    *,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    executor: Any = None,
) -> list[str]:
    """Requeue every durable non-terminal acquisition after process restart."""
    if session_factory is None:
        from backend.database import AsyncSessionLocal

        session_factory = AsyncSessionLocal
    if executor is None:
        from backend.executor import get_executor

        executor = get_executor()

    async with session_factory() as db:
        result = await db.execute(
            select(AcquisitionExecution)
            .where(
                AcquisitionExecution.status.in_(
                    [
                        AcquisitionExecutionStatus.ACCEPTED,
                        AcquisitionExecutionStatus.QUEUED,
                        AcquisitionExecutionStatus.RUNNING,
                    ]
                )
            )
            .order_by(AcquisitionExecution.created_at)
        )
        executions = list(result.scalars().all())
        for execution in executions:
            execution.status = AcquisitionExecutionStatus.QUEUED
            execution.started_at = None
            execution.finished_at = None
        await db.commit()

    for execution in executions:
        await executor.dispatch_acquisition(execution.id)
    return [execution.id for execution in executions]


async def _fail_execution(
    execution_id: str,
    failure: dict[str, str],
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as db:
        execution = await db.get(AcquisitionExecution, execution_id)
        if execution is None or execution.status == AcquisitionExecutionStatus.CANCELLED:
            return
        execution.status = AcquisitionExecutionStatus.FAILED
        execution.failure = failure
        execution.finished_at = datetime.now(UTC)
        await db.commit()


async def run_acquisition_execution(
    execution_id: str,
    *,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    channel: Any = None,
) -> None:
    if session_factory is None:
        from backend.database import AsyncSessionLocal

        session_factory = AsyncSessionLocal

    async with session_factory() as db:
        claim = await db.execute(
            update(AcquisitionExecution)
            .where(
                AcquisitionExecution.id == execution_id,
                AcquisitionExecution.status == AcquisitionExecutionStatus.QUEUED,
            )
            .values(
                status=AcquisitionExecutionStatus.RUNNING,
                started_at=datetime.now(UTC),
            )
        )
        if claim.rowcount != 1:
            await db.rollback()
            return
        await db.commit()
        execution = await db.get(AcquisitionExecution, execution_id)
        if execution is None:
            return
        input_payload = dict(execution.input_payload)
        capability_id = execution.capability_id
        capability_version = execution.capability_version
        output_schema_version = execution.output_schema_version
        required_artifacts = list(execution.required_artifacts)

    invocation = _CAPABILITY_INVOCATIONS.get(
        (capability_id, capability_version, output_schema_version)
    )
    if invocation is None:
        await _fail_execution(
            execution_id,
            {
                "code": "unsupported_capability_invocation",
                "message": (
                    f"No invocation is registered for {capability_id}"
                    f"@{capability_version} schema {output_schema_version}"
                ),
            },
            session_factory,
        )
        return

    try:
        pool = await _managed_browser_pool(session_factory)
        endpoint = pool.select_anonymous_endpoint()
        if channel is None:
            from backend.channels.opencli_channel import OpenCLIChannel

            channel = OpenCLIChannel()

        parameters = {
            **input_payload,
            "chrome_endpoint": endpoint,
            "required_profile_kind": "anonymous",
        }
        if required_artifacts:
            parameters["trace"] = "on"
        result = await channel.collect(
            invocation,
            parameters,
        )
    except NoCleanProfileError as exc:
        await _fail_execution(
            execution_id,
            {"code": exc.code, "message": str(exc)},
            session_factory,
        )
        return
    except Exception as exc:
        await _fail_execution(
            execution_id,
            {
                "code": "capability_execution_failed",
                "message": str(exc),
                "error_type": type(exc).__name__,
            },
            session_factory,
        )
        return

    async with session_factory() as db:
        execution = await db.get(AcquisitionExecution, execution_id)
        if execution is None or execution.status == AcquisitionExecutionStatus.CANCELLED:
            return
        execution.finished_at = datetime.now(UTC)
        execution.trace_ref = result.metadata.get("trace_artifact")
        if not result.success or not result.items:
            execution.status = AcquisitionExecutionStatus.FAILED
            message = result.error or "Capability returned no payload"
            execution.failure = {
                "code": (
                    "browser_route_unavailable"
                    if "CDP not reachable" in message
                    else "capability_execution_failed"
                ),
                "message": message,
            }
        else:
            payload = result.items[0]
            identity_matches = (
                payload.get("capabilityId") == capability_id
                and payload.get("capabilityVersion") == capability_version
                and payload.get("outputSchemaVersion") == output_schema_version
            )
            if not identity_matches:
                execution.status = AcquisitionExecutionStatus.FAILED
                execution.failure = {
                    "code": "invalid_capability_envelope",
                    "message": (
                        "Capability payload identity does not match the requested contract"
                    ),
                }
                await db.commit()
                return

            returned_artifact_kinds = {
                "trace" for value in [result.metadata.get("trace_artifact")] if value
            }
            missing_artifacts = [
                kind for kind in required_artifacts if kind not in returned_artifact_kinds
            ]
            if missing_artifacts:
                execution.status = AcquisitionExecutionStatus.FAILED
                execution.failure = {
                    "code": "required_artifact_missing",
                    "message": (
                        "Capability did not return required artifacts: "
                        + ", ".join(missing_artifacts)
                    ),
                }
                await db.commit()
                return

            execution.status = AcquisitionExecutionStatus.SUCCEEDED
            execution.result_payload = {
                "capability": {
                    "id": capability_id,
                    "version": capability_version,
                },
                "output_schema_version": output_schema_version,
                "payload": payload,
                "operational": {
                    "runtime": {
                        "ohmyopencli_repo_commit": OHMYOPENCLI_COMMIT,
                        "capability_source_commit": OFFICIAL_SITE_CAPABILITY_COMMIT,
                        "opencli_version": OPENCLI_VERSION,
                    },
                    "browser": {
                        "endpoint": endpoint,
                        "profile_kind": "anonymous",
                    },
                    "channel_metadata": result.metadata,
                },
            }
            artifacts = payload.get("artifacts", [])
            artifact_refs = artifacts if isinstance(artifacts, list) else []
            if result.metadata.get("trace_artifact"):
                artifact_refs = [
                    *artifact_refs,
                    {"kind": "trace", "ref": result.metadata["trace_artifact"]},
                ]
            execution.artifact_refs = artifact_refs
            execution.failure = None
        await db.commit()
