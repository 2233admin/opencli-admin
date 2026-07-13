import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.browser_pool import init_pool
from backend.channels.base import ChannelResult
from backend.models.acquisition import AcquisitionExecutionStatus
from backend.models.browser import BrowserInstance
from backend.schemas.acquisition import AcquisitionSubmission
from backend.services import acquisition_service


def _submission() -> AcquisitionSubmission:
    return AcquisitionSubmission.model_validate(
        {
            "request_id": "request-1",
            "idempotency_key": "attempt-1",
            "capability": {
                "id": "official-site.observe",
                "version": "1.0.0",
            },
            "output_schema_version": "1",
            "input": {"url": "https://example.com"},
            "environment": {"locale": "zh-CN", "region": "CN"},
            "required_artifacts": ["trace"],
            "geo_refs": {"attempt_id": "attempt-1"},
        }
    )


@pytest.mark.asyncio
async def test_official_site_execution_fails_without_calling_opencli_when_no_clean_profile(
    db_engine,
):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    init_pool(["http://signed-in-profile:9222"], use_redis=False)
    channel = AsyncMock()

    await run_acquisition_execution(
        execution_id,
        session_factory=sessions,
        channel=channel,
    )

    async with sessions() as db:
        execution = await acquisition_service.get_execution(db, execution_id)
        assert execution is not None
        assert execution.status == AcquisitionExecutionStatus.FAILED
        assert execution.failure == {
            "code": "no_clean_profile",
            "message": "no_clean_profile",
        }
        assert execution.result_payload is None

    channel.collect.assert_not_awaited()


@pytest.mark.asyncio
async def test_duplicate_delivery_claims_a_queued_execution_only_once(db_engine):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    pool = init_pool(["http://clean-profile:9222"], use_redis=False)
    pool.set_profile_kind("http://clean-profile:9222", "anonymous")
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def collect(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        started.set()
        if calls == 1:
            await release.wait()
        return ChannelResult.ok(
            [
                {
                    "capabilityId": "official-site.observe",
                    "capabilityVersion": "1.0.0",
                    "outputSchemaVersion": "1",
                }
            ],
            trace_artifact="artifact://trace/1",
        )

    channel = AsyncMock()
    channel.collect.side_effect = collect
    first = asyncio.create_task(
        run_acquisition_execution(
            execution_id, session_factory=sessions, channel=channel
        )
    )
    await started.wait()
    await run_acquisition_execution(
        execution_id, session_factory=sessions, channel=channel
    )
    release.set()
    await first

    channel.collect.assert_awaited_once()


@pytest.mark.asyncio
async def test_pool_initialization_error_is_persisted_as_terminal_failure(
    db_engine, monkeypatch
):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    monkeypatch.setattr(
        "backend.acquisition.runner._managed_browser_pool",
        AsyncMock(side_effect=RuntimeError("redis unavailable")),
    )

    await run_acquisition_execution(execution_id, session_factory=sessions)

    async with sessions() as db:
        execution = await acquisition_service.get_execution(db, execution_id)
        assert execution is not None
        assert execution.status == AcquisitionExecutionStatus.FAILED
        assert execution.failure == {
            "code": "capability_execution_failed",
            "message": "redis unavailable",
            "error_type": "RuntimeError",
        }


@pytest.mark.asyncio
async def test_required_trace_must_be_returned_by_the_channel(db_engine):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    pool = init_pool(["http://clean-profile:9222"], use_redis=False)
    pool.set_profile_kind("http://clean-profile:9222", "anonymous")
    channel = AsyncMock()
    channel.collect.return_value = ChannelResult.ok(
        [
            {
                "capabilityId": "official-site.observe",
                "capabilityVersion": "1.0.0",
                "outputSchemaVersion": "1",
            }
        ]
    )

    await run_acquisition_execution(
        execution_id, session_factory=sessions, channel=channel
    )

    async with sessions() as db:
        execution = await acquisition_service.get_execution(db, execution_id)
        assert execution is not None
        assert execution.status == AcquisitionExecutionStatus.FAILED
        assert execution.failure == {
            "code": "required_artifact_missing",
            "message": "Capability did not return required artifacts: trace",
        }
        assert execution.trace_ref is None


@pytest.mark.asyncio
async def test_unknown_capability_invocation_fails_closed(db_engine):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    submission_data = _submission().model_dump()
    submission_data["capability"] = {
        "id": "chat-ai.capture",
        "version": "1.0.0",
    }
    submission = AcquisitionSubmission.model_validate(submission_data)
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, submission)
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    pool = init_pool(["http://clean-profile:9222"], use_redis=False)
    pool.set_profile_kind("http://clean-profile:9222", "anonymous")
    channel = AsyncMock()

    await run_acquisition_execution(
        execution_id, session_factory=sessions, channel=channel
    )

    async with sessions() as db:
        execution = await acquisition_service.get_execution(db, execution_id)
        assert execution is not None
        assert execution.status == AcquisitionExecutionStatus.FAILED
        assert execution.failure == {
            "code": "unsupported_capability_invocation",
            "message": "No invocation is registered for chat-ai.capture@1.0.0 schema 1",
        }
    channel.collect.assert_not_awaited()


@pytest.mark.asyncio
async def test_worker_process_hydrates_anonymous_profile_before_dispatch(
    db_engine,
    monkeypatch,
):
    from backend import browser_pool
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id
        db.add(
            BrowserInstance(
                endpoint="http://clean-profile:9222",
                mode="cdp",
                profile_kind="anonymous",
                agent_url="http://clean-profile:9222",
            )
        )
        await db.commit()

    monkeypatch.setattr(browser_pool, "_pool", None)
    channel = AsyncMock()
    channel.collect.return_value = ChannelResult.ok(
        [
            {
                "capabilityId": "official-site.observe",
                "capabilityVersion": "1.0.0",
                "outputSchemaVersion": "1",
            }
        ]
    )

    await run_acquisition_execution(
        execution_id,
        session_factory=sessions,
        channel=channel,
    )

    channel.collect.assert_awaited_once()
    assert browser_pool.get_pool().get_profile_kind(
        "http://clean-profile:9222"
    ) == "anonymous"


@pytest.mark.asyncio
async def test_official_site_execution_preserves_payload_in_versioned_envelope(
    db_engine,
):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    pool = init_pool(["http://clean-profile:9222"], use_redis=False)
    pool.set_mode("http://clean-profile:9222", "cdp")
    pool.set_profile_kind("http://clean-profile:9222", "anonymous")
    payload = {
        "capabilityId": "official-site.observe",
        "capabilityVersion": "1.0.0",
        "outputSchemaVersion": "1",
        "finalUrl": "https://example.com/",
        "accessState": "accessible",
        "personalizationDetected": False,
        "domLength": 380997,
        "domSha256": "d" * 64,
        "artifacts": [
            {"kind": "dom", "ref": "artifact://dom/1", "sha256": "d" * 64}
        ],
    }
    channel = AsyncMock()
    channel.collect.return_value = ChannelResult.ok(
        [payload],
        site="official-site",
        command="observe",
        chrome_mode="cdp",
        trace_artifact="artifact://trace/1",
    )

    await run_acquisition_execution(
        execution_id,
        session_factory=sessions,
        channel=channel,
    )

    channel.collect.assert_awaited_once_with(
        {"site": "official-site", "command": "observe", "format": "json"},
        {
            "url": "https://example.com",
            "chrome_endpoint": "http://clean-profile:9222",
            "required_profile_kind": "anonymous",
            "trace": "on",
        },
    )
    async with sessions() as db:
        execution = await acquisition_service.get_execution(db, execution_id)
        assert execution is not None
        assert execution.status == AcquisitionExecutionStatus.SUCCEEDED
        assert execution.failure is None
        assert execution.result_payload == {
            "capability": {"id": "official-site.observe", "version": "1.0.0"},
            "output_schema_version": "1",
            "payload": payload,
            "operational": {
                "runtime": {
                    "ohmyopencli_repo_commit": (
                        "8a087abe1805a9cff77b64ba80da12379afa184e"
                    ),
                    "capability_source_commit": (
                        "35b146e675a51f013f293d12d303cfedfac58495"
                    ),
                    "opencli_version": "1.8.5",
                },
                "browser": {
                    "endpoint": "http://clean-profile:9222",
                    "profile_kind": "anonymous",
                },
                "channel_metadata": {
                    "site": "official-site",
                    "command": "observe",
                    "chrome_mode": "cdp",
                    "trace_artifact": "artifact://trace/1",
                },
            },
        }
        assert execution.artifact_refs == [
            *payload["artifacts"],
            {"kind": "trace", "ref": "artifact://trace/1"},
        ]
        assert execution.trace_ref == "artifact://trace/1"


@pytest.mark.asyncio
async def test_startup_requeues_durable_inflight_acquisitions(db_engine):
    from backend.acquisition.runner import recover_acquisition_executions

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    execution_ids = []
    async with sessions() as db:
        for index, status in enumerate(
            [
                AcquisitionExecutionStatus.ACCEPTED,
                AcquisitionExecutionStatus.QUEUED,
                AcquisitionExecutionStatus.RUNNING,
            ]
        ):
            body = _submission().model_copy(
                update={
                    "request_id": f"request-{index}",
                    "idempotency_key": f"attempt-{index}",
                }
            )
            outcome = await acquisition_service.submit_execution(db, body)
            outcome.execution.status = status
            execution_ids.append(outcome.execution.id)
        await db.commit()

    executor = AsyncMock()
    await recover_acquisition_executions(
        session_factory=sessions,
        executor=executor,
    )

    assert [
        call.args[0] for call in executor.dispatch_acquisition.await_args_list
    ] == execution_ids
    async with sessions() as db:
        for execution_id in execution_ids:
            execution = await acquisition_service.get_execution(db, execution_id)
            assert execution is not None
            assert execution.status == AcquisitionExecutionStatus.QUEUED


@pytest.mark.asyncio
async def test_mismatched_capability_payload_is_persisted_as_failure(db_engine):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    pool = init_pool(["http://clean-profile:9222"], use_redis=False)
    pool.set_profile_kind("http://clean-profile:9222", "anonymous")
    channel = AsyncMock()
    channel.collect.return_value = ChannelResult.ok(
        [
            {
                "capabilityId": "official-site.observe",
                "capabilityVersion": "2.0.0",
                "outputSchemaVersion": "1",
            }
        ]
    )

    await run_acquisition_execution(
        execution_id, session_factory=sessions, channel=channel
    )

    async with sessions() as db:
        execution = await acquisition_service.get_execution(db, execution_id)
        assert execution is not None
        assert execution.status == AcquisitionExecutionStatus.FAILED
        assert execution.failure == {
            "code": "invalid_capability_envelope",
            "message": "Capability payload identity does not match the requested contract",
        }


@pytest.mark.asyncio
async def test_opencli_exception_becomes_observable_terminal_failure(db_engine):
    from backend.acquisition.runner import run_acquisition_execution

    sessions = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with sessions() as db:
        outcome = await acquisition_service.submit_execution(db, _submission())
        await acquisition_service.queue_execution(db, outcome.execution)
        execution_id = outcome.execution.id

    pool = init_pool(["http://clean-profile:9222"], use_redis=False)
    pool.set_profile_kind("http://clean-profile:9222", "anonymous")
    channel = AsyncMock()
    channel.collect.side_effect = RuntimeError("opencli crashed")

    await run_acquisition_execution(
        execution_id, session_factory=sessions, channel=channel
    )

    async with sessions() as db:
        execution = await acquisition_service.get_execution(db, execution_id)
        assert execution is not None
        assert execution.status == AcquisitionExecutionStatus.FAILED
        assert execution.failure == {
            "code": "capability_execution_failed",
            "message": "opencli crashed",
            "error_type": "RuntimeError",
        }
        assert execution.trace_ref is None
