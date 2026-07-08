import sampleRows from "../fixtures/jin10-sample.json"

const FLASH_API_URL = "https://flash-api.jin10.com/get_flash_list"
const DETAIL_BASE_URL = "https://flash.jin10.com/detail/"

export type Jin10FlashRow = {
  id: string
  time: string
  title: string
  content: string
  important: boolean
  source: string
  channels: string[]
  tags: string[]
  url?: string
}

export type Jin10FetchOptions = {
  limit?: number
  importantOnly?: boolean
  channel?: string
  hot?: string
  rows?: Jin10FlashRow[]
  fetcher?: typeof fetch
}

export type WorkflowSourceItem = {
  id: string
  source: "jin10"
  occurredAt: string
  title: string
  body: string
  important: boolean
  tags: string[]
  url?: string
  raw: Jin10FlashRow
}

export function fetchJin10Fixture(options: Jin10FetchOptions = {}): WorkflowSourceItem[] {
  const limit = options.limit ?? 20
  const rows = options.rows ?? (sampleRows as Jin10FlashRow[])

  return rows
    .filter((row) => !options.importantOnly || row.important)
    .slice(0, limit)
    .map(normalizeJin10FlashRow)
}

export function buildJin10FlashUrl(params: { channel?: string; hot?: string } = {}): URL {
  const url = new URL(FLASH_API_URL)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
  return url
}

export async function fetchJin10Live(options: Jin10FetchOptions = {}): Promise<WorkflowSourceItem[]> {
  const fetcher = options.fetcher ?? fetch
  const url = buildJin10FlashUrl({ channel: options.channel, hot: options.hot })
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.jin10.com",
      Referer: "https://www.jin10.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "x-app-id": "bVBF4FyRTn5NJF5n",
      "x-version": "1.0.0",
    },
  })
  if (!response.ok) throw new Error(`JIN10 HTTP ${response.status}`)

  const payload = (await response.json()) as { status?: number; message?: string; data?: unknown }
  if (payload.status !== 200 || !Array.isArray(payload.data)) {
    throw new Error(`JIN10 response invalid: ${payload.message ?? "unknown error"}`)
  }

  return payload.data
    .map((item) => normalizeJin10ApiItem(item))
    .filter((item) => item.id && item.body)
    .filter((item) => !options.importantOnly || item.important)
    .slice(0, options.limit ?? 20)
}

export function normalizeJin10FlashRow(row: Jin10FlashRow): WorkflowSourceItem {
  return {
    id: row.id,
    source: "jin10",
    occurredAt: row.time,
    title: row.title,
    body: row.content,
    important: row.important,
    tags: [...new Set([...row.channels, ...row.tags])],
    url: row.url,
    raw: row,
  }
}

export function normalizeJin10ApiItem(item: unknown): WorkflowSourceItem {
  const record = isRecord(item) ? item : {}
  const data = isRecord(record.data) ? record.data : {}
  const id = String(record.id ?? "").trim()
  const split = splitBracketTitleAndContent(
    typeof data.title === "string" ? data.title : "",
    typeof data.content === "string" ? data.content : "",
  )
  const channels = Array.isArray(record.channel) ? record.channel.map((channel) => String(channel)) : []
  const tags = normalizeTags(record.tags)
  const raw: Jin10FlashRow = {
    id,
    time: typeof record.time === "string" ? record.time : "",
    title: split.title,
    content: split.content,
    important: Number(record.important ?? data.star ?? 0) > 0,
    source: typeof data.source === "string" ? data.source : "金十数据",
    channels,
    tags,
    url: id ? `${DETAIL_BASE_URL}${id}` : undefined,
  }
  return normalizeJin10FlashRow(raw)
}

function splitBracketTitleAndContent(title: string, content: string): { title: string; content: string } {
  const cleanedContent = cleanText(content)
  if (title.trim()) return { title: cleanText(title), content: cleanedContent }

  const match = cleanedContent.match(/^【([^】]+)】(.*)$/)
  if (!match) return { title: "", content: cleanedContent }
  return { title: match[1].trim(), content: match[2].trim() }
}

function cleanText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((tag) => {
      if (typeof tag === "string") return tag
      if (isRecord(tag) && typeof tag.name === "string") return tag.name
      return ""
    })
    .filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
