# ADR 0006: Versioned packaged Node composition

Packaged Nodes may contain other packaged Nodes. Ordinary authoring should remain within four visible levels; compilation permits at most sixteen levels, rejects dependency cycles, and reports the complete package path when expansion fails.

Published Workflow Versions pin exact packaged Node definitions and transitive dependencies. Installing or importing a newer definition never mutates a published version. Drafts may adopt upgrades explicitly after reviewing differences and completing a validation Run.

This keeps Houdini-style procedural composition without exposing unbounded recursion, accidental upgrades, or non-reproducible Runs. Product UI calls these packaged Nodes; HDA remains an internal architectural analogy.
