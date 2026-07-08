"""Tests for the Tag/TagBinding models and DataSource taxonomy columns (PR-A)."""

import uuid

import pytest
from sqlalchemy import select

from backend.models.source import DataSource
from backend.models.tag import Tag, TagBinding


@pytest.mark.asyncio
async def test_tag_can_be_created_with_category_type(db_session):
    tag = Tag(type="category", name="模型能力")
    db_session.add(tag)
    await db_session.flush()

    assert tag.id is not None
    assert tag.created_at is not None

    fetched = (await db_session.execute(select(Tag).where(Tag.id == tag.id))).scalar_one()
    assert fetched.type == "category"
    assert fetched.name == "模型能力"


@pytest.mark.asyncio
async def test_tag_can_be_created_with_subtag_type(db_session):
    tag = Tag(type="subtag", name="LLM")
    db_session.add(tag)
    await db_session.flush()

    assert tag.type == "subtag"


@pytest.mark.asyncio
async def test_tag_binding_links_tag_to_target_without_db_level_fk(db_session):
    tag = Tag(type="category", name="行业资讯")
    db_session.add(tag)
    await db_session.flush()

    target_id = str(uuid.uuid4())
    binding = TagBinding(tag_id=tag.id, target_id=target_id)
    db_session.add(binding)
    await db_session.flush()

    assert binding.id is not None

    fetched = (
        await db_session.execute(select(TagBinding).where(TagBinding.target_id == target_id))
    ).scalar_one()
    assert fetched.tag_id == tag.id


@pytest.mark.asyncio
async def test_tag_binding_does_not_enforce_referential_integrity(db_session):
    """No DB-level FK on tag_id/target_id — dangling references are allowed
    at the DB layer (integrity enforced at the service layer in a later PR)."""
    binding = TagBinding(tag_id="does-not-exist", target_id="also-does-not-exist")
    db_session.add(binding)
    # Should not raise, unlike a real FK-constrained column would.
    await db_session.flush()

    assert binding.id is not None


@pytest.mark.asyncio
async def test_data_source_public_defaults_to_false(db_session):
    source = DataSource(
        name="Default Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed.xml"},
    )
    db_session.add(source)
    await db_session.flush()

    assert source.public is False
    assert source.default_category is None


@pytest.mark.asyncio
async def test_data_source_public_and_default_category_can_be_set(db_session):
    source = DataSource(
        name="Public Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed.xml"},
        public=True,
        default_category="工程实践",
    )
    db_session.add(source)
    await db_session.flush()

    fetched = (
        await db_session.execute(select(DataSource).where(DataSource.id == source.id))
    ).scalar_one()
    assert fetched.public is True
    assert fetched.default_category == "工程实践"
