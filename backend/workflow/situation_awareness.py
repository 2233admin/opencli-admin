"""Deterministic recent-window research and situation-awareness analysis.

The module is intentionally independent from collection. Workflow source nodes
produce items; this executor turns those items into a traceable research brief.
That keeps the same analysis usable with OpenCLI, imported files, or another
future collector without coupling the research logic to a browser session.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dateutil import parser as date_parser

from backend.workflow.last30days_provider import (
    Last30DaysProviderError,
    execute_last30days_research,
)

SITUATION_AWARENESS_EXECUTOR = "situation_awareness"
SITUATION_AWARENESS_TOOL_CAPABILITY_ID = "tool.intelligence.situation-awareness"

_DATE_KEYS = (
    "published_at",
    "publishedAt",
    "create_time",
    "createTime",
    "created_at",
    "createdAt",
    "timestamp",
    "date",
    "time",
)
_TRACKING_QUERY_KEYS = {
    "share_source",
    "share_token",
    "source",
    "spm_id_from",
    "timestamp",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
    "xsec_source",
    "xsec_token",
}
_ENGAGEMENT_WEIGHTS = {
    "like_count": 1.0,
    "likes": 1.0,
    "digg_count": 1.0,
    "favorite_count": 1.5,
    "collect_count": 1.5,
    "comment_count": 2.0,
    "comments": 2.0,
    "share_count": 3.0,
    "shares": 3.0,
    "repost_count": 3.0,
    "view_count": 0.01,
    "views": 0.01,
    "play_count": 0.01,
}


def execute_situation_awareness(
    input_items: list[dict[str, Any]],
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a bounded recent-window research report from workflow items."""

    config = params or {}
    provider = (_read_string(config.get("provider")) or "opencli-native").lower()
    if provider == "last30days":
        return execute_last30days_research(config)
    if provider != "opencli-native":
        raise Last30DaysProviderError(
            f'Unsupported situation-awareness provider "{provider}"'
        )
    now = _parse_datetime(config.get("now")) or datetime.now(tz=UTC)
    window_days = _bounded_int(config.get("windowDays"), default=30, minimum=1, maximum=365)
    baseline_days = _bounded_int(
        config.get("baselineDays"), default=window_days, minimum=1, maximum=365
    )
    include_unknown = config.get("includeUnknownDates", False) is True
    query = _read_string(config.get("query")) or _read_string(config.get("topic")) or ""
    top_k = _bounded_int(config.get("topK"), default=10, minimum=1, maximum=50)

    recent_start = now - timedelta(days=window_days)
    baseline_start = recent_start - timedelta(days=baseline_days)
    classified: list[dict[str, Any]] = []
    for position, wrapped in enumerate(input_items):
        item = _unwrap_item(wrapped)
        observed_at = _item_datetime(item)
        freshness = _freshness_bucket(
            observed_at,
            now=now,
            recent_start=recent_start,
            baseline_start=baseline_start,
        )
        classified.append(
            {
                **item,
                "_position": position,
                "_publishedAt": observed_at.isoformat() if observed_at else None,
                "_freshness": freshness,
                "_platform": _platform(item),
                "_canonicalUrl": _canonical_url(_read_string(item.get("url")) or ""),
                "_engagementScore": round(_engagement_score(item), 2),
            }
        )

    included = [
        item
        for item in classified
        if item["_freshness"] == "recent"
        or (include_unknown and item["_freshness"] == "unknown")
    ]
    recent = _dedupe(included)
    baseline = _dedupe([item for item in classified if item["_freshness"] == "baseline"])
    topics = _topic_rows(recent, query=query, top_k=top_k)
    platforms = _platform_rows(recent)
    signals = _signals(
        recent,
        baseline,
        now=now,
        window_days=window_days,
        baseline_days=baseline_days,
        platforms=platforms,
    )
    top_items = sorted(
        recent,
        key=_ranked_item_key,
    )[:top_k]
    counts = Counter(item["_freshness"] for item in classified)
    report = {
        "schema": "situation.report.v1",
        "source": "opencli-admin",
        "eventType": "situation.awareness.completed",
        "status": "completed",
        "query": query,
        "window": {
            "days": window_days,
            "start": recent_start.isoformat(),
            "end": now.isoformat(),
            "baselineDays": baseline_days,
            "includeUnknownDates": include_unknown,
        },
        "counts": {
            "input": len(input_items),
            "recent": counts["recent"],
            "unknownDate": counts["unknown"],
            "baseline": counts["baseline"],
            "older": counts["older"],
            "future": counts["future"],
            "includedAfterDedupe": len(recent),
            "duplicatesRemoved": len(included) - len(recent),
        },
        "platforms": platforms,
        "topics": topics,
        "signals": signals,
        "topItems": [_public_item(item) for item in top_items],
        "dataQuality": _data_quality(classified, platforms),
        "generatedAt": now.isoformat(),
    }
    report["brief"] = _markdown_brief(report)
    return report


def _unwrap_item(wrapped: dict[str, Any]) -> dict[str, Any]:
    normalized = wrapped.get("normalizedData")
    raw = wrapped.get("raw")
    if isinstance(normalized, dict):
        merged = dict(normalized)
        if isinstance(raw, dict):
            for key, value in raw.items():
                if key not in merged and f"extra_{key}" not in merged:
                    merged[key] = value
        return merged
    if isinstance(raw, dict):
        return dict(raw)
    return dict(wrapped)


def _item_datetime(item: dict[str, Any]) -> datetime | None:
    for key in _DATE_KEYS:
        if key in item and item[key] not in (None, ""):
            parsed = _parse_datetime(item[key])
            if parsed:
                return parsed
        extra_key = f"extra_{key}"
        if extra_key in item and item[extra_key] not in (None, ""):
            parsed = _parse_datetime(item[extra_key])
            if parsed:
                return parsed
    return None


def _parse_datetime(value: object) -> datetime | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        seconds = float(value)
        if seconds > 10_000_000_000:
            seconds /= 1000
        try:
            return datetime.fromtimestamp(seconds, tz=UTC)
        except (OSError, OverflowError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if re.fullmatch(r"\d{10,13}", text):
        return _parse_datetime(int(text))
    try:
        parsed = date_parser.parse(text)
    except (OverflowError, TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _freshness_bucket(
    observed_at: datetime | None,
    *,
    now: datetime,
    recent_start: datetime,
    baseline_start: datetime,
) -> str:
    if observed_at is None:
        return "unknown"
    if observed_at > now + timedelta(minutes=5):
        return "future"
    if observed_at >= recent_start:
        return "recent"
    if observed_at >= baseline_start:
        return "baseline"
    return "older"


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    winners: dict[str, dict[str, Any]] = {}
    for item in items:
        identity = _item_identity(item)
        current = winners.get(identity)
        item_score = float(item["_engagementScore"])
        current_score = float(current["_engagementScore"]) if current else -1
        if (
            current is None
            or item_score > current_score
            or (
                item_score == current_score
                and _stable_item_key(item) < _stable_item_key(current)
            )
        ):
            winners[identity] = item
    return list(winners.values())


def _item_identity(item: dict[str, Any]) -> str:
    url = _read_string(item.get("_canonicalUrl"))
    if url:
        return f"url:{url}"
    title = _read_string(item.get("title")) or ""
    content = _read_string(item.get("content")) or _read_string(item.get("text")) or ""
    platform = _read_string(item.get("_platform")) or "unknown"
    digest = hashlib.sha256(f"{platform}|{title}|{content}".encode()).hexdigest()
    return f"content:{digest}"


def _ranked_item_key(item: dict[str, Any]) -> tuple[float, int, float, str]:
    """Preserve score/date priority with a canonical final tie-breaker."""

    published_at = _parse_datetime(item.get("_publishedAt"))
    return (
        -float(item.get("_engagementScore") or 0),
        0 if published_at is not None else 1,
        -(published_at.timestamp() if published_at is not None else 0),
        _stable_item_key(item),
    )


def _stable_item_key(item: dict[str, Any]) -> str:
    public_identity = {
        "author": _read_string(item.get("author")) or "",
        "canonicalUrl": _read_string(item.get("_canonicalUrl")) or "",
        "content": _read_string(item.get("content"))
        or _read_string(item.get("text"))
        or "",
        "platform": _read_string(item.get("_platform")) or "unknown",
        "publishedAt": _read_string(item.get("_publishedAt")),
        "title": _read_string(item.get("title")) or "",
    }
    return json.dumps(
        public_identity,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _canonical_url(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    query = urlencode(
        [
            (key, val)
            for key, val in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in _TRACKING_QUERY_KEYS
        ],
        doseq=True,
    )
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/") or parsed.path,
            query,
            "",
        )
    )


def _platform(item: dict[str, Any]) -> str:
    candidates = [
        item.get("platform"),
        item.get("site"),
        item.get("source"),
        item.get("source_id"),
        item.get("extra_platform"),
        item.get("extra_site"),
    ]
    url = (_read_string(item.get("url")) or "").lower()
    candidates.append(url)
    joined = " ".join(str(value).lower() for value in candidates if value)
    aliases = {
        "douyin": ("douyin", "iesdouyin"),
        "xiaohongshu": ("xiaohongshu", "xhs", "小红书"),
        "bilibili": ("bilibili", "b23.tv"),
        "twitter": ("twitter", "x.com"),
    }
    for platform, markers in aliases.items():
        if any(marker in joined for marker in markers):
            return platform
    return _read_string(item.get("source_id")) or "unknown"


def _engagement_score(item: dict[str, Any]) -> float:
    weighted_values: list[float] = []
    for key, value in _flatten_dict(item):
        normalized_key = key.lower()
        if normalized_key.startswith("extra_"):
            normalized_key = normalized_key[6:]
        weight = _ENGAGEMENT_WEIGHTS.get(normalized_key)
        if weight is not None:
            weighted_values.append(_metric_number(value) * weight)
    return math.fsum(sorted(weighted_values))


def _flatten_dict(value: dict[str, Any]) -> list[tuple[str, object]]:
    flattened: list[tuple[str, object]] = []
    for key, item in value.items():
        if isinstance(item, dict):
            flattened.extend(_flatten_dict(item))
        else:
            flattened.append((key, item))
    return flattened


def _metric_number(value: object) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return max(float(value), 0)
    if not isinstance(value, str):
        return 0.0
    text = value.strip().lower().replace(",", "")
    multiplier = 1.0
    if text.endswith(("万", "w")):
        multiplier, text = 10_000.0, text[:-1]
    elif text.endswith(("千", "k")):
        multiplier, text = 1_000.0, text[:-1]
    try:
        return max(float(text) * multiplier, 0)
    except ValueError:
        return 0.0


def _topic_rows(
    items: list[dict[str, Any]],
    *,
    query: str,
    top_k: int,
) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()
    platforms: dict[str, set[str]] = {}
    for item in items:
        labels = _topic_labels(item, query=query)
        for label in labels:
            counter[label] += 1
            platforms.setdefault(label, set()).add(item["_platform"])
    return [
        {
            "label": label,
            "mentionCount": count,
            "platformCount": len(platforms.get(label, set())),
            "platforms": sorted(platforms.get(label, set())),
        }
        for label, count in sorted(
            counter.items(),
            key=lambda pair: (
                -pair[1],
                0 if query and pair[0].casefold() == query.casefold() else 1,
                pair[0].casefold(),
                pair[0],
            ),
        )[:top_k]
    ]


def _topic_labels(item: dict[str, Any], *, query: str) -> list[str]:
    labels: list[str] = []
    for key in ("tags", "hashtags", "topics", "extra_tags", "extra_hashtags"):
        value = item.get(key)
        if isinstance(value, list):
            labels.extend(_read_string(tag) or "" for tag in value)
        elif isinstance(value, str):
            labels.extend(re.split(r"[,，\s]+", value))
    text = " ".join(
        filter(
            None,
            [
                _read_string(item.get("title")),
                _read_string(item.get("content")),
                _read_string(item.get("text")),
            ],
        )
    )
    labels.extend(re.findall(r"#([^#\s]{2,30})#?", text))
    if query and query.lower() in text.lower():
        labels.append(query)
    if not labels:
        first_clause = re.split(r"[。！？!?；;|｜\n]", text)[0].strip()
        if 2 <= len(first_clause) <= 30:
            labels.append(first_clause)
    return list(dict.fromkeys(label.strip("# ") for label in labels if label.strip("# ")))[:4]


def _platform_rows(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        grouped.setdefault(item["_platform"], []).append(item)
    return [
        {
            "platform": platform,
            "itemCount": len(rows),
            "datedItemCount": sum(row["_publishedAt"] is not None for row in rows),
            "engagementScore": round(
                math.fsum(sorted(float(row["_engagementScore"]) for row in rows)),
                2,
            ),
        }
        for platform, rows in sorted(grouped.items(), key=lambda pair: (-len(pair[1]), pair[0]))
    ]


def _signals(
    recent: list[dict[str, Any]],
    baseline: list[dict[str, Any]],
    *,
    now: datetime,
    window_days: int,
    baseline_days: int,
    platforms: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    dated_recent = [
        item for item in recent if _parse_datetime(item["_publishedAt"]) is not None
    ]
    last_day_count = sum(
        1
        for item in dated_recent
        if (_parse_datetime(item["_publishedAt"]) or now) >= now - timedelta(days=1)
    )
    prior_daily_rate = max((len(dated_recent) - last_day_count) / max(window_days - 1, 1), 0)
    if last_day_count and last_day_count >= max(2, prior_daily_rate * 2):
        signals.append(
            {
                "type": "velocity_spike",
                "severity": "high" if last_day_count >= max(4, prior_daily_rate * 4) else "medium",
                "value": last_day_count,
                "baselineDailyRate": round(prior_daily_rate, 2),
                "message": "过去 24 小时内容量显著高于窗口内此前日均。",
            }
        )
    if baseline:
        current_rate = len(dated_recent) / window_days
        baseline_rate = len(baseline) / baseline_days
        delta = (current_rate - baseline_rate) / baseline_rate if baseline_rate else None
        signals.append(
            {
                "type": "window_momentum",
                "severity": "medium" if delta is not None and abs(delta) >= 0.5 else "info",
                "currentDailyRate": round(current_rate, 2),
                "baselineDailyRate": round(baseline_rate, 2),
                "deltaRatio": round(delta, 3) if delta is not None else None,
                "message": "当前窗口与前一基线窗口的日均内容量对比。",
            }
        )
    if recent:
        scores = [float(item["_engagementScore"]) for item in recent]
        threshold = median(scores) * 3
        outliers = [item for item in recent if item["_engagementScore"] > max(threshold, 0)]
        if outliers and any(score > 0 for score in scores):
            signals.append(
                {
                    "type": "engagement_outlier",
                    "severity": "medium",
                    "itemCount": len(outliers),
                    "threshold": round(threshold, 2),
                    "message": "检测到互动强度明显高于样本中位数的内容。",
                }
            )
        top_platform = platforms[0] if platforms else None
        if top_platform and top_platform["itemCount"] / len(recent) >= 0.7:
            signals.append(
                {
                    "type": "platform_concentration",
                    "severity": "medium",
                    "platform": top_platform["platform"],
                    "ratio": round(top_platform["itemCount"] / len(recent), 3),
                    "message": "样本过度集中于单一平台，结论可能存在平台偏差。",
                }
            )
    return signals


def _data_quality(
    items: list[dict[str, Any]],
    platforms: list[dict[str, Any]],
) -> dict[str, Any]:
    total = len(items)
    dated = sum(item["_publishedAt"] is not None for item in items)
    url_count = sum(bool(item["_canonicalUrl"]) for item in items)
    return {
        "dateCoverage": round(dated / total, 3) if total else 0,
        "urlCoverage": round(url_count / total, 3) if total else 0,
        "platformCount": len(platforms),
        "limitations": [
            limitation
            for limitation, applies in (
                ("部分内容没有可验证发布时间，已单独标记为 unknownDate。", dated < total),
                ("部分内容没有稳定 URL，去重退化为内容指纹。", url_count < total),
                ("样本来自单一平台，不能代表全网态势。", len(platforms) == 1),
            )
            if applies
        ],
    }


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": _read_string(item.get("title")) or "",
        "url": item["_canonicalUrl"],
        "platform": item["_platform"],
        "publishedAt": item["_publishedAt"],
        "freshness": item["_freshness"],
        "engagementScore": item["_engagementScore"],
        "author": _read_string(item.get("author")) or "",
    }


def _markdown_brief(report: dict[str, Any]) -> str:
    counts = report["counts"]
    topic_lines = "\n".join(
        f"- {topic['label']}: {topic['mentionCount']} 条 / {topic['platformCount']} 个平台"
        for topic in report["topics"][:5]
    ) or "- 暂无可识别主题"
    signal_lines = "\n".join(
        f"- [{signal['severity']}] {signal['message']}" for signal in report["signals"]
    ) or "- 当前样本未触发规则型异常信号"
    return (
        f"# 近 {report['window']['days']} 天事态感知：{report['query'] or '未命名主题'}\n\n"
        f"输入 {counts['input']} 条；窗口内 {counts['recent']} 条；"
        f"时间未知 {counts['unknownDate']} 条；去重后纳入 {counts['includedAfterDedupe']} 条。\n\n"
        f"## 主题\n\n{topic_lines}\n\n"
        f"## 信号\n\n{signal_lines}\n\n"
        "## 可信度说明\n\n"
        + (
            "\n".join(f"- {item}" for item in report["dataQuality"]["limitations"])
            or "- 当前样本的时间、URL 与平台覆盖未发现显著缺口。"
        )
    )


def _read_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _bounded_int(value: object, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    return min(max(parsed, minimum), maximum)
