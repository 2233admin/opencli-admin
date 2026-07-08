// Server-Side Image Creation
// Renders the workflow graph to a standalone SVG on the server (no headless browser needed).

interface RNode {
  id: string
  position: { x: number; y: number }
  width?: number
  height?: number
  measured?: { width?: number; height?: number }
  parentId?: string
  data?: { label?: string; description?: string; color?: string; nodeType?: string; shape?: string }
}
interface REdge {
  source: string
  target: string
  label?: string
}

const COLORS: Record<string, string> = {
  "var(--chart-1)": "oklch(0.62 0.19 150)",
  "var(--chart-2)": "oklch(0.55 0.2 262)",
  "var(--chart-3)": "oklch(0.7 0.17 60)",
  "var(--chart-4)": "oklch(0.6 0.16 200)",
  "var(--chart-5)": "oklch(0.55 0.02 260)",
  "var(--muted-foreground)": "oklch(0.52 0.02 258)",
}
const BG = "oklch(0.985 0.002 250)"
const CARD = "oklch(1 0 0)"
const FG = "oklch(0.21 0.02 260)"
const MUTED = "oklch(0.52 0.02 258)"
const BORDER = "oklch(0.9 0.008 255)"

function color(c?: string) {
  if (!c) return COLORS["var(--chart-5)"]
  return COLORS[c] ?? c
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export async function POST(req: Request) {
  try {
    const { nodes, edges } = (await req.json()) as { nodes: RNode[]; edges: REdge[] }
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return Response.json({ error: "没有可导出的节点" }, { status: 400 })
    }

    const posOf = new Map<string, { x: number; y: number }>()
    for (const n of nodes) posOf.set(n.id, n.position)

    // resolve absolute positions (account for parent groups)
    const abs = new Map<string, { x: number; y: number; w: number; h: number; n: RNode }>()
    for (const n of nodes) {
      let x = n.position.x
      let y = n.position.y
      if (n.parentId && posOf.has(n.parentId)) {
        x += posOf.get(n.parentId)!.x
        y += posOf.get(n.parentId)!.y
      }
      const w = n.measured?.width ?? (n.width as number) ?? 220
      const h = n.measured?.height ?? (n.height as number) ?? 90
      abs.set(n.id, { x, y, w, h, n })
    }

    const PAD = 60
    const xs = [...abs.values()]
    const minX = Math.min(...xs.map((b) => b.x)) - PAD
    const minY = Math.min(...xs.map((b) => b.y)) - PAD
    const maxX = Math.max(...xs.map((b) => b.x + b.w)) + PAD
    const maxY = Math.max(...xs.map((b) => b.y + b.h)) + PAD
    const W = Math.max(maxX - minX, 200)
    const H = Math.max(maxY - minY, 200)

    const tx = (x: number) => x - minX
    const ty = (y: number) => y - minY

    // edges
    const edgeSvg = edges
      .map((e) => {
        const s = abs.get(e.source)
        const t = abs.get(e.target)
        if (!s || !t) return ""
        const x1 = tx(s.x + s.w / 2)
        const y1 = ty(s.y + s.h)
        const x2 = tx(t.x + t.w / 2)
        const y2 = ty(t.y)
        const dy = Math.max(Math.abs(y2 - y1) * 0.5, 40)
        const path = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        const label = e.label
          ? `<rect x="${midX - e.label.length * 5 - 4}" y="${midY - 10}" width="${e.label.length * 10 + 8}" height="18" rx="4" fill="${CARD}" stroke="${BORDER}"/>` +
            `<text x="${midX}" y="${midY + 3}" font-size="11" fill="${MUTED}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif">${esc(e.label)}</text>`
          : ""
        return `<path d="${path}" fill="none" stroke="${BORDER}" stroke-width="2" marker-end="url(#arrow)"/>${label}`
      })
      .join("\n")

    // nodes
    const nodeSvg = [...abs.values()]
      .map(({ x, y, w, h, n }) => {
        const c = color(n.data?.color)
        const label = esc(n.data?.label ?? "节点")
        const desc = n.data?.description ? esc(n.data.description) : ""
        const isGroup = n.data?.nodeType === "group"
        if (isGroup) {
          return `<g transform="translate(${tx(x)}, ${ty(y)})">
            <rect width="${w}" height="${h}" rx="16" fill="${c}" fill-opacity="0.06" stroke="${c}" stroke-opacity="0.4" stroke-dasharray="6 4"/>
            <text x="16" y="26" font-size="13" font-weight="600" fill="${c}" font-family="ui-sans-serif,system-ui,sans-serif">${label}</text>
          </g>`
        }
        return `<g transform="translate(${tx(x)}, ${ty(y)})">
          <rect width="${w}" height="${h}" rx="12" fill="${CARD}" stroke="${BORDER}" stroke-width="1.5"/>
          <rect width="4" height="${h}" rx="2" fill="${c}"/>
          <circle cx="26" cy="26" r="12" fill="${c}" fill-opacity="0.16"/>
          <circle cx="26" cy="26" r="4" fill="${c}"/>
          <text x="46" y="24" font-size="13" font-weight="600" fill="${FG}" font-family="ui-sans-serif,system-ui,sans-serif">${label.length > 20 ? label.slice(0, 20) + "…" : label}</text>
          ${desc ? `<text x="46" y="42" font-size="11" fill="${MUTED}" font-family="ui-sans-serif,system-ui,sans-serif">${desc.length > 26 ? desc.slice(0, 26) + "…" : desc}</text>` : ""}
        </g>`
      })
      .join("\n")

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${BORDER}"/>
    </marker>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${edgeSvg}
  ${nodeSvg}
</svg>`

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="workflow-${Date.now()}.svg"`,
      },
    })
  } catch (err) {
    console.log("[v0] render error:", err instanceof Error ? err.message : String(err))
    return Response.json({ error: "服务端成图失败" }, { status: 500 })
  }
}
