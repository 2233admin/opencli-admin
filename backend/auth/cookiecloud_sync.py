"""CookieCloud sync adapter — the ONLY place that speaks CookieCloud's own
protocol/encryption (https://github.com/easychen/CookieCloud). Everything
downstream of :func:`sync_from_cookiecloud` only ever sees our own
Fernet-encrypted, domain-keyed ``cookie_jar`` rows (backend.models.cookie_jar);
CookieCloud's AES/CryptoJS format never leaks past this module.

Uses the ``PyCookieCloud`` client (does the HTTP GET + AES decrypt) — it's a
synchronous/blocking library, so calls run in a thread via ``asyncio.to_thread``
to stay compatible with this codebase's async-everywhere convention.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


class CookieCloudSyncError(RuntimeError):
    """The CookieCloud server was unreachable, or the password/uuid was wrong."""


def _fetch_decrypted(url: str, uuid: str, password: str) -> dict[str, Any]:
    from PyCookieCloud import PyCookieCloud

    client = PyCookieCloud(url, uuid, password)
    data = client.get_decrypted_data()
    if not data:
        raise CookieCloudSyncError(
            "CookieCloud sync failed: could not fetch/decrypt (check url/uuid/password)"
        )
    return data


async def sync_from_cookiecloud(url: str, uuid: str, password: str) -> int:
    """Pull the current cookie jar from a CookieCloud server, decrypt it, and
    upsert every cookie into our own ``cookie_jar`` table (domain-keyed,
    Fernet-encrypted). Returns the number of cookies synced.

    CookieCloud's decrypted shape is ``{"cookie_data": {group_key: [cookie, ...]},
    "local_storage_data": {...}}`` — ``local_storage_data`` is out of scope (v1
    is cookies only). Each cookie's own ``domain`` field (e.g. ``.example.com``,
    as the browser stored it) is the key we store under, not ``group_key``.
    """
    data = await asyncio.to_thread(_fetch_decrypted, url, uuid, password)
    cookie_data: dict[str, list[dict[str, Any]]] = data.get("cookie_data", {})

    from backend.auth.manager import AuthManager
    from backend.database import AsyncSessionLocal

    manager = AuthManager()
    synced = 0
    # One session/transaction for the whole sync (can be hundreds of cookies) —
    # store_cookie(session=...) only flushes per cookie, we commit once at the end.
    async with AsyncSessionLocal() as session:
        for cookies in cookie_data.values():
            for cookie in cookies:
                domain = (cookie.get("domain") or "").lstrip(".")
                name = cookie.get("name")
                if not domain or not name:
                    continue
                same_site = cookie.get("sameSite")
                if same_site == "unspecified":  # CookieCloud's own normalization note
                    same_site = "Lax"
                attrs = {
                    "value": cookie.get("value", ""),
                    "path": cookie.get("path", "/"),
                    "expires": cookie.get("expires"),
                    "httpOnly": cookie.get("httpOnly", False),
                    "secure": cookie.get("secure", False),
                    "sameSite": same_site,
                }
                await manager.store_cookie(domain, name, attrs, session=session)
                synced += 1
        await session.commit()

    logger.info(
        "cookiecloud sync | %d cookies synced across %d domain groups", synced, len(cookie_data)
    )
    return synced
