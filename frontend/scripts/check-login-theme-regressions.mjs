import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('login keeps the liquid, terminal, and pixel theme switcher', async () => {
  const login = await read('app/login/page.tsx')

  assert.match(login, /type LoginBackdrop = 'liquid' \| 'terminal' \| 'pixel'/)
  assert.match(login, /aria-label="登录背景主题"/)
  assert.match(login, /<PixelLiquidBg/)
  assert.match(login, /<FaultyTerminal/)
  assert.match(login, /<Dither/)
})

test('login preserves the current auth paths and reduced-motion fallback', async () => {
  const login = await read('app/login/page.tsx')

  assert.match(login, /signInWithOidc/)
  assert.match(login, /signInWithBootstrap/)
  assert.match(login, /enterDevelopmentMode/)
  assert.match(login, /prefers-reduced-motion: reduce/)
})

test('auth defaults return to the project list instead of a contextless workflow', async () => {
  const [provider, oidc] = await Promise.all([
    read('components/auth/auth-provider.tsx'),
    read('lib/auth/oidc.ts'),
  ])

  assert.match(provider, /returnTo = ['"]\/studio['"]/)
  assert.doesNotMatch(provider, /returnTo = ['"]\/studio\/workflow['"]/)
  assert.match(oidc, /return ['"]\/studio['"]/)
  assert.doesNotMatch(oidc, /return ['"]\/studio\/workflow['"]/)
})
