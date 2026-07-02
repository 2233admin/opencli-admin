"""HTTP-seam tests for the preset service (Plan IR issue 06):

- GET /api/v1/presets — standard ApiResponse envelope, presets grouped by
  channel_type, opencli + a non-opencli channel (rss) both present
- every returned preset's prefill payload is independently re-validated
  against the REAL registered channel's ``validate_config`` (never a
  reimplementation of that check) — the endpoint's core contract
- the opencli catalog is injected via the ``OpencliCatalogProvider`` seam
  (a fixture catalog), never the real installed binary, so these tests are
  hermetic and deterministic regardless of what's on the test host's PATH
"""

import pytest

from backend.channels.registry import get_channel
from backend.plan_ir.presets import (
    OpencliCommandMeta,
    list_presets,
    list_presets_grouped,
)


class _FixtureOpencliCatalogProvider:
    """A known, fixed catalog standing in for ``opencli list -f json`` —
    one safe read/no-required-arg command, one write command (must be
    excluded), one read command with a required arg (must be excluded)."""

    async def get_catalog(self) -> list[OpencliCommandMeta]:
        return [
            OpencliCommandMeta(
                site="xueqiu", name="hot", description="雪球热帖",
                access="read", required_args=False,
            ),
            OpencliCommandMeta(
                site="12306", name="login", description="Login (write)",
                access="write", required_args=False,
            ),
            OpencliCommandMeta(
                site="github", name="search", description="Needs a query",
                access="read", required_args=True,
            ),
        ]


class _EmptyOpencliCatalogProvider:
    """Simulates the real provider's best-effort behaviour when the opencli
    binary is unavailable: an empty catalog, not an error."""

    async def get_catalog(self) -> list[OpencliCommandMeta]:
        return []


@pytest.fixture(autouse=True)
def _fixture_opencli_provider(monkeypatch):
    """Route the router's ``list_presets_grouped()`` call through the fixture
    provider for the whole module, so the HTTP-seam tests never depend on a
    real opencli binary being on the test host's PATH."""
    import backend.api.v1.presets as presets_router

    async def _grouped_with_fixture():
        return await list_presets_grouped(provider=_FixtureOpencliCatalogProvider())

    monkeypatch.setattr(presets_router, "list_presets_grouped", _grouped_with_fixture)


# ── HTTP seam ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_presets_returns_ok_envelope(client):
    response = await client.get("/api/v1/presets")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"] is not None
    assert body["error"] is None


@pytest.mark.asyncio
async def test_list_presets_grouped_by_channel_type(client):
    response = await client.get("/api/v1/presets")
    data = response.json()["data"]

    assert "opencli" in data
    assert len(data["opencli"]) > 0
    assert "rss" in data
    assert len(data["rss"]) > 0


@pytest.mark.asyncio
async def test_opencli_presets_exclude_write_and_required_arg_commands(client):
    """The fixture catalog has 3 commands; only the read + no-required-args
    one should survive derivation — proves filtering, not just pass-through."""
    response = await client.get("/api/v1/presets")
    data = response.json()["data"]

    opencli_ids = {p["id"] for p in data["opencli"]}
    assert opencli_ids == {"opencli:xueqiu:hot"}


@pytest.mark.asyncio
async def test_every_preset_payload_validates_against_real_channel_schema(client):
    """Independently re-validate every preset the endpoint returns against
    the REAL channel's validate_config — a second, HTTP-seam-level check
    distinct from whatever list_presets() does internally."""
    response = await client.get("/api/v1/presets")
    data = response.json()["data"]

    total_checked = 0
    for channel_type, presets in data.items():
        channel = get_channel(channel_type)
        for preset in presets:
            config = {k: v for k, v in preset["params"].items() if k != "channel_type"}
            errors = await channel.validate_config(config)
            assert errors == [], f"preset {preset['id']!r} invalid: {errors}"
            total_checked += 1

    assert total_checked > 0


@pytest.mark.asyncio
async def test_rss_preset_present_and_valid(client):
    """At least one non-opencli channel (rss) present with a preset whose
    prefill payload is independently valid."""
    response = await client.get("/api/v1/presets")
    data = response.json()["data"]

    rss_presets = data["rss"]
    assert len(rss_presets) >= 1

    rss_channel = get_channel("rss")
    for preset in rss_presets:
        assert preset["node_type"] == "rss_source"
        config = {k: v for k, v in preset["params"].items() if k != "channel_type"}
        errors = await rss_channel.validate_config(config)
        assert errors == []


@pytest.mark.asyncio
async def test_each_preset_declares_id_label_description_and_params(client):
    response = await client.get("/api/v1/presets")
    data = response.json()["data"]

    for presets in data.values():
        for preset in presets:
            assert preset["id"]
            assert preset["label"]
            assert isinstance(preset["description"], str)
            assert isinstance(preset["params"], dict)
            assert preset["params"].get("channel_type") == preset["channel_type"]


# ── unit coverage of the presets module directly ────────────────────────────


@pytest.mark.asyncio
async def test_list_presets_ids_are_unique():
    presets = await list_presets(provider=_FixtureOpencliCatalogProvider())
    ids = [p.id for p in presets]
    assert len(ids) == len(set(ids))


@pytest.mark.asyncio
async def test_list_presets_node_type_matches_channel_type():
    presets = await list_presets(provider=_FixtureOpencliCatalogProvider())
    assert len(presets) > 0
    for preset in presets:
        assert preset.node_type == f"{preset.channel_type}_source"


@pytest.mark.asyncio
async def test_list_presets_includes_opencli_and_rss():
    presets = await list_presets(provider=_FixtureOpencliCatalogProvider())
    channel_types = {p.channel_type for p in presets}
    assert "opencli" in channel_types
    assert "rss" in channel_types


@pytest.mark.asyncio
async def test_empty_opencli_catalog_yields_zero_opencli_presets_not_an_error():
    """Best-effort contract: when the catalog provider can't get real data
    (e.g. binary unavailable), derivation yields zero opencli presets —
    never a fake/placeholder one — while other channels are unaffected."""
    grouped = await list_presets_grouped(provider=_EmptyOpencliCatalogProvider())
    assert grouped.get("opencli", []) == []
    assert len(grouped["rss"]) > 0
