export const dynamic = 'force-dynamic'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:8031'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const response = await fetch(`${BACKEND_URL}/api/v1/workflows/node-edit-draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.get('authorization')
          ? { Authorization: req.headers.get('authorization') as string }
          : {}),
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    return Response.json(payload, { status: response.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: 'WORKFLOW_NODE_EDIT_DRAFT_FAILED',
        message: error instanceof Error ? error.message : 'Unknown workflow node edit error',
      },
      { status: 502 },
    )
  }
}
