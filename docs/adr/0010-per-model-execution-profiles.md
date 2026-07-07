# Model-specific execution profiles tune the skill loop

**Status: Proposed** — design sketch, implement after review. Extends ADR-0003 (skill execute loop) at the model-binding seam.

## Why

The execute loop (ADR-0003) drives a real Chrome page by asking a model for one action per step. It was built model-agnostic: one system prompt, one message shape, one `max_steps`, and a single per-model fork — `_is_xml_tool_model(model)` in `backend/skills/toolcall.py`, which only picks XML-vs-OpenAI tool syntax. Running the *same* skill (`example.com/open-more-info`, v3) against six models on 2026-07-08 showed that a single knob-set does not fit them — each fails in a **different, model-characteristic** way:

- **step-3.7-flash** (StepFun) — strongest actor (navigate/click/scroll/extract, 20 steps, richest extracts), but **wanders**: step 0 navigates to a hallucinated `en.wikipedia.org/wiki/DNA` and ignores the skill's target. Needs an *instruction-adherence* clamp ("do not navigate outside the domains SKILL.md declares").
- **MiniMax-M3** / **gemma4:e4b** — **give up on a blank page**: they `done(failed)` at step 0–3 without ever navigating off `about:blank`. Need a *bootstrap* nudge ("the page starts blank — navigate first") and a bar on premature `done`.
- **qwen3:4b / qwen3.6:35b** — **never terminate** (`capped`): they keep extracting and never emit `done`. Need stronger terminal-condition steering.
- **MiniMax** (any) — provider is **message-format strict**: a system-only first request or an empty-content assistant turn returns `400 chat content is empty (2013)` where OpenAI/Ollama tolerate both. (Already fixed generically in `loop.py` via `_FIRST_TURN_PROMPT` / `_ASSISTANT_ACTED`, commit `c323dd3` — this ADR generalizes that one-off into a declared capability.)
- **gpt-oss:20b** — balanced; the only `done_success`. This is the profile others are tuned *toward*.

The lesson is that execution quality decomposes into two independent axes — **agentic drive** (does it navigate/act/persist) and **instruction adherence** (does it stay on the SKILL.md target). Models sit at different points on both, and a per-model tuning point is the honest way to meet them where they are, instead of degrading the shared prompt to the weakest common denominator.

## Two orthogonal tuning layers — this ADR owns only the second

- **Skill-level** (*where to go*): the SKILL.md 9 elements — start URL, milestones, terminal conditions. Already mutable via `redistill` (ADR-0003 D7). step-3.7-flash's wandering is half a skill-level gap: v3 never pins a start URL, so a strong agent invents one.
- **Model-level** (*how to drive*): per-model behavior correction, tool syntax, provider message compatibility, step budget. Today this layer holds exactly one point (`_is_xml_tool_model`). This ADR proposes growing it into a first-class abstraction.

They compose: pin the start URL in SKILL.md *and* clamp cross-domain navigation in the profile. Neither replaces the other.

## Decision

Introduce a `ModelProfile` resolved once at loop entry from the model name, carrying:

- `tool_format: "openai" | "xml"` — subsumes the existing `_is_xml_tool_model` fork (its first and only client).
- `provider_strict: bool` — whether to guarantee a non-empty opening user turn and assistant placeholder (subsumes the `c323dd3` fix; a no-op for tolerant providers, so it can stay always-on, but declaring it keeps the reason discoverable).
- `behavior_nudges: list[str]` — **declarative** correction lines appended to the system prompt after `build_system_prompt(...)`. Examples: *"The page begins blank; your first action must be `navigate`."* / *"Do not navigate to any domain not named in the skill."* / *"When the required sections are extracted, emit `done` — do not keep scrolling."*
- `max_steps: int` — per-model step budget overriding the shared `MAX_STEPS` (give up-fast models a higher floor; give wanderers a tighter cap).

Profiles live in a small **name-pattern registry** (substring/prefix match on the model id, same matching style as `_is_xml_tool_model`) with a `default` profile — the balanced gpt-oss-shaped baseline — as the fallback. Resolution happens where the loop already knows the model name; the resolved profile feeds the existing seams (system-prompt assembly, tool-format branch, message construction, step cap). No new control flow in the step body — the loop stays a single perceive→propose→act path; only its *inputs* are profile-parameterized.

## Boundaries (what this is not)

- **Not** per-model `if model == ...` branches scattered through `loop.py`. Corrections are declarative prompt text in one registry, so the loop body never grows model conditionals.
- **Not** a change to the distiller. `distill_trace` stays the frozen component (ADR-0003 D7); profiles tune *execution*, never distillation.
- **Not** runtime/learned profiling. Matching is a static name→profile table a human edits. Auto-tuning a profile from a model's failure history is a plausible future (it would lean on the same `evidence` ledger the correction loop already writes) but is explicitly out of scope here.
- **Not** a provider store change. `ModelProvider` rows keep carrying base_url/api_key/model; a profile attaches by model *name*, so one provider row can serve models of different profiles.

## Consequences

Adding a new model's tuning — or a new nudge — is editing the registry, not touching the loop. New profile *fields* or a new orthogonal layer (e.g. per-model temperature/sampling, or auto-learned profiles) require revisiting this ADR, not just extending the table. The one-off `c323dd3` message-compat fix and the lone `_is_xml_tool_model` fork both fold into the registry on implementation, leaving a single place to answer "how do we drive model X."
