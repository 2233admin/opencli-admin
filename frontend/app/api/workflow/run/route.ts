import workflowFixture from "../../../../lib/workflow/fixtures/workflow-intelligence.json"
import { parseWorkflowProject } from "../../../../lib/workflow/schema"

export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({ project: workflowFixture }))
    const project = parseWorkflowProject(body?.project ?? body ?? workflowFixture)
    const response = await fetch(`${BACKEND_URL}/api/v1/workflows/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.get("authorization")
          ? { Authorization: req.headers.get("authorization") as string }
          : {}),
      },
      body: JSON.stringify({
        project,
        ...(typeof body?.packageNodeId === "string" ? { packageNodeId: body.packageNodeId } : {}),
        ...(typeof body?.runId === "string" ? { runId: body.runId } : {}),
        ...(typeof body?.traceId === "string" ? { traceId: body.traceId } : {}),
        ...(body?.sourceOutputs && typeof body.sourceOutputs === "object"
          ? { sourceOutputs: body.sourceOutputs }
          : {}),
        ...(body?.trigger && typeof body.trigger === "object"
          ? { trigger: body.trigger }
          : {}),
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
        error: "WORKFLOW_RUN_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow run error",
      },
      { status: 400 },
    )
  }
}
