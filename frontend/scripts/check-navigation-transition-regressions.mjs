import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('native View Transition integration stays disabled', async () => {
  const sources = await Promise.all([
    read('next.config.mjs'),
    read('app/globals.css'),
    read('components/shell/app-shell.tsx'),
    read('components/shell/app-sidebar.tsx'),
    read('components/shell/route-tabs.tsx'),
  ])
  const combined = sources.join('\n')

  assert.doesNotMatch(combined, /experimental\s*:\s*\{[^}]*viewTransition/s)
  assert.doesNotMatch(combined, /::view-transition-/)
  assert.doesNotMatch(combined, /<ViewTransition\b/)
  assert.doesNotMatch(combined, /transitionTypes=/)
})

test('persistent application chrome stays outside the routed animation boundary', async () => {
  const shell = await read('components/shell/app-shell.tsx')
  const sidebarIndex = shell.indexOf('<AppSidebar />')
  const headerIndex = shell.indexOf('<AppHeader ')
  const transitionIndex = shell.indexOf('<AppRouteTransition>')

  assert.ok(sidebarIndex >= 0, 'AppSidebar should remain mounted')
  assert.ok(headerIndex >= 0, 'AppHeader should remain mounted')
  assert.ok(transitionIndex > sidebarIndex, 'route animation must not wrap the sidebar')
  assert.ok(transitionIndex > headerIndex, 'route animation must not wrap the header')
  assert.match(shell, /<AppRouteTransition>\{children\}<\/AppRouteTransition>/)
  assert.match(
    shell,
    /className="[^"]*relative[^"]*z-0[^"]*overflow-x-clip[^"]*bg-background[^"]*"/,
    'SSGOI positioned parent should keep its stacking, clipping, and background contract',
  )
})

test('SSGOI boundary is pathname-keyed and query-only changes stay local', async () => {
  const transition = await read('components/motion/app-route-transition.tsx')

  assert.match(transition, /const pathname = usePathname\(\)/)
  assert.match(transition, /key=\{pathname\}/)
  assert.match(transition, /data-ssgoi-transition=\{pathname\}/)
  assert.match(transition, /axis\(\{ paths: APP_ROUTES, type: 'x', variant: 'snappy' \}\)/)
  assert.match(transition, /prefersReducedMotion \? STATIC_CONFIG : MOTION_CONFIG/)
})
