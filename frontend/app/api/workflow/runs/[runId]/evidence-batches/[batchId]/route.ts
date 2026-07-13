import { proxyWorkflowEvidenceBatchRequest } from "../../../../evidence-batch-proxy"

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  context: { params: Promise<{ runId: string; batchId: string }> },
) {
  const { runId, batchId } = await context.params
  return proxyWorkflowEvidenceBatchRequest(req, runId, `/${encodeURIComponent(batchId)}`)
}
