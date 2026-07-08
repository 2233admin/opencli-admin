"""Small realtime market-data executors for OpenCLI Tool Capabilities."""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from typing import Any

OKX_MARKET_TICKER_SNAPSHOT_EXECUTOR = "okx_market_ticker_snapshot"
OKX_MARKET_TICKER_URL = "https://www.okx.com/api/v5/market/ticker"


class RealtimeMarketExecutionError(RuntimeError):
    """Raised when a realtime market executor cannot collect data."""


def execute_okx_market_ticker_snapshot(params: dict[str, Any]) -> dict[str, Any]:
    """Collect one real OKX public ticker snapshot as an event.v1-like payload."""

    inst_id = _read_string(params.get("instId")) or _read_string(params.get("inst_id"))
    inst_id = inst_id or "ETH-USDT-SWAP"
    proxy_url = (
        _read_string(params.get("proxyUrl"))
        or _read_string(params.get("proxy_url"))
        or _read_string(os.environ.get("OKX_HTTP_PROXY"))
        or _read_string(os.environ.get("HTTPS_PROXY"))
        or _read_string(os.environ.get("https_proxy"))
    )
    timeout_seconds = _read_timeout(params.get("timeoutSeconds"))
    url = f"{OKX_MARKET_TICKER_URL}?{urllib.parse.urlencode({'instId': inst_id})}"
    opened_at = time.time()
    opener = _build_opener(proxy_url)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 OpenCLI-Admin-market-executor/0.1"},
    )

    try:
        with opener.open(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # pragma: no cover - exercised by live smoke failures.
        raise RealtimeMarketExecutionError(f"OKX ticker request failed: {exc}") from exc

    if payload.get("code") != "0" or not payload.get("data"):
        raise RealtimeMarketExecutionError(f"OKX ticker returned non-success payload: {payload}")

    row = dict(payload["data"][0])
    ts_ms = _read_int(row.get("ts"))
    observed_ms = int(time.time() * 1000)
    return {
        "schema": "event.market.ticker.v1",
        "source": "okx",
        "channel": "tickers",
        "instId": row.get("instId") or inst_id,
        "eventType": "market.ticker",
        "eventTime": _timestamp_iso(ts_ms),
        "exchangeTs": row.get("ts"),
        "observedAt": datetime.fromtimestamp(observed_ms / 1000, tz=UTC).isoformat(),
        "latencyMs": observed_ms - ts_ms if ts_ms is not None else None,
        "transport": "public-rest-ticker-snapshot",
        "request": {
            "url": OKX_MARKET_TICKER_URL,
            "instId": inst_id,
            "proxy": _proxy_label(proxy_url),
            "durationMs": round((time.time() - opened_at) * 1000),
        },
        "market": {
            "last": row.get("last"),
            "bidPx": row.get("bidPx"),
            "askPx": row.get("askPx"),
            "bidSz": row.get("bidSz"),
            "askSz": row.get("askSz"),
            "high24h": row.get("high24h"),
            "low24h": row.get("low24h"),
            "vol24h": row.get("vol24h"),
        },
        "raw": row,
    }


def _build_opener(proxy_url: str | None) -> urllib.request.OpenerDirector:
    if proxy_url:
        return urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        )
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _read_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _read_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _read_timeout(value: object) -> float:
    if isinstance(value, int | float) and value > 0:
        return float(value)
    return 8.0


def _timestamp_iso(ts_ms: int | None) -> str | None:
    if ts_ms is None:
        return None
    return datetime.fromtimestamp(ts_ms / 1000, tz=UTC).isoformat()


def _proxy_label(proxy_url: str | None) -> str:
    return "configured" if proxy_url else "direct"
