"""Preset endpoint (Plan IR issue 06): read-only, grouped-by-channel-type
list of one-click node presets for the Collection Canvas palette (stories
4, 26). Every preset is derived fresh from adapter metadata on each call —
see ``backend.plan_ir.presets`` for how (no DB table, no persistence).
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.notification import NotificationRule
from backend.plan_ir.presets import Preset, list_presets_grouped
from backend.schemas.common import ApiResponse
from backend.schemas.schedule import CronScheduleCreate
from backend.schemas.source import DataSourceCreate
from backend.services import schedule_service, source_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/presets", tags=["presets"])

OPINION_MONITOR_PROMPT = (
    "你是舆情监控助手。分析下面采集记录，只返回 JSON 对象："
    '{"summary":"一句话摘要","tags":["关键词"],"sentiment":"positive|neutral|negative",'
    '"category":"类别"}。\n'
    "标题: {{title}}\n内容: {{content}}{{text}}{{description}}\n链接: {{url}}"
)


class OpinionMonitorAccountSlot(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    site: str = Field("aibase", min_length=1, max_length=80)
    command: str = Field("news", min_length=1, max_length=80)
    limit: int = Field(5, ge=1, le=100)
    cron_expression: str = Field("*/30 * * * *", description="5-field cron expression")
    timezone: str = "Asia/Shanghai"


def _default_opinion_slots() -> list[OpinionMonitorAccountSlot]:
    return [
        OpinionMonitorAccountSlot(label="aibase-account-a"),
        OpinionMonitorAccountSlot(label="aibase-account-b"),
    ]


class OpinionMonitorApplyRequest(BaseModel):
    source_prefix: str = Field("舆情监控", min_length=1, max_length=120)
    account_slots: list[OpinionMonitorAccountSlot] = Field(
        default_factory=_default_opinion_slots
    )
    source_enabled: bool = True
    create_schedules: bool = True
    schedule_enabled: bool = True
    feishu_webhook_url: str | None = None
    feishu_secret: str | None = None
    notification_enabled: bool = True
    notification_name: str = Field("舆情监控飞书推送", min_length=1, max_length=255)


def _opinion_source_payload(
    body: OpinionMonitorApplyRequest,
    slot: OpinionMonitorAccountSlot,
) -> dict[str, Any]:
    return {
        "name": f"{body.source_prefix} · {slot.label}",
        "description": "Opinion monitoring quickstart source generated from presets.",
        "channel_type": "opencli",
        "channel_config": {
            "site": slot.site,
            "command": slot.command,
            "format": "json",
            "args": {"limit": slot.limit},
            "account_label": slot.label,
            "resource_policy": {
                "site_binding": slot.site,
                "account_label": slot.label,
                "routing": "site_binding_agent_first",
            },
        },
        "ai_config": {
            "processor_type": "openai",
            "prompt_template": OPINION_MONITOR_PROMPT,
            "json_mode": True,
        },
        "enabled": body.source_enabled,
        "tags": ["opinion-monitor", slot.site, slot.label],
    }


def _opinion_bundle_preview(body: OpinionMonitorApplyRequest) -> dict[str, Any]:
    feishu_configured = bool(body.feishu_webhook_url)
    return {
        "id": "opinion-monitor.visual-feed.v1",
        "label": "可视化舆情监控",
        "description": "多账号 OpenCLI 采集 + AI 摘要打标 + 飞书推送 + 监控台投影",
        "source_count": len(body.account_slots),
        "sources": [_opinion_source_payload(body, slot) for slot in body.account_slots],
        "schedules": [
            {
                "name": f"{body.source_prefix} · {slot.label} · 定时采集",
                "cron_expression": slot.cron_expression,
                "timezone": slot.timezone,
                "parameters": {"limit": slot.limit},
                "enabled": body.schedule_enabled,
            }
            for slot in body.account_slots
        ],
        "notification": {
            "name": body.notification_name,
            "notifier_type": "feishu",
            "trigger_event": "on_new_record",
            "enabled": body.notification_enabled and feishu_configured,
            "requires_config": not feishu_configured,
            "template_fields": ["title", "url", "summary", "tags", "sentiment"],
        },
        "visualization": {
            "dashboard": "/dashboard",
            "api": "/api/v1/dashboard/opinion-monitor",
        },
    }


@router.get("", response_model=ApiResponse[dict[str, list[Preset]]])
async def get_presets() -> ApiResponse:
    """Presets grouped by ``channel_type`` (== node type minus the
    ``_source`` suffix). Pure read: nothing here creates or persists
    anything, so this is safe to poll from the palette on every canvas
    open."""
    grouped = await list_presets_grouped()
    return ApiResponse.ok(grouped)


@router.get("/opinion-monitor", response_model=ApiResponse[dict])
async def get_opinion_monitor_preset() -> ApiResponse:
    """Read-only preview of the practical opinion-monitor quickstart bundle."""
    return ApiResponse.ok(_opinion_bundle_preview(OpinionMonitorApplyRequest()))


@router.post("/opinion-monitor/apply", response_model=ApiResponse[dict], status_code=201)
async def apply_opinion_monitor_preset(
    body: OpinionMonitorApplyRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    """Create sources, schedules, and a Feishu rule for the opinion monitor."""
    created_sources = []
    created_schedules = []
    warnings = []

    for slot in body.account_slots:
        if body.create_schedules and not schedule_service.validate_cron_expression(
            slot.cron_expression
        ):
            warnings.append(
                {
                    "slot": slot.label,
                    "warning": "invalid_cron_expression",
                    "cron_expression": slot.cron_expression,
                }
            )
            continue

        source_data = DataSourceCreate(**_opinion_source_payload(body, slot))
        source = await source_service.create_source(db, source_data)
        created_sources.append(
            {
                "id": source.id,
                "name": source.name,
                "site": slot.site,
                "command": slot.command,
                "account_label": slot.label,
            }
        )

        if body.create_schedules:
            schedule = await schedule_service.create_schedule(
                db,
                CronScheduleCreate(
                    source_id=source.id,
                    name=f"{source.name} · 定时采集",
                    cron_expression=slot.cron_expression,
                    timezone=slot.timezone,
                    parameters={"limit": slot.limit},
                    enabled=body.schedule_enabled,
                ),
            )
            created_schedules.append(
                {
                    "id": schedule.id,
                    "source_id": source.id,
                    "cron_expression": schedule.cron_expression,
                    "timezone": schedule.timezone,
                    "enabled": schedule.enabled,
                }
            )

    feishu_configured = bool(body.feishu_webhook_url)
    if not feishu_configured:
        warnings.append(
            {
                "warning": "feishu_webhook_url_missing",
                "detail": "Feishu rule is created disabled until webhook_url is configured.",
            }
        )

    rule = NotificationRule(
        name=body.notification_name,
        source_id=None,
        trigger_event="on_new_record",
        notifier_type="feishu",
        notifier_config={
            "webhook_url": body.feishu_webhook_url or "",
            "secret": body.feishu_secret or "",
            "title": "【舆情】{{title}}",
            "content": (
                "**摘要**：{{summary}}\n"
                "**标签**：{{tags}}\n"
                "**情绪**：{{sentiment}}\n"
                "**链接**：{{url}}"
            ),
        },
        enabled=body.notification_enabled and feishu_configured,
    )
    db.add(rule)
    await db.flush()
    await db.refresh(rule)

    return ApiResponse.ok(
        {
            "preset_id": "opinion-monitor.visual-feed.v1",
            "sources": created_sources,
            "schedules": created_schedules,
            "notification_rule": {
                "id": rule.id,
                "name": rule.name,
                "enabled": rule.enabled,
                "requires_config": not feishu_configured,
            },
            "warnings": warnings,
            "next": {
                "bind_site_to_ws_agent": "/api/v1/browsers/bindings",
                "trigger": "/api/v1/tasks/trigger",
                "monitor": "/api/v1/dashboard/opinion-monitor",
            },
        }
    )
