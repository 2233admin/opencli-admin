"""Credential security: encrypted-at-rest secrets + AuthManager resolution.

Secrets never live as plaintext in ``channel_config``. They are stored encrypted
in ``source_credentials`` (Fernet) and resolved at runtime into the runner's
``AuthContext`` so channels never touch raw secrets.
"""

from backend.auth.manager import AuthManager

__all__ = ["AuthManager"]
