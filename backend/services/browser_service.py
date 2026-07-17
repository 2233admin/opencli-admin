from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.browser import (
    BrowserBinding,
    ProfileBinding,
    ProfileLock,
    SessionSnapshot,
)


async def list_bindings(session: AsyncSession) -> list[BrowserBinding]:
    result = await session.execute(select(BrowserBinding).order_by(BrowserBinding.site))
    return list(result.scalars().all())


async def get_binding(session: AsyncSession, binding_id: str) -> BrowserBinding | None:
    return await session.get(BrowserBinding, binding_id)


async def get_binding_by_site(session: AsyncSession, site: str) -> BrowserBinding | None:
    result = await session.execute(
        select(BrowserBinding).where(BrowserBinding.site == site)
    )
    return result.scalar_one_or_none()


async def create_binding(
    session: AsyncSession, browser_endpoint: str, site: str, notes: str | None = None
) -> BrowserBinding:
    binding = BrowserBinding(browser_endpoint=browser_endpoint, site=site, notes=notes)
    session.add(binding)
    await session.flush()
    await session.refresh(binding)
    return binding


async def create_profile_binding(
    session: AsyncSession,
    profile_id: str,
    site: str,
    browser_endpoint: str,
    mutation_mode: str = "read",
    notes: str | None = None,
) -> ProfileBinding:
    """Create a saved profile binding without storing cookie material."""
    binding = ProfileBinding(
        profile_id=profile_id,
        site=site,
        browser_endpoint=browser_endpoint,
        mutation_mode=mutation_mode,
        notes=notes,
    )
    session.add(binding)
    await session.flush()
    await session.refresh(binding)
    return binding


async def get_profile_binding_by_site(
    session: AsyncSession, site: str
) -> ProfileBinding | None:
    result = await session.execute(
        select(ProfileBinding).where(ProfileBinding.site == site, ProfileBinding.active.is_(True))
    )
    return result.scalar_one_or_none()


async def publish_session_snapshot(
    session: AsyncSession,
    profile_binding_id: str,
    blob_uri: str | None = None,
) -> SessionSnapshot:
    """Publish a new immutable snapshot reference for read-only workers."""
    snapshot = SessionSnapshot(
        profile_binding_id=profile_binding_id,
        snapshot_id=str(uuid.uuid4()),
        blob_uri=blob_uri,
    )
    session.add(snapshot)
    await session.flush()
    await session.refresh(snapshot)
    return snapshot


async def get_latest_session_snapshot(
    session: AsyncSession, profile_binding_id: str
) -> SessionSnapshot | None:
    result = await session.execute(
        select(SessionSnapshot)
        .where(SessionSnapshot.profile_binding_id == profile_binding_id)
        .order_by(SessionSnapshot.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def acquire_profile_lock(
    session: AsyncSession,
    profile_binding_id: str,
    worker_slot_id: str,
    lock_token: str,
) -> ProfileLock | None:
    """Create an exclusive profile lock; uniqueness makes contention safe."""
    lock = ProfileLock(
        profile_binding_id=profile_binding_id,
        worker_slot_id=worker_slot_id,
        lock_token=lock_token,
    )
    session.add(lock)
    try:
        await session.flush()
    except Exception:
        await session.rollback()
        return None
    await session.refresh(lock)
    return lock


async def release_profile_lock(session: AsyncSession, lock_token: str) -> bool:
    result = await session.execute(delete(ProfileLock).where(ProfileLock.lock_token == lock_token))
    return bool(result.rowcount)


async def delete_binding(session: AsyncSession, binding_id: str) -> bool:
    result = await session.execute(
        delete(BrowserBinding).where(BrowserBinding.id == binding_id)
    )
    return result.rowcount > 0
