"""Adapter factory (GOAL-6 PR-B, decision #6): dispatch a
:class:`~backend.models.provider.ModelProvider` row to its
:class:`~backend.llm.base.ProviderAdapter` by ``provider_type``.

This is the single place PR-C's API routes / PR-D's resolver / PR-E's
consumption points should call to turn a stored provider row into something
that can ``chat``/``list_models``/``test_connection`` — the SSRF guard
(decision #6) lives inside the concrete adapters' client-building step
(``OpenAICompatAdapter._get_client`` / ``AnthropicAdapter._get_client``), not
here; this function only dispatches on ``provider_type``.
"""

from __future__ import annotations

from typing import Any

from backend.llm.anthropic import AnthropicAdapter
from backend.llm.base import LlmAdapterError, ProviderAdapter
from backend.llm.openai_compat import OpenAICompatAdapter

#: provider_type -> adapter class (decision #2: provider_type stays the
#: existing openai|claude|local enum; it now also selects the adapter
#: *family* — openai/local share OpenAICompatAdapter, claude gets its own).
_ADAPTERS: dict[str, type[ProviderAdapter]] = {
    "openai": OpenAICompatAdapter,
    "local": OpenAICompatAdapter,
    "claude": AnthropicAdapter,
}


def get_adapter(provider: Any) -> ProviderAdapter:
    """Return the :class:`ProviderAdapter` for ``provider.provider_type``.

    Raises :class:`LlmAdapterError` for an unrecognized ``provider_type``
    rather than silently defaulting — a typo'd/legacy provider_type should
    fail loudly here instead of quietly getting the wrong adapter.
    """
    provider_type = getattr(provider, "provider_type", None)
    adapter_cls = _ADAPTERS.get(provider_type)
    if adapter_cls is None:
        raise LlmAdapterError(
            f"no adapter registered for provider_type={provider_type!r} "
            f"(expected one of {sorted(_ADAPTERS)})"
        )
    return adapter_cls(provider)
