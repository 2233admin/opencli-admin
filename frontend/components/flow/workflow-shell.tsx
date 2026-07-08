"use client"

import { Suspense } from "react"
import { ErrorBoundary } from "@/components/error-boundary"
import { HealthCheckGate } from "@/components/health-check-gate"
import { WorkflowEditor } from "@/components/flow/workflow-editor"
import { ErrorLogger } from "@/components/flow/error-logger"

export function WorkflowShell() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <ErrorLogger />
      <ErrorBoundary label="WorkflowEditor">
        <WorkflowEditor />
      </ErrorBoundary>
      <Suspense fallback={null}>
        <HealthCheckGate />
      </Suspense>
    </main>
  )
}
