import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { odpNodeFacts, odpNodeHealth } from './odpNode.ts'
import type { OdpSystemState } from '../../api/types.ts'

function baseState(overrides: Partial<OdpSystemState> = {}): OdpSystemState {
  return {
    ingest: { available: true, healthy: true, error: null },
    stream: {
      available: true,
      name: 'odp.ingest.raw',
      group: 'odp-ingest',
      lag: 0,
      pending: 0,
      oldest_pending_idle_ms: null,
      error: null,
    },
    dlq: { available: true, total: 0, last_24h: 0, error: null },
    store: { available: false, healthy: null, heartbeat_age_seconds: null, note: 'no heartbeat table' },
    outbox: { available: false, unpublished: null, note: 'no odp_outbox table' },
    collected_at: '2026-07-02T00:00:00Z',
    ...overrides,
  }
}

describe('odpNodeHealth', () => {
  it('renders unknown, never healthy, when there is no data yet', () => {
    assert.equal(odpNodeHealth(null), 'unknown')
    assert.equal(odpNodeHealth(undefined), 'unknown')
  })

  it('renders healthy only when every observed section is available and clean', () => {
    assert.equal(odpNodeHealth(baseState()), 'healthy')
  })

  it('never renders healthy when ingest is unavailable (down Redis / odp-ingest)', () => {
    const state = baseState({ ingest: { available: false, healthy: null, error: 'connection refused' } })
    assert.equal(odpNodeHealth(state), 'warning')
  })

  it('never renders healthy when the stream section is unavailable', () => {
    const state = baseState({
      stream: {
        available: false,
        name: 'odp.ingest.raw',
        group: 'odp-ingest',
        lag: null,
        pending: null,
        oldest_pending_idle_ms: null,
        error: 'redis down',
      },
    })
    assert.equal(odpNodeHealth(state), 'warning')
  })

  it('never renders healthy when the dlq section is unavailable', () => {
    const state = baseState({ dlq: { available: false, total: null, last_24h: null, error: 'pg down' } })
    assert.equal(odpNodeHealth(state), 'warning')
  })

  it('renders failed when ingest reports explicitly unhealthy', () => {
    const state = baseState({ ingest: { available: true, healthy: false, error: null } })
    assert.equal(odpNodeHealth(state), 'failed')
  })

  it('renders warning (not healthy) when the DLQ has a 24h backlog', () => {
    const state = baseState({ dlq: { available: true, total: 12, last_24h: 3, error: null } })
    assert.equal(odpNodeHealth(state), 'warning')
  })

  it('renders warning (not healthy) when the stream has pending backlog', () => {
    const state = baseState({
      stream: {
        available: true,
        name: 'odp.ingest.raw',
        group: 'odp-ingest',
        lag: 0,
        pending: 40,
        oldest_pending_idle_ms: 5000,
        error: null,
      },
    })
    assert.equal(odpNodeHealth(state), 'warning')
  })

  it('store/outbox being permanently unavailable by design does not pin the node at warning', () => {
    // baseState() already carries store.available=false / outbox.available=false
    // (matches backend/schemas/odp_state.py's always-unavailable-by-design
    // sections) — the healthy case above already proves this, restated here
    // as an explicit regression guard against accidentally including them.
    const state = baseState()
    assert.equal(state.store.available, false)
    assert.equal(state.outbox.available, false)
    assert.equal(odpNodeHealth(state), 'healthy')
  })
})

describe('odpNodeFacts', () => {
  it('renders a neutral "no data" badge when state is absent', () => {
    const facts = odpNodeFacts(null)
    assert.deepEqual(facts.badges, ['no data'])
    assert.deepEqual(facts.detail, {})
  })

  it('spells out each section explicitly, never silently omitting an unavailable one', () => {
    const state = baseState({ ingest: { available: false, healthy: null, error: 'timeout' } })
    const facts = odpNodeFacts(state)
    assert.ok(facts.badges.some((b) => b === 'ingest: unavailable'))
    assert.equal(facts.detail.ingest_available, false)
    assert.equal(facts.detail.ingest_error, 'timeout')
  })

  it('shows live stream/dlq numbers when sections are available', () => {
    const state = baseState({
      stream: {
        available: true,
        name: 'odp.ingest.raw',
        group: 'odp-ingest',
        lag: 7,
        pending: 2,
        oldest_pending_idle_ms: 1200,
        error: null,
      },
      dlq: { available: true, total: 5, last_24h: 1, error: null },
    })
    const facts = odpNodeFacts(state)
    assert.ok(facts.badges.some((b) => b === 'lag 7 · pending 2'))
    assert.ok(facts.badges.some((b) => b === 'dlq 24h: 1'))
    assert.equal(facts.detail.stream_lag, 7)
    assert.equal(facts.detail.dlq_last_24h, 1)
  })

  it('always surfaces store/outbox as unavailable-by-design, never a fabricated number', () => {
    const facts = odpNodeFacts(baseState())
    assert.ok(facts.badges.includes('store: no heartbeat'))
    assert.ok(facts.badges.includes('outbox: no table'))
  })
})
