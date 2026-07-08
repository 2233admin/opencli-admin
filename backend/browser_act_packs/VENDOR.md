# VENDOR.md — browser-act skills packs

- **Source**: https://github.com/browser-act/skills
- **Vendored commit**: `a23131e7bd7ea7e472e3a4882b9e22e34b3bd9cf`
- **Vendored on**: 2026-07-08
- **License**: MIT (see `LICENSE` in this directory) — attribution: BrowserAct
  (https://github.com/browser-act)

## What was copied

The upstream `solutions/` tree, verbatim, one directory per pack:

```
solutions/<category>/<pack-name>/SKILL.md
solutions/<category>/<pack-name>/scripts/*.py
```

became

```
backend/browser_act_packs/<category>/<pack-name>/SKILL.md
backend/browser_act_packs/<category>/<pack-name>/scripts/*.py
```

for the five upstream categories: `ecommerce`, `lead-generation`, `search-research`,
`social-listening`, `video-platforms` — 78 packs total (`SKILL.md` count at vendor
time; see `catalog.py`'s scan for the live count).

`solutions/README.md` was copied to `backend/browser_act_packs/SOLUTIONS-README.md`
(kept out of the category tree so it isn't mistaken for a pack). The upstream
`LICENSE` was copied unchanged to `backend/browser_act_packs/LICENSE`.

**Not vendored** (see GOAL-7.md, YAGNI list):
- the `browser-act` CLI itself (external PyPI tool, `uv tool install browser-act-cli`)
- `browser-act-skill-forge` (pack generator, out of scope)

## What was NOT touched

Every `SKILL.md` and every file under `scripts/` is byte-for-byte identical to the
upstream commit above. Do not hand-edit files inside a `<category>/<pack-name>/`
directory — if a pack needs a fix, fix it upstream and re-vendor (re-clone +
re-copy `solutions/**`), or override in code outside this tree.

## What IS ours (added on top, not upstream)

- `catalog.py`, `manifest.py`, `__init__.py` — new code, not vendored.
- `channel.manifest.json` files (one per pack, machine-readable execution
  contract) are **our addition**, authored in PR-D of GOAL-7 — they do not
  exist upstream and are not part of the BrowserAct skills repo. PR-A (this
  vendor drop) defines only the `PackManifest` schema/loader; it does not
  write any `channel.manifest.json` content.

## Refreshing

To pull upstream updates:

1. `git clone --depth 1 https://github.com/browser-act/skills <tmp>`
2. Diff `<tmp>/solutions/**` against this tree; re-copy changed/added pack
   directories verbatim (do not touch our `channel.manifest.json` files when
   they exist — those are ours, not upstream's).
3. Update the commit hash and date at the top of this file.
