# @opencli/node-kit (L3 node layer) — INCUBATING

Reusable node layer for the whole fleet. One contract, two authoring paths
(human TS + agent JSON), one registry, one generic renderer.

> **Status:** incubating at `frontend/src/node-kit/` (consumed via `@/node-kit`).
> When stable: `git mv` to a top-level NX lib `node-kit/` (`@opencli/node-kit`),
> add `project.json` + `package.json`, register in root `workspaces`, then other
> repos (katana, vault-mind) install it from gitea npm. Keep this module free of
> app/data imports so the move stays mechanical.

## Layers

- **Atoms** (`render/atoms.tsx`) — smallest reusable node-body bits: `NodeHeader`,
  `NodePort`, `NodeField`, `NodeStat`, `NodeOpButton`, `NodeBadge`, `NodeToggle`.
- **Contract** (`spec.ts`) — `NodeSpec`: type, ports, `config` (zero-dep declarative
  fields), `ops` (declarative actions), optional `render`, **reserved** `run`.
- **Registry** (`registry.ts`) — `registerNode` (human) / `instantiate` (agent JSON).
- **Renderer** (`render/KitNode.tsx`, `nodeTypesForXyflow`) — draws any spec on xyflow.
- **Primitives** (`nodes/primitives.ts`) — `value`, `transform.filter/map`,
  `control.branch`, `display.json`, `note`.
- **Agent bridge** (`agent/toSchema.ts`) — node specs → JSON-schema for chat.py TOOLS.

## Author a node (human)

```ts
import { defineNode, registerNode } from '@/node-kit'
registerNode(defineNode({
  type: 'source.http', category: 'source', title: 'HTTP 源', icon: 'globe',
  ports: { inputs: [], outputs: [{ id: 'out' }] },
  config: { fields: [
    { key: 'url', type: 'string', label: 'URL', required: true },
    { key: 'interval', type: 'number', label: '间隔(s)', default: 60 },
  ] },
  ops: [{ id: 'test', label: '测试', icon: 'plug', run: async (ctx) => { /* call API */ } }],
}))
```

## Author a node (agent)

Agent reads `nodeCatalogForAgent()` (types + JSON-schema), emits:

```json
{ "type": "source.http", "config": { "url": "https://…", "interval": 30 } }
```

`instantiate(json)` validates against the registered spec → a `NodeInstance`.

## Render on a canvas

```tsx
import { registerNodes, nodeTypesForXyflow, PRIMITIVE_NODES } from '@/node-kit'
registerNodes(PRIMITIVE_NODES)
const nodeTypes = useMemo(() => nodeTypesForXyflow(), [])
// <ReactFlow nodeTypes={nodeTypes} nodes={[{ id, type:'value', data:{ config:{ value:42 } } }]} />
```

## Reserved: execution engine

`run()`, `NodeRunContext`, `EdgeValue`, `RunResult` are in the contract but no
engine calls them yet (scope: "A skeleton, reserve engine hooks"). Adding a
dataflow runner later must not change these types.
