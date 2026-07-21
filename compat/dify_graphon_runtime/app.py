from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from contracts import (
    CONTRACT_VERSION,
    InspectRequest,
    RunRequest,
    RuntimeContractError,
)
from engine import GraphonRuntime


def create_app(runtime: GraphonRuntime | None = None) -> FastAPI:
    graphon_runtime = runtime or GraphonRuntime()
    application = FastAPI(
        title="OpenCLI Dify Graphon Runtime",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
    )

    @application.exception_handler(RuntimeContractError)
    async def handle_contract_error(
        _request: Request,
        error: RuntimeContractError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "details": error.details,
                }
            },
        )

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        issues = [
            {
                "path": "/".join(str(part) for part in issue["loc"]),
                "type": issue["type"],
            }
            for issue in error.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "request.invalid",
                    "message": "The request does not match the runtime contract.",
                    "details": {"issues": issues},
                }
            },
        )

    @application.exception_handler(Exception)
    async def handle_unexpected_error(
        _request: Request,
        _error: Exception,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "runtime.internal_error",
                    "message": "The compatibility runtime failed unexpectedly.",
                    "details": {},
                }
            },
        )

    @application.get("/health")
    async def health() -> JSONResponse:
        payload: dict[str, Any] = {
            "status": "ok" if graphon_runtime.healthy else "unhealthy",
            "contractVersion": CONTRACT_VERSION,
            "engine": graphon_runtime.identity.as_dict(),
            "helpers": getattr(graphon_runtime, "helpers", {}),
        }
        if graphon_runtime.health_reason:
            payload["reason"] = graphon_runtime.health_reason
        return JSONResponse(
            status_code=200 if graphon_runtime.healthy else 503,
            content=payload,
        )

    @application.post("/v1/dify/inspect")
    async def inspect(request: InspectRequest) -> dict[str, Any]:
        return graphon_runtime.inspect(request)

    @application.post("/v1/dify/runs", status_code=202)
    async def start_run(request: RunRequest) -> dict[str, Any]:
        return graphon_runtime.start_run(request)

    @application.get("/v1/dify/runs/{runtime_run_id}/events")
    async def replay_events(
        runtime_run_id: str,
        after_sequence: int = Query(default=0, alias="afterSequence", ge=0),
    ) -> dict[str, Any]:
        return graphon_runtime.replay_events(
            runtime_run_id,
            after_sequence=after_sequence,
        )

    @application.post("/v1/dify/runs/{runtime_run_id}/cancel")
    async def cancel_run(runtime_run_id: str) -> dict[str, Any]:
        return graphon_runtime.cancel_run(runtime_run_id)

    return application


app = create_app()
