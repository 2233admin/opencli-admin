import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { registerNode, _clearRegistry } from '../registry.ts'
import { runGraph, type RunEdge, type RunNode } from './engine.ts'
import type { RunNodeState } from './runLog.ts'

// Two trivial specs: 'echo' passes its config.value through as output.value;
// 'boom' always throws. Registered fresh per test via _clearRegistry so tests
// don't leak node types into each other.
function registerEcho() {
  registerNode({
    type: 'test.echo',
    category: 'transform',
    title: 'Echo',
    ports: { inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] },
    run: async ({ config, inputs }) => ({ out: inputs.in ?? config.value ?? null }),
  })
}
function registerBoom() {
  registerNode({
    type: 'test.boom',
    category: 'transform',
    title: 'Boom',
    ports: { inputs: [], outputs: [{ id: 'out' }] },
    run: async () => {
      throw new Error('kaboom')
    },
  })
}

describe('runGraph (backward compatibility)', () => {
  it('returns the same shape and values with no observer passed', async () => {
    _clearRegistry()
    registerEcho()
    const nodes: RunNode[] = [{ id: 'a', type: 'test.echo', config: { value: 'hi' } }]
    const res = await runGraph(nodes, [])
    assert.deepEqual(res.order, ['a'])
    assert.deepEqual(res.outputs.a, { out: 'hi' })
    assert.deepEqual(res.errors, {})
    assert.deepEqual(res.artifact.a, { out: 'hi' })
  })

  it('still records node errors in the errors map when a node throws', async () => {
    _clearRegistry()
    registerBoom()
    const nodes: RunNode[] = [{ id: 'a', type: 'test.boom', config: {} }]
    const res = await runGraph(nodes, [])
    assert.equal(res.errors.a, 'kaboom')
  })
})

describe('runGraph observer', () => {
  it('emits queued for every node up front, then running before executing, then success', async () => {
    _clearRegistry()
    registerEcho()
    const nodes: RunNode[] = [
      { id: 'a', type: 'test.echo', config: { value: 1 } },
      { id: 'b', type: 'test.echo', config: {} },
    ]
    const edges: RunEdge[] = [{ source: 'a', target: 'b' }]
    const events: Array<[string, RunNodeState]> = []
    await runGraph(nodes, edges, {
      observer: (id, state) => events.push([id, state]),
    })
    // both queued first, in topo order
    assert.deepEqual(events.slice(0, 2), [
      ['a', 'queued'],
      ['b', 'queued'],
    ])
    // then running/success pairs in execution order: a before b (topo dependency)
    const aRunningIdx = events.findIndex(([id, s]) => id === 'a' && s === 'running')
    const aSuccessIdx = events.findIndex(([id, s]) => id === 'a' && s === 'success')
    const bRunningIdx = events.findIndex(([id, s]) => id === 'b' && s === 'running')
    assert.ok(aRunningIdx < aSuccessIdx)
    assert.ok(aSuccessIdx < bRunningIdx, 'b must not start running before a finishes (sequential exec order observable)')
  })

  it('emits error state with an error message when a node throws', async () => {
    _clearRegistry()
    registerBoom()
    const nodes: RunNode[] = [{ id: 'a', type: 'test.boom', config: {} }]
    const events: Array<{ id: string; state: RunNodeState; detail?: { errorMessage?: string } }> = []
    await runGraph(nodes, [], {
      observer: (id, state, detail) => events.push({ id, state, detail }),
    })
    const errEvt = events.find((e) => e.state === 'error')
    assert.ok(errEvt)
    assert.equal(errEvt?.detail?.errorMessage, 'kaboom')
  })

  it('emits success with a durationMs and an outputPreview', async () => {
    _clearRegistry()
    registerEcho()
    const nodes: RunNode[] = [{ id: 'a', type: 'test.echo', config: { value: 'preview-me' } }]
    let successDetail: { durationMs?: number; outputPreview?: string } | undefined
    await runGraph(nodes, [], {
      observer: (id, state, detail) => {
        if (id === 'a' && state === 'success') successDetail = detail
      },
    })
    assert.ok(successDetail)
    assert.equal(typeof successDetail?.durationMs, 'number')
    assert.ok(successDetail?.outputPreview?.includes('preview-me'))
  })

  it('marks nodes involved in a cycle as skipped via the observer', async () => {
    _clearRegistry()
    registerEcho()
    const nodes: RunNode[] = [
      { id: 'a', type: 'test.echo', config: {} },
      { id: 'b', type: 'test.echo', config: {} },
    ]
    const edges: RunEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]
    const events: Array<[string, RunNodeState]> = []
    await runGraph(nodes, edges, { observer: (id, state) => events.push([id, state]) })
    assert.ok(events.some(([id, s]) => id === 'a' && s === 'skipped'))
    assert.ok(events.some(([id, s]) => id === 'b' && s === 'skipped'))
  })

  it('honors an abort signal by skipping remaining nodes between awaits', async () => {
    _clearRegistry()
    registerEcho()
    const nodes: RunNode[] = [
      { id: 'a', type: 'test.echo', config: { value: 1 } },
      { id: 'b', type: 'test.echo', config: { value: 2 } },
    ]
    const signal = { aborted: false }
    const events: Array<[string, RunNodeState]> = []
    await runGraph(nodes, [], {
      signal,
      observer: (id, state) => {
        events.push([id, state])
        if (id === 'a' && state === 'success') signal.aborted = true
      },
    })
    assert.ok(events.some(([id, s]) => id === 'b' && s === 'skipped'))
    assert.ok(!events.some(([id, s]) => id === 'b' && s === 'running'))
  })
})
