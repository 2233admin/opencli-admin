import type { WorkflowCapabilitiesResponse } from "./capabilities"

type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export async function fetchWorkflowCapabilities(
  options: { baseUrl?: string; authorization?: string | null } = {},
): Promise<WorkflowCapabilitiesResponse> {
  const baseUrl = options.baseUrl ?? ""
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/workflow/capabilities`, {
      headers: {
        ...workflowRequestAuthHeaders(options.authorization),
      },
      cache: "no-store",
    })
  } catch {
    throw new Error("网络错误：无法连接运行能力目录")
  }
  const payload = (await response.json().catch(() => null)) as ApiResponse<WorkflowCapabilitiesResponse> | null
  if (response.status === 401 || response.status === 403) throw new Error(`权限错误（${response.status}）：无法读取运行能力目录`)
  if (response.status >= 500) throw new Error(`服务错误（${response.status}）：运行能力目录暂不可用`)
  if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? `运行能力目录请求失败（${response.status}）`)
  if (!payload?.data || payload.data.catalog.length === 0) throw new Error("空目录：后端未返回可用节点能力")
  return payload.data
}
import { workflowRequestAuthHeaders } from "./request-auth"
