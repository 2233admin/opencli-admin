import { Suspense } from 'react'

import { WorkflowEditorSession } from '@/components/flow/workflow-editor-session'

export default function CanvasPage() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">正在加载工作流…</div>}>
      <WorkflowEditorSession />
    </Suspense>
  )
}
