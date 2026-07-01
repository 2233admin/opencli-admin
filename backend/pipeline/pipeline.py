"""Pipeline orchestrator: collect → normalize → store → [ai] → [notify]."""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from backend.models.source import DataSource
from backend.pipeline import events

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    success: bool
    source_id: str
    collected: int = 0
    stored: int = 0
    skipped: int = 0
    ai_processed: int = 0
    notifications_sent: int = 0
    error: str | None = None
    duration_ms: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


async def run_pipeline(
    task_id: str,
    source: DataSource,
    parameters: dict[str, Any] | None = None,
    enable_ai: bool = True,
    enable_notifications: bool = True,
    agent_config: dict[str, Any] | None = None,
    run_id: str | None = None,
    sink=None,  # ItemSink | None — write destination; defaults to LegacyDbSink
) -> PipelineResult:
    """Execute the full collection pipeline. Each write step uses its own
    short-lived session so no write lock is held during long-running I/O."""
    from backend.database import AsyncSessionLocal
    from backend.pipeline import ai_processor, collector, notifier_dispatch

    started = datetime.now(timezone.utc)
    params = parameters or {}

    # Pre-step: auto-resolve chrome endpoint from a browser binding. Channels that
    # declare capabilities.session_affinity (opencli, skill) drive a real Chrome
    # from the shared pool, so a site-keyed binding lets them attach to a
    # logged-in browser. Best-effort: a missing binding is not an error
    # (browser_pool.acquire(endpoint=None) picks a default), so we only override
    # chrome_endpoint when a binding exists. Gated by the capability rather than a
    # hardcoded channel list, so a new session-bound channel needs no change here.
    from backend.channels.registry import get_channel

    try:
        _affinity_channel = get_channel(source.channel_type)
    except Exception:
        _affinity_channel = None  # unknown channel_type surfaces in the collect step
    if (
        _affinity_channel is not None
        and _affinity_channel.capabilities.session_affinity
        and not params.get("chrome_endpoint")
    ):
        site = source.channel_config.get("site", "")
        if site:
            from backend.services import browser_service
            async with AsyncSessionLocal() as session:
                binding = await browser_service.get_binding_by_site(session, site)
                if binding:
                    params = {**params, "chrome_endpoint": binding.browser_endpoint}
                    logger.info("[task:%s] auto-binding | site=%s → %s",
                                task_id, site, binding.browser_endpoint)

    # Step 1: Collect
    logger.info("[task:%s] step1/collect start | source=%s channel=%s params=%s",
                task_id, source.name, source.channel_type, params)
    step1_start = datetime.now(timezone.utc)

    if run_id:
        # Skill channel: inject run_id into params BEFORE dispatch so the loop can
        # emit per-step events via events.emit(run_id, ...). Scoped to "skill" —
        # other channels don't expect a run_id param. (chrome_endpoint, if any,
        # was already injected by the pre-step binding above.)
        if source.channel_type == "skill":
            params = {**params, "run_id": run_id}
        collect_detail: dict = {"channel_type": source.channel_type, "params": params}
        if source.channel_type == "skill":
            _skill_md = source.channel_config.get("skill_md") or ""
            collect_detail["skill"] = {
                "skill_chars": len(_skill_md),
                "has_chrome_endpoint": bool(params.get("chrome_endpoint")),
                "auto_confirm": bool(source.channel_config.get("auto_confirm", False)),
            }
        if source.channel_type == "opencli":
            from backend.channels.opencli_channel import _get_named_options, _OPENCLI_BIN
            cfg = source.channel_config
            _site = cfg.get("site", "")
            _cmd = cfg.get("command", "")
            _raw_args = {**cfg.get("args", {}), **{k: v for k, v in params.items() if k != "chrome_endpoint"}}
            _pos = [str(v) for v in cfg.get("positional_args", [])]
            _fmt = cfg.get("format", "json")
            # Apply same positional-resolution logic as the channel
            _named_opts = await _get_named_options(_OPENCLI_BIN, _site, _cmd)
            _named_args, _extra_pos = {}, []
            for k, v in _raw_args.items():
                if _named_opts and k not in _named_opts:
                    _extra_pos.append(str(v))
                else:
                    _named_args[k] = v
            _all_pos = _extra_pos + _pos
            _parts = ["opencli", _site, _cmd] + _all_pos
            for k, v in _named_args.items():
                _parts += [f"--{k}", str(v)]
            _parts += ["-f", _fmt]
            collect_detail["command"] = " ".join(_parts)
        await events.emit(
            run_id, "collect",
            f"开始采集 | 渠道={source.channel_type} 数据源={source.name}",
            detail=collect_detail,
        )

    try:
        channel_result = await collector.collect(source, params)
    except Exception as exc:
        logger.exception("[task:%s] step1/collect exception | %s", task_id, exc)
        if run_id:
            await events.emit(
                run_id, "collect",
                f"采集失败: {exc}",
                level="error",
                detail={"error": str(exc)},
            )
        return PipelineResult(success=False, source_id=source.id, error=str(exc))

    if not channel_result.success:
        logger.error("[task:%s] step1/collect failed | error=%s", task_id, channel_result.error)
        if run_id:
            await events.emit(
                run_id, "collect",
                f"采集失败: {channel_result.error}",
                level="error",
                detail={"error": channel_result.error},
            )
        return PipelineResult(success=False, source_id=source.id, error=channel_result.error)

    step1_elapsed = int((datetime.now(timezone.utc) - step1_start).total_seconds() * 1000)
    logger.info("[task:%s] step1/collect done | count=%d metadata=%s",
                task_id, channel_result.count, channel_result.metadata)
    if run_id:
        chrome_mode = channel_result.metadata.get("chrome_mode")
        mode_label = f" | Chrome={chrome_mode}" if chrome_mode else ""
        await events.emit(
            run_id, "collect",
            f"采集完成 | 获取 {channel_result.count} 条{mode_label}",
            detail={"count": channel_result.count, "metadata": channel_result.metadata},
            elapsed_ms=step1_elapsed,
        )

    # Steps 2+3: Normalize + Store, behind the write seam. The sink owns its own
    # normalization, dedup, and persistence; the orchestrator stays
    # destination-agnostic. An explicitly injected sink wins (tests, callers);
    # otherwise the source's write_strategy selects it (default 'legacy' →
    # LegacyDbSink, the original inline path).
    from backend.pipeline.sinks.base import RunContext
    from backend.pipeline.sinks.strategy import select_sink

    active_sink = sink or select_sink(getattr(source, "write_strategy", None))
    sink_ctx = RunContext(
        task_id=task_id,
        source_id=source.id,
        provider=source.channel_type,
        run_id=run_id,
    )
    logger.info("[task:%s] step2-3/sink start | sink=%s items=%d",
                task_id, type(active_sink).__name__, channel_result.count)
    try:
        sink_result = await active_sink.write_batch(sink_ctx, channel_result.items)
    except Exception as exc:
        logger.exception("[task:%s] step2-3/sink exception | %s", task_id, exc)
        return PipelineResult(
            success=False,
            source_id=source.id,
            collected=channel_result.count,
            error=str(exc),
        )
    new_records = sink_result.records
    skipped = sink_result.duplicates
    logger.info("[task:%s] step2-3/sink done | normalized=%d new=%d skipped=%d",
                task_id, sink_result.normalized, len(new_records), skipped)
    if run_id:
        await events.emit(
            run_id, "normalize",
            f"归一化完成 | {sink_result.normalized} 条",
            detail={"items": sink_result.normalized},
        )
        await events.emit(
            run_id, "store",
            f"入库完成 | 新增 {len(new_records)} 条，跳过 {skipped} 条（重复）",
            detail={"new": len(new_records), "skipped": skipped},
        )

    # Incremental cursor: advance the persisted cursor ONLY now that the write sink
    # has accepted this batch. A raised/failed sink returned above, so reaching here
    # means the data landed; committing during fetch would skip items that never got
    # written. (Deeper ODP durability — a queued 202 that never persists — is an
    # ODP-side guarantee, tracked separately.)
    pending_cursor = channel_result.metadata.pop("__cursor_pending__", None)
    cursor_source_id = channel_result.metadata.pop("__cursor_source_id__", None)
    if pending_cursor is not None and cursor_source_id is not None:
        from backend.pipeline.cursor_store import DBCursorStore

        await DBCursorStore().save(cursor_source_id, pending_cursor)
        logger.info("[task:%s] cursor committed post-write | source=%s",
                    task_id, cursor_source_id)

    # Step 4: AI processing
    effective_ai_config = agent_config or source.ai_config
    ai_count = 0
    if enable_ai and effective_ai_config and new_records:
        processor_type = effective_ai_config.get("processor_type", "claude")
        model = effective_ai_config.get("model", "")
        logger.info("[task:%s] step4/ai start | processor=%s model=%s records=%d",
                    task_id, processor_type, model, len(new_records))

        async with AsyncSessionLocal() as session:
            from backend.models.task import CollectionTask
            task_row = await session.get(CollectionTask, task_id)
            if task_row:
                task_row.status = "ai_processing"
                await session.commit()
        try:
            await ai_processor.process_with_ai(new_records, effective_ai_config)
            # Persist enrichments — new_records are detached after step3 session closed
            from backend.models.record import CollectedRecord
            async with AsyncSessionLocal() as session:
                for rec in new_records:
                    if rec.ai_enrichment is not None:
                        db_rec = await session.get(CollectedRecord, rec.id)
                        if db_rec:
                            db_rec.ai_enrichment = rec.ai_enrichment
                            db_rec.status = "ai_processed"
                await session.commit()
            ai_count = len(new_records)
            logger.info("[task:%s] step4/ai done | processed=%d", task_id, ai_count)
            if run_id:
                await events.emit(
                    run_id, "ai_process",
                    f"AI 处理完成 | {ai_count} 条",
                    detail={"processed": ai_count},
                )
        except Exception as exc:
            logger.warning("[task:%s] step4/ai failed | %s", task_id, exc)
            if run_id:
                await events.emit(
                    run_id, "ai_process",
                    f"AI 处理失败: {exc}",
                    level="warning",
                )
    elif enable_ai and not effective_ai_config:
        logger.debug("[task:%s] step4/ai skipped | no ai_config", task_id)
        if run_id:
            await events.emit(run_id, "ai_process", "跳过 AI 处理（未配置）")

    # Step 5: Notify
    if enable_notifications and new_records:
        logger.info("[task:%s] step5/notify start | records=%d", task_id, len(new_records))
        try:
            async with AsyncSessionLocal() as session:
                await notifier_dispatch.dispatch_notifications(session, source.id, new_records)
                await session.commit()
            logger.info("[task:%s] step5/notify done", task_id)
            if run_id:
                await events.emit(run_id, "notify", "通知发送完成")
        except Exception as exc:
            logger.warning("[task:%s] step5/notify failed | %s", task_id, exc)
            if run_id:
                await events.emit(
                    run_id, "notify",
                    f"通知发送失败: {exc}",
                    level="warning",
                )

    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)

    if run_id:
        await events.emit(
            run_id, "complete",
            f"任务完成 | 总耗时 {duration_ms}ms | 采集 {channel_result.count} 新增 {len(new_records)} 跳过 {skipped}",
            detail={
                "duration_ms": duration_ms,
                "collected": channel_result.count,
                "stored": len(new_records),
                "skipped": skipped,
            },
        )

    return PipelineResult(
        success=True,
        source_id=source.id,
        collected=channel_result.count,
        stored=len(new_records),
        skipped=skipped,
        ai_processed=ai_count,
        duration_ms=duration_ms,
        metadata=channel_result.metadata,
    )
