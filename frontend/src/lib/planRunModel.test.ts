import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  evaluateRunGate,
  hasUnmaterializedDraftSource,
  latestHealthByNode,
  markNodesRunning,
  mergeRunState,
  projectHealthOntoSharedNodes,
  projectPlanRunOntoNodes,
  segmentSummary,
  sourceNodeIds,
  toggleLens,
} from './planRunModel.ts'
import type { PlanHealthRead, PlanNode, PlanRunRead, SourceSegmentRead } from '../api/types.ts'

function makeSourceNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: 'n1',
    kind: 'source',
    type: 'rss_source',
    label: 'RSS',
    params: { channel_type: 'rss' },
    required_params: [],
    inputs: [],
    outputs: [{ name: 'out', type: 'records' }],
    source_id: 'src-1',
    draft: false,
    ...overrides,
  }
}

function makeSharedNode(id: string, kind: PlanNode['kind'] = 'transform'): PlanNode {
  return {
    id,
    kind,
    type: kind,
    label: undefined,
    params: {},
    required_params: [],
    inputs: [{ name: 'in', type: 'any' }],
    outputs: kind === 'sink' ? [] : [{ name: 'out', type: 'any' }],
    source_id: undefined,
    draft: false,
  }
}

function makeHealth(overrides: Partial<PlanHealthRead> = {}): PlanHealthRead {
  return {
    id: 'h1',
    plan_id: 'p1',
    run_key: 'run-1',
    node_id: 'merge-1',
    node_type: 'merge',
    success: true,
    duration_ms: 120,
    items_in: 10,
    items_out: 8,
    error_message: null,
    detail: {},
    recorded_at: '2026-07-03T00:00:00Z',
    ...overrides,
  }
}

describe('toggleLens', () => {
  it('flips edit <-> observe', () => {
    assert.equal(toggleLens('edit'), 'observe')
    assert.equal(toggleLens('observe'), 'edit')
  })
})

describe('evaluateRunGate', () => {
  it('blocks a draft plan with reason "draft"', () => {
    assert.deepEqual(evaluateRunGate({ draft: true, runnable: false }), { canRun: false, reason: 'draft' })
  })

  it('blocks a non-draft, non-runnable plan with reason "not-runnable"', () => {
    assert.deepEqual(evaluateRunGate({ draft: false, runnable: false }), { canRun: false, reason: 'not-runnable' })
  })

  it('allows a non-draft runnable plan', () => {
    assert.deepEqual(evaluateRunGate({ draft: false, runnable: true }), { canRun: true })
  })

  it('reports draft over not-runnable when a plan is somehow both', () => {
    assert.deepEqual(evaluateRunGate({ draft: true, runnable: false }), { canRun: false, reason: 'draft' })
  })
})

describe('hasUnmaterializedDraftSource', () => {
  it('true when any source node is an unmaterialized draft', () => {
    const nodes = [makeSourceNode({ id: 'a' }), makeSourceNode({ id: 'b', draft: true, source_id: undefined })]
    assert.equal(hasUnmaterializedDraftSource(nodes), true)
  })

  it('false when every source node is materialized', () => {
    const nodes = [makeSourceNode({ id: 'a' }), makeSourceNode({ id: 'b' })]
    assert.equal(hasUnmaterializedDraftSource(nodes), false)
  })
})

describe('sourceNodeIds / markNodesRunning', () => {
  it('collects only source-kind node ids', () => {
    const nodes = [makeSourceNode({ id: 'a' }), makeSharedNode('t1'), makeSourceNode({ id: 'b' })]
    assert.deepEqual(sourceNodeIds(nodes), ['a', 'b'])
  })

  it('marks every given id running with sequential seq', () => {
    const map = markNodesRunning(['a', 'b'])
    assert.equal(map.a.state, 'running')
    assert.equal(map.b.state, 'running')
    assert.equal(map.a.seq, 0)
    assert.equal(map.b.seq, 1)
  })
})

describe('projectPlanRunOntoNodes', () => {
  it('projects multi-source source_results onto matching node ids', () => {
    const nodes = [makeSourceNode({ id: 'src-node-1', source_id: 'src-1' }), makeSourceNode({ id: 'src-node-2', source_id: 'src-2' })]
    const run: PlanRunRead = {
      plan_id: 'p1',
      source_id: 'src-1',
      task_id: 't1',
      run_id: 'r1',
      success: false,
      collected: 0,
      stored: 0,
      skipped: 0,
      error: null,
      source_results: [
        { node_id: 'src-node-1', source_id: 'src-1', task_id: 't1', run_id: 'r1', success: true, collected: 5, stored: 5, skipped: 0, error: null },
        { node_id: 'src-node-2', source_id: 'src-2', task_id: 't2', run_id: 'r2', success: false, collected: 0, stored: 0, skipped: 0, error: 'boom' },
      ],
      shared_segment: null,
    }
    const map = projectPlanRunOntoNodes(nodes, run)
    assert.equal(map['src-node-1'].state, 'success')
    assert.equal(map['src-node-2'].state, 'error')
    assert.equal(map['src-node-2'].detail.errorMessage, 'boom')
  })

  it('projects a degenerate single-source run via top-level fields', () => {
    const nodes = [makeSourceNode({ id: 'only-node', source_id: 'src-1' })]
    const run: PlanRunRead = {
      plan_id: 'p1',
      source_id: 'src-1',
      task_id: 't1',
      run_id: 'r1',
      success: true,
      collected: 3,
      stored: 3,
      skipped: 0,
      error: null,
      source_results: [],
      shared_segment: null,
    }
    const map = projectPlanRunOntoNodes(nodes, run)
    assert.equal(map['only-node'].state, 'success')
  })

  it('projects a degenerate failure with the error message', () => {
    const nodes = [makeSourceNode({ id: 'only-node', source_id: 'src-1' })]
    const run: PlanRunRead = {
      plan_id: 'p1',
      source_id: 'src-1',
      task_id: 't1',
      run_id: null,
      success: false,
      collected: 0,
      stored: 0,
      skipped: 0,
      error: 'connection refused',
      source_results: [],
      shared_segment: null,
    }
    const map = projectPlanRunOntoNodes(nodes, run)
    assert.equal(map['only-node'].state, 'error')
    assert.equal(map['only-node'].detail.errorMessage, 'connection refused')
  })

  it('does not fabricate an entry when source_id matches no node', () => {
    const nodes = [makeSourceNode({ id: 'only-node', source_id: 'src-999' })]
    const run: PlanRunRead = {
      plan_id: 'p1',
      source_id: 'src-unknown',
      task_id: 't1',
      run_id: 'r1',
      success: true,
      collected: 1,
      stored: 1,
      skipped: 0,
      error: null,
      source_results: [],
      shared_segment: null,
    }
    const map = projectPlanRunOntoNodes(nodes, run)
    assert.deepEqual(map, {})
  })
})

describe('segmentSummary', () => {
  it('formats collected/stored/skipped counts', () => {
    const seg: SourceSegmentRead = { node_id: 'n1', success: true, collected: 5, stored: 4, skipped: 1 }
    assert.equal(segmentSummary(seg), 'collected 5 · stored 4 · skipped 1')
  })
})

describe('latestHealthByNode', () => {
  it('keeps the newest row per node_id', () => {
    const older = makeHealth({ node_id: 'merge-1', recorded_at: '2026-07-01T00:00:00Z', success: false })
    const newer = makeHealth({ node_id: 'merge-1', recorded_at: '2026-07-02T00:00:00Z', success: true })
    const map = latestHealthByNode([older, newer])
    assert.equal(map.get('merge-1')?.success, true)
  })

  it('tracks multiple distinct nodes independently', () => {
    const a = makeHealth({ node_id: 'merge-1' })
    const b = makeHealth({ node_id: 'sink-1', node_type: 'sink' })
    const map = latestHealthByNode([a, b])
    assert.equal(map.size, 2)
  })
})

describe('projectHealthOntoSharedNodes', () => {
  it('projects the latest health row onto its shared node', () => {
    const nodes = [makeSourceNode({ id: 'src-1' }), makeSharedNode('merge-1', 'merge')]
    const health = [makeHealth({ node_id: 'merge-1', success: true, duration_ms: 42, items_in: 10, items_out: 9 })]
    const map = projectHealthOntoSharedNodes(nodes, health)
    assert.equal(map['merge-1'].state, 'success')
    assert.equal(map['merge-1'].detail.durationMs, 42)
    assert.equal(map['merge-1'].detail.outputPreview, 'in 10 · out 9')
    assert.equal('src-1' in map, false)
  })

  it('projects a failing shared node as error with its message', () => {
    const nodes = [makeSharedNode('sink-1', 'sink')]
    const health = [makeHealth({ node_id: 'sink-1', node_type: 'sink', success: false, error_message: 'db down' })]
    const map = projectHealthOntoSharedNodes(nodes, health)
    assert.equal(map['sink-1'].state, 'error')
    assert.equal(map['sink-1'].detail.errorMessage, 'db down')
  })

  it('leaves a shared node with no recorded health row absent from the map (honest no-data)', () => {
    const nodes = [makeSharedNode('merge-1', 'merge'), makeSharedNode('merge-2', 'merge')]
    const health = [makeHealth({ node_id: 'merge-1' })]
    const map = projectHealthOntoSharedNodes(nodes, health)
    assert.equal('merge-1' in map, true)
    assert.equal('merge-2' in map, false)
  })

  it('never includes source nodes even when a health row somehow names one', () => {
    const nodes = [makeSourceNode({ id: 'src-1' })]
    const health = [makeHealth({ node_id: 'src-1', node_type: 'source' })]
    const map = projectHealthOntoSharedNodes(nodes, health)
    assert.deepEqual(map, {})
  })
})

describe('mergeRunState', () => {
  it('is right-biased on key collision', () => {
    const a = { x: { nodeId: 'x', state: 'running' as const, detail: {}, seq: 0 } }
    const b = { x: { nodeId: 'x', state: 'success' as const, detail: {}, seq: 1 } }
    assert.equal(mergeRunState(a, b).x.state, 'success')
  })

  it('keeps entries unique to either side', () => {
    const a = { x: { nodeId: 'x', state: 'running' as const, detail: {}, seq: 0 } }
    const b = { y: { nodeId: 'y', state: 'success' as const, detail: {}, seq: 1 } }
    const merged = mergeRunState(a, b)
    assert.equal(merged.x.state, 'running')
    assert.equal(merged.y.state, 'success')
  })
})
