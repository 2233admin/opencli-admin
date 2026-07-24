import { getApiAuthToken } from '@/lib/api/auth-token'

import type { WorkflowProject } from './schema'

export type WorkflowNodeEditPatch = {
  valid: boolean
  errors: Array<{ code: string; message: string; node_id?: string | null }>
  patch: { operations: Array<Record<string, unknown>> }
  project: WorkflowProject | null
}

export type WorkflowNodeEditDraft = {
  reply: string
  patch: WorkflowNodeEditPatch | null
}

export async function requestWorkflowNodeEditDraft(
  project: WorkflowProject,
  nodeId: string,
  message: string,
): Promise<WorkflowNodeEditDraft> {
  const token = getApiAuthToken()
  const response = await fetch('/api/workflow/node-edit-draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ project, nodeId, message }),
  })
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean
    data?: WorkflowNodeEditDraft
    error?: string
    message?: string
  } | null
  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(payload?.message ?? payload?.error ?? `节点 AI 编辑失败 (${response.status})`)
  }
  return payload.data
}
