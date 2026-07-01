"""Single source of truth for turning decrypted credentials into an HTTP auth
header. Used by both ``AuthManager.resolve_context()`` (the generic
per-auth_kind ``AuthContext`` path) and ``ApiChannel._resolve_auth_headers()``
(the per-source, config-driven path) so the bearer/api_key/basic key-name
convention (``token``/``key``/``username``+``password``) and empty-credential
handling live in one place instead of two hand-copied implementations that can
drift.
"""

import base64


def build_auth_header(
    auth_kind: str, creds: dict[str, str], header_name: str = "X-API-Key"
) -> dict[str, str]:
    """Build the Authorization/custom header for ``auth_kind`` from decrypted
    ``creds``. Returns ``{}`` when there's nothing usable to send — never sends
    an empty/placeholder credential (e.g. ``Basic <base64 of ":">``)."""
    if auth_kind == "bearer":
        token = creds.get("token", "")
        return {"Authorization": f"Bearer {token}"} if token else {}
    if auth_kind == "api_key":
        key = creds.get("key", "")
        return {header_name: key} if key else {}
    if auth_kind == "basic":
        user = creds.get("username", "")
        pw = creds.get("password", "")
        if not (user or pw):
            return {}
        encoded = base64.b64encode(f"{user}:{pw}".encode()).decode()
        return {"Authorization": f"Basic {encoded}"}
    return {}
