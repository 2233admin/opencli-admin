# Third-party notices

This compatibility runtime intentionally pins upstream execution components so a
saved OpenCLI run can be reproduced against a known implementation.

## Graphon

- Project: `langgenius/graphon`
- Version: `0.7.0`
- Source commit: `b187ce7927fea1a7c137b642be3f78e3abb9f7de`
- License: Apache License 2.0
- Source: <https://github.com/langgenius/graphon>

Graphon is installed from the exact source commit recorded in `uv.lock`. Its
license and copyright remain with the upstream authors.

## Dify Plugin Daemon Slim

- Project: `langgenius/dify-plugin-daemon`
- Compatible release: `0.6.5`
- Source commit: `14877f8f8b6dd63d3cec760411a875cc8e077547`
- License: Apache License 2.0
- Source: <https://github.com/langgenius/dify-plugin-daemon>

The Slim helper is an optional external runtime for Dify model and tool nodes. It
is not bundled in the P0 image. When installed separately, OpenCLI reports its
availability while preserving the pinned compatibility target above.
