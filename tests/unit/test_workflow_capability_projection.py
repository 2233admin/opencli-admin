from backend.channels.base import Capabilities
from backend.schemas.workflow import WorkflowRuntimeCapability
from backend.workflow import capability_projection


class _StubChannel:
    def __init__(self, capabilities: Capabilities) -> None:
        self.capabilities = capabilities


def test_canvas_source_projection_covers_seven_channels(monkeypatch) -> None:
    channel_capabilities = {
        channel_type: Capabilities(
            incremental=channel_type == "rss",
            session_affinity=channel_type in {"opencli", "skill"},
        )
        for channel_type in capability_projection.CANVAS_SOURCE_CHANNEL_TYPES
    }
    monkeypatch.setattr(
        capability_projection,
        "get_channel",
        lambda channel_type: _StubChannel(channel_capabilities[channel_type]),
    )
    monkeypatch.setattr(
        capability_projection,
        "list_channel_types",
        lambda: [*capability_projection.CANVAS_SOURCE_CHANNEL_TYPES, "browser_act"],
    )

    channels = {item.channelType: item for item in capability_projection._channel_capabilities()}
    sources = {
        item.channelType: item
        for item in capability_projection._canvas_source_catalog_capabilities()
    }

    assert set(sources) == set(capability_projection.CANVAS_SOURCE_CHANNEL_TYPES)
    assert channels["opencli"].status == "runnable"
    assert channels["opencli"].runtimeBinding == "iii.collector-opencli.snapshot"
    for channel_type in set(sources) - {"opencli"}:
        source = sources[channel_type]
        assert source.status == "blocked"
        assert source.runtimeBinding == "workflow.source.fetch"
        assert source.reason
        assert "live_source_executor" in source.missing
        assert source.manifest["canvas"]["node"] is True
        assert source.manifest["canvas"]["adapter"]["provider"] == channel_type
        assert source.manifest["canvas"]["params"]["channelType"] == channel_type

    assert sources["rss"].manifest["channel"]["capabilities"]["incremental"] is True
    assert "browser_session_resource" in sources["skill"].missing
    assert "cli_binary_allowlist" in sources["cli"].missing
    assert channels["browser_act"].manifest == {}
    assert "browser_act" not in sources


def test_blocked_channel_reason_is_preserved_on_catalog_projection(monkeypatch) -> None:
    monkeypatch.setattr(
        capability_projection,
        "get_channel",
        lambda _channel_type: _StubChannel(Capabilities()),
    )

    channel = capability_projection._channel_capability("api")
    source = capability_projection._channel_capability("api", surface="catalog")

    assert isinstance(source, WorkflowRuntimeCapability)
    assert source.reason == channel.reason
    assert source.missing == channel.missing
    assert source.manifest["channel"]["requiredConfig"] == ["base_url", "endpoint"]
