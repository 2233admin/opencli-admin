# Expandable Business Nodes Without A Fixed Depth Hierarchy

Status: accepted

OpenCLI's default Workflow authoring surface will show business-level Operator Nodes. A node may declare an inspectable or editable internal implementation graph and allow the operator to enter that graph through a separate breadcrumbed Node Scope. The parent Workflow continues to treat the Expandable Node as one versioned executable step with stable external ports. OpenCLI will not require every node to implement a fixed Operator, Implementation, Component, and Primitive four-level hierarchy.

Consequences:

- Simple nodes remain simple and do not acquire artificial internal layers.
- Complex packaged nodes can preserve the previously designed enter-node capability for composition and diagnosis.
- Parent Workflow wiring is insulated from ordinary internal graph edits by stable node contracts and versioning.
- Primitive implementation details remain optional and advanced rather than dominating the default palette.
- Infinite inline nesting is not part of the normal interaction model; each graph scope is opened explicitly and identified by breadcrumbs.
- The existing `fuse-dify-paperclip-frontend-template` OpenSpec, editor guards, compiler validation, and regression tests still enforce an L1-L4 depth cap. That limit is a legacy compatibility boundary, not the target domain rule; removing it requires an explicit migration of authoring, validation, compilation, runtime paths, and tests rather than a silent relaxation in one layer.
