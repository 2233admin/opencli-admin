"""Pipeline Step 1: Dispatch to the appropriate channel."""

from typing import Any

from backend.channels.base import ChannelResult
from backend.channels.registry import get_channel
from backend.models.source import DataSource


async def collect(source: DataSource, parameters: dict[str, Any]) -> ChannelResult:
    """Dispatch collection to the registered channel's ``fetch()`` through the
    thick runner (``run_channel``).

    Every channel goes through the same path now, not just incremental ones: a
    channel that hasn't migrated ``fetch()`` gets the default adapter that bridges
    to ``collect()``, and ``run_channel`` degrades to a single non-paginated,
    no-cursor call for it — identical to calling ``collect()`` directly, plus a
    resolved ``AuthContext`` and a rate-limited client the channel may opt into.
    """
    channel = get_channel(source.channel_type)
    return await _collect_via_runner(source, parameters, channel)


async def _collect_via_runner(
    source: DataSource, parameters: dict[str, Any], channel: Any
) -> ChannelResult:
    """Collect via ``run_channel``, staging the cursor and forwarding metadata.

    The persisted cursor (if any) seeds the fetch, but the advanced value is held
    in an in-memory staging store and returned in ``metadata['__cursor_pending__']``
    (a reserved-prefix key, so a channel's own metadata can never collide with it) —
    the pipeline commits it to the DB only after the write sink durably accepts
    the batch, so the cursor never advances past data that did not land.
    Non-incremental channels never populate a cursor, so this staging is a no-op
    for them; ``run_channel``'s own ``metadata`` (e.g. opencli's node_url, skill's
    awaiting_confirm) is merged through unchanged either way.
    """
    from backend.pipeline.channel_runner import run_channel
    from backend.pipeline.cursor_store import DBCursorStore, InMemoryCursorStore

    staging = InMemoryCursorStore()
    if channel.capabilities.incremental:
        # Only incremental channels can ever have a persisted cursor row — skip
        # the SELECT entirely for the rest (api/opencli/skill/cli/web_scraper),
        # since run_channel() would find nothing to stage for them anyway.
        start = await DBCursorStore().load(source.id)
        if start is not None:
            await staging.save(source.id, start)

    run_result = await run_channel(source, parameters, cursor_store=staging, channel=channel)
    staged = await staging.load(source.id)

    metadata = {
        **run_result.metadata,
        "__cursor_pending__": staged,
        "__cursor_source_id__": source.id,
    }
    return ChannelResult.ok(run_result.items, **metadata)
