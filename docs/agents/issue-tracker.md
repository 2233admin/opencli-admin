# Issue tracker: GitHub

Specifications and implementation tasks for this repository live as GitHub Issues in the public repository `2233admin/opencli-admin`.

## Conventions

- Always pass `--repo 2233admin/opencli-admin` to `gh` issue and label commands. The local checkout also has a read-only upstream remote, so repository inference is unsafe for writes.
- Create an issue with `gh issue create --repo 2233admin/opencli-admin`.
- Read an issue with `gh issue view <number> --repo 2233admin/opencli-admin --comments`.
- List issues with `gh issue list --repo 2233admin/opencli-admin` and request JSON fields needed by the caller.
- Comment, edit, label, close, and reopen issues only with the same explicit `--repo` argument.
- When a skill says to publish a specification or PRD to the issue tracker, create a GitHub Issue in `2233admin/opencli-admin`.

## Pull requests as a triage surface

PRs as a request surface: no. Pull requests may reference Issues, but they do not enter the Issue triage queue automatically.
