"""Thin HTTP client for the pinned Graphon compatibility sidecar."""

from __future__ import annotations

from typing import Any

import httpx

from backend.schemas.dify_compat import (
    DifyInspection,
    DifyRuntimeCancelResponse,
    DifyRuntimeEventPage,
    DifyRuntimeRunStart,
)

DIFY_GRAPHON_NAME = "graphon"
DIFY_GRAPHON_VERSION = "0.7.0"
DIFY_GRAPHON_COMMIT = "b187ce7927fea1a7c137b642be3f78e3abb9f7de"
DIFY_GRAPHON_BINDING_ID = "workflow.compat.dify.graphon"
DIFY_GRAPHON_CONTRACT_VERSION = "opencli.graphon.compat.v1"
DIFY_GRAPHON_SOURCE_FORMAT = "dify-app-dsl"


class DifyGraphonUnavailableError(RuntimeError):
    pass


class DifyGraphonRunError(RuntimeError):
    def __init__(self, code: str, message: str, *, blocked: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.blocked = blocked


class DifyGraphonClient:
    def __init__(self, *, base_url: str, timeout_seconds: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def is_healthy(self) -> bool:
        try:
            response = await self._request("GET", "/health")
        except DifyGraphonUnavailableError:
            return False
        if response.status_code != 200:
            return False
        try:
            payload = response.json()
        except ValueError:
            return False
        engine = payload.get("engine") if isinstance(payload, dict) else None
        return (
            payload.get("status") == "ok"
            and payload.get("contractVersion") == DIFY_GRAPHON_CONTRACT_VERSION
            and isinstance(engine, dict)
            and engine.get("name") == DIFY_GRAPHON_NAME
            and engine.get("version") == DIFY_GRAPHON_VERSION
            and engine.get("commit") == DIFY_GRAPHON_COMMIT
        )

    async def inspect(
        self,
        *,
        source_content: str,
        source_sha256: str,
        policy: dict[str, Any],
        grants: dict[str, Any] | None = None,
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
                        "grants": grants or {},
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

    async def start_run(
        self,
        *,
        source_content: str,
        source_sha256: str,
        policy: dict[str, Any],
        inputs: dict[str, Any],
        grants: dict[str, Any],
    ) -> DifyRuntimeRunStart:
        response = await self._request(
            "POST",
            "/v1/dify/runs",
            json={
                "source": {
                    "format": "dify-app-dsl",
                    "sha256": source_sha256,
                    "content": source_content,
                },
                "policy": policy,
                "inputs": inputs,
                "grants": grants,
            },
        )
        if response.status_code >= 400:
            raise _run_error_from_response(response)
        return _validate_runtime_contract(DifyRuntimeRunStart, response)

    async def replay_events(
        self,
        runtime_run_id: str,
        *,
        after_sequence: int,
    ) -> DifyRuntimeEventPage:
        response = await self._request(
            "GET",
            f"/v1/dify/runs/{runtime_run_id}/events",
            params={"afterSequence": after_sequence},
        )
        if response.status_code >= 400:
            raise _run_error_from_response(response)
        page = _validate_runtime_contract(DifyRuntimeEventPage, response)
        if page.runtime_run_id != runtime_run_id:
            raise DifyGraphonUnavailableError(
                "The Graphon compatibility runtime returned an invalid run identity."
            )
        return page

    async def cancel_run(self, runtime_run_id: str) -> DifyRuntimeCancelResponse:
        response = await self._request(
            "POST",
            f"/v1/dify/runs/{runtime_run_id}/cancel",
        )
        if response.status_code >= 400:
            raise _run_error_from_response(response)
        cancelled = _validate_runtime_contract(DifyRuntimeCancelResponse, response)
        if cancelled.runtime_run_id != runtime_run_id:
            raise DifyGraphonUnavailableError(
                "The Graphon compatibility runtime returned an invalid run identity."
            )
        return cancelled

    async def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                return await client.request(method, f"{self.base_url}{path}", **kwargs)
        except (httpx.HTTPError, ValueError) as error:
            raise DifyGraphonUnavailableError(
                "The pinned Graphon compatibility runtime is unavailable."
            ) from error


def _validate_runtime_contract(model_type, response: httpx.Response):
    try:
        return model_type.model_validate(response.json())
    except (ValueError, TypeError) as error:
        raise DifyGraphonUnavailableError(
            "The Graphon compatibility runtime returned an invalid contract."
        ) from error


def _run_error_from_response(response: httpx.Response) -> DifyGraphonRunError:
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    error = payload.get("error") if isinstance(payload, dict) else None
    error = error if isinstance(error, dict) else {}
    details = error.get("details")
    blockers = details.get("blockers") if isinstance(details, dict) else None
    first_blocker = (
        next((item for item in blockers if isinstance(item, dict)), None)
        if isinstance(blockers, list)
        else None
    )
    code = (
        str(first_blocker.get("code"))
        if isinstance(first_blocker, dict) and first_blocker.get("code")
        else str(error.get("code") or "dify_runtime_failed")
    )
    message = (
        str(first_blocker.get("message"))
        if isinstance(first_blocker, dict) and first_blocker.get("message")
        else str(error.get("message") or "The Graphon workflow run failed.")
    )
    return DifyGraphonRunError(
        code,
        message,
        blocked=response.status_code in {409, 429},
    )
