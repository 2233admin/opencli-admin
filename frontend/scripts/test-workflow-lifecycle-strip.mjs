/**
 * Focused regression test for WorkflowLifecycleStrip's state -> view logic.
 * No test runner is configured in this project (no vitest/jest), so this
 * follows the existing plain-script pattern (see generate-m3-theme.mjs):
 * a standalone Node script run directly, using Node's built-in TypeScript
 * support and the built-in assert module.
 * Usage: node scripts/test-workflow-lifecycle-strip.mjs
 */
import assert from 'node:assert/strict'

import { deriveWorkflowLifecycleView } from '../components/studio/workflow-lifecycle-strip.logic.ts'

let passed = 0

function test(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

test('draft: activation stage carries the not-integrated note', () => {
  const view = deriveWorkflowLifecycleView('draft')
  assert.equal(view.primaryStatusLabel, '草稿')
  const activate = view.stages.find((s) => s.key === 'activate')
  assert.equal(activate.status, 'unavailable')
  assert.equal(activate.note, '待后端接入')
})

test('validating -> validated -> publishing labels are distinct', () => {
  assert.equal(deriveWorkflowLifecycleView('validating').primaryStatusLabel, '验证中')
  assert.equal(deriveWorkflowLifecycleView('validated').primaryStatusLabel, '已验证')
  assert.equal(deriveWorkflowLifecycleView('publishing').primaryStatusLabel, '发布中')
})

test('published: publish stage is done but activation is still unavailable, never active', () => {
  const view = deriveWorkflowLifecycleView('published')
  assert.equal(view.primaryStatusLabel, '已发布')

  const publish = view.stages.find((s) => s.key === 'publish')
  assert.equal(publish.status, 'done')

  const activate = view.stages.find((s) => s.key === 'activate')
  assert.equal(activate.status, 'unavailable')
  assert.notEqual(activate.status, 'active')
  assert.notEqual(activate.status, 'done')
  assert.equal(activate.note, '待后端接入')
})

test('blocked: exactly one blocker message surfaces and validate stage reports error', () => {
  const view = deriveWorkflowLifecycleView('blocked', '节点端口类型不匹配')
  assert.equal(view.primaryStatusLabel, '已阻塞')
  assert.equal(view.blockerText, '节点端口类型不匹配')

  const validate = view.stages.find((s) => s.key === 'validate')
  assert.equal(validate.status, 'error')
})

test('blocker text is only surfaced when state is actually blocked', () => {
  const view = deriveWorkflowLifecycleView('draft', 'stale blocker text should be ignored')
  assert.equal(view.blockerText, undefined)
})

test('every state exposes exactly four stages in a stable order', () => {
  const states = ['draft', 'validating', 'validated', 'publishing', 'published', 'blocked']
  for (const state of states) {
    const view = deriveWorkflowLifecycleView(state)
    assert.deepEqual(
      view.stages.map((s) => s.key),
      ['draft', 'validate', 'publish', 'activate'],
    )
  }
})

console.log(`\n${passed} passed`)
