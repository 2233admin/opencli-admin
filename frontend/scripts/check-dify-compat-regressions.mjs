import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(frontendRoot, '..')
const windowsPython = path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe')
const unixPython = path.join(repositoryRoot, '.venv', 'bin', 'python')
const pythonExecutable = existsSync(windowsPython)
  ? windowsPython
  : (process.env.PYTHON ?? (existsSync(unixPython) ? unixPython : 'python'))

registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidates = []
    if (specifier.startsWith('@/')) {
      candidates.push(path.join(frontendRoot, specifier.slice(2)))
    } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      candidates.push(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
    }
    for (const candidate of candidates) {
      for (const resolvedPath of [candidate, `${candidate}.ts`, `${candidate}.tsx`]) {
        if (existsSync(resolvedPath)) {
          return { url: pathToFileURL(resolvedPath).href, shortCircuit: true }
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts') || url.endsWith('.tsx')) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
        mode: 'transform',
        sourceMap: true,
        sourceUrl: url,
      })
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

const fixture = readFileSync(path.join(repositoryRoot, 'tests/fixtures/dify/pure_logic.yml'), 'utf8')
const importTypeScript = (relativePath) => import(pathToFileURL(path.join(frontendRoot, relativePath)).href)

test('browser Dify translation is a locked, non-executable preview', async () => {
  const { translateWorkflowDsl } = await importTypeScript('lib/workflow/codec.ts')
  const imported = translateWorkflowDsl(fixture)

  assert.equal(imported.ok, true)
  assert.equal(imported.format, 'dify')
  assert.equal(imported.report.runtimeSource, 'browser-fallback')
  assert.equal(imported.report.executable, false)
  assert.equal(imported.project.nodes.length, 1)
  assert.equal(imported.project.nodes[0].params.packageExecution, 'blocked')
  assert.equal(imported.project.nodes[0].internals.locked, true)
  assert.equal(imported.report.blockers[0].code, 'dify_backend_inspection_required')

  const compiled = spawnSync(pythonExecutable, ['-c', [
    'import json, sys',
    'from backend.schemas.workflow import WorkflowProject',
    'from backend.workflow.compiler import compile_workflow_project',
    'project = WorkflowProject.model_validate(json.load(sys.stdin))',
    'print(compile_workflow_project(project).model_dump_json())',
  ].join('; ')], {
    cwd: repositoryRoot,
    input: JSON.stringify(imported.project),
    encoding: 'utf8',
  })
  assert.equal(compiled.status, 0, compiled.stderr)
  const compileResult = JSON.parse(compiled.stdout)
  assert.equal(compileResult.valid, false)
  assert.ok(compileResult.errors.some((error) => error.code === 'capability_gap'))
})

test('managed Dify translation uses the backend project and readiness report', async () => {
  const { translateWorkflowDsl, translateWorkflowDslManaged } = await importTypeScript('lib/workflow/codec.ts')
  const local = translateWorkflowDsl(fixture)
  assert.equal(local.ok, true)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/workflow/import/dify')
    return Response.json({
      success: true,
      data: {
        project: local.project,
        report: {
          source: 'dify',
          workflowName: local.project.name,
          appMode: 'workflow',
          nodeCount: 4,
          edgeCount: 3,
          sourceSha256: 'a'.repeat(64),
          executable: true,
          blockers: [],
        },
        inspection: {
          loadStatus: 'ready',
          engine: { name: 'graphon', version: '0.7.0', commit: 'b187ce' },
          appMode: 'workflow',
          nodes: [],
          dependencies: [],
          blockers: [],
        },
      },
    })
  }

  try {
    const imported = await translateWorkflowDslManaged(fixture)
    assert.equal(imported.ok, true)
    assert.equal(imported.report.runtimeSource, 'backend')
    assert.equal(imported.report.executable, true)
    assert.equal(imported.report.sourceSha256, 'a'.repeat(64))
    assert.equal(imported.report.inspection.engine.version, '0.7.0')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('managed Dify translation preserves a non-executable preview when the backend is unavailable', async () => {
  const { translateWorkflowDslManaged } = await importTypeScript('lib/workflow/codec.ts')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Graphon offline')
  }

  try {
    const imported = await translateWorkflowDslManaged(fixture)
    assert.equal(imported.ok, true)
    assert.equal(imported.report.runtimeSource, 'browser-fallback')
    assert.equal(imported.report.executable, false)
    assert.match(imported.report.backendError, /Graphon offline/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('browser fallback removes embedded credentials before a preview can be saved', async () => {
  const { translateWorkflowDslManaged } = await importTypeScript('lib/workflow/codec.ts')
  const source = `kind: app
app: {name: Secret fallback, mode: workflow}
workflow:
  graph:
    nodes:
      - id: llm
        data:
          type: llm
          model:
            provider: openai
            name: gpt-test
            api_key: fallback-model-secret
            max_tokens: 512
    edges: []
`
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('backend unavailable')
  }
  try {
    const imported = await translateWorkflowDslManaged(source)
    assert.equal(imported.ok, true)
    const serialized = JSON.stringify(imported.project)
    assert.doesNotMatch(serialized, /fallback-model-secret/)
    assert.match(serialized, /\[REDACTED\]/)
    assert.match(serialized, /max_tokens/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Dify import proxy returns stable client and upstream failure responses', async () => {
  const { POST } = await importTypeScript('app/api/workflow/import/dify/route.ts')
  const malformed = await POST(new Request('http://localhost/api/workflow/import/dify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  }))
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error, 'DIFY_IMPORT_REQUEST_INVALID')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('private upstream details')
  }
  try {
    const unavailable = await POST(new Request('http://localhost/api/workflow/import/dify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: fixture }),
    }))
    const payload = await unavailable.json()
    assert.equal(unavailable.status, 503)
    assert.equal(payload.error, 'DIFY_BACKEND_UNAVAILABLE')
    assert.doesNotMatch(JSON.stringify(payload), /private upstream details/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
