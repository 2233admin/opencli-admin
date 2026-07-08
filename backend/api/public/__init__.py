"""Public, unauthenticated REST API package (PR-E, GOAL-5.md).

Mounted in backend/main.py alongside (not nested under) /api/v1/*. See
router.py for the rate-limiting wiring and items.py for the /items endpoint.
"""

from backend.api.public.router import public_router

__all__ = ["public_router"]
