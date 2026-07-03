import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyRunEvent,
  summarizeRun,
  toRunLogRows,
  truncatePreview,
  EMPTY_RUN_STATE,
  type RunStateMap,
} from './runLog.ts'

describe('applyRunEvent', () => {
  it('adds a fresh entry for an unseen node', () => {
    const map = applyRunEvent(EMPTY_RUN_STATE, 'n1', 'queued', {}, 0)
    assert.equal(map.n1.state, 'queued')
    assert.equal(map.n1.seq, 0)
  })

  it('overwrites the same node on later transitions (running -> success)', () => {
    let map: RunStateMap = EMPTY_RUN_STATE
    map = applyRunEvent(map, 'n1', 'queued', {}, 0)
    map = applyRunEvent(map, 'n1', 'running', {}, 1)
    map = applyRunEvent(map, 'n1', 'success', { durationMs: 42, outputPreview: '{"ok":true}' }, 2)
    assert.equal(Object.keys(map).length, 1)
    assert.equal(map.n1.state, 'success')
    assert.equal(map.n1.detail.durationMs, 42)
  })

  it('does not mutate the input map (pure)', () => {
    const before = applyRunEvent(EMPTY_RUN_STATE, 'n1', 'queued', {}, 0)
    const after = applyRunEvent(before, 'n2', 'queued', {}, 1)
    assert.equal(Object.keys(before).length, 1)
    assert.equal(Object.keys(after).length, 2)
  })
})

describe('truncatePreview', () => {
  it('leaves short strings untouched', () => {
    assert.equal(truncatePreview('hello'), 'hello')
  })

  it('truncates long strings with an ellipsis at the given max', () => {
    const s = 'x'.repeat(100)
    const out = truncatePreview(s, 10)
    assert.equal(out.length, 10)
    assert.equal(out.endsWith('…'), true)
  })
})

describe('toRunLogRows', () => {
  it('orders rows by seq (chronological), not by nodeId', () => {
    let map: RunStateMap = EMPTY_RUN_STATE
    map = applyRunEvent(map, 'b', 'success', { durationMs: 5 }, 1)
    map = applyRunEvent(map, 'a', 'success', { durationMs: 3 }, 0)
    const rows = toRunLogRows(map, (id) => `title-${id}`)
    assert.deepEqual(rows.map((r) => r.nodeId), ['a', 'b'])
  })

  it('resolves title via the injected lookup', () => {
    const map = applyRunEvent(EMPTY_RUN_STATE, 'n1', 'running', {}, 0)
    const rows = toRunLogRows(map, () => 'My Node')
    assert.equal(rows[0].title, 'My Node')
  })

  it('formats duration as em-dash when unknown, Nms when known', () => {
    let map: RunStateMap = EMPTY_RUN_STATE
    map = applyRunEvent(map, 'n1', 'running', {}, 0)
    map = applyRunEvent(map, 'n2', 'success', { durationMs: 12 }, 1)
    const rows = toRunLogRows(map, (id) => id)
    assert.equal(rows[0].durationLabel, '—')
    assert.equal(rows[1].durationLabel, '12ms')
  })

  it('carries error text through for error rows', () => {
    const map = applyRunEvent(EMPTY_RUN_STATE, 'n1', 'error', { errorMessage: 'boom' }, 0)
    const rows = toRunLogRows(map, (id) => id)
    assert.equal(rows[0].errorText, 'boom')
    assert.equal(rows[0].stateLabel, 'ERROR')
  })

  it('truncates output preview in the row projection', () => {
    const map = applyRunEvent(EMPTY_RUN_STATE, 'n1', 'success', { outputPreview: 'y'.repeat(200) }, 0)
    const rows = toRunLogRows(map, (id) => id)
    assert.equal(rows[0].outputPreview.length, 80)
  })
})

describe('summarizeRun', () => {
  it('reports 0/0/0ms for an empty run', () => {
    const summary = summarizeRun(EMPTY_RUN_STATE)
    assert.equal(summary.successCount, 0)
    assert.equal(summary.errorCount, 0)
    assert.equal(summary.totalMs, 0)
    assert.equal(summary.label, '0 success / 0 error / 0ms total')
  })

  it('counts success and error terminal states, ignoring queued/running for either bucket', () => {
    let map: RunStateMap = EMPTY_RUN_STATE
    map = applyRunEvent(map, 'a', 'success', { durationMs: 10 }, 0)
    map = applyRunEvent(map, 'b', 'error', { durationMs: 5 }, 1)
    map = applyRunEvent(map, 'c', 'running', {}, 2)
    const summary = summarizeRun(map)
    assert.equal(summary.successCount, 1)
    assert.equal(summary.errorCount, 1)
    assert.equal(summary.totalCount, 3)
    assert.equal(summary.totalMs, 15)
  })

  it('sums duration across all entries that report one', () => {
    let map: RunStateMap = EMPTY_RUN_STATE
    map = applyRunEvent(map, 'a', 'success', { durationMs: 10 }, 0)
    map = applyRunEvent(map, 'b', 'success', { durationMs: 20 }, 1)
    map = applyRunEvent(map, 'c', 'skipped', {}, 2)
    const summary = summarizeRun(map)
    assert.equal(summary.totalMs, 30)
  })
})
