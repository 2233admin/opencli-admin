# Use FlowGram for canvas infrastructure

OpenCLI Admin will not build its own workflow canvas, node form, or workflow authoring infrastructure. We will use FlowGram as the adapter behind Diagnostic Canvas and Workflow Authoring surfaces, while Collection Operations remains the primary domain module and operator UX. This keeps canvas implementation replaceable and lets the product invest in human task flow instead of rebuilding low-level canvas/form/variable-scope mechanics.

Implementation note: pin FlowGram packages to `1.0.11` until the npm registry exposes a consistent `1.0.12` dependency set. On 2026-06-25, `@flowgram.ai/editor@1.0.12` and layout packages require `@flowgram.ai/utils@1.0.12`, but that package version is not available from the registry.
