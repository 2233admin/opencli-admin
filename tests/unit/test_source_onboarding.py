"""discover_feeds / parse_opml / bulk_import_rss — RSS source onboarding
(setup-time convenience, not scheduled channel behavior)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.models.source import DataSource
from backend.services import source_service


@pytest.fixture(autouse=True)
def _public_dns():
    """Let mocked HTTP calls pass the real SSRF validation deterministically."""
    with patch("socket.getaddrinfo", return_value=[(None, None, None, "", ("93.184.216.34", 0))]):
        yield


_HTML_WITH_FEED_LINKS = """<!doctype html><html><head>
<link rel="alternate" type="application/rss+xml" title="Main Feed" href="/feed.xml">
<link rel="alternate" type="application/atom+xml" title="Atom" href="https://example.com/atom.xml">
<link rel="stylesheet" href="/style.css">
</head><body></body></html>"""

_HTML_NO_FEED_LINKS = "<!doctype html><html><head></head><body>plain page</body></html>"

_OPML = """<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline text="Feed A" title="Feed A" xmlUrl="https://a.example.com/rss" />
      <outline text="Feed B" title="Feed B" xmlUrl="https://b.example.com/rss" />
    </outline>
    <outline text="Feed A dup" title="Feed A dup" xmlUrl="https://a.example.com/rss" />
    <outline text="folder only, no feed" />
  </body>
</opml>"""


def _mock_response(text="", status_code=200, url="https://example.com/", headers=None):
    resp = MagicMock()
    resp.text = text
    resp.status_code = status_code
    resp.url = url
    resp.headers = headers or {}
    resp.raise_for_status = MagicMock()
    return resp


# ── discover_feeds ───────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_discover_feeds_finds_link_tags():
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(_HTML_WITH_FEED_LINKS))
    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_ctx):
        candidates = await source_service.discover_feeds("https://example.com")

    urls = {c["url"] for c in candidates}
    assert urls == {"https://example.com/feed.xml", "https://example.com/atom.xml"}
    mock_client.get.assert_awaited_once()  # no fallback probing needed


@pytest.mark.asyncio
async def test_discover_feeds_falls_back_to_common_paths():
    homepage = _mock_response(_HTML_NO_FEED_LINKS)
    feed_probe = _mock_response(
        "", status_code=200, headers={"content-type": "application/rss+xml"}
    )
    miss_probe = _mock_response("", status_code=404)

    mock_client = AsyncMock()

    async def fake_get(url, *a, **kw):
        if url == "https://example.com/":
            return homepage
        if url.endswith("/feed"):
            return feed_probe
        return miss_probe

    mock_client.get = AsyncMock(side_effect=fake_get)
    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_ctx):
        candidates = await source_service.discover_feeds("https://example.com")

    assert candidates == [{"url": "https://example.com/feed", "title": None}]


@pytest.mark.asyncio
async def test_discover_feeds_unreachable_site_returns_empty():
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=OSError("connection refused"))
    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_ctx):
        assert await source_service.discover_feeds("https://unreachable.example") == []


# ── parse_opml ───────────────────────────────────────────────────────────────
def test_parse_opml_nested_folders_and_dedup():
    entries = source_service.parse_opml(_OPML)
    urls = [e["url"] for e in entries]
    assert urls == [
        "https://a.example.com/rss",
        "https://b.example.com/rss",
    ]  # dup within file collapsed
    assert entries[0]["title"] == "Feed A"


def test_parse_opml_invalid_xml_raises_value_error():
    with pytest.raises(ValueError, match="invalid OPML"):
        source_service.parse_opml("<not-xml-at-all")


# ── bulk_import_rss ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_bulk_import_rss_creates_disabled_sources(db_session):
    entries = [{"url": "https://a.example.com/rss", "title": "Feed A"}]
    created, skipped = await source_service.bulk_import_rss(db_session, entries)

    assert len(created) == 1
    assert created[0].channel_type == "rss"
    assert created[0].enabled is False
    assert created[0].channel_config == {"feed_url": "https://a.example.com/rss"}
    assert skipped == []


@pytest.mark.asyncio
async def test_bulk_import_rss_skips_already_stored_feed_url(db_session):
    existing = DataSource(
        name="Already here",
        channel_type="rss",
        channel_config={"feed_url": "https://a.example.com/rss"},
    )
    db_session.add(existing)
    await db_session.flush()

    created, skipped = await source_service.bulk_import_rss(
        db_session, [{"url": "https://a.example.com/rss", "title": "Feed A"}]
    )
    assert created == []
    assert skipped == ["https://a.example.com/rss"]


@pytest.mark.asyncio
async def test_bulk_import_rss_dedups_within_same_batch(db_session):
    entries = [
        {"url": "https://a.example.com/rss", "title": "Feed A"},
        {"url": "https://a.example.com/rss", "title": "Feed A dup"},
    ]
    created, skipped = await source_service.bulk_import_rss(db_session, entries)
    assert len(created) == 1
    assert skipped == ["https://a.example.com/rss"]
