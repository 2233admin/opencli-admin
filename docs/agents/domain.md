# Domain docs

This repository uses a single domain context.

## Read before product or architecture work

- Read the root `CONTEXT.md` and use its canonical terms.
- Read the relevant accepted decisions under `docs/adr/`.
- Surface an ADR conflict explicitly instead of silently overriding it.

## Layout

```text
/
├── CONTEXT.md
└── docs/
    └── adr/
```

Do not introduce a `CONTEXT-MAP.md` or per-package contexts unless the repository later becomes a genuinely independent multi-product monorepo.
