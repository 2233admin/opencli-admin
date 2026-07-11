"""Shared pipeline runner — used by both local executor and Celery tasks."""

import logging
from datetime import UTC, datetime

from sqlalchemy import select

from backend.database import AsyncSessionLocal
from backend.models.task import CollectionTask, TaskRun
from backend.pipeline import events
from backend.pipeline.pipeline import run_pipeline

logger = logging.getLogger(__name__)

# Generic best-effort enrichment prompt used by the auto-default agent.
# Unfilled {{placeholders}} render to empty strings (see OpenAIProcessor._render).
DEFAULT_ENRICH_PROMPT = (
    "分析下面这条采集记录, 只返回一个 JSON 对象, 字段: "
    '{"summary": "一句话摘要", "tags": ["关键词"], '
    '"sentiment": "positive|neutral|negative", "category": "分类"}。\n'
    "标题: {{title}}\n内容: {{content}}{{text}}{{description}}\n链接: {{url}}"
)


async def run_collection_pipeline(
    task_id: str,
    parameters: dict,
    celery_task_id: str | None = None,
    worker_id: str | None = None,
) -> dict:
    """Execute full collection pipeline for task_id.

    Uses separate short-lived sessions per write phase to avoid holding an open
    write transaction during the long-running collection step (Chrome/CLI).
    """
    logger.info("[task:%s] pipeline start | params=%s", task_id, parameters)

    # ── Phase 1: mark running, create TaskRun ────────────────────────────────
    run_id: str | None = None
    source_id: str | None = None
    merged_params: dict = {}
    agent_id: str | None = None
    trigger_type: str = "manual"

    async with AsyncSessionLocal() as session:
        task = await session.get(CollectionTask, task_id)
        if not task:
            return {"error": f"Task {task_id} not found"}

        run = TaskRun(
            task_id=task_id,
            status="running",
            celery_task_id=celery_task_id,
            worker_id=worker_id,
            started_at=datetime.now(UTC),
        )
        session.add(run)
        task.status = "running"
        await session.flush()
        run_id = run.id
        source_id = task.source_id
        merged_params = {**task.parameters, **parameters}
        agent_id = task.agent_id
        trigger_type = task.trigger_type
        await session.commit()

    # Emit trigger event after committing the run row
    if run_id and source_id:
        await events.emit(
            run_id,
            "trigger",
            f"任务触发 | 方式={trigger_type} 数据源ID={source_id}",
            detail={"trigger_type": trigger_type, "source_id": source_id},
        )

    logger.info(
        "[task:%s] phase1 done | run_id=%s source_id=%s merged_params=%s",
        task_id,
        run_id,
        source_id,
        merged_params,
    )

    # ── Phase 2: load source + agent config (read-only, no write lock) ───────
    from backend.models.source import DataSource

    async with AsyncSessionLocal() as session:
        source = await session.get(DataSource, source_id)
        if not source:
            async with AsyncSessionLocal() as s2:
                t = await s2.get(CollectionTask, task_id)
                r = await s2.get(TaskRun, run_id)
                if t:
                    t.status = "failed"
                    t.error_message = "Source not found"
                if r:
                    r.status = "failed"
                    r.error_message = "Source not found"
                await s2.commit()
            return {"error": "Source not found"}

        agent_config = None
        if agent_id:
            from backend.models.agent import AIAgent
            from backend.models.provider import ModelProvider

            agent = await session.get(AIAgent, agent_id)
            if agent and agent.enabled:
                # Start with provider credentials (if linked), then overlay agent's own config
                provider_config: dict = {}
                if agent.provider_id:
                    provider = await session.get(ModelProvider, agent.provider_id)
                    if provider and provider.enabled:
                        if provider.api_key:
                            provider_config["api_key"] = provider.api_key
                        if provider.base_url:
                            provider_config["base_url"] = provider.base_url
                agent_config = {
                    "processor_type": agent.processor_type,
                    "model": agent.model,
                    "prompt_template": agent.prompt_template,
                    **provider_config,
                    **agent.processor_config,  # agent-level overrides provider
                }

        # Autonomous default (N8N-style: configure the credential once, the AI node
        # just works). No explicit agent → auto-use the first enabled provider with a
        # generic enrichment prompt. So configuring a provider is enough — no per-agent setup.
        if agent_config is None:
            from backend.models.provider import ModelProvider

            result = await session.execute(
                select(ModelProvider)
                .where(ModelProvider.enabled.is_(True))
                .order_by(ModelProvider.created_at.asc())
            )
            provider = result.scalars().first()
            if provider:
                cfg: dict = {}
                if provider.api_key:
                    cfg["api_key"] = provider.api_key
                if provider.base_url:
                    cfg["base_url"] = provider.base_url
                agent_config = {
                    # OpenAI-compatible: covers Ollama/local/openai gateways.
                    "processor_type": "openai",
                    "model": provider.default_model,
                    "prompt_template": DEFAULT_ENRICH_PROMPT,
                    **cfg,
                }
                logger.info(
                    "[task:%s] auto default agent | provider=%s model=%s",
                    task_id,
                    provider.name,
                    provider.default_model,
                )

        # Detach source from session so it can be used after session closes
        session.expunge(source)
    logger.info(
        "[task:%s] phase2 done | source=%s channel=%s agent_config=%s",
        task_id,
        source.name,
        source.channel_type,
        {k: v for k, v in (agent_config or {}).items() if k != "prompt_template"},
    )

    # ── Phase 3: run pipeline (no session held during collection) ─────────────
    # Hold a per-domain slot for the run so the fleet stays polite to a site even
    # when many sources target it (in-process cap; cross-worker would need Redis).
    from backend.pipeline.domain_limiter import domain_slot

    async with domain_slot(source):
        try:
            pipeline_result = await run_pipeline(
                task_id=task_id,
                source=source,
                parameters=merged_params,
                agent_config=agent_config,
                run_id=run_id,
            )
        except Exception as exc:
            # run_pipeline only re-raises errors its taxonomy classified as
            # retryable (backend.pipeline.error_taxonomy) — record this attempt
            # as failed before letting it propagate to celery's autoretry_for,
            # so the UI never shows a run stuck at "running" while celery backs
            # off and retries. Each retry is a fresh run_collection_pipeline
            # call, so it gets its own new TaskRun row (see TaskRun docstring:
            # "a single execution attempt").
            async with AsyncSessionLocal() as session:
                err_task = await session.get(CollectionTask, task_id)
                err_run = await session.get(TaskRun, run_id)
                if err_task:
                    err_task.status = "failed"
                    err_task.error_message = str(exc)
                if err_run:
                    err_run.status = "failed"
                    err_run.error_message = str(exc)
                    err_run.finished_at = datetime.now(UTC)
                await session.commit()
            raise

    # ── Phase 4: persist final status ────────────────────────────────────────
    async with AsyncSessionLocal() as session:
        task = await session.get(CollectionTask, task_id)
        run = await session.get(TaskRun, run_id)

        if run:
            run.finished_at = datetime.now(UTC)
            run.duration_ms = pipeline_result.duration_ms
            run.records_collected = pipeline_result.stored
            if pipeline_result.metadata.get("node_url"):
                run.node_url = pipeline_result.metadata["node_url"]
            # Shadow-sink errors (P1-7): best-effort ODP forward failures never
            # fail the run, but must not vanish either — record them on the
            # existing error_detail JSON column (no migration: the column
            # already exists and is otherwise unused on a successful run).
            shadow_errors = pipeline_result.metadata.get("shadow_errors")
            if shadow_errors:
                run.error_detail = {
                    "shadow_errors": shadow_errors,
                    "shadow_meta": pipeline_result.metadata.get("shadow_meta"),
                }

        # Paused outcome (skill execute loop hit the confirm gate in headless v1):
        # a successful pipeline run that stopped at a confirm-required action.
        # collect/normalize/store all ran (finished_at/duration/records above are
        # still set); the run just paused, so it is neither completed nor failed.
        # TaskRun.status / CollectionTask.status are free-text String(50) so
        # storing "awaiting_confirm" needs no migration (anchor is issue 04).
        if pipeline_result.metadata.get("awaiting_confirm"):
            if task:
                task.status = "awaiting_confirm"
                task.error_message = None
            if run:
                run.status = "awaiting_confirm"
        elif pipeline_result.success:
            if task:
                task.status = "completed"
                task.error_message = None
            if run:
                run.status = "completed"
        else:
            if task:
                task.status = "failed"
                task.error_message = pipeline_result.error
            if run:
                run.status = "failed"
                run.error_message = pipeline_result.error

        await session.commit()

    logger.info(
        "[task:%s] pipeline done | success=%s collected=%d stored=%d skipped=%d "
        "ai=%d duration_ms=%d error=%s",
        task_id,
        pipeline_result.success,
        pipeline_result.collected,
        pipeline_result.stored,
        pipeline_result.skipped,
        pipeline_result.ai_processed,
        pipeline_result.duration_ms,
        pipeline_result.error,
    )

    # ── Phase 5: dataflow triggering (issue 05) ──────────────────────────────
    # Fires AFTER the source's own TaskRun/CollectionTask row above is already
    # committed — so this is strictly additive: a Plan's shared-segment
    # trouble can never touch what's already durably recorded as this
    # source's own outcome (Two-Tier Attribution / failure isolation). Only
    # fires on a genuine delivery of new data (a successful run that actually
    # stored something) — a run that collected nothing new, or failed,
    # triggers no downstream shared segment (nothing new to flow through).
    # This is the ONE call site for both scheduled and manually-triggered
    # collection: LocalExecutor.dispatch_collection/dispatch_scheduled_
    # collection and the Celery run_collection/run_scheduled_collection
    # tasks all funnel into this same run_collection_pipeline function, so
    # hooking here (rather than in either trigger path separately) covers
    # both without duplicating the hook or needing plan-level cron.
    if pipeline_result.success and pipeline_result.stored > 0 and source_id:
        try:
            from backend.services.plan_trigger_service import trigger_incremental_shared_segments

            async with AsyncSessionLocal() as trigger_session:
                await trigger_incremental_shared_segments(
                    trigger_session,
                    source_id=source_id,
                    task_id=task_id,
                    parameters=parameters,
                )
                await trigger_session.commit()
        except Exception:
            # Belt-and-braces on top of trigger_incremental_shared_segments'
            # own internal isolation: this source's collection run is ALREADY
            # committed as completed above; nothing downstream may ever flip
            # that outcome, so any surprise here is logged, never raised.
            logger.exception(
                "[task:%s] dataflow trigger raised unexpectedly | source_id=%s",
                task_id,
                source_id,
            )

    return {
        "task_id": task_id,
        "run_id": run_id,
        "success": pipeline_result.success,
        "collected": pipeline_result.collected,
        "stored": pipeline_result.stored,
        "skipped": pipeline_result.skipped,
        "error": pipeline_result.error,
    }


async def run_scheduled_pipeline(
    schedule_id: str,
    source_id: str,
    parameters: dict,
    *,
    occurrence_id: str | None = None,
    celery_task_id: str | None = None,
    worker_id: str | None = None,
) -> dict:
    """Create or resume one scheduled occurrence and run its pipeline.

    Celery keeps its request ID across retries. Using it as ``occurrence_id``
    makes task creation idempotent while allowing a new TaskRun for each
    execution attempt.
    """
    from backend.models.schedule import CronSchedule
    from backend.services import task_service

    is_one_time = False
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(CronSchedule).where(CronSchedule.id == schedule_id))
        schedule = result.scalar_one_or_none()
        schedule_agent_id = schedule.agent_id if schedule else None

        task = None
        if occurrence_id is not None:
            task = await session.scalar(
                select(CollectionTask).where(CollectionTask.id == occurrence_id)
            )
            if task is not None and (
                task.source_id != source_id or task.trigger_type != "scheduled"
            ):
                raise RuntimeError("Scheduled occurrence ID is already bound to another task")

        if task is None:
            task = await task_service.create_task(
                session,
                source_id=source_id,
                trigger_type="scheduled",
                parameters=parameters,
                agent_id=schedule_agent_id,
                task_id=occurrence_id,
            )
        if schedule and task.status == "pending":
            schedule.last_run_at = datetime.now(UTC)
            is_one_time = schedule.is_one_time
            if is_one_time:
                # A one-time schedule is consumed when its occurrence is
                # durably created, not after execution, so a post-run database
                # failure cannot dispatch the same schedule again.
                schedule.enabled = False
        await session.commit()
        task_id = task.id

    return await run_collection_pipeline(
        task_id,
        parameters,
        celery_task_id=celery_task_id,
        worker_id=worker_id,
    )
