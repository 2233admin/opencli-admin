export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function POST(req: Request) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/workflows/fleet/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.get("authorization")
          ? { Authorization: req.headers.get("authorization") as string }
          : {}),
      },
      body: await req.text(),
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
        error: "WORKFLOW_FLEET_MATCH_FAILED",
        message: error instanceof Error ? error.message : "Unknown workflow fleet match error",
      },
      { status: 502 },
    )
  }
}
