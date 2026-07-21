"""Thin HTTP client for the pinned Graphon compatibility sidecar."""

from __future__ import annotations

from typing import Any

import httpx

from backend.schemas.dify_compat import DifyInspection

DIFY_GRAPHON_NAME = "graphon"
DIFY_GRAPHON_VERSION = "0.7.0"
DIFY_GRAPHON_COMMIT = "b187ce7927fea1a7c137b642be3f78e3abb9f7de"
DIFY_GRAPHON_BINDING_ID = "workflow.compat.dify.graphon"


class DifyGraphonUnavailableError(RuntimeError):
    pass


class DifyGraphonClient:
    def __init__(self, *, base_url: str, timeout_seconds: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def inspect(
        self,
        *,
        source_content: str,
        source_sha256: str,
        policy: dict[str, Any],
    ) -> DifyInspection:
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    f"{self.base_url}/v1/dify/inspect",
                    json={
                        "source": {
                            "format": "dify-app-dsl",
                            "sha256": source_sha256,
                            "content": source_content,
                        },
                        "policy": policy,
                    },
                )
                response.raise_for_status()
        except (httpx.HTTPError, ValueError) as error:
            raise DifyGraphonUnavailableError(
                "The pinned Graphon compatibility runtime is unavailable."
            ) from error

        try:
            inspection = DifyInspection.model_validate(response.json())
        except (ValueError, TypeError) as error:
            raise DifyGraphonUnavailableError(
                "The Graphon compatibility runtime returned an invalid contract."
            ) from error
        if (
            inspection.engine.name != DIFY_GRAPHON_NAME
            or inspection.engine.version != DIFY_GRAPHON_VERSION
            or inspection.engine.commit != DIFY_GRAPHON_COMMIT
        ):
            raise DifyGraphonUnavailableError(
                "The Graphon compatibility runtime does not match the pinned engine."
            )
        return inspection
