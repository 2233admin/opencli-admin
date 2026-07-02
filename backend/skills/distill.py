"""Distill kernel — trajectory → reusable skill spec.

Moved from the validated BrowserBC path-B spike (STEP 1). The distillation
prompt and JSON-extraction logic are unchanged (that is the "已验证" part);
only the I/O surface is adapted to opencli-admin:

  * async httpx instead of blocking urllib,
  * driven by a provider config dict (sourced from ModelProvider) instead of
    hardcoded Ollama env vars,
  * returns the distilled spec instead of writing files — the caller (pipeline
    distill step) persists it to the Skill model.

The 9 elements extracted (see SYSTEM prompt):
  1 general pattern (-> scope)        2 entry preconditions
  3 generalized procedure             4 milestones
  5 terminal/exit conditions          6 false terminal states
  7 failure modes + recovery          8 anti-drift boundaries
  9 red lines
"""

import json
import re
from typing import TYPE_CHECKING, Any

import httpx

from backend.security.url_guard import SSRFValidationError, guarded_async_client

if TYPE_CHECKING:
    from backend.models.provider import ModelProvider

# The 9 elements the distiller extracts from a journey_trace_v1 trace.
SYSTEM = """你是技能蒸馏器。输入是一次人类浏览器操作轨迹(journey_trace_v1)。
把它蒸馏成一份**可跨同类任务复用**的技能卡,提取 9 要素:
1 general pattern(这类任务的通用模式)
2 entry preconditions(开始前必须成立的前提)
3 generalized procedure(泛化的分步流程,不写死坐标/具体值)
4 milestones(中途可验证的里程碑)
5 terminal/exit conditions(怎么算真做完)
6 false terminal states(看着做完其实没做完的陷阱)
7 failure modes + recovery(常见失败与恢复)
8 anti-drift boundaries(防止偏离任务意图的边界)
9 red lines(绝不能做的危险动作)

只输出一个 JSON 对象,键固定为:
skill_name, scope, preconditions(数组), procedure(数组), milestones(数组),
terminal_conditions(数组), false_terminal_states(数组), recovery_policies(数组),
anti_drift_boundaries(数组), red_lines(数组), skill_md(字符串,完整 SKILL.md 正文,markdown)。
不要输出 markdown 代码块包裹,不要解释,只要 JSON。"""

# Keys of the structured 9-element spec stored on the Skill model.
ELEMENT_KEYS = (
    "preconditions",
    "procedure",
    "milestones",
    "terminal_conditions",
    "false_terminal_states",
    "recovery_policies",
    "anti_drift_boundaries",
    "red_lines",
)

_DEFAULT_PROVIDER: dict[str, Any] = {
    "base_url": "http://localhost:11434/v1",
    "model": "qwen3:4b",
    "api_key": None,
    "api_style": "openai",  # openai | ollama
    "timeout": 180,
}


def provider_from_model(mp: "ModelProvider") -> dict[str, Any]:
    """Build a distill provider config from a saved ModelProvider row."""
    style = "ollama" if (mp.provider_type or "").lower() == "local" else "openai"
    return {
        "base_url": mp.base_url or _DEFAULT_PROVIDER["base_url"],
        "model": mp.default_model or _DEFAULT_PROVIDER["model"],
        "api_key": mp.api_key,
        "api_style": style,
        "timeout": _DEFAULT_PROVIDER["timeout"],
    }


async def call_llm(system: str, user: str, provider: dict[str, Any]) -> str:
    """One chat completion against the provider. Supports OpenAI-compatible
    (/v1/chat/completions) and native Ollama (/api/chat) styles.

    Key-exfil guard: when ``provider['base_url']`` is explicitly supplied
    (sourced from a saved ``ModelProvider`` row — DB-stored config), it's
    validated through the SSRF guard before the API key is attached to any
    request — an unvalidated base_url would ship the key to whatever host it
    points at (internal service or attacker-controlled public endpoint). The
    *hardcoded* ``_DEFAULT_PROVIDER["base_url"]`` (local Ollama at
    ``localhost:11434`` — this module's own no-provider-configured fallback,
    not user/DB input) is intentionally NOT run through the guard: it's a
    fixed operator-intended local endpoint, and blocking loopback
    unconditionally here would break that legitimate default. Raises
    :class:`SSRFValidationError` (not a silent empty string) so the caller
    sees a clear rejection instead of a confusing downstream connection
    failure.

    DNS-rebinding closure (AUDIT B3 follow-up): this is a plain-httpx call
    site (not a vendor SDK), so when ``base_url`` goes through the guard it
    also gets a connection pinned to the validated IP(s) via
    :func:`~backend.security.url_guard.guarded_async_client` — same mechanism
    every other httpx call site in this codebase uses. The hardcoded local
    Ollama default is never pinned either (nothing was validated to pin to;
    a plain client is used exactly as before).
    """
    base_url = provider.get("base_url") or _DEFAULT_PROVIDER["base_url"]
    model = provider.get("model", _DEFAULT_PROVIDER["model"])
    api_key = provider.get("api_key")
    api_style = provider.get("api_style", "openai")
    timeout = provider.get("timeout", _DEFAULT_PROVIDER["timeout"])

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user + "\n\n/no_think"},
    ]
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    if base_url != _DEFAULT_PROVIDER["base_url"]:
        try:
            client, base_url = await guarded_async_client(base_url, timeout=timeout)
        except SSRFValidationError:
            raise
    else:
        client = httpx.AsyncClient(timeout=timeout)

    async with client:
        if api_style == "ollama":
            resp = await client.post(
                base_url.rstrip("/") + "/api/chat",
                json={"model": model, "messages": messages, "stream": False,
                      "options": {"temperature": 0.2}},
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()["message"]["content"]
        resp = await client.post(
            base_url.rstrip("/") + "/chat/completions",
            json={"model": model, "messages": messages, "stream": False,
                  "temperature": 0.2},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def extract_json(text: str) -> dict:
    """Pull the first balanced JSON object out of an LLM reply (strips <think>
    blocks and ``` fences first)."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start = text.find("{")
    if start < 0:
        raise ValueError(f"no JSON object in LLM output: {text[:200]!r}")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("unbalanced JSON braces in LLM output")


def slug(x: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (x or "").lower()).strip("-") or "unknown"


def assemble_skill_md(s: dict) -> str:
    """Fallback SKILL.md body when the LLM did not return a `skill_md` string."""
    def block(title: str, items: Any) -> str:
        if not items:
            return ""
        if isinstance(items, str):
            return f"## {title}\n\n{items}\n\n"
        return f"## {title}\n\n" + "".join(f"- {x}\n" for x in items) + "\n"

    md = f"# {s.get('skill_name', 'unnamed-skill')}\n\n"
    md += (s.get("scope", "") + "\n\n") if s.get("scope") else ""
    md += block("Preconditions", s.get("preconditions"))
    md += block("Procedure", s.get("procedure"))
    md += block("Milestones", s.get("milestones"))
    md += block("Terminal conditions", s.get("terminal_conditions"))
    md += block("False terminal states", s.get("false_terminal_states"))
    md += block("Recovery", s.get("recovery_policies"))
    md += block("Anti-drift boundaries", s.get("anti_drift_boundaries"))
    md += block("Red lines", s.get("red_lines"))
    return md


async def distill_trace(trace: dict, provider: dict[str, Any] | None = None) -> dict:
    """Distill one journey_trace_v1 trace into a skill spec.

    Returns a dict ready to map onto the Skill model via `to_skill_fields`:
        skill_name, scope, skill_md, <ELEMENT_KEYS...>, domain, capability,
        source_trace, distill_model
    Pure: performs no DB or filesystem writes.
    """
    provider = {**_DEFAULT_PROVIDER, **(provider or {})}
    domain = trace.get("summary", {}).get("domain") or "unknown"

    user = "轨迹 JSON:\n" + json.dumps(trace, ensure_ascii=False, indent=2)
    raw = await call_llm(SYSTEM, user, provider)
    spec = extract_json(raw)

    capability = slug(spec.get("skill_name") or trace.get("label"))
    skill_md = spec.get("skill_md") or assemble_skill_md(spec)
    if not skill_md.lstrip().startswith("---"):
        fm = (
            f"---\nname: {slug(domain)}-{capability}\n"
            f"description: {spec.get('scope', spec.get('skill_name', capability))}\n---\n\n"
        )
        skill_md = fm + skill_md

    spec.update(
        domain=domain,
        capability=capability,
        skill_md=skill_md,
        source_trace=trace.get("trace_id"),
        distill_model=provider.get("model"),
    )
    return spec


def to_skill_fields(spec: dict) -> dict[str, Any]:
    """Map a distilled spec onto Skill model column kwargs."""
    return {
        "domain": spec.get("domain") or "unknown",
        "capability": spec.get("capability") or slug(spec.get("skill_name")),
        "name": spec.get("skill_name") or spec.get("capability") or "unnamed-skill",
        "scope": spec.get("scope"),
        "skill_md": spec.get("skill_md") or "",
        "elements": {k: spec.get(k) or [] for k in ELEMENT_KEYS},
        "source_trace": spec.get("source_trace"),
        "distill_model": spec.get("distill_model"),
    }
