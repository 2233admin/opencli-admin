"""Preset endpoint (Plan IR issue 06): read-only, grouped-by-channel-type
list of one-click node presets for the Collection Canvas palette (stories
4, 26). Every preset is derived fresh from adapter metadata on each call —
see ``backend.plan_ir.presets`` for how (no DB table, no persistence).
"""

import logging

from fastapi import APIRouter

from backend.plan_ir.presets import Preset, list_presets_grouped
from backend.schemas.common import ApiResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/presets", tags=["presets"])


@router.get("", response_model=ApiResponse[dict[str, list[Preset]]])
async def get_presets() -> ApiResponse:
    """Presets grouped by ``channel_type`` (== node type minus the
    ``_source`` suffix). Pure read: nothing here creates or persists
    anything, so this is safe to poll from the palette on every canvas
    open."""
    grouped = await list_presets_grouped()
    return ApiResponse.ok(grouped)
