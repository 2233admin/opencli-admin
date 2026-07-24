import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const businessSource = await readFile(new URL('../lib/workflow/opencli-business-workflows.ts', import.meta.url), 'utf8')
const catalogSource = await readFile(new URL('../lib/workflow/node-catalog.ts', import.meta.url), 'utf8')
const templateSource = await readFile(new URL('../lib/workflow/studio-templates.ts', import.meta.url), 'utf8')

test('registers two real OpenCLI business workflow templates', () => {
  assert.match(templateSource, /id: 'ashare-market-intelligence'/)
  assert.match(templateSource, /id: 'opencli-situation-awareness'/)
  assert.match(templateSource, /buildAshareMarketWorkflow\(name\)/)
  assert.match(templateSource, /buildOpenCLISituationAwarenessWorkflow\(name\)/)
})

test('A-share workflow covers market, financials, announcements and live news without fixtures', () => {
  for (const command of ['gridlist', 'quote', 'bbsj-summary', 'announcement', 'telegraph', 'news']) {
    assert.match(businessSource, new RegExp(`command: "${command}"`))
  }
  assert.doesNotMatch(businessSource, /runtime:\s*"fixture"|mode:\s*"fixture"/)
  assert.match(businessSource, /deterministicSimulation: false/)
  assert.match(businessSource, /exposeRawSourceItems: true/)
})

test('situation workflow collects cross-platform discovery and stable transcript evidence', () => {
  assert.match(businessSource, /site: "bilibili"[\s\S]*command: "subtitle"/)
  assert.match(businessSource, /site: "youtube"[\s\S]*command: "search"/)
  assert.match(businessSource, /公开来源、时间和采集证据/)
  assert.match(businessSource, /sourceGroup: "video-transcript"/)
})

test('OpenCLI source slots preserve positional command arguments', () => {
  assert.match(catalogSource, /positionalArgs\?: string\[\]/)
  assert.match(catalogSource, /source\.positionalArgs \? \{ positionalArgs: source\.positionalArgs \}/)
  assert.match(businessSource, /positionalArgs: \["600519,000001,300750"\]/)
  assert.match(businessSource, /editable: \["sources", "sources\[\]\.args", "sources\[\]\.positionalArgs"\]/)
})

test('workflow surfaces explicit outputs and source health semantics', () => {
  assert.match(businessSource, /items: "items\[\]"/)
  assert.match(businessSource, /health: "per-source completed\/empty\/failed"/)
  assert.match(businessSource, /records: "record\.v1\[\]", rejected: "rejection\[\]", metrics: "hygieneMetrics"/)
  assert.match(businessSource, /输出 stored、rejected、metrics 与 run trace 引用/)
})
