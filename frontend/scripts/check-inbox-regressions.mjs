import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('inbox is built only from currently available operational APIs', async () => {
  const page = await read('app/(app)/inbox/page.tsx')

  assert.match(page, /useTasks\(\{ status: 'failed', limit: 50 \}\)/)
  assert.match(page, /useTasks\(\{ status: 'pending', limit: 50 \}\)/)
  assert.match(page, /useNotificationLogs\(\)/)
  assert.match(page, /useControlActions\(\{ outcome: 'pending', limit: 50 \}\)/)
  assert.doesNotMatch(page, /useMyWorkspaces|useOperationsInbox|\/workspaces|operations-inbox/)
})

test('inbox explains actions and preserves destinations for the underlying records', async () => {
  const page = await read('app/(app)/inbox/page.tsx')

  assert.match(page, /先处理失败运行/)
  assert.match(page, /推进等待事项/)
  assert.match(page, /复核控制结果/)
  assert.match(page, /href="\/tasks"/)
  assert.match(page, /href="\/notifications"/)
  assert.match(page, /href="\/control\/actions"/)
  assert.match(page, /href=\{`\/sources\/\$\{task\.source_id\}`\}/)
  assert.match(page, /href=\{`\/sources\/\$\{action\.source_id\}`\}/)
})

test('inbox renders explicit initial, partial, empty, and total failure states', async () => {
  const page = await read('app/(app)/inbox/page.tsx')

  assert.match(page, /const isInitialLoading = queries\.every/)
  assert.match(page, /const isTotalFailure = queries\.every/)
  assert.match(page, /这一组暂时无法读取/)
  assert.match(page, /其他待办仍可处理/)
  assert.match(page, /isLoading=\{pendingTasks\.isLoading && notificationLogs\.isLoading\}/)
  assert.match(page, /isError=\{pendingTasks\.isError && notificationLogs\.isError\}/)
  assert.match(page, /当前没有需要你处理的事项/)
  assert.match(page, /<LoadingState rows=\{5\}/)
  assert.match(page, /<ErrorState/)
  assert.match(page, /重新读取/)
})
