"""Aggregates /api/public/* sub-routers and attaches IP rate limiting.

Mirrors backend/api/v1/__init__.py's aggregation pattern (one prefix-router
per resource, included into a package-level router), but lives in its own
module rather than __init__.py to match GOAL-5.md's PR-E file list
(router.py/items.py/schemas.py/throttle.py).

No auth dependency here — intentional (GOAL-5.md 架构决策 #1: anonymous,
no token, matching AIHOT's model). Do not add one.
"""

from fastapi import APIRouter, Depends

from backend.api.public import items
from backend.api.public.throttle import rate_limit_dependency

public_router = APIRouter(
    prefix="/api/public",
    tags=["public"],
    # Attached once, at the router level, so it covers every route on this
    # router — both routes declared directly on it and ones pulled in via
    # include_router() below (FastAPI's APIRouter.add_api_route always
    # merges self.dependencies for the router add_api_route is ultimately
    # invoked on, regardless of whether the route originated on a
    # sub-router). Future PR-F/PR-G routes added the same way inherit this
    # automatically — do not re-declare rate limiting per-endpoint.
    dependencies=[Depends(rate_limit_dependency)],
)

public_router.include_router(items.router)
