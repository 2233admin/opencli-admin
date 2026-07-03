import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveRunInboxState } from './runInbox.ts'

const baseTask = {
  status: 'completed' as const,
  error_message: undefined,
}

describe('deriveRunInboxState', () => {
  it('keeps local handling state separate from backend execution state', () => {
    assert.equal(deriveRunInboxState(baseTask, undefined, 'resolved'), 'resolved')
    assert.equal(deriveRunInboxState(baseTask, undefined, 'ignored'), 'ignored')
  })

  it('classifies active backend states as running', () => {
    assert.equal(deriveRunInboxState({ ...baseTask, status: 'pending' }), 'running')
    assert.equal(deriveRunInboxState(baseTask, { status: 'running', error_message: undefined }), 'running')
  })

  it('surfaces failed tasks and failed runs as needing attention', () => {
    assert.equal(deriveRunInboxState({ ...baseTask, status: 'failed' }), 'needs_attention')
    assert.equal(
      deriveRunInboxState(baseTask, { status: 'completed', error_message: 'notify failed' }),
      'needs_attention',
    )
  })

  it('sends completed work to review', () => {
    assert.equal(deriveRunInboxState(baseTask), 'ready_to_review')
    assert.equal(deriveRunInboxState({ ...baseTask, status: 'running' }, undefined, 'resolved'), 'resolved')
  })
})
