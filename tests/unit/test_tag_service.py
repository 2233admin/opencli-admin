"""Tests for TagService: bind_category/add_subtags/get_tags/list_by_category (PR-B)."""

import uuid

import pytest
from sqlalchemy import select

from backend.models.tag import Tag, TagBinding
from backend.services import tag_service


def _record_id() -> str:
    return str(uuid.uuid4())


@pytest.mark.asyncio
async def test_bind_category_creates_binding(db_session):
    record_id = _record_id()

    await tag_service.bind_category(db_session, record_id, "模型能力")

    bindings = (
        await db_session.execute(select(TagBinding).where(TagBinding.target_id == record_id))
    ).scalars().all()
    assert len(bindings) == 1
    tag = (await db_session.execute(select(Tag).where(Tag.id == bindings[0].tag_id))).scalar_one()
    assert tag.type == "category"
    assert tag.name == "模型能力"


@pytest.mark.asyncio
async def test_bind_category_overwrites_not_accumulates(db_session):
    record_id = _record_id()

    await tag_service.bind_category(db_session, record_id, "模型能力")
    await tag_service.bind_category(db_session, record_id, "行业资讯")
    await tag_service.bind_category(db_session, record_id, "工程实践")

    # Only one category TagBinding survives for this record.
    category_tag_ids = select(Tag.id).where(Tag.type == "category")
    bindings = (
        await db_session.execute(
            select(TagBinding).where(
                TagBinding.target_id == record_id,
                TagBinding.tag_id.in_(category_tag_ids),
            )
        )
    ).scalars().all()
    assert len(bindings) == 1

    tag = (await db_session.execute(select(Tag).where(Tag.id == bindings[0].tag_id))).scalar_one()
    assert tag.name == "工程实践"


@pytest.mark.asyncio
async def test_bind_category_does_not_touch_subtag_bindings(db_session):
    record_id = _record_id()

    await tag_service.add_subtags(db_session, record_id, ["LLM"])
    await tag_service.bind_category(db_session, record_id, "模型能力")
    await tag_service.bind_category(db_session, record_id, "行业资讯")

    tags = await tag_service.get_tags(db_session, record_id)
    types_names = {(t.type, t.name) for t in tags}
    assert ("subtag", "LLM") in types_names
    assert ("category", "行业资讯") in types_names
    assert ("category", "模型能力") not in types_names
    assert len(tags) == 2


@pytest.mark.asyncio
async def test_bind_category_rejects_invalid_name(db_session):
    record_id = _record_id()

    with pytest.raises(ValueError):
        await tag_service.bind_category(db_session, record_id, "不存在的分类")

    bindings = (
        await db_session.execute(select(TagBinding).where(TagBinding.target_id == record_id))
    ).scalars().all()
    assert bindings == []


@pytest.mark.asyncio
async def test_add_subtags_dedupes_within_call(db_session):
    record_id = _record_id()

    bindings = await tag_service.add_subtags(db_session, record_id, ["LLM", "LLM", "RAG", "LLM"])

    assert len(bindings) == 2
    tags = await tag_service.get_tags(db_session, record_id)
    names = sorted(t.name for t in tags)
    assert names == ["LLM", "RAG"]


@pytest.mark.asyncio
async def test_add_subtags_dedupes_against_already_bound(db_session):
    record_id = _record_id()

    first = await tag_service.add_subtags(db_session, record_id, ["LLM", "RAG"])
    assert len(first) == 2

    # Re-adding one existing name plus one new name: only the new one is created.
    second = await tag_service.add_subtags(db_session, record_id, ["LLM", "Agents"])
    assert len(second) == 1
    assert second[0].tag_id != first[0].tag_id

    tags = await tag_service.get_tags(db_session, record_id)
    names = sorted(t.name for t in tags)
    assert names == ["Agents", "LLM", "RAG"]


@pytest.mark.asyncio
async def test_add_subtags_reuses_existing_tag_row(db_session):
    record_a = _record_id()
    record_b = _record_id()

    await tag_service.add_subtags(db_session, record_a, ["LLM"])
    await tag_service.add_subtags(db_session, record_b, ["LLM"])

    tags = (await db_session.execute(select(Tag).where(Tag.type == "subtag", Tag.name == "LLM"))).scalars().all()
    assert len(tags) == 1


@pytest.mark.asyncio
async def test_get_tags_returns_empty_for_unbound_record(db_session):
    tags = await tag_service.get_tags(db_session, _record_id())
    assert tags == []


@pytest.mark.asyncio
async def test_list_by_category_returns_only_matching_category(db_session):
    record_a = _record_id()
    record_b = _record_id()
    record_c = _record_id()

    await tag_service.bind_category(db_session, record_a, "模型能力")
    await tag_service.bind_category(db_session, record_b, "模型能力")
    await tag_service.bind_category(db_session, record_c, "行业资讯")
    # A subtag with a name that happens to collide with a category name must
    # not leak into list_by_category results.
    await tag_service.add_subtags(db_session, record_c, ["模型能力"])

    result = await tag_service.list_by_category(db_session, "模型能力")

    assert set(result) == {record_a, record_b}
    assert record_c not in result


@pytest.mark.asyncio
async def test_list_by_category_empty_when_no_bindings(db_session):
    result = await tag_service.list_by_category(db_session, "其它")
    assert result == []
