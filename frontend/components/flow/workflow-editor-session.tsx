'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Rocket } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/components/error-boundary'
import { WorkflowLifecycleStrip } from '@/components/studio/workflow-lifecycle-strip'
import { loader, Matrix } from '@/components/unlumen-ui/matrix'
import { getProjectWorkflowDraft, publishProjectWorkflow, updateProjectWorkflowDraft, validateProjectWorkflowDraft } from '@/lib/api/endpoints'
import { useWorkspaceProjects } from '@/lib/api/hooks'
import { useFlowStore } from '@/lib/flow/store'
import { useWorkflowCapabilities } from '@/lib/workflow/use-workflow-capabilities'
import { parseWorkflowProject, type WorkflowProject, type WorkflowProjectNode } from '@/lib/workflow/schema'

import { WorkflowEditor } from './workflow-editor'

function persistableProject(project: WorkflowProject): WorkflowProject {
  const persistableNode = (node: WorkflowProjectNode): WorkflowProjectNode => {
    const ui = { ...(node.ui ?? {}) }
    delete ui.runtimeCapability
    return {
      ...node,
      ...(node.ui ? { ui } : {}),
      ...(node.internals
        ? {
            internals: {
              ...node.internals,
              nodes: node.internals.nodes.map((item) => persistableNode(item as WorkflowProjectNode)),
            },
          }
        : {}),
    }
  }
  return { ...project, nodes: project.nodes.map(persistableNode) }
}

const projectFingerprint = (project: WorkflowProject) => JSON.stringify(persistableProject(project))

type WorkflowEditorSessionProps = {
  forceStandalone?: boolean
}

export function WorkflowEditorSession({ forceStandalone = false }: WorkflowEditorSessionProps = {}) {
  const params = useSearchParams()
  const workspaceId = forceStandalone ? null : params.get('workspace')
  const projectId = forceStandalone ? null : params.get('project')
  const requestedWorkflowId = forceStandalone ? null : params.get('workflow')
  const workspaceProjects = useWorkspaceProjects(workspaceId)
  const project = workspaceProjects.data?.find((item) => item.id === projectId)
  const resolvedWorkflowId = requestedWorkflowId ?? project?.primary_workflow_id
  const primaryWorkflowPending = !requestedWorkflowId && workspaceProjects.isLoading
  const workflowProject = useFlowStore((state) => state.workflowProject)
  const importWorkflowProject = useFlowStore((state) => state.importWorkflowProject)
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [documentState, setDocumentState] = useState<'loading' | 'saving' | 'saved' | 'error' | 'conflict'>('loading')
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [validationRunId, setValidationRunId] = useState<string | null>(null)
  const [releaseState, setReleaseState] = useState<'idle' | 'validating' | 'validated' | 'publishing' | 'published' | 'blocked'>('idle')
  const [releaseBlocker, setReleaseBlocker] = useState<string | null>(null)
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null)
  const loaded = useRef(false)
  const revision = useRef<number | null>(null)
  const pendingGraph = useRef<typeof workflowProject | null>(null)
  const lastSavedFingerprint = useRef<string | null>(null)
  const saveQueuePromise = useRef<Promise<void> | null>(null)
  const saveBlocked = useRef(false)
  const { error: capabilityError, loading: capabilityLoading } = useWorkflowCapabilities(true)
  const standalone = !workspaceId || !projectId

  const saveDraft = useCallback(
    (graph: typeof workflowProject) => {
      if (!workspaceId || !projectId || !workflowId || revision.current === null || saveBlocked.current) return Promise.reject(new Error('草稿尚未就绪'))
      const persistableGraph = persistableProject(graph)
      if (lastSavedFingerprint.current === projectFingerprint(persistableGraph)) return Promise.resolve()
      pendingGraph.current = persistableGraph
      setDocumentState('saving')
      if (!saveQueuePromise.current) {
        saveQueuePromise.current = (async () => {
          while (pendingGraph.current) {
            const nextGraph = pendingGraph.current
            pendingGraph.current = null
            try {
              const draft = await updateProjectWorkflowDraft(workspaceId, projectId, workflowId, nextGraph, revision.current!)
              revision.current = draft.revision
              setSavedRevision(draft.revision)
              lastSavedFingerprint.current = projectFingerprint(nextGraph)
            } catch (reason) {
              pendingGraph.current = null
              const status = (reason as Error & { status?: number }).status
              saveBlocked.current = status === 409
              setDocumentState(status === 409 ? 'conflict' : 'error')
              throw reason
            }
          }
          setDocumentState('saved')
        })().finally(() => {
          saveQueuePromise.current = null
        })
      }
      return saveQueuePromise.current
    },
    [projectId, workflowId, workspaceId],
  )

  useEffect(() => {
    if (!workspaceId || !projectId) return
    if (primaryWorkflowPending) return
    let active = true
    loaded.current = false
    revision.current = null
    setSavedRevision(null)
    pendingGraph.current = null
    lastSavedFingerprint.current = null
    saveBlocked.current = false
    setDocumentState('loading')
    ;(async () => {
      try {
        if (!resolvedWorkflowId) throw new Error('项目中没有可编辑的工作流')
        const draft = await getProjectWorkflowDraft(workspaceId, projectId, resolvedWorkflowId)
        if (!active) return
        const graph = parseWorkflowProject(draft.graph)
        importWorkflowProject(graph)
        revision.current = draft.revision
        setSavedRevision(draft.revision)
        lastSavedFingerprint.current = projectFingerprint(graph)
        setWorkflowId(resolvedWorkflowId)
        loaded.current = true
        setDocumentState('saved')
      } catch (reason) {
        if (!active) return
        setDocumentState('error')
        toast.error(reason instanceof Error ? reason.message : '工作流加载失败')
      }
    })()
    return () => {
      active = false
    }
  }, [importWorkflowProject, primaryWorkflowPending, projectId, resolvedWorkflowId, workspaceId])

  useEffect(() => {
    if (!loaded.current || !workspaceId || !projectId || !workflowId) return
    const timer = window.setTimeout(() => {
      saveDraft(workflowProject).catch((reason: Error) => toast.error(`自动保存失败：${reason.message}`))
    }, 800)
    return () => window.clearTimeout(timer)
  }, [projectId, saveDraft, workflowId, workflowProject, workspaceId])

  useEffect(() => {
    if (loaded.current) {
      setReleaseState('idle')
      setValidationRunId(null)
      setReleaseBlocker(null)
      setPublishedVersion(null)
    }
  }, [workflowProject])

  async function validateDraft() {
    if (!workspaceId || !projectId || !workflowId) return
    if (capabilityLoading) {
      toast.info('运行能力目录仍在加载，请稍候再验证')
      return
    }
    if (capabilityError) {
      toast.error('运行能力目录不可用，当前 Draft 不能验证或发布')
      return
    }
    setReleaseState('validating')
    setReleaseBlocker(null)
    try {
      await saveDraft(workflowProject)
      const run = await validateProjectWorkflowDraft(workspaceId, projectId, workflowId)
      if (!run.valid || run.status !== 'completed') {
        const details = run.errors.slice(0, 3).map((error) => error.message).filter(Boolean)
        throw new Error(details.length ? `验证失败：${details.join('；')}` : `验证 Run 状态：${run.status}`)
      }
      setValidationRunId(run.runId)
      setReleaseState('validated')
      toast.success('验证 Run 已通过，可以发布')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '验证失败'
      setReleaseBlocker(message)
      setReleaseState('blocked')
      toast.error(message)
    }
  }

  async function publishDraft() {
    if (!workspaceId || !projectId || !workflowId) return
    if (revision.current === null || !validationRunId) {
      toast.error('请先完成当前 revision 的验证 Run')
      return
    }
    setReleaseState('publishing')
    try {
      const version = await publishProjectWorkflow(workspaceId, projectId, workflowId, {
        reason: '通过工作区画布发布',
        expectedRevision: revision.current,
        validationRunId,
      })
      setPublishedVersion(version.version)
      setReleaseBlocker(null)
      setReleaseState('published')
      toast.success(`Workflow Version ${version.version} 已发布`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '发布失败'
      setReleaseBlocker(message)
      setReleaseState('blocked')
      toast.error(message)
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {standalone ? (
        <ErrorBoundary label="WorkflowEditor">
          <WorkflowEditor />
        </ErrorBoundary>
      ) : documentState === 'loading' ? (
        <div className="grid h-full place-items-center bg-muted/10" aria-busy="true">
          <div className="flex flex-col items-center gap-4 text-sm text-muted-foreground" role="status">
            <Matrix
              rows={7}
              cols={7}
              frames={loader}
              fps={10}
              size={5}
              gap={2}
              palette={{
                on: 'var(--color-primary)',
                off: 'var(--color-muted-foreground)',
              }}
              ariaLabel="正在加载工作流"
            />
            <span>正在加载工作流…</span>
          </div>
        </div>
      ) : !loaded.current ? (
        <div className="grid h-full place-items-center">
          <div className="space-y-3 text-center">
            <p className="text-sm text-destructive">工作流加载失败</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className="size-3.5" />
              重新加载
            </Button>
          </div>
        </div>
      ) : (
        <ErrorBoundary label="WorkflowEditor">
          <WorkflowEditor />
        </ErrorBoundary>
      )}
      {workspaceId && projectId && workflowId ? (
        <div className="absolute inset-x-3 bottom-3 z-40 ml-auto flex max-w-4xl flex-col gap-2 rounded-xl border bg-background/90 p-2 shadow-lg backdrop-blur-xl">
          <WorkflowLifecycleStrip state={documentState === 'error' || documentState === 'conflict' || capabilityError ? 'blocked' : releaseState === 'idle' ? 'draft' : releaseState} revision={savedRevision} publishedVersion={publishedVersion} blockerText={documentState === 'conflict' ? '草稿已在其他位置更新，请重新加载。' : documentState === 'error' ? '草稿保存失败。' : capabilityError ? '运行能力目录不可用，暂时无法验证。' : (releaseBlocker ?? undefined)} />
          <div className="flex items-center justify-end gap-2">
            <div className="flex items-center gap-1.5 px-1.5 text-xs text-muted-foreground" role="status">
              {documentState === 'loading' || documentState === 'saving' ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {documentState === 'saved' ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : null}
              {documentState === 'error' || documentState === 'conflict' ? <AlertTriangle className="size-3.5 text-amber-500" /> : null}
              {
                {
                  loading: '加载中',
                  saving: '保存中',
                  saved: `已保存 · revision ${savedRevision ?? '—'}`,
                  error: '保存失败',
                  conflict: '保存冲突',
                }[documentState]
              }
            </div>
            {documentState === 'conflict' ? (
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="size-3.5" />
                重新加载
              </Button>
            ) : null}
            {documentState === 'error' ? (
              <Button size="sm" variant="outline" onClick={() => void saveDraft(workflowProject)}>
                <RefreshCw className="size-3.5" />
                重试保存
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={validateDraft} disabled={capabilityLoading || Boolean(capabilityError) || releaseState === 'validating' || releaseState === 'publishing'} title={capabilityLoading ? '正在加载运行能力目录' : capabilityError ? '运行能力目录不可用' : undefined}>
              {capabilityLoading || releaseState === 'validating' ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              验证
            </Button>
            <Button size="sm" onClick={publishDraft} disabled={releaseState !== 'validated'}>
              {releaseState === 'publishing' ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
              发布
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
