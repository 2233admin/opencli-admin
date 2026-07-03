import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  formatJsonPreview,
  getAckStatusTone,
  summarizeNotificationResponse,
} from './notificationDisplay.ts'

describe('notification display helpers', () => {
  it('summarizes HTTP response data with status and body preview', () => {
    assert.equal(
      summarizeNotificationResponse({ status_code: 202, body: 'queued for delivery' }),
      'HTTP 202 · queued for delivery',
    )
  })

  it('returns an em dash when response data is missing', () => {
    assert.equal(summarizeNotificationResponse(null), '—')
  })

  it('formats ack data as readable JSON', () => {
    assert.equal(
      formatJsonPreview({ downstream_id: 'msg-1', accepted: true }),
      '{\n  "downstream_id": "msg-1",\n  "accepted": true\n}',
    )
  })

  it('maps ack statuses to table tones', () => {
    assert.equal(getAckStatusTone('acked'), 'success')
    assert.equal(getAckStatusTone('pending'), 'warning')
    assert.equal(getAckStatusTone('failed'), 'danger')
    assert.equal(getAckStatusTone('not_required'), 'muted')
  })
})
