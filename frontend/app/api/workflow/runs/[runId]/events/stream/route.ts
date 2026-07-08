export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function GET(req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/workflows/runs/${encodeURIComponent(runId)}/events/stream`,
      {
        headers: {
          ...(req.headers.get("authorization")
            ? { Authorization: req.headers.get("authorization") as string }
            : {}),
        },
        cache: "no-store",
      },
    )
    const body = await response.text()
    return new Response(body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "WORKFLOW_RUN_STREAM_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow run stream error",
      },
      { status: 502 },
    )
  }
}
