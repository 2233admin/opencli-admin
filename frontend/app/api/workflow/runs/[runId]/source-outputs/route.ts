export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function POST(req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params
  try {
    const body = await req.json()
    const response = await fetch(
      `${BACKEND_URL}/api/v1/workflows/runs/${encodeURIComponent(runId)}/source-outputs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.headers.get("authorization")
            ? { Authorization: req.headers.get("authorization") as string }
            : {}),
        },
        body: JSON.stringify(body),
      },
    )
    const payload = await response.json().catch(() => null)
    return Response.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "WORKFLOW_RUN_CONTINUATION_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow run continuation error",
      },
      { status: 502 },
    )
  }
}
