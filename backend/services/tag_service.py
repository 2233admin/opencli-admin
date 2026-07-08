from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.tag import Tag, TagBinding
from backend.taxonomy import TOP_LEVEL_CATEGORIES, is_valid_category


async def _get_or_create_tag(session: AsyncSession, type_: str, name: str) -> Tag:
    result = await session.execute(select(Tag).where(Tag.type == type_, Tag.name == name))
    tag = result.scalar_one_or_none()
    if tag is None:
        tag = Tag(type=type_, name=name)
        session.add(tag)
        await session.flush()
    return tag


async def bind_category(session: AsyncSession, record_id: str, category_name: str) -> TagBinding:
    """Bind `record_id` to a single top-level category tag.

    Enforces the locked invariant: a record has at most one `type="category"`
    TagBinding. Calling this again for the same record is a covering/overwrite
    operation — any prior category binding for the record is removed before
    the new one is created. Existing subtag bindings are left untouched.

    Raises ValueError if `category_name` is not one of the closed top-level
    categories (backend.taxonomy.TOP_LEVEL_CATEGORIES).
    """
    if not is_valid_category(category_name):
        raise ValueError(
            f"Invalid category name: {category_name!r}; must be one of {TOP_LEVEL_CATEGORIES}"
        )

    tag = await _get_or_create_tag(session, "category", category_name)

    category_tag_ids = select(Tag.id).where(Tag.type == "category")
    await session.execute(
        delete(TagBinding).where(
            TagBinding.target_id == record_id,
            TagBinding.tag_id.in_(category_tag_ids),
        )
    )

    binding = TagBinding(tag_id=tag.id, target_id=record_id)
    session.add(binding)
    await session.flush()
    await session.refresh(binding)
    return binding


async def add_subtags(session: AsyncSession, record_id: str, names: list[str]) -> list[TagBinding]:
    """Bind `record_id` to one or more subtag Tags.

    Dedupes both within `names` and against subtags already bound to this
    record. Creates new `type="subtag"` Tag rows for names that don't exist
    yet. Returns only the newly created bindings (already-bound names are
    silently skipped, not re-bound).
    """
    seen: set[str] = set()
    unique_names: list[str] = []
    for name in names:
        if name not in seen:
            seen.add(name)
            unique_names.append(name)

    if not unique_names:
        return []

    already_bound_result = await session.execute(
        select(Tag.name)
        .join(TagBinding, TagBinding.tag_id == Tag.id)
        .where(Tag.type == "subtag", TagBinding.target_id == record_id)
    )
    already_bound_names = set(already_bound_result.scalars().all())

    new_bindings = []
    for name in unique_names:
        if name in already_bound_names:
            continue
        tag = await _get_or_create_tag(session, "subtag", name)
        binding = TagBinding(tag_id=tag.id, target_id=record_id)
        session.add(binding)
        new_bindings.append(binding)

    if new_bindings:
        await session.flush()
        for binding in new_bindings:
            await session.refresh(binding)

    return new_bindings


async def get_tags(session: AsyncSession, record_id: str) -> list[Tag]:
    """Return all Tags (category + subtags) bound to `record_id`."""
    result = await session.execute(
        select(Tag)
        .join(TagBinding, TagBinding.tag_id == Tag.id)
        .where(TagBinding.target_id == record_id)
        .order_by(Tag.type, Tag.name)
    )
    return result.scalars().all()


async def list_by_category(session: AsyncSession, category_name: str) -> list[str]:
    """Return the record_ids bound to the given category tag name.

    Only records with a `type="category"` binding to a Tag of this exact
    name are returned — other categories and subtag bindings are excluded.
    """
    result = await session.execute(
        select(TagBinding.target_id)
        .join(Tag, Tag.id == TagBinding.tag_id)
        .where(Tag.type == "category", Tag.name == category_name)
    )
    return list(result.scalars().all())
