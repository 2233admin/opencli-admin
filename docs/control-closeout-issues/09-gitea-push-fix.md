---
labels: ready-for-agent
---

# 09 — Fix the hanging gitea push

## Parent

docs/control-closeout-PRD.md

## What to build

Pushing `refactor/thin-channel-thick-runner` to the gitea remote hangs (~2min timeout, suspected interactive credential/certificate prompt swallowed by the non-interactive shell). Diagnose the actual cause (credential helper? TLS cert verification? remote URL scheme?), fix it durably (config, not a one-off flag), and push the branch so the self-hosted mirror is current.

This is an environment/credential task, not code. Credentials come from the operator: ASK for the gitea token/credentials — do not search the filesystem or backups for them. (Known context: the gitea account for automation is `claudeQWQ`; self-signed cert may require `http.sslVerify=false` scoped to the gitea remote only, never globally.)

## Acceptance criteria

- [ ] Root cause of the hang identified and stated
- [ ] Fix is durable (survives new shells/sessions; scoped to the gitea remote)
- [ ] `git push gitea refactor/thin-channel-thick-runner` completes; remote tip equals local tip (verified via ls-remote)
- [ ] No credentials written into the repo or committed files

## Blocked by

None - can start immediately (needs operator-supplied credentials)

## Agent rules

- Do NOT use the Agent tool
- Do NOT commit anything
- Do NOT read secrets/backup files; ask the operator for credentials
