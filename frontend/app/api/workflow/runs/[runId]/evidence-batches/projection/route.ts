import { proxyWorkflowEvidenceRequest } from "../../../../evidence-proxy"

export const dynamic = "force-dynamic"

export async function GET(req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params
  return proxyWorkflowEvidenceRequest(req, runId, "/projection")
}
