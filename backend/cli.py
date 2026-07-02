"""Thin CLI for the skill subsystem (record→distill→execute→correct, ADR-0003).

2026-07-02 addendum: the web dock (frontend/src/pages/Skills{,Detail}Page.tsx)
covers day-to-day human ops inside opencli-admin fine, but this capability is
meant to scale *out* of one project's React admin panel — a scriptable local
CLI is the form factor that actually travels. This is a pure HTTP client over
the **same** REST API the dock uses (``backend/api/v1/skills.py`` +
``skill_record.py``) — zero duplicated business logic, so a fix to the API
behaves identically from either surface.

Requires a running backend (``uv run uvicorn backend.main:app``); point
``--base-url`` / ``OPENCLI_ADMIN_URL`` at it if not the default
``http://localhost:8031``.

Usage::

    uv run python -m backend.cli list
    uv run python -m backend.cli show <skill_id>
    uv run python -m backend.cli record --domain example.com --capability open-list
    uv run python -m backend.cli redistill <skill_id>
    uv run python -m backend.cli dismiss <skill_id>
    uv run python -m backend.cli rollback <skill_id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import httpx

DEFAULT_BASE_URL = os.environ.get("OPENCLI_ADMIN_URL", "http://localhost:8031")


def _client(base_url: str) -> httpx.Client:
    return httpx.Client(base_url=f"{base_url.rstrip('/')}/api/v1", timeout=30.0)


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(1)


def _unwrap(resp: httpx.Response) -> Any:
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        _die(f"{resp.status_code} {detail}")
    body = resp.json()
    return body.get("data", body)


def cmd_list(args: argparse.Namespace) -> None:
    with _client(args.base_url) as c:
        params: dict[str, Any] = {}
        if args.domain:
            params["domain"] = args.domain
        resp = c.get("/skills", params=params)
        skills = _unwrap(resp)
    if not skills:
        print("(no skills)")
        return
    for s in skills:
        flag = " [待处理]" if s.get("has_open_proposal") else ""
        print(f"{s['id']}  {s['domain']}/{s['capability']}  v{s['version']}  {s['status']}{flag}")


def cmd_show(args: argparse.Namespace) -> None:
    with _client(args.base_url) as c:
        skill = _unwrap(c.get(f"/skills/{args.skill_id}"))
    print(json.dumps(skill, ensure_ascii=False, indent=2))


def cmd_redistill(args: argparse.Namespace) -> None:
    with _client(args.base_url) as c:
        result = _unwrap(c.post(f"/skills/{args.skill_id}/redistill", json={}))
    print(f"redistilled -> v{result['version']}")


def cmd_dismiss(args: argparse.Namespace) -> None:
    with _client(args.base_url) as c:
        _unwrap(c.post(f"/skills/{args.skill_id}/dismiss-correction"))
    print("dismissed — fail streak reset")


def cmd_rollback(args: argparse.Namespace) -> None:
    with _client(args.base_url) as c:
        result = _unwrap(c.post(f"/skills/{args.skill_id}/rollback"))
    print(f"rolled back -> v{result['version']}")


def _print_trace_steps(trace: dict[str, Any]) -> None:
    steps = trace.get("steps") or []
    print(f"captured {len(steps)} step(s):")
    for i, s in enumerate(steps, 1):
        target = s.get("target")
        line = f"  {i}. {s.get('verb')}"
        if target is not None:
            line += f"  {target}"
        if s.get("error"):
            line += f"  [error: {s['error']}]"
        print(line)


def cmd_record(args: argparse.Namespace) -> None:
    """Interactive: start capturing, human demos in the real Chrome, Enter to
    stop, review, confirm distill — the CLI equivalent of the dock's 3-step
    wizard (start → recording → review)."""
    with _client(args.base_url) as c:
        start_body: dict[str, Any] = {"domain": args.domain, "capability": args.capability}
        if args.cdp_endpoint:
            start_body["cdp_endpoint"] = args.cdp_endpoint
        session = _unwrap(c.post("/skills/record/start", json=start_body, timeout=60.0))
        session_id = session["session_id"]
        print(f"recording started (session={session_id}, chrome={session['cdp_endpoint']})")
        print("go demo the task in that Chrome window now.")

        # /start holds the pool's per-endpoint mutex for the session's lifetime,
        # released only by /stop. Ctrl+C (or EOF) on either prompt below must
        # still reach /stop, or that Chrome endpoint stays locked until the
        # backend process restarts.
        try:
            input("press Enter here when done recording... ")
            status = "success"
            if input("mark as success? [Y/n] ").strip().lower() == "n":
                status = "failed"
        except (KeyboardInterrupt, EOFError):
            print()
            status = "failed"

        stop_result = _unwrap(
            c.post(f"/skills/record/{session_id}/stop", json={"status": status}, timeout=30.0)
        )
        trace = stop_result["trace"]
        _print_trace_steps(trace)

        if not trace.get("steps"):
            print("nothing captured — not distilling.")
            return
        if input("distill into a skill? [Y/n] ").strip().lower() == "n":
            print("discarded (trace not saved).")
            return

        skill = _unwrap(
            c.post(
                "/skills/distill",
                json={"trace": trace, "domain": args.domain, "capability": args.capability},
                timeout=180.0,
            )
        )
        print(
            f"distilled: {skill['id']}  {skill['domain']}/{skill['capability']}"
            f"  v{skill['version']}"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="opencli-skill", description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"default: {DEFAULT_BASE_URL}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="list skills")
    p_list.add_argument("--domain", default=None)
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="show one skill's full detail")
    p_show.add_argument("skill_id")
    p_show.set_defaults(func=cmd_show)

    p_record = sub.add_parser("record", help="record a demo -> distill into a new skill")
    p_record.add_argument("--domain", required=True)
    p_record.add_argument("--capability", required=True)
    p_record.add_argument(
        "--cdp-endpoint", default=None, help="specific Chrome CDP URL (else pool default)"
    )
    p_record.set_defaults(func=cmd_record)

    p_redistill = sub.add_parser("redistill", help="redistill from the skill's last_failing_trace")
    p_redistill.add_argument("skill_id")
    p_redistill.set_defaults(func=cmd_redistill)

    p_dismiss = sub.add_parser("dismiss", help="dismiss an open correction proposal")
    p_dismiss.add_argument("skill_id")
    p_dismiss.set_defaults(func=cmd_dismiss)

    p_rollback = sub.add_parser("rollback", help="undo the most recent redistill")
    p_rollback.add_argument("skill_id")
    p_rollback.set_defaults(func=cmd_rollback)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
