# Glossary

Shared vocabulary for OpenCLI Admin. Add terms as the domain model sharpens.

## Skill subsystem

- **Skill** — a reusable browser capability identified by `(domain, capability)`, stored in the `skills` table. Body is a `SKILL.md` card plus the structured 9-element spec.
- **SKILL.md** — the human/agent-readable skill card. Carries the 9 elements as prose + front matter.
- **9 elements** — the spec a skill is distilled into: general pattern (scope), preconditions, procedure, milestones, terminal conditions, false terminal states, recovery policies, anti-drift boundaries, red lines.
- **journey_trace_v1** — the trace shape both loop legs share. Produced by the human **record** leg and by every **execute** run (assembled from step events + outcome); consumed by the distiller.
- **Distiller** — `backend/skills/distill.py`. Turns one `journey_trace_v1` trace (+ optionally the current SKILL.md) into a skill spec via a provider LLM. The single converter for both record and correct legs.
- **Execute loop** — the `skill` channel's perceive→propose→confirm→act cycle: snapshot the page, cheap model emits one action, gate it, run it, emit a step event, check milestones/terminal.
- **Perception snapshot** — the per-step page view given to the model: an injected-JS list of visible interactive elements `[{ref, role, name, value}]`, token-bounded.
- **ref** — a per-snapshot `data-skill-ref` id the model uses to address an element in an action.
- **proposal→confirm guardrail** — the dock's hard rule that write actions are not executed until confirmed. The execute loop reuses it for high-risk actions.
- **Risk-tiered confirm** — reads/navigation/scroll/extract auto-run; red-line / high-risk actions (submit, pay, post, delete) require confirm.
- **auto_confirm** — a per-source flag letting a trusted skill run high-risk actions unattended. Default off.
- **awaiting_confirm** — paused run status: a headless run hit a confirm-required action and stopped (resume is v2).
- **Record leg / Correct leg** — the two trace sources: a human demonstrating a task once (record), and a failing execute run fed back for re-distillation (correct).
- **Evidence** — the `skills.evidence` log of closed-loop events (distilled / executed / corrected with outcomes) that drives self-evaluation.
