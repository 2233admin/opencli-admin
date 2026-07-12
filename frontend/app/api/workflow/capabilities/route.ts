export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function GET(req: Request) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/workflows/capabilities`, {
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
        error: "WORKFLOW_CAPABILITIES_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow capability error",
      },
      { status: 502 },
    )
  }
}
import { forwardedRequestAuthHeaders } from "@/lib/workflow/request-auth"
