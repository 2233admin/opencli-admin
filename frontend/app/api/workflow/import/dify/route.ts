export const dynamic = "force-dynamic"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json(
      {
        success: false,
        error: "DIFY_IMPORT_REQUEST_INVALID",
        message: "Dify import request must be valid JSON.",
      },
      { status: 400 },
    )
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/workflows/import/dify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.get("authorization")
          ? { Authorization: req.headers.get("authorization") as string }
          : {}),
      },
      body: JSON.stringify({
        source: readProperty(body, "source"),
        ...(typeof readProperty(body, "name") === "string" ? { name: readProperty(body, "name") } : {}),
      }),
    })
    const payload = await response.json().catch(() => null)
    return Response.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    void error
    return Response.json(
      {
        success: false,
        error: "DIFY_BACKEND_UNAVAILABLE",
        message: "The workflow import service is unavailable.",
      },
      { status: 503 },
    )
  }
}

function readProperty(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined
}
