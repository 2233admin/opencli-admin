from datetime import datetime
from typing import Any

from pydantic import BaseModel

from backend.schemas.common import UTCModel


class CollectedRecordRead(UTCModel):
    id: str
    task_id: str
    source_id: str
    workflow_id: str | None
    workflow_run_id: str | None
    raw_data: dict[str, Any]
    normalized_data: dict[str, Any]
    ai_enrichment: dict[str, Any] | None
    content_hash: str
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RecordFilter(BaseModel):
    source_id: str | None = None
    task_id: str | None = None
    status: str | None = None
    page: int = 1
    limit: int = 20
