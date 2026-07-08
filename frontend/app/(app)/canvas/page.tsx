import { ErrorBoundary } from '@/components/error-boundary'
import { WorkflowEditor } from '@/components/flow/workflow-editor'

export default function CanvasPage() {
  return (
    <div className="h-full w-full overflow-hidden">
      <ErrorBoundary label="WorkflowEditor">
        <WorkflowEditor />
      </ErrorBoundary>
    </div>
  )
}
