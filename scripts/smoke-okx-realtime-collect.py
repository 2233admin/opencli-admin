"""Smoke test real OKX market-data collection for realtime tool capability work."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import websockets

OKX_WS_URL = "wss://ws.okx.com:8443/ws/v5/public"


def main() -> None:
    args = _parse_args()
    if args.proxy:
        os.environ["http_proxy"] = args.proxy
        os.environ["https_proxy"] = args.proxy
    events = asyncio.run(_collect(args.inst_id, args.count, args.timeout))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            "\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n",
            encoding="utf-8",
        )
    print(
        json.dumps(
            {
                "ok": bool(events),
                "instId": args.inst_id,
                "eventCount": len(events),
                "output": str(args.output) if args.output else None,
                "latest": events[-1] if events else None,
            },
            ensure_ascii=False,
        )
    )
    if not events:
        raise SystemExit(1)


async def _collect(inst_id: str, count: int, timeout: float) -> list[dict[str, Any]]:
    subscribe = {"op": "subscribe", "args": [{"channel": "tickers", "instId": inst_id}]}
    started = time.perf_counter()
    events: list[dict[str, Any]] = []
    headers = {"User-Agent": "Mozilla/5.0 OpenCLI-Admin-collector-smoke/0.1"}
    async with websockets.connect(
        OKX_WS_URL,
        additional_headers=headers,
        ping_interval=20,
        open_timeout=timeout,
    ) as ws:
        connected_ms = round((time.perf_counter() - started) * 1000)
        await ws.send(json.dumps(subscribe))
        deadline = time.perf_counter() + timeout
        while len(events) < count and time.perf_counter() < deadline:
            raw = await asyncio.wait_for(
                ws.recv(),
                timeout=max(0.1, deadline - time.perf_counter()),
            )
            message = json.loads(raw)
            if message.get("event"):
                continue
            for row in message.get("data", []):
                event = _ticker_event(row, connected_ms)
                events.append(event)
                print(json.dumps(event, ensure_ascii=False))
                if len(events) >= count:
                    break
    return events


def _ticker_event(row: dict[str, Any], connected_ms: int) -> dict[str, Any]:
    ts_ms = _read_int(row.get("ts"))
    observed_ms = int(time.time() * 1000)
    return {
        "schema": "event.market.ticker.v1",
        "source": "okx",
        "channel": "tickers",
        "instId": row.get("instId"),
        "eventType": "market.ticker",
        "eventTime": _timestamp_iso(ts_ms),
        "exchangeTs": row.get("ts"),
        "observedAt": datetime.fromtimestamp(observed_ms / 1000, tz=UTC).isoformat(),
        "latencyMs": observed_ms - ts_ms if ts_ms is not None else None,
        "connectedMs": connected_ms,
        "market": {
            "last": row.get("last"),
            "bidPx": row.get("bidPx"),
            "askPx": row.get("askPx"),
        },
        "raw": row,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inst-id", default="ETH-USDT-SWAP")
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument(
        "--proxy",
        default=(
            os.environ.get("OKX_WS_PROXY")
            or os.environ.get("HTTPS_PROXY")
            or "http://127.0.0.1:7897"
        ),
    )
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def _read_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _timestamp_iso(ts_ms: int | None) -> str | None:
    if ts_ms is None:
        return None
    return datetime.fromtimestamp(ts_ms / 1000, tz=UTC).isoformat()


if __name__ == "__main__":
    main()
