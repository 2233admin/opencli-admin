import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getApiAuthToken, resolveApiAuthToken } from './apiAuthToken.ts'

describe('resolveApiAuthToken', () => {
  it('returns empty string when neither source is set', () => {
    assert.equal(resolveApiAuthToken(undefined, null), '')
  })

  it('falls back to the build-time token', () => {
    assert.equal(resolveApiAuthToken('built-token', null), 'built-token')
  })

  it('localStorage override wins over build config', () => {
    assert.equal(resolveApiAuthToken('built-token', 'stored-token'), 'stored-token')
  })

  it('treats blank stored values as unset and falls back to build token', () => {
    assert.equal(resolveApiAuthToken('built-token', '   '), 'built-token')
  })

  it('trims surrounding whitespace from the winning token', () => {
    assert.equal(resolveApiAuthToken(undefined, '  stored-token  '), 'stored-token')
    assert.equal(resolveApiAuthToken('  built-token  ', null), 'built-token')
  })

  it('treats a blank build token as unset', () => {
    assert.equal(resolveApiAuthToken('   ', null), '')
  })
})

describe('getApiAuthToken', () => {
  it('returns empty string outside a Vite/browser context (no env, no localStorage)', () => {
    // Under node --test there is no import.meta.env and no localStorage:
    // the dev posture — no token, no Authorization header attached.
    assert.equal(getApiAuthToken(), '')
  })
})
