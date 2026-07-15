import { Suspense } from 'react'

import { WorkflowEditorSession } from '@/components/flow/workflow-editor-session'
import { WorkflowProjectHeader } from '@/components/studio/workflow-project-header'

export default function WorkspaceWorkflowPage() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label="工作区节点工作流">
      <Suspense fallback={<div className="h-14 shrink-0 border-b bg-card/30" aria-hidden />}>
        <WorkflowProjectHeader />
      </Suspense>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">正在加载工作流…</div>}>
          <WorkflowEditorSession />
        </Suspense>
      </div>
    </div>
  )
}
