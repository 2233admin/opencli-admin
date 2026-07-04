import type { WorkflowProject } from "./schema"

type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export type WorkflowRunStatus = "queued" | "running" | "partial" | "blocked" | "completed" | "failed"

export type WorkflowNodeRunEventType =
  | "queued"
  | "started"
  | "blocked"
  | "batch_ready"
  | "partial"
  | "completed"
  | "failed"

export type WorkflowRunBlockReason = {
  code: string
  message: string
  source?: string | null
  details: Record<string, unknown>
}

export type WorkflowRunBatchReference = {
  batchId: string
  itemCount: number
  recordCount: number
  sourceGroup?: string | null
  adapterTaskId?: string | null
  odpRef?: string | null
  manifestUri?: string | null
}

export type WorkflowNodeRunEvent = {
  id: string
  sequence: number
  workflowId: string
  workflowRunId: string
  traceId: string
  nodeId: string
  eventType: WorkflowNodeRunEventType
  createdAt: string
  packageNodeId?: string | null
  internalNodeId?: string | null
  sourceGroup?: string | null
  message?: string | null
  blockReason?: WorkflowRunBlockReason | null
  batch?: WorkflowRunBatchReference | null
  details: Record<string, unknown>
}

export type WorkflowRunNodeState = {
  nodeId: string
  status: WorkflowRunStatus
  packageNodeId?: string | null
  internalNodeId?: string | null
  sourceGroups: string[]
  latestEventId?: string | null
  eventCount: number
  blockReasons: WorkflowRunBlockReason[]
  batches: WorkflowRunBatchReference[]
}

export type WorkflowRunProjection = {
  workflowId: string
  runId: string
  traceId: string
  valid: boolean
  status: WorkflowRunStatus
  packageNodeId?: string | null
  startedAt: string
  updatedAt: string
  eventCount: number
  nodeStates: WorkflowRunNodeState[]
  errors: Array<{ code: string; message: string; node_id?: string | null; edge_id?: string | null }>
}

export type WorkflowRunStreamReplay = {
  events: WorkflowNodeRunEvent[]
  projection: WorkflowRunProjection | null
}

export async function startWorkflowRun(
  project: WorkflowProject,
  options: { authorization?: string | null } = {},
): Promise<WorkflowRunProjection> {
  const response = await fetch("/api/workflow/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify({ project }),
  })
  return readApiResponse(response, "Workflow run failed")
}

export async function fetchWorkflowRunProjection(
  runId: string,
  options: { authorization?: string | null } = {},
): Promise<WorkflowRunProjection> {
  const response = await fetch(`/api/workflow/runs/${encodeURIComponent(runId)}`, {
    headers: {
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    cache: "no-store",
  })
  return readApiResponse(response, "Workflow run projection failed")
}

export async function fetchWorkflowRunEvents(
  runId: string,
  options: { authorization?: string | null } = {},
): Promise<WorkflowNodeRunEvent[]> {
  const response = await fetch(`/api/workflow/runs/${encodeURIComponent(runId)}/events`, {
    headers: {
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    cache: "no-store",
  })
  return readApiResponse(response, "Workflow run events failed")
}

export async function replayWorkflowRunEventStream(
  runId: string,
  options: { authorization?: string | null } = {},
): Promise<WorkflowRunStreamReplay> {
  const response = await fetch(`/api/workflow/runs/${encodeURIComponent(runId)}/events/stream`, {
    headers: {
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    cache: "no-store",
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(payload?.message ?? payload?.error ?? `Workflow event stream failed (${response.status})`)
  }
  const text = await response.text()
  return parseWorkflowRunEventStream(text)
}

export function parseWorkflowRunEventStream(text: string): WorkflowRunStreamReplay {
  const events: WorkflowNodeRunEvent[] = []
  let projection: WorkflowRunProjection | null = null

  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue
    const eventName = block.match(/^event:\s*(.+)$/m)?.[1]?.trim()
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
    if (!eventName || !data) continue
    if (eventName === "node_event") {
      events.push(JSON.parse(data) as WorkflowNodeRunEvent)
    } else if (eventName === "run_state") {
      projection = JSON.parse(data) as WorkflowRunProjection
    }
  }

  return { events, projection }
}

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message ?? payload?.error ?? `${fallback} (${response.status})`)
  }
  return payload.data
}
