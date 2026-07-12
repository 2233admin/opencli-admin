from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.workspace_settings import WorkspaceSettings
from backend.schemas.workspace_settings import SettingsPatch, SettingsRead, SettingsValues

SCOPE = "global"
DEFAULTS = SettingsValues()
NEXT_RUN_FIELDS = {"default_concurrency", "automatic_retries", "retain_raw_data", "retention_days"}


async def _get_row(db: AsyncSession) -> WorkspaceSettings | None:
    result = await db.execute(select(WorkspaceSettings).where(WorkspaceSettings.scope == SCOPE))
    return result.scalar_one_or_none()


def _response(row: WorkspaceSettings | None) -> SettingsRead:
    overrides = row.overrides if row else {}
    values = DEFAULTS.model_copy(update=overrides)
    sources = {
        field: "override" if field in overrides else "default"
        for field in SettingsValues.model_fields
    }
    apply_modes = {
        field: "next_run" if field in NEXT_RUN_FIELDS else "immediate"
        for field in SettingsValues.model_fields
    }
    return SettingsRead(
        values=values,
        sources=sources,
        apply_modes=apply_modes,
        revision=row.revision if row else 0,
        updated_at=row.updated_at if row else None,
    )


async def get_settings(db: AsyncSession) -> SettingsRead:
    return _response(await _get_row(db))


async def update_settings(db: AsyncSession, patch: SettingsPatch) -> SettingsRead:
    row = await _get_row(db)
    changes = patch.model_dump(exclude_unset=True, exclude_none=True)
    if row is None:
        row = WorkspaceSettings(scope=SCOPE, overrides=changes, revision=1)
        db.add(row)
    else:
        row.overrides = {**row.overrides, **changes}
        row.revision += 1
    await db.commit()
    await db.refresh(row)
    return _response(row)


async def reset_settings(db: AsyncSession) -> SettingsRead:
    row = await _get_row(db)
    if row is not None:
        row.overrides = {}
        row.revision += 1
        await db.commit()
        await db.refresh(row)
    return _response(row)
