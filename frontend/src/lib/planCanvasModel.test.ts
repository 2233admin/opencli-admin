import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  _resetDraftSeq,
  anchorValidationErrors,
  buildSubnetView,
  canvasNodeType,
  canvasToPlanGraph,
  createDraftNodeFromPreset,
  createDraftSourceNode,
  deriveDraftAndRunnable,
  detachNode,
  extractPlanValidationErrors,
  fallbackPosition,
  groupPresetsByNodeType,
  isDraftSourceNode,
  listCanvasGroups,
  materializeDraftNode,
  planGraphToCanvas,
  presetMatchesQuery,
  readCanvasGroup,
  withCanvasGroup,
} from './planCanvasModel.ts'
import type { PlanEdge, PlanGraph, PlanNode, Preset } from '../api/types.ts'

function makeSourceNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: 'n1',
    kind: 'source',
    type: 'rss_source',
    label: 'RSS',
    params: { channel_type: 'rss', feed_url: 'https://example.com/rss' },
    required_params: [],
    inputs: [],
    outputs: [{ name: 'out', type: 'records' }],
    source_id: 'src-1',
    draft: false,
    ...overrides,
  }
}

const preset: Preset = {
  id: 'opencli:xueqiu:hot',
  channel_type: 'opencli',
  node_type: 'opencli_source',
  label: '雪球 · 热帖',
  description: 'hot posts',
  params: { channel_type: 'opencli', site: 'xueqiu', command: 'hot', format: 'json' },
}

describe('canvasNodeType', () => {
  it('maps a materialized source node to source.<channel_type>', () => {
    assert.equal(canvasNodeType(makeSourceNode()), 'source.rss')
  })

  it('falls back to plan.source-draft when a draft has no channel_type yet', () => {
    const node = makeSourceNode({ params: {}, draft: true, source_id: undefined })
    assert.equal(canvasNodeType(node), 'plan.source-draft')
  })

  it('maps non-source kinds to plan.<kind>', () => {
    assert.equal(canvasNodeType(makeSourceNode({ kind: 'merge', type: 'merge' })), 'plan.merge')
    assert.equal(canvasNodeType(makeSourceNode({ kind: 'transform', type: 'dedupe' })), 'plan.transform')
    assert.equal(canvasNodeType(makeSourceNode({ kind: 'sink', type: 'db_sink' })), 'plan.sink')
  })
})

describe('fallbackPosition', () => {
  it('lays out a deterministic grid (4 cols)', () => {
    assert.deepEqual(fallbackPosition(0), { x: 0, y: 0 })
    assert.deepEqual(fallbackPosition(3), { x: 3 * 260, y: 0 })
    assert.deepEqual(fallbackPosition(4), { x: 0, y: 160 })
  })

  it('is stable across repeated calls (no jitter)', () => {
    assert.deepEqual(fallbackPosition(7), fallbackPosition(7))
  })
})

describe('planGraphToCanvas / canvasToPlanGraph round-trip', () => {
  const edge: PlanEdge = {
    id: 'e1',
    source_node: 'n1',
    source_port: 'out',
    target_node: 'n2',
    target_port: 'in',
  }
  const graph: PlanGraph = {
    ir_version: '1.0.0',
    name: 'My Plan',
    draft: false,
    nodes: [
      makeSourceNode(),
      { ...makeSourceNode({ id: 'n2', kind: 'sink', type: 'db_sink' }), inputs: [{ name: 'in', type: 'records' }], outputs: [] },
    ],
    edges: [edge],
  }

  it('projects PlanGraph nodes/edges onto canvas shapes with fallback positions', () => {
    const canvas = planGraphToCanvas(graph)
    assert.equal(canvas.nodes.length, 2)
    assert.equal(canvas.nodes[0].id, 'n1')
    assert.deepEqual(canvas.nodes[0].position, fallbackPosition(0))
    assert.deepEqual(canvas.nodes[1].position, fallbackPosition(1))
    assert.equal(canvas.edges.length, 1)
    assert.equal(canvas.edges[0].source, 'n1')
    assert.equal(canvas.edges[0].target, 'n2')
    assert.equal(canvas.edges[0].sourceHandle, 'out')
    assert.equal(canvas.edges[0].targetHandle, 'in')
  })

  it('restores a stored __canvas_position instead of the fallback grid', () => {
    const positioned: PlanGraph = {
      ...graph,
      nodes: [
        { ...makeSourceNode(), params: { ...makeSourceNode().params, __canvas_position: { x: 999, y: 42 } } },
      ],
    }
    const canvas = planGraphToCanvas(positioned)
    assert.deepEqual(canvas.nodes[0].position, { x: 999, y: 42 })
  })

  it('round-trips byte-faithfully: canvasToPlanGraph(planGraphToCanvas(g)) preserves node/edge content', () => {
    const canvas = planGraphToCanvas(graph)
    const back = canvasToPlanGraph(canvas, { irVersion: graph.ir_version, name: graph.name, draft: graph.draft })

    assert.equal(back.nodes.length, graph.nodes.length)
    assert.equal(back.edges.length, graph.edges.length)
    assert.deepEqual(back.edges, graph.edges)
    // Every original field survives (position is additive under __canvas_position).
    for (const [i, original] of graph.nodes.entries()) {
      const roundTripped = back.nodes[i]
      assert.equal(roundTripped.id, original.id)
      assert.equal(roundTripped.kind, original.kind)
      assert.equal(roundTripped.type, original.type)
      assert.equal(roundTripped.source_id, original.source_id)
      assert.equal(roundTripped.draft, original.draft)
      for (const [k, v] of Object.entries(original.params)) {
        assert.deepEqual(roundTripped.params[k], v)
      }
    }
  })

  it('reprojecting a round-tripped graph again yields the same canvas positions (stable reload)', () => {
    const canvas1 = planGraphToCanvas(graph)
    const saved = canvasToPlanGraph(canvas1, { irVersion: graph.ir_version, name: graph.name, draft: graph.draft })
    const canvas2 = planGraphToCanvas(saved)
    assert.deepEqual(
      canvas2.nodes.map((n) => n.position),
      canvas1.nodes.map((n) => n.position),
    )
  })
})

describe('Draft Source Node lifecycle', () => {
  it('createDraftSourceNode produces an unmaterialized source node', () => {
    _resetDraftSeq()
    const node = createDraftSourceNode('rss', { x: 0, y: 0 }, 'draft-1')
    assert.equal(node.kind, 'source')
    assert.equal(node.draft, true)
    assert.equal(node.source_id, undefined)
    assert.equal(node.params.channel_type, 'rss')
    assert.equal(isDraftSourceNode(node), true)
  })

  it('createDraftNodeFromPreset prefills params from the preset payload exactly', () => {
    const node = createDraftNodeFromPreset(preset, { x: 10, y: 20 }, 'draft-preset-1')
    assert.equal(node.type, preset.node_type)
    assert.equal(node.label, preset.label)
    assert.equal(node.params.site, 'xueqiu')
    assert.equal(node.params.command, 'hot')
    assert.equal(node.draft, true)
    assert.equal(isDraftSourceNode(node), true)
  })

  it('materializeDraftNode flips draft off and stamps source_id, leaving everything else untouched', () => {
    const draft = createDraftSourceNode('rss', { x: 5, y: 5 }, 'draft-2')
    const materialized = materializeDraftNode(draft, 'real-source-id')
    assert.equal(materialized.draft, false)
    assert.equal(materialized.source_id, 'real-source-id')
    assert.equal(materialized.id, draft.id)
    assert.deepEqual(materialized.params, draft.params)
    assert.equal(isDraftSourceNode(materialized), false)
  })

  it('isDraftSourceNode is false for a materialized source and for non-source kinds', () => {
    assert.equal(isDraftSourceNode(makeSourceNode()), false)
    assert.equal(isDraftSourceNode(makeSourceNode({ kind: 'merge', type: 'merge', source_id: undefined, draft: false })), false)
  })

  it('deriveDraftAndRunnable: all-materialized single source is runnable, not draft', () => {
    const flags = deriveDraftAndRunnable([makeSourceNode()])
    assert.equal(flags.draft, false)
    assert.equal(flags.runnable, true)
  })

  it('deriveDraftAndRunnable: any draft source node marks the whole plan draft and not runnable', () => {
    const flags = deriveDraftAndRunnable([makeSourceNode(), createDraftSourceNode('api', { x: 0, y: 0 }, 'd')])
    assert.equal(flags.draft, true)
    assert.equal(flags.runnable, false)
  })

  it('deriveDraftAndRunnable: zero source nodes is neither draft nor runnable', () => {
    const flags = deriveDraftAndRunnable([makeSourceNode({ kind: 'sink', type: 'db_sink' })])
    assert.equal(flags.draft, false)
    assert.equal(flags.runnable, false)
  })
})

describe('Preset grouping + search (palette)', () => {
  const grouped = {
    opencli: [preset, { ...preset, id: 'opencli:xueqiu:stock', node_type: 'opencli_source' }],
    rss: [{ ...preset, id: 'rss:hn', channel_type: 'rss', node_type: 'rss_source', label: 'Hacker News' }],
  }

  it('groupPresetsByNodeType regroups by node_type across channel groups', () => {
    const byNodeType = groupPresetsByNodeType(grouped)
    assert.equal(byNodeType.opencli_source.length, 2)
    assert.equal(byNodeType.rss_source.length, 1)
  })

  it('presetMatchesQuery matches label/description/channel_type/node_type case-insensitively', () => {
    assert.equal(presetMatchesQuery(preset, '雪球'), true)
    assert.equal(presetMatchesQuery(preset, 'OPENCLI'), true)
    assert.equal(presetMatchesQuery(preset, 'hot posts'), true)
    assert.equal(presetMatchesQuery(preset, 'nonexistent'), false)
  })

  it('presetMatchesQuery treats an empty/whitespace query as matching everything', () => {
    assert.equal(presetMatchesQuery(preset, ''), true)
    assert.equal(presetMatchesQuery(preset, '   '), true)
  })
})

describe('Validation-error anchoring', () => {
  it('anchorValidationErrors groups by node_id and edge_id, keeping unanchored errors separate', () => {
    const result = anchorValidationErrors([
      { code: 'missing_required_param', message: 'x', node_id: 'n1' },
      { code: 'cycle', message: 'y', node_id: 'n1' },
      { code: 'dangling_edge_source', message: 'z', edge_id: 'e1' },
      { code: 'unknown_target_port', message: 'w', node_id: 'n2', edge_id: 'e2' },
      { code: 'weird', message: 'no anchor' },
    ])
    assert.equal(result.byNode.get('n1')?.length, 2)
    assert.equal(result.byNode.get('n2')?.length, 1)
    assert.equal(result.byEdge.get('e1')?.length, 1)
    assert.equal(result.byEdge.get('e2')?.length, 1)
    assert.equal(result.unanchored.length, 1)
    assert.equal(result.unanchored[0].code, 'weird')
  })

  it('extractPlanValidationErrors reads the array `.detail` a save-call Error carries', () => {
    const err = Object.assign(new Error('Validation failed'), {
      detail: [{ code: 'cycle', message: 'x', node_id: 'n1' }],
    })
    const errors = extractPlanValidationErrors(err)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].code, 'cycle')
  })

  it('extractPlanValidationErrors returns [] for a plain string-message error (not a validation failure)', () => {
    assert.deepEqual(extractPlanValidationErrors(new Error('network down')), [])
    assert.deepEqual(extractPlanValidationErrors(null), [])
    assert.deepEqual(extractPlanValidationErrors('not an error object'), [])
  })
})

describe('detachNode (never deletes the entity)', () => {
  it('removes the node and every edge touching it, keeps the rest', () => {
    const canvas = planGraphToCanvas({
      ir_version: '1.0.0',
      draft: false,
      nodes: [
        makeSourceNode({ id: 'n1' }),
        makeSourceNode({ id: 'n2', kind: 'sink', type: 'db_sink', source_id: undefined, draft: false }),
        makeSourceNode({ id: 'n3', kind: 'sink', type: 'db_sink', source_id: undefined, draft: false }),
      ],
      edges: [
        { id: 'e1', source_node: 'n1', source_port: 'out', target_node: 'n2', target_port: 'in' },
        { id: 'e2', source_node: 'n1', source_port: 'out', target_node: 'n3', target_port: 'in' },
      ],
    })

    const result = detachNode(canvas, 'n1')
    assert.equal(result.nodes.length, 2)
    assert.equal(result.nodes.some((n) => n.id === 'n1'), false)
    assert.equal(result.edges.length, 0)
  })

  it('is a pure function — never mutates the input graph', () => {
    const canvas = planGraphToCanvas({
      ir_version: '1.0.0',
      draft: false,
      nodes: [makeSourceNode({ id: 'n1' })],
      edges: [],
    })
    const before = JSON.stringify(canvas)
    detachNode(canvas, 'n1')
    assert.equal(JSON.stringify(canvas), before)
  })
})

describe('功能组 (Houdini-style subnets): group helpers + buildSubnetView', () => {
  const G = { id: 'g-1', label: '采集' }

  function makeGroupedGraph() {
    // n1(采集) → n2(采集) → n3(ungrouped sink); n1→n2 is intra-group,
    // n2→n3 crosses the group boundary.
    const nodes: PlanNode[] = [
      withCanvasGroup(makeSourceNode({ id: 'n1' }), G),
      withCanvasGroup(
        makeSourceNode({ id: 'n2', kind: 'transform', type: 'dedupe', inputs: [{ name: 'in', type: 'any' }] }),
        G,
      ),
      makeSourceNode({ id: 'n3', kind: 'sink', type: 'sink', inputs: [{ name: 'in', type: 'any' }], outputs: [] }),
    ]
    const edges: PlanEdge[] = [
      { id: 'e1', source_node: 'n1', source_port: 'out', target_node: 'n2', target_port: 'in' },
      { id: 'e2', source_node: 'n2', source_port: 'out', target_node: 'n3', target_port: 'in' },
    ]
    return planGraphToCanvas({ ir_version: '1.0.0', draft: false, nodes, edges })
  }

  it('withCanvasGroup stamps membership into params and readCanvasGroup round-trips it', () => {
    const grouped = withCanvasGroup(makeSourceNode(), G)
    assert.deepEqual(readCanvasGroup(grouped), G)
    assert.equal(readCanvasGroup(withCanvasGroup(grouped, null)), null)
  })

  it('listCanvasGroups returns distinct groups in first-appearance order', () => {
    const g2 = { id: 'g-2', label: '清洗' }
    const nodes = [
      withCanvasGroup(makeSourceNode({ id: 'a' }), G),
      withCanvasGroup(makeSourceNode({ id: 'b' }), g2),
      withCanvasGroup(makeSourceNode({ id: 'c' }), G),
    ]
    assert.deepEqual(listCanvasGroups(nodes), [G, g2])
  })

  it('top level (功能层): collapses members into one subnet and re-anchors boundary edges', () => {
    const view = buildSubnetView(makeGroupedGraph(), null)
    assert.deepEqual(view.nodes.map((n) => n.id), ['n3'])
    assert.equal(view.subnets.length, 1)
    assert.equal(view.subnets[0].memberCount, 2)
    // Intra-group edge n1→n2 disappears; n2→n3 re-anchors onto the subnet id.
    assert.equal(view.edges.length, 1)
    assert.equal(view.edges[0].source, '__subnet-g-1')
    assert.equal(view.edges[0].target, 'n3')
  })

  it('dive level (实现层): shows only members and intra-group wiring', () => {
    const view = buildSubnetView(makeGroupedGraph(), 'g-1')
    assert.deepEqual(view.nodes.map((n) => n.id).sort(), ['n1', 'n2'])
    assert.equal(view.subnets.length, 0)
    assert.deepEqual(view.edges.map((e) => e.id), ['e1'])
  })

  it('ungrouped graph passes through unchanged at the top level', () => {
    const canvas = planGraphToCanvas({
      ir_version: '1.0.0',
      draft: false,
      nodes: [makeSourceNode({ id: 'n1' })],
      edges: [],
    })
    const view = buildSubnetView(canvas, null)
    assert.equal(view.nodes.length, 1)
    assert.equal(view.subnets.length, 0)
  })
})
