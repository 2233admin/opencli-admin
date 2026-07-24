"""Preset service (Plan IR issue 06, PRD stories 4/26; glossary term Preset).

A Preset is a packaged, one-click node configuration for the Collection
Canvas palette: a node type plus a param prefill payload the operator can
drop onto the canvas without walking dropdowns. Presets are never hand-
maintained — they are *derived* at request time from adapter metadata the
backend already has access to:

- opencli: the real ``opencli list -f json`` catalog (site × command ×
  access/args), behind :class:`OpencliCatalogProvider` so tests can inject a
  known fixture instead of shelling out to the real binary.
- other channels: each channel's own minimal config shape. A channel only
  gets a preset here if a prefill payload can be constructed that
  independently passes that channel's real ``validate_config`` — no
  placeholder is ever served as if it were real / working.

No DB table, no persistence: ``list_presets()`` is a pure(-ish) function of
"whatever the adapters currently report", recomputed on every call.
"""

import asyncio
from typing import Protocol

from pydantic import BaseModel

from backend.workflow.opencli_adapter_nodes import get_opencli_adapter_catalog

# Cap on how many opencli presets we surface — the real catalog has 1000+
# read-only, no-required-arg commands (issue 06 research: 709 at time of
# writing); a bounded, deterministic slice keeps the endpoint response and
# the palette usable while still being fully metadata-derived (no hardcoded
# site list — this is just "how many of the derived results to keep").
_MAX_OPENCLI_PRESETS = 200


class OpencliCommandMeta(BaseModel):
    """One entry from ``opencli list -f json`` — the fields preset
    derivation actually needs. Extra fields the binary emits (columns,
    domain, example, ...) are intentionally not modeled here."""

    site: str
    name: str
    description: str = ""
    access: str = "read"
    required_args: bool = False


class OpencliCatalogProvider(Protocol):
    """Seam between preset derivation and "however opencli's catalog is
    obtained". The real implementation shells out to the installed binary;
    tests inject a fixture with a known, fixed catalog."""

    async def get_catalog(self) -> list[OpencliCommandMeta]:
        ...


class RealOpencliCatalogProvider:
    """Derive presets from the same OpenCLI registry used by workflow nodes."""

    async def get_catalog(self) -> list[OpencliCommandMeta]:
        data = await asyncio.to_thread(get_opencli_adapter_catalog, refresh=True)
        catalog: list[OpencliCommandMeta] = []
        for entry in data:
            site = entry.get("site")
            name = entry.get("name")
            if not site or not name:
                continue
            args = entry.get("args") or []
            required_args = any(a.get("required") for a in args if isinstance(a, dict))
            catalog.append(
                OpencliCommandMeta(
                    site=site,
                    name=name,
                    description=entry.get("description") or "",
                    access=entry.get("access") or "read",
                    required_args=required_args,
                )
            )
        return catalog


class Preset(BaseModel):
    """One packaged, one-click node configuration."""

    id: str
    channel_type: str
    node_type: str
    label: str
    description: str = ""
    #: Exact param prefill payload — always includes "channel_type" (matching
    #: the projection.py convention: node params = {"channel_type": ..., **channel_config}).
    params: dict


def _opencli_presets(catalog: list[OpencliCommandMeta]) -> list[Preset]:
    """One preset per (site, command) that is safe as a one-click default:
    ``access == "read"`` (never surface a write/login action as a casual
    one-click node) and no required args (so the prefill payload alone is
    enough to pass validate_config — nothing left for the operator to fill
    in before the node is runnable). Deterministic ordering + a bounded cap
    keep the derived list stable and palette-sized.
    """
    candidates = [
        c for c in catalog
        if c.access == "read" and not c.required_args
    ]
    candidates.sort(key=lambda c: (c.site, c.name))

    presets: list[Preset] = []
    for c in candidates[:_MAX_OPENCLI_PRESETS]:
        preset_id = f"opencli:{c.site}:{c.name}"
        label = f"{c.site} · {c.name}"
        presets.append(
            Preset(
                id=preset_id,
                channel_type="opencli",
                node_type="opencli_source",
                label=label,
                description=c.description,
                params={
                    "channel_type": "opencli",
                    "site": c.site,
                    "command": c.name,
                    "format": "json",
                },
            )
        )
    return presets


def _rss_presets() -> list[Preset]:
    """RSS is the one non-opencli channel whose ``validate_config`` needs
    nothing but a truthy ``feed_url`` (no network probe, no allowlisted
    binary, no credentials) — so a real, generically-reachable public feed
    can be prefilled and will independently pass validation. Other channels
    (api: needs a real base_url+endpoint pair; cli: needs an operator-
    allowlisted binary; skill/web_scraper/crawl4ai: need per-deployment
    config) have no prefill that is both generic and guaranteed valid, so
    they deliberately get no preset here rather than a fake-valid one."""
    return [
        Preset(
            id="rss:hn-frontpage",
            channel_type="rss",
            node_type="rss_source",
            label="Hacker News · Front page",
            description="Hacker News front-page RSS feed",
            params={
                "channel_type": "rss",
                "feed_url": "https://news.ycombinator.com/rss",
                "max_entries": 30,
            },
        ),
    ]


async def list_presets(provider: OpencliCatalogProvider | None = None) -> list[Preset]:
    """All presets across every channel, derived fresh on each call. Pass a
    fixture ``provider`` in tests to avoid depending on the real opencli
    binary being installed; production code (the router) omits it and gets
    :class:`RealOpencliCatalogProvider`."""
    provider = provider or RealOpencliCatalogProvider()
    catalog = await provider.get_catalog()

    presets: list[Preset] = []
    presets.extend(_opencli_presets(catalog))
    presets.extend(_rss_presets())
    return presets


async def list_presets_grouped(
    provider: OpencliCatalogProvider | None = None,
) -> dict[str, list[Preset]]:
    """``list_presets()`` grouped by ``channel_type`` for the palette
    (category → node type → Preset, story 25)."""
    grouped: dict[str, list[Preset]] = {}
    for preset in await list_presets(provider):
        grouped.setdefault(preset.channel_type, []).append(preset)
    return grouped
