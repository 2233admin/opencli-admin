"""TurboPush publishing capability metadata for workflow nodes.

TurboPush is a local desktop publishing service. The workflow layer treats it
as a runtime resource: node params carry publishing intent and content, while
accounts, sessions, browser state, and platform settings are resolved through
TurboPush's own local API/MCP bridge.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

TURBOPUSH_BINDING_ID = "turbopush.local.publish"
TURBOPUSH_PROVIDER = "turbopush"
TURBOPUSH_CHANNEL = "turbopush"
TURBOPUSH_MCP_SERVER = "turbo-push"

TURBOPUSH_CONTENT_TYPES = {
    "article": {
        "create_tool": "create_article",
        "publish_tool": "publish_article",
        "publish_path": "/sse/article/{article_id}",
        "publish_type": 1,
    },
    "graph_text": {
        "create_tool": "create_graph_text",
        "publish_tool": "publish_graph_text",
        "publish_path": "/sse/graphText/{article_id}",
        "publish_type": 2,
    },
    "video": {
        "create_tool": "create_video",
        "publish_tool": "publish_video",
        "publish_path": "/sse/video/{article_id}",
        "publish_type": 3,
    },
}

TURBOPUSH_TOOL_FLOW = [
    "list_logged_accounts",
    "get_platform_setting_schema",
    "create_article|create_graph_text|create_video",
    "publish_article|publish_graph_text|publish_video",
    "list_records|get_record_info",
]

TURBOPUSH_PLATFORMS = [
    {
        "platType": "wechat",
        "label": "WeChat Official Account",
        "contentTypes": ["article", "graph_text", "video"],
    },
    {
        "platType": "toutiaohao",
        "label": "Toutiao",
        "contentTypes": ["article", "graph_text", "video"],
    },
    {"platType": "zhihu", "label": "Zhihu", "contentTypes": ["article", "graph_text", "video"]},
    {
        "platType": "baijiahao",
        "label": "Baijiahao",
        "contentTypes": ["article", "graph_text", "video"],
    },
    {"platType": "sina", "label": "Sina Weibo", "contentTypes": ["article", "graph_text", "video"]},
    {
        "platType": "omtencent",
        "label": "Tencent Content Platform",
        "contentTypes": ["article", "video"],
    },
    {"platType": "juejin", "label": "Juejin", "contentTypes": ["article", "graph_text"]},
    {"platType": "bilibili", "label": "Bilibili", "contentTypes": ["article", "video"]},
    {"platType": "acfun", "label": "AcFun", "contentTypes": ["article", "video"]},
    {"platType": "jianshuhao", "label": "Jianshu", "contentTypes": ["article"]},
    {"platType": "xiaohongshu", "label": "Xiaohongshu", "contentTypes": ["graph_text", "video"]},
    {"platType": "douyin", "label": "Douyin", "contentTypes": ["graph_text", "video"]},
    {"platType": "kuaishou", "label": "Kuaishou", "contentTypes": ["graph_text", "video"]},
    {
        "platType": "wechat-video",
        "label": "WeChat Channels",
        "contentTypes": ["graph_text", "video"],
    },
    {"platType": "weishi", "label": "Weishi", "contentTypes": ["video"]},
    {"platType": "csdn", "label": "CSDN", "contentTypes": ["article", "video"]},
    {"platType": "tiktok", "label": "TikTok", "contentTypes": ["video"]},
    {"platType": "youtube", "label": "YouTube", "contentTypes": ["video"]},
    {"platType": "x", "label": "X", "contentTypes": ["graph_text", "video"]},
    {"platType": "pinduoduo", "label": "Pinduoduo", "contentTypes": ["video"]},
]

_SUPPORTED_PLATFORM_TYPES = {platform["platType"] for platform in TURBOPUSH_PLATFORMS}


class TurboPushServiceResource(BaseModel):
    configured: bool
    source: str | None = None
    base_url: str | None = None
    auth_present: bool = False
    missing: list[str] = Field(default_factory=list)
    message: str


class TurboPushServiceCredentials(BaseModel):
    configured: bool
    source: str | None = None
    base_url: str | None = None
    auth_token: str | None = None
    missing: list[str] = Field(default_factory=list)
    message: str


def resolve_turbopush_service_resource() -> TurboPushServiceResource:
    """Detect the local TurboPush service resource without exposing secrets."""

    env_port = _read_string(os.getenv("TURBO_PUSH_PORT"))
    env_auth = _read_string(os.getenv("TURBO_PUSH_AUTH"))
    if env_port and env_auth:
        return TurboPushServiceResource(
            configured=True,
            source="env",
            base_url=f"http://127.0.0.1:{env_port}",
            auth_present=True,
            message="TurboPush service detected from environment.",
        )

    config_path = _mcp_config_path()
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return TurboPushServiceResource(
            configured=False,
            missing=["TURBO_PUSH_PORT", "TURBO_PUSH_AUTH", str(config_path)],
            message=(
                "TurboPush local service is not configured. Start the TurboPush "
                "desktop app so it writes mcp.json or exports runtime env vars; "
                "do not put cookie/profile/worker details on the workflow node."
            ),
        )

    port = _read_string(data.get("port"))
    auth = _read_string(data.get("auth"))
    if not port or not auth:
        return TurboPushServiceResource(
            configured=False,
            source=str(config_path),
            missing=["port", "auth"],
            message="TurboPush mcp.json exists but does not contain port and auth.",
        )

    return TurboPushServiceResource(
        configured=True,
        source=str(config_path),
        base_url=f"http://127.0.0.1:{port}",
        auth_present=True,
        message="TurboPush service detected from mcp.json.",
    )


def resolve_turbopush_service_credentials() -> TurboPushServiceCredentials:
    """Resolve the local TurboPush API endpoint and auth token for runtime use."""

    env_port = _read_string(os.getenv("TURBO_PUSH_PORT"))
    env_auth = _read_string(os.getenv("TURBO_PUSH_AUTH"))
    if env_port and env_auth:
        return TurboPushServiceCredentials(
            configured=True,
            source="env",
            base_url=f"http://127.0.0.1:{env_port}",
            auth_token=env_auth,
            message="TurboPush service detected from environment.",
        )

    config_path = _mcp_config_path()
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return TurboPushServiceCredentials(
            configured=False,
            missing=["TURBO_PUSH_PORT", "TURBO_PUSH_AUTH", str(config_path)],
            message=(
                "TurboPush local service is not configured. Start the TurboPush "
                "desktop app so it writes mcp.json or exports runtime env vars."
            ),
        )

    port = _read_string(data.get("port"))
    auth = _read_string(data.get("auth"))
    if not port or not auth:
        return TurboPushServiceCredentials(
            configured=False,
            source=str(config_path),
            missing=["port", "auth"],
            message="TurboPush mcp.json exists but does not contain port and auth.",
        )

    return TurboPushServiceCredentials(
        configured=True,
        source=str(config_path),
        base_url=f"http://127.0.0.1:{port}",
        auth_token=auth,
        message="TurboPush service detected from mcp.json.",
    )


def normalize_turbopush_content_type(value: Any) -> str | None:
    content_type = _read_string(value) or "article"
    return content_type if content_type in TURBOPUSH_CONTENT_TYPES else None


def turbopush_target_platforms(params: dict[str, Any]) -> list[str]:
    raw = params.get("targetPlatforms", params.get("target_platforms"))
    values: list[str] = []
    if isinstance(raw, str):
        values = [part.strip() for part in raw.split(",")]
    elif isinstance(raw, list):
        values = [item.strip() for item in raw if isinstance(item, str)]
    return [value for value in values if value in _SUPPORTED_PLATFORM_TYPES]


def turbopush_binding_input(params: dict[str, Any]) -> dict[str, Any]:
    content_type = normalize_turbopush_content_type(params.get("contentType"))
    assert content_type is not None
    content_meta = TURBOPUSH_CONTENT_TYPES[content_type]
    target_platforms = turbopush_target_platforms(params)
    account_selector = _read_string(params.get("accountSelector")) or "logged_accounts_by_platform"
    content_source = _read_string(params.get("contentSource")) or "upstream"

    return {
        "contentType": content_type,
        "contentSource": content_source,
        "articleId": params.get("articleId"),
        "title": params.get("title"),
        "markdown": params.get("markdown"),
        "desc": params.get("desc"),
        "files": params.get("files") if isinstance(params.get("files"), list) else [],
        "thumb": params.get("thumb") if isinstance(params.get("thumb"), list) else [],
        "platformSettings": (
            params.get("platformSettings")
            if isinstance(params.get("platformSettings"), dict)
            else {}
        ),
        "targetPlatforms": target_platforms,
        "accountSelector": account_selector,
        "syncDraft": bool(params.get("syncDraft", False)),
        "publish": {
            "createTool": content_meta["create_tool"],
            "publishTool": content_meta["publish_tool"],
            "publishPathTemplate": content_meta["publish_path"],
            "toolFlow": TURBOPUSH_TOOL_FLOW,
        },
    }


def turbopush_platform_projection() -> list[dict[str, Any]]:
    return [dict(platform) for platform in TURBOPUSH_PLATFORMS]


def _mcp_config_path() -> Path:
    override = _read_string(os.getenv("TURBO_PUSH_MCP_CONFIG"))
    if override:
        return Path(override).expanduser()
    return Path.home() / ".TurboPush" / "mcp.json"


def _read_string(value: Any) -> str | None:
    if isinstance(value, int):
        return str(value)
    return value.strip() if isinstance(value, str) and value.strip() else None
