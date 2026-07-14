# Dify + Paperclip Frontend Template

This OpenSpec change captures the product inventory and a throwaway UI prototype for
stitching Dify-style workflow building and Paperclip-style work governance into the
OpenCLI frontend.

The source of truth for this change is:

- [Inventory](inventory.md)
- [Brief](brief.md)
- [Directions](directions.md)
- [Design](design.md)
- [Locked object model](object-model.md)
- [Motion](motion.md)
- [Tasks](tasks.md)
- [QA](qa.md)

The prototype is intentionally static and must not be treated as a production data
contract. It exists to choose the product shell and object hierarchy before backend
integration.

The selected Direction C now also documents and exercises the production four-layer canonical node
model: Dify-style L1 Operator, existing OpenCLI L2 Implementation, L3 Component, and L4 Primitive.
