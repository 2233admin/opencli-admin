import workflowFixture from "../../../../../lib/workflow/fixtures/workflow-intelligence.json"
import { parseWorkflowProject } from "../../../../../lib/workflow/schema"

export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const project = parseWorkflowProject(body?.project ?? workflowFixture)
    const response = await fetch(`${BACKEND_URL}/api/v1/workflows/import/external-runtime`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...forwardedRequestAuthHeaders(req),
      },
      body: JSON.stringify({
        project,
        runtime: body?.runtime,
        graph: body?.graph,
        ...(typeof body?.name === "string" ? { name: body.name } : {}),
        ...(typeof body?.locale === "string" ? { locale: body.locale } : {}),
      }),
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
        error: "WORKFLOW_IMPORT_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow import error",
      },
      { status: 400 },
    )
  }
}
import { forwardedRequestAuthHeaders } from "@/lib/workflow/request-auth"
