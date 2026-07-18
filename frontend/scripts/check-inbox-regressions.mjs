import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('inbox is built only from currently available operational APIs', async () => {
  const page = await read('app/(app)/inbox/page.tsx')
  const hooks = await read('lib/api/hooks.ts')
  const endpoints = await read('lib/api/endpoints.ts')

  assert.match(page, /useInfiniteTasks\(\{ status: 'failed', limit: 100 \}\)/)
  assert.match(page, /useInfiniteTasks\(\{ status: 'pending', limit: 100 \}\)/)
  assert.match(page, /useInfiniteNotificationLogs\(\{ limit: 100 \}\)/)
  assert.match(page, /useInfiniteControlActions\(\{ outcome: 'pending', limit: 100 \}\)/)
  assert.match(hooks, /export function useInfiniteTasks/)
  assert.match(hooks, /export function useInfiniteNotificationLogs/)
  assert.match(hooks, /export function useInfiniteControlActions/)
  assert.match(endpoints, /listNotificationLogs = \(params\?: \{ rule_id\?: string; page\?: number; limit\?: number \}\)/)
  assert.doesNotMatch(page, /useMyWorkspaces|useOperationsInbox|\/workspaces|operations-inbox/)
})

test('inbox uses a Linear-style queue while preserving destinations for underlying records', async () => {
  const page = await read('app/(app)/inbox/page.tsx')

  assert.match(page, /data-testid="inbox-workbench"/)
  assert.match(page, /lg:h-\[calc\(100dvh-3\.5rem\)\]/)
  assert.match(page, /data-testid="inbox-queue-scroll"/)
  assert.match(page, /data-testid="inbox-detail-scroll"/)
  assert.doesNotMatch(page, /<PageContainer/)
  assert.doesNotMatch(page, /className="overflow-hidden rounded-xl border bg-card shadow-sm"/)
  assert.match(page, /ACTION_CENTER_TABS/)
  assert.match(page, /groupQueueItems/)
  assert.match(page, /role="listbox"/)
  assert.match(page, /aria-label="所选信号详情"/)
  assert.match(page, /搜索当前队列/)
  assert.match(page, /按严重程度排列，重复信号自动合并/)
  assert.match(page, /router\.push\(selectedItem\.href\)/)
  assert.match(page, /event\.key\.toLowerCase\(\) === 'j'/)
  assert.match(page, /event\.key\.toLowerCase\(\) === 'k'/)
  assert.match(page, /scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.match(page, /\[content-visibility:auto\]/)
  assert.match(page, /href: `\/tasks\/\$\{task\.id\}`/)
  assert.match(page, /href: '\/notifications'/)
  assert.match(page, /href: '\/control\/actions'/)
  assert.match(page, /href=\{`\/sources\/\$\{item\.sourceId\}`\}/)
})

test('inbox preserves queue state and progressively loads hundreds-scale signal sets', async () => {
  const page = await read('app/(app)/inbox/page.tsx')

  assert.match(page, /useSearchParams\(\)/)
  assert.match(page, /searchParams\.get\('view'\)/)
  assert.match(page, /searchParams\.get\('q'\)/)
  assert.match(page, /const searchParamsKey = searchParams\.toString\(\)/)
  assert.doesNotMatch(page, /\}, \[searchParams\]\)/)
  assert.match(page, /router\.replace\(/)
  assert.match(page, /\.pages\.flatMap\(\(page\) => page\.data\)/)
  assert.match(page, /hasMoreSignals/)
  assert.match(page, /isFetchingNextPage/)
  assert.match(page, /加载更多信号/)
  assert.match(page, /已加载/)
})

test('inbox renders explicit initial, partial, empty, and total failure states', async () => {
  const page = await read('app/(app)/inbox/page.tsx')

  assert.match(page, /const isInitialLoading = queries\.every/)
  assert.match(page, /const isTotalFailure = queries\.every/)
  assert.match(page, /const partialFailures =/)
  assert.match(page, /暂时无法读取，其余信号仍可处理/)
  assert.match(page, /当前视图已经清空/)
  assert.match(page, /<LoadingState rows=\{5\}/)
  assert.match(page, /<ErrorState/)
  assert.match(page, /重新读取/)
})
