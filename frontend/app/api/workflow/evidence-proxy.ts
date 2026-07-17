const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function proxyWorkflowEvidenceRequest(
  req: Request,
  runId: string,
  suffix = "",
): Promise<Response> {
  try {
    const url = new URL(req.url)
    const search = url.searchParams.toString()
    const response = await fetch(
      `${BACKEND_URL}/api/v1/workflows/runs/${encodeURIComponent(runId)}${suffix}${search ? `?${search}` : ""}`,
      {
        headers: {
          ...(req.headers.get("authorization")
            ? { Authorization: req.headers.get("authorization") as string }
            : {}),
        },
        cache: "no-store",
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
        error: "WORKFLOW_EVIDENCE_PROJECTION_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow evidence projection error",
      },
      { status: 502 },
    )
  }
}
