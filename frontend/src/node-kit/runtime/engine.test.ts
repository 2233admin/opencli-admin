import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

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

// ─────────────────────────────────────────────────────────────────────────────
// Dry-Run Preview isolation (Plan IR issue 09). NodeWorkbench.runNow() — the
// component the Dry-Run Preview labeling in this issue targets — calls
// `runGraph(nodes, edges, { signal, observer })` with NO `backend` option. Per
// engine.ts step 3/4, that means: a node with `spec.run` executes that pure
// function; a node WITHOUT `spec.run` and no `opts.backend` hits the
// `_pending` fallback branch and nothing else — the engine never reaches for
// I/O on its own. This is the actual seam to assert at: not "does some node
// happen to avoid fetch today" but "does the code path NodeWorkbench invokes
// have any way to reach the network or persistence, structurally".
//
// The pipeline/primitive/collection/source node modules (node-kit/nodes/*)
// cannot be imported here: they use extensionless internal imports (bundler
// resolution, Vite-only) and the collection/source ones are .tsx (JSX), and
// this suite runs under Node's native --test type-stripping with neither a
// bundler nor a loader — exactly the constraint the pre-existing engine.test.ts
// already worked around by registering trivial specs inline instead of
// importing real ones. Two complementary checks close the loop honestly:
//  1. Dynamic: register specs with the exact real shapes runGraph must
//     handle — a no-run "trigger" node and a no-run "sink" node (mirroring
//     trigger.schedule/sink.record's actual shape: ports but no `run`) plus a
//     pure-function transform (mirroring transform.filter) — run a graph
//     exactly the way NodeWorkbench does (no backend hook), patch
//     globalThis.fetch to throw on any call, and assert it is never invoked
//     and the no-run nodes degrade to the engine's own `_pending` marker
//     rather than silently doing anything.
//  2. Static: the real collection/channel node specs that talk to backend
//     APIs (node-kit/nodes/collection.tsx, sources.tsx) are read as source
//     text and asserted to define `run:` only inside `ops: [...]` (imperative
//     button actions engine.ts's runGraph never calls), never as the
//     top-level `spec.run` the engine actually executes. If someone later
//     adds `run:` to one of those specs backed by `updateSource`/
//     `triggerTask`/etc, this assertion fails and the dry-run/collection
//     boundary is caught before the engine could ever call it.
describe('Dry-Run Preview isolation (engine seam)', () => {
  it('runGraph called the way NodeWorkbench.runNow calls it (no backend hook) never calls fetch, and no-run nodes degrade to _pending', async () => {
    _clearRegistry()
    // Mirrors trigger.schedule (pipeline.ts): ports only, no `run`.
    registerNode({
      type: 'trigger.schedule',
      category: 'control',
      title: '定时触发',
      ports: { inputs: [], outputs: [{ id: 'out' }] },
    })
    // Mirrors `value` (primitives.ts): pure passthrough, real `run`.
    registerNode({
      type: 'value',
      category: 'source',
      title: '常量',
      ports: { inputs: [], outputs: [{ id: 'out' }] },
      run: async (ctx) => ({ out: ctx.config.value }),
    })
    // Mirrors transform.filter (primitives.ts): pure local array filter, real `run`.
    registerNode({
      type: 'transform.filter',
      category: 'transform',
      title: '过滤',
      ports: { inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] },
      run: async (ctx) => {
        const arr = Array.isArray(ctx.inputs.in) ? (ctx.inputs.in as Record<string, unknown>[]) : []
        const path = String(ctx.config.path)
        return { out: arr.filter((r) => String(r?.[path]) === String(ctx.config.equals)) }
      },
    })
    // Mirrors sink.record (pipeline.ts): ports only, no `run`.
    registerNode({
      type: 'sink.record',
      category: 'sink',
      title: '存记录',
      ports: { inputs: [{ id: 'in' }], outputs: [] },
    })

    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalls++
      throw new Error(`Dry-Run Preview engine must never call fetch(${JSON.stringify(args[0])})`)
    }) as typeof fetch

    try {
      // trigger.schedule (no run) -> value (run, pure) -> transform.filter (run, pure) -> sink.record (no run)
      const nodes: RunNode[] = [
        { id: 'trigger', type: 'trigger.schedule', config: { cron: '0 * * * * *', enabled: true } },
        { id: 'val', type: 'value', config: { value: [{ status: 'active' }, { status: 'idle' }] } },
        { id: 'filtered', type: 'transform.filter', config: { path: 'status', equals: 'active' } },
        { id: 'store', type: 'sink.record', config: { dedup_key: 'id' } },
      ]
      const edges: RunEdge[] = [
        { source: 'trigger', target: 'val' },
        { source: 'val', target: 'filtered' },
        { source: 'filtered', target: 'store' },
      ]

      // Exactly NodeWorkbench.runNow's call shape: no `backend` in opts.
      const res = await runGraph(nodes, edges, {
        signal: { aborted: false },
        observer: () => {},
      })

      assert.equal(fetchCalls, 0, 'dry-run engine must perform zero HTTP calls')
      // Nodes without spec.run (trigger.schedule, sink.record) degrade to the
      // engine's declared _pending marker, never to a silently-executed side
      // effect — this is what "persists nothing" looks like at this seam.
      assert.deepEqual(res.outputs.trigger, { _pending: '定时触发 需后端执行（未接 backend runner）' })
      assert.deepEqual(res.outputs.store, { _pending: '存记录 需后端执行（未接 backend runner）' })
      // The pure-function nodes ran locally on the fixture value, unaffected.
      assert.deepEqual(res.outputs.filtered, { out: [{ status: 'active' }] })
      assert.deepEqual(res.errors, {})
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('a backend-shaped decoy spec with no spec.run also degrades to _pending instead of NodeWorkbench silently wiring a runner for it', async () => {
    _clearRegistry()
    let decoyCalled = false
    registerNode({
      type: 'test.would-be-collection-call',
      category: 'source',
      title: 'Decoy',
      ports: { inputs: [], outputs: [{ id: 'out' }] },
      // Deliberately NO `run` — mirrors collection.tsx/sources.tsx's real
      // shape (they only define `ops[].run`, never `spec.run`).
      ops: [{ id: 'op', label: 'op', run: () => { decoyCalled = true } }],
    })
    const nodes: RunNode[] = [{ id: 'a', type: 'test.would-be-collection-call', config: {} }]
    const res = await runGraph(nodes, [], { observer: () => {} })
    assert.equal(decoyCalled, false, 'runGraph must never invoke a node op — only spec.run')
    assert.ok(String(res.outputs.a?._pending ?? '').includes('需后端执行'))
  })

  it('static: collection.tsx and sources.tsx (the specs that actually call collection APIs) define run only under ops[], never as the top-level engine seam', () => {
    const here = fileURLToPath(import.meta.url)
    const nodesDir = new URL('../nodes/', `file://${here.replace(/\\/g, '/')}`)
    for (const file of ['collection.tsx', 'sources.tsx']) {
      const path = fileURLToPath(new URL(file, nodesDir))
      const src = readFileSync(path, 'utf8')
      // Strip every `ops: [ ... ]` array body (which legitimately contains
      // `run:` for imperative buttons) before checking for a bare top-level
      // `run:` key — the engine-seam field defineNode()/NodeSpec declare.
      const withoutOpsArrays = src.replace(/ops:\s*\[[\s\S]*?\n {2}\],?/g, '')
      assert.ok(
        !/^\s*run:/m.test(withoutOpsArrays),
        `${file} must not define a top-level spec.run (the Dry-Run engine's execution seam) — ` +
          `it may only define ops[].run (imperative buttons runGraph never calls)`,
      )
    }
  })
})
