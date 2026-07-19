"""RSS entry mapping tests."""

import pytest

from backend.channels.rss_channel import RSSChannel


@pytest.fixture
def channel():
    return RSSChannel()


@pytest.mark.asyncio
async def test_entry_to_dict(channel):
    class FakeEntry:
        def get(self, key, default=""):
            data = {
                "title": "Test Title",
                "link": "https://example.com/post",
                "summary": "A summary",
                "author": "Alice",
                "published": "2024-01-01",
                "tags": [{"term": "python"}],
                "id": "abc123",
            }
            return data.get(key, default)

    result = channel._entry_to_dict(FakeEntry())
    assert result["title"] == "Test Title"
    assert result["link"] == "https://example.com/post"
    assert "python" in result["tags"]


def test_entry_to_dict_missing_optional_fields(channel):
    """An entry with only a link uses it as the id fallback."""

    class MinimalEntry:
        def get(self, key, default=""):
            return {"link": "https://ex.com/x"}.get(key, default)

    result = channel._entry_to_dict(MinimalEntry())
    assert result["link"] == "https://ex.com/x"
    assert result["id"] == "https://ex.com/x"
    assert result["tags"] == []


def test_entry_to_dict_all_tags(channel):
    """All tag terms are extracted."""

    class TaggedEntry:
        def get(self, key, default=""):
            return {
                "tags": [{"term": "a"}, {"term": "b"}, {"term": "c"}]
            }.get(key, default)

    result = channel._entry_to_dict(TaggedEntry())
    assert result["tags"] == ["a", "b", "c"]
