import xml.etree.ElementTree as ET
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.channels.registry import get_channel
from backend.models.source import DataSource
from backend.models.source_credential import SourceCredential
from backend.schemas.source import DataSourceCreate, DataSourceUpdate
from backend.security.url_guard import SSRFValidationError, avalidate_public_url

#: common feed paths probed when a site's <head> has no <link rel="alternate">
#: feed tags at all (many blogs/CMSes still serve a feed at one of these).
_COMMON_FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml"]
_FEED_MIME_TYPES = {"application/rss+xml", "application/atom+xml", "application/xml", "text/xml"}


async def list_sources(
    session: AsyncSession,
    enabled: Optional[bool] = None,
    channel_type: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[DataSource], int]:
    query = select(DataSource).order_by(DataSource.created_at.desc())
    count_query = select(func.count()).select_from(DataSource)

    if enabled is not None:
        query = query.where(DataSource.enabled == enabled)
        count_query = count_query.where(DataSource.enabled == enabled)
    if channel_type:
        query = query.where(DataSource.channel_type == channel_type)
        count_query = count_query.where(DataSource.channel_type == channel_type)

    total = (await session.execute(count_query)).scalar_one()
    offset = (page - 1) * limit
    result = await session.execute(query.offset(offset).limit(limit))
    return result.scalars().all(), total


async def get_source(session: AsyncSession, source_id: str) -> Optional[DataSource]:
    result = await session.execute(
        select(DataSource).where(DataSource.id == source_id)
    )
    return result.scalar_one_or_none()


async def create_source(session: AsyncSession, data: DataSourceCreate) -> DataSource:
    source = DataSource(**data.model_dump())
    session.add(source)
    await session.flush()
    await session.refresh(source)
    return source


async def update_source(
    session: AsyncSession, source: DataSource, data: DataSourceUpdate
) -> DataSource:
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(source, key, value)
    await session.flush()
    await session.refresh(source)
    return source


async def delete_source(session: AsyncSession, source: DataSource) -> None:
    # source_credentials has no FK/cascade to data_sources (it's written by
    # AuthManager, a separate session, so a DB-level FK would need cross-module
    # coordination) — clean it up here instead, or the encrypted secrets for a
    # deleted source live forever.
    await session.execute(
        delete(SourceCredential).where(SourceCredential.source_id == source.id)
    )
    await session.delete(source)
    await session.flush()


async def validate_source_config(source: DataSource) -> list[str]:
    try:
        channel = get_channel(source.channel_type)
        return await channel.validate_config(source.channel_config)
    except ValueError as exc:
        return [str(exc)]


async def test_source_connectivity(source: DataSource) -> tuple[bool, list[str]]:
    errors = await validate_source_config(source)
    if errors:
        return False, errors
    try:
        channel = get_channel(source.channel_type)
        ok = await channel.health_check(source.channel_config, source.id)
        return ok, []
    except Exception as exc:
        return False, [str(exc)]


# ── RSS source onboarding: feed discovery + OPML bulk import ────────────────────
async def discover_feeds(url: str) -> list[dict[str, Any]]:
    """Given a site's homepage (not a feed URL itself), find candidate RSS/Atom
    feeds. Setup-time only — never called from a scheduled collect(). Returns
    every candidate found (no auto-pick of "the main one"); an empty list means
    genuinely nothing found, not a raised error."""
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    try:
        url = await avalidate_public_url(url)
    except SSRFValidationError:
        return []

    # follow_redirects=False: a validated URL can still 30x-redirect to a
    # private/loopback/fleet address (SSRF via redirect) — this endpoint takes
    # a raw user-supplied homepage URL at setup time, so it's a prime target.
    async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except Exception:
            return []

        soup = BeautifulSoup(response.text, "lxml")
        for link in soup.find_all("link", rel="alternate"):
            mime = (link.get("type") or "").lower()
            href = link.get("href")
            if mime in _FEED_MIME_TYPES and href:
                feed_url = urljoin(str(response.url), href)
                # The derived feed_url is attacker-influenceable (comes from the
                # fetched page's own <link href>), so it needs the same check as
                # the original url, not just a "we already validated the site" pass.
                try:
                    feed_url = await avalidate_public_url(feed_url)
                except SSRFValidationError:
                    continue
                if feed_url not in seen:
                    seen.add(feed_url)
                    candidates.append({"url": feed_url, "title": link.get("title")})

        if candidates:
            return candidates

        # Nothing declared in <head> — probe common paths as a fallback.
        parsed = urlparse(str(response.url))
        base = f"{parsed.scheme}://{parsed.netloc}"
        for path in _COMMON_FEED_PATHS:
            probe_url = base + path
            try:
                probe_url = await avalidate_public_url(probe_url)
            except SSRFValidationError:
                continue
            try:
                probe = await client.get(probe_url)
            except Exception:
                continue
            content_type = probe.headers.get("content-type", "").split(";")[0].strip().lower()
            if probe.status_code == 200 and content_type in _FEED_MIME_TYPES and probe_url not in seen:
                seen.add(probe_url)
                candidates.append({"url": probe_url, "title": None})

    return candidates


def parse_opml(xml_text: str) -> list[dict[str, str]]:
    """Walk an OPML document's (possibly nested, folder-grouped) <outline>
    elements and collect every one carrying xmlUrl (a feed). Malformed XML
    raises ValueError so the caller can 400 instead of 500."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"invalid OPML: {exc}") from exc

    entries: list[dict[str, str]] = []
    seen: set[str] = set()

    def _walk(node: ET.Element) -> None:
        for outline in node.findall("outline"):
            feed_url = outline.get("xmlUrl")
            if feed_url and feed_url not in seen:
                seen.add(feed_url)
                title = outline.get("title") or outline.get("text") or feed_url
                entries.append({"url": feed_url, "title": title})
            _walk(outline)  # folders nest outlines without xmlUrl inside them

    body = root.find("body")
    _walk(body if body is not None else root)
    return entries


async def bulk_import_rss(
    session: AsyncSession, entries: list[dict[str, str]]
) -> tuple[list[DataSource], list[str]]:
    """Create one disabled channel_type="rss" DataSource per entry, deduped
    against BOTH already-stored sources and duplicates within the same OPML
    file. Lands disabled — a human reviews and enables, not an auto-live
    firehose from one file upload. Returns (created rows, skipped feed_urls)."""
    existing = (
        await session.execute(select(DataSource).where(DataSource.channel_type == "rss"))
    ).scalars().all()
    existing_urls = {s.channel_config.get("feed_url") for s in existing}

    created: list[DataSource] = []
    skipped: list[str] = []
    seen_this_batch: set[str] = set()

    for entry in entries:
        feed_url = entry["url"]
        if feed_url in existing_urls or feed_url in seen_this_batch:
            skipped.append(feed_url)
            continue
        seen_this_batch.add(feed_url)
        source = DataSource(
            name=entry.get("title") or feed_url,
            channel_type="rss",
            channel_config={"feed_url": feed_url},
            enabled=False,
        )
        session.add(source)
        created.append(source)

    if created:
        await session.flush()
        for source in created:
            await session.refresh(source)

    return created, skipped
