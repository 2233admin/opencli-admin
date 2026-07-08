"""Resolve TurboPush logged accounts into publish postAccounts payloads."""

from __future__ import annotations

from typing import Any

from backend.workflow.turbopush_errors import TurboPushPublishError
from backend.workflow.turbopush_runtime import TURBOPUSH_PLATFORMS


def resolve_turbopush_post_accounts(
    client: Any,
    content_type: str,
    binding_input: dict[str, Any],
) -> list[dict[str, Any]]:
    raw_accounts = _extract_list(client.get("/account/logged?simple=true"))
    if not raw_accounts:
        raise TurboPushPublishError(
            "missing_turbopush_logged_accounts",
            "TurboPush has no logged-in accounts available for publishing.",
            status="blocked",
        )

    account_selector = _read_string(binding_input.get("accountSelector"))
    target_platforms = (
        set()
        if account_selector == "all_logged"
        else set(_read_string_list(binding_input.get("targetPlatforms")))
    )
    platform_settings = (
        binding_input.get("platformSettings")
        if isinstance(binding_input.get("platformSettings"), dict)
        else {}
    )
    post_accounts: list[dict[str, Any]] = []
    for account in raw_accounts:
        if not isinstance(account, dict):
            continue
        plat_type = _account_platform(account)
        if plat_type is None:
            continue
        if target_platforms and plat_type not in target_platforms:
            continue
        if not _platform_supports_content_type(plat_type, content_type):
            continue

        account_id = _account_id(account)
        if account_id is None:
            continue

        settings = _account_settings(account)
        override = platform_settings.get(plat_type)
        if isinstance(override, dict):
            settings.update(override)
        _apply_platform_setting_defaults(settings, plat_type, content_type)
        missing = _missing_required_platform_settings(settings, plat_type, content_type)
        if missing:
            raise TurboPushPublishError(
                "missing_turbopush_platform_settings",
                (
                    f"TurboPush platform {plat_type} requires settings: "
                    f"{', '.join(missing)}."
                ),
                details={"platType": plat_type, "missing": missing},
                status="blocked",
            )

        post_accounts.append(
            {
                "id": account_id,
                "platName": _account_platform_name(account, plat_type),
                "settings": settings,
            }
        )

    if not post_accounts:
        raise TurboPushPublishError(
            "missing_turbopush_target_accounts",
            "No logged TurboPush accounts matched the target platforms.",
            details={"targetPlatforms": sorted(target_platforms)},
            status="blocked",
        )
    return post_accounts


def _apply_platform_setting_defaults(
    settings: dict[str, Any], plat_type: str, content_type: str
) -> None:
    settings["platType"] = plat_type
    defaults = _PLATFORM_SETTING_DEFAULTS.get((plat_type, content_type), {})
    defaults = {**_PLATFORM_SETTING_DEFAULTS.get((plat_type, "*"), {}), **defaults}
    for key, value in defaults.items():
        settings.setdefault(key, value)


def _missing_required_platform_settings(
    settings: dict[str, Any], plat_type: str, content_type: str
) -> list[str]:
    required = _PLATFORM_REQUIRED_SETTINGS.get((plat_type, content_type), [])
    required = [*_PLATFORM_REQUIRED_SETTINGS.get((plat_type, "*"), []), *required]
    return [field for field in required if field not in settings]


_PLATFORM_SETTING_DEFAULTS: dict[tuple[str, str], dict[str, Any]] = {
    ("xiaohongshu", "*"): {"origin": False, "source": 0, "lookScope": 0},
    ("douyin", "*"): {"allowSave": True, "lookScope": 0},
    ("kuaishou", "*"): {
        "source": 0,
        "sameFrame": True,
        "download": True,
        "sameCity": True,
        "lookScope": 0,
    },
    ("wechat", "*"): {
        "leave": True,
        "origin": True,
        "reprint": True,
        "publishType": "mass",
        "source": 0,
    },
    ("wechat-video", "*"): {"location": "auto", "linkType": 0, "origin": False},
    ("bilibili", "article"): {"byAI": False, "origin": False, "public": True},
    ("acfun", "*"): {"origin": True},
    ("baijiahao", "*"): {"source": 0},
    ("zhihu", "*"): {"source": 0},
    ("sina", "*"): {"source": 0},
    ("jianshuhao", "*"): {"vetoReprint": False},
    ("csdn", "article"): {"artType": 0, "backupGitCode": False, "lookScope": 0},
    ("csdn", "video"): {"recommend": False},
    ("tiktok", "video"): {
        "lookScope": 0,
        "comment": True,
        "creation": True,
        "reveal": False,
        "yourBrand": False,
        "brandContent": False,
        "aigc": False,
    },
    ("youtube", "video"): {
        "categoryId": "22",
        "defaultLanguage": "zh",
        "embeddable": True,
        "license": "youtube",
        "privacyStatus": "private",
        "publicStatsViewable": True,
        "selfDeclaredMadeForKids": False,
        "containsSyntheticMedia": False,
    },
    ("pinduoduo", "video"): {"source": 0},
}

_PLATFORM_REQUIRED_SETTINGS: dict[tuple[str, str], list[str]] = {
    ("douyin", "*"): ["source"],
    ("acfun", "*"): ["classify"],
    ("juejin", "article"): ["tag"],
    ("csdn", "article"): ["labels"],
    ("csdn", "video"): ["labels"],
    ("bilibili", "video"): ["partition"],
    ("omtencent", "video"): ["classify"],
}


def _platform_supports_content_type(plat_type: str, content_type: str) -> bool:
    for platform in TURBOPUSH_PLATFORMS:
        if platform["platType"] == plat_type:
            return content_type in platform["contentTypes"]
    return True


def _extract_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("list", "accounts", "data", "items"):
            nested = value.get(key)
            if isinstance(nested, list):
                return nested
    return []


def _account_id(account: dict[str, Any]) -> int | str | None:
    for key in ("id", "aid", "accountId", "account_id"):
        value = account.get(key)
        if isinstance(value, int | str) and str(value).strip():
            return value
    return None


def _account_platform(account: dict[str, Any]) -> str | None:
    for key in ("platType", "plat_type", "platform", "type", "platName", "platformName"):
        value = _normalize_platform_value(_read_string(account.get(key)))
        if value:
            return value
    settings = account.get("settings")
    if isinstance(settings, dict):
        value = _normalize_platform_value(_read_string(settings.get("platType")))
        if value:
            return value
    platform = account.get("platform")
    if isinstance(platform, dict):
        for key in ("platType", "type", "name", "label"):
            value = _normalize_platform_value(_read_string(platform.get(key)))
            if value:
                return value
    return None


def _account_platform_name(account: dict[str, Any], plat_type: str) -> str:
    return (
        _read_string(account.get("platName"))
        or _read_string(account.get("platformName"))
        or _read_string(account.get("name"))
        or _read_string(account.get("nickname"))
        or plat_type
    )


def _account_settings(account: dict[str, Any]) -> dict[str, Any]:
    for key in ("settings", "setting", "config"):
        value = account.get(key)
        if isinstance(value, dict):
            return dict(value)
    return {}


def _read_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


_PLATFORM_ALIASES = {
    "微信": "wechat",
    "微信公众号": "wechat",
    "视频号": "wechat-video",
    "微信视频号": "wechat-video",
    "头条": "toutiaohao",
    "今日头条": "toutiaohao",
    "头条号": "toutiaohao",
    "知乎": "zhihu",
    "百家号": "baijiahao",
    "微博": "sina",
    "新浪微博": "sina",
    "企鹅号": "omtencent",
    "腾讯内容开放平台": "omtencent",
    "掘金": "juejin",
    "哔哩哔哩": "bilibili",
    "b站": "bilibili",
    "acfun": "acfun",
    "a站": "acfun",
    "简书": "jianshuhao",
    "小红书": "xiaohongshu",
    "抖音": "douyin",
    "快手": "kuaishou",
    "微视": "weishi",
    "csdn": "csdn",
    "tiktok": "tiktok",
    "youtube": "youtube",
    "x": "x",
    "twitter": "x",
    "拼多多": "pinduoduo",
}


def _normalize_platform_value(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    supported = {
        str(platform["platType"]).lower(): str(platform["platType"])
        for platform in TURBOPUSH_PLATFORMS
    }
    if normalized in supported:
        return supported[normalized]
    return _PLATFORM_ALIASES.get(normalized) or _PLATFORM_ALIASES.get(value.strip())


def _read_string(value: Any) -> str | None:
    if isinstance(value, int):
        return str(value)
    return value.strip() if isinstance(value, str) and value.strip() else None
