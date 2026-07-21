import {
  parseWorkflowProject,
  type WorkflowProject,
} from "./schema"
import type {
  DifyCompatibilityBlocker,
  DifyInspectionSummary,
  DifyTranslationReport,
} from "./dify-translator"

type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
  detail?: string | { code?: string; message?: string }
}

type BackendDifyImportResponse = {
  project: unknown
  report: {
    source: "dify"
    workflowName: string
    appMode: string
    nodeCount: number
    edgeCount: number
    sourceSha256: string
    executable: boolean
    blockers: DifyCompatibilityBlocker[]
  }
  inspection: DifyInspectionSummary
}

export type ManagedDifyImportResult = {
  project: WorkflowProject
  report: DifyTranslationReport
}

export async function importDifyWorkflow(
  source: string,
  options: { name?: string; authorization?: string | null } = {},
): Promise<ManagedDifyImportResult> {
  const response = await fetch("/api/workflow/import/dify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify({
      source,
      ...(options.name ? { name: options.name } : {}),
    }),
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<BackendDifyImportResponse> | null
  if (!response.ok || !payload?.data) {
    throw new Error(readApiError(payload) ?? `Dify import failed (${response.status})`)
  }

  const project = parseWorkflowProject(payload.data.project)
  const backendReport = payload.data.report
  return {
    project,
    report: {
      source: "dify",
      workflowName: backendReport.workflowName,
      appMode: backendReport.appMode,
      nodeCount: backendReport.nodeCount,
      edgeCount: backendReport.edgeCount,
      adapterCount: project.adapters.length,
      unsupportedEdgeCount: 0,
      executable: backendReport.executable,
      runtimeSource: "backend",
      blockers: backendReport.blockers,
      sourceSha256: backendReport.sourceSha256,
      inspection: payload.data.inspection,
    },
  }
}

function readApiError(payload: ApiResponse<unknown> | null): string | undefined {
  if (!payload) return undefined
  if (typeof payload.detail === "string") return payload.detail
  if (payload.detail && typeof payload.detail === "object" && typeof payload.detail.message === "string") {
    return payload.detail.message
  }
  return payload.message ?? payload.error
}
