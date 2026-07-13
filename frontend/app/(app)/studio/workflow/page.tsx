import { Suspense } from 'react'

import { WorkflowEditorSession } from '@/components/flow/workflow-editor-session'

export default function StudioWorkflowPage() {
  return (
    <div className="h-full min-h-0 overflow-hidden" aria-label="工作室节点工作流">
      <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">正在加载工作流…</div>}>
        <WorkflowEditorSession />
      </Suspense>
    </div>
  )
}
