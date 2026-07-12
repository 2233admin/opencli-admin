export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function GET(req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/workflows/runs/${encodeURIComponent(runId)}`, {
      headers: {
        ...forwardedRequestAuthHeaders(req),
      },
      cache: "no-store",
    })
    const payload = await response.json().catch(() => null)
    return Response.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "WORKFLOW_RUN_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow run fetch error",
      },
      { status: 502 },
    )
  }
}
import { forwardedRequestAuthHeaders } from "@/lib/workflow/request-auth"
