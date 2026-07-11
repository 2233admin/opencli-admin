# A-Share Quant Data Source Map

This is the v1 collection map for using OpenCLI Admin as the A-share quant data intake console.

It is designed for:

- official disclosure and exchange event monitoring;
- daily and intraday research signals where public web data is enough;
- downstream AI enrichment through the XR MiniMax / StepFun / local Ollama provider setup;
- handoff into a quant system as structured records, not direct trading advice.

## Scope

Priority order:

1. Official or exchange-owned sources.
2. Officially designated disclosure platforms.
3. Licensed data-service endpoints where the team has credentials.
4. Third-party public pages only as cross-check or discovery sources.

Do not rely on scraped third-party pages as the source of truth for orders, execution, compliance records, or live trading decisions.

## Data Domains

| Domain | Use | Primary Sources | Notes |
| --- | --- | --- | --- |
| Instrument master | stock list, board, status, listing/delisting | SSE, SZSE, BSE, CNINFO | Needs normalization by exchange/code/board. |
| Daily OHLCV | backtest bars, factors | licensed vendor or exchange data service | Public pages are not enough for robust historical bars. |
| Intraday/tick/Level2 | execution, microstructure | licensed market data vendor | Requires authorization; do not scrape. |
| Announcements | event study, earnings, risk, corporate actions | CNINFO, SSE, BSE | Core source group for AI extraction. |
| Financial statements | fundamentals, quality, valuation | CNINFO, exchange filings, licensed APIs | Parse annual/quarterly reports and XBRL/HTML/PDF where available. |
| Corporate actions | dividends, splits, placements, repurchases | CNINFO, SSE/SZSE/BSE | Must be point-in-time. |
| Trading public info | longhubang, abnormal moves | SSE, SZSE, BSE | Useful event feature, should be exchange-first. |
| Margin trading | leverage and sentiment | SSE, CSF, SZSE pages/data service | Cross-check with third-party pages. |
| Index membership | universe, benchmark, neutralization | CSI, CNINDEX | Licensed feed preferred for history. |
| Northbound/connect | flow and eligible universe | HKEX | Daily public data; history/licensing needs review. |
| Macro/rates | discount rates, risk appetite | ChinaMoney, ChinaBond | Keep separate macro calendar and publication lag. |
| Regulator policy | regime shifts, penalties, rules | CSRC, exchanges | AI tag by company/industry/rule type. |
| News/sentiment | event discovery | STCN, exchange news, licensed news/RSS | Treat as non-authoritative until verified. |

## OpenCLI Admin Pack Files

- Node-aware collection pack: `configs/a-share-quant-pack.json`
- Pack bootstrap: `scripts/bootstrap-a-share-pack.sh`
- Legacy source catalog draft: `configs/a-share-quant-sources.json`
- Legacy source-only bootstrap: `scripts/bootstrap-a-share-sources.sh`
- AI provider bootstrap: `scripts/bootstrap-xr-ai-providers.sh`

Run after the API is up:

```bash
OPENCLI_ADMIN_API=http://localhost:8031/api/v1 scripts/bootstrap-a-share-pack.sh
```

The pack creates or updates sources and schedules. Optional browser bindings are controlled by env vars such as `A_SHARE_BINDING_XUEQIU_ENDPOINT`; this keeps the pack portable across machines where edge node URLs differ.

High-value announcement/news sources should use `XR Smart Default - MiniMax`; bulk scheduled sources should use `XR Local Bulk`.

## Ingestion Shape

Recommended record fields for quant handoff:

```json
{
  "source_name": "A股-上交所-上市公司最新公告",
  "source_url": "https://www.sse.com.cn/disclosure/listedinfo/announcement/",
  "captured_at": "2026-07-10T00:00:00Z",
  "market": "CN-A",
  "exchange": "SSE",
  "security_code": "600000",
  "security_name": "example",
  "event_type": "announcement",
  "event_subtype": "earnings|dividend|risk|mna|regulatory|other",
  "event_time": "2026-07-10",
  "title": "...",
  "url": "...",
  "raw_text": "...",
  "ai_summary": "...",
  "ai_tags": ["risk", "earnings"],
  "confidence": 0.0,
  "dedupe_key": "source:code:event_time:title_hash"
}
```

## Gaps Before Production

- Add a licensed bar/tick vendor for OHLCV, tick, Level2, adjustments, and point-in-time fundamentals.
- Add exchange-specific parsers instead of generic CSS extraction for core official pages.
- Add PDF download and OCR/extraction for announcements and annual reports.
- Add dedupe keys, publication-lag tracking, and point-in-time snapshots.
- Add compliance review for each third-party source's terms of use.
- Add backfill jobs separate from live monitoring jobs.
