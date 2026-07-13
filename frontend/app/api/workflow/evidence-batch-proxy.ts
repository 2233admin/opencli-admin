const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function proxyWorkflowEvidenceBatchRequest(
  req: Request,
  runId: string,
  suffix = "",
): Promise<Response> {
  try {
    const root = `${BACKEND_URL}/api/v1/workflows/runs/${encodeURIComponent(runId)}/evidence-batches`
    const search = new URL(req.url).searchParams.toString()
    const response = await fetch(`${root}${suffix}${search ? `?${search}` : ""}`, {
      headers: {
        ...(req.headers.get("authorization")
          ? { Authorization: req.headers.get("authorization") as string }
          : {}),
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
        error: "WORKFLOW_EVIDENCE_BATCH_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unknown EvidenceBatch fetch error",
      },
      { status: 502 },
    )
  }
}
