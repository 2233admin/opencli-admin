# Live Webhook Acceptance

Date: 2026-07-07

## WSL Test Environment

- Repo: `/mnt/c/c/Users/Administrator/projects/opencli-admin-backend`
- WSL distro: Ubuntu
- Working Python: `3.12.13`
- WSL venv: `/root/.cache/codex/venvs/opencli-admin-backend-py312`
- Install command:

```bash
uv venv /root/.cache/codex/venvs/opencli-admin-backend-py312 \
  --python /root/.local/share/uv/python/cpython-3.12-linux-x86_64-gnu/bin/python3.12

uv pip install \
  --python /root/.cache/codex/venvs/opencli-admin-backend-py312/bin/python \
  -e '.[dev]'
```

Notes:

- The repo-local `.venv` is a Windows venv (`Scripts/python.exe`), not usable from WSL.
- Ubuntu's system Python is `3.14.4`; it was not used for acceptance because `lxml==5.4.0` does not build cleanly on this image.
- `uv python install 3.11` did not complete in this WSL session, but uv already had Python `3.12.13`, which satisfies the project `>=3.11` requirement.

## Baseline Pytest Acceptance

Command:

```bash
cd /mnt/c/c/Users/Administrator/projects/opencli-admin-backend
/root/.cache/codex/venvs/opencli-admin-backend-py312/bin/python \
  -m pytest -q -m 'not live' --maxfail=20
```

Result:

```text
1430 passed, 1 skipped, 9 deselected, 92 warnings in 235.18s
Required test coverage of 80% reached. Total coverage: 89.72%
```

One test adjustment was needed: compile API binding assertions now allow the runtime binding to include the new `contract` manifest while still asserting the original stable binding fields and matching `contract.bindingId`.

## Generic Webhook Live Acceptance

Added test:

```text
tests/integration/test_generic_webhook_live.py
```

Behavior:

- If `OPENCLI_GENERIC_WEBHOOK_LIVE_URL` is set, the test posts to that URL.
- If unset, the test creates a temporary Webhook.site token with `POST https://webhook.site/token`.
- For Webhook.site URLs, the test reads `request/latest/raw` and verifies the captured payload.
- The test exercises the real project path: `execute_workflow_webhook_delivery()` -> `WebhookNotifier` -> public HTTPS POST.

Command:

```bash
cd /mnt/c/c/Users/Administrator/projects/opencli-admin-backend
/root/.cache/codex/venvs/opencli-admin-backend-py312/bin/python \
  -m pytest -q -m live tests/integration/test_generic_webhook_live.py --no-cov
```

Result:

```text
1 passed, 27 warnings in 2.89s
```

Manual smoke also passed before the pytest was added:

```text
delivery_result.delivered=true
captured_event=workflow.evidence_batch.ready
captured_title=WSL live webhook acceptance
```

## Secret Handling

No Feishu, DingTalk, WeCom, Hookdeck, or other private keys were added to the repo or written into this document.

For provider-specific live checks, inject secrets through WSL environment variables or an external secret manager:

```bash
export OPENCLI_FEISHU_WEBHOOK_URL='...'
export OPENCLI_DINGTALK_WEBHOOK_URL='...'
export OPENCLI_WECOM_WEBHOOK_URL='...'
```

Then add or run provider-specific `pytest -m live` tests that skip unless the matching env var is present.

## Next Step

After generic webhook live is green, wire Feishu/DingTalk/WeCom live smoke tests behind env-var skips. Keep their keys out of git, shell history, docs, and chat.
