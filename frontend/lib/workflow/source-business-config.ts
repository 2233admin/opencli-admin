import type { DataSource } from "@/lib/api/types"
import type { OpenCLISourceSlot } from "./node-catalog"

const QUERY_KEYS = ["query", "keyword", "q", "searchTerm"] as const

export const SOURCE_MARKET_OPTIONS = [
  { value: "hs-a", label: "全部 A 股" },
  { value: "sh-a", label: "沪市 A 股" },
  { value: "sz-a", label: "深市 A 股" },
  { value: "bj-a", label: "北交所" },
] as const

export const SOURCE_ARGUMENT_LABELS: Record<string, string> = {
  symbol: "证券代码",
  symbols: "证券范围",
  industry: "行业",
  sector: "板块",
  limit: "数量上限",
  page: "页码",
  pageSize: "每页数量",
  maxEntries: "最大条数",
  windowDays: "时间范围（天）",
  since: "开始时间",
  until: "结束时间",
  includeUnknownDates: "包含未知日期",
  product: "数据范围",
}

export function openCLISlotFromDataSource(source: DataSource): OpenCLISourceSlot | undefined {
  if (source.channel_type !== "opencli" || !source.enabled) return undefined
  const site = source.channel_config.site
  const command = source.channel_config.command
  const args = source.channel_config.args
  if (
    typeof site !== "string" ||
    !site.trim() ||
    typeof command !== "string" ||
    !command.trim() ||
    !args ||
    typeof args !== "object" ||
    Array.isArray(args)
  ) {
    return undefined
  }
  return {
    id: `registered-${source.id}`,
    label: source.name,
    sourceGroup: source.tags[0] || "web",
    site,
    command,
    args: { ...(args as Record<string, unknown>) },
    format: typeof source.channel_config.format === "string" ? source.channel_config.format : undefined,
  }
}

export function sourceSlotKey(source: Pick<OpenCLISourceSlot, "site" | "command" | "args">): string {
  return `${source.site}::${source.command}::${stableSerialize(source.args)}`
}

export function sourceBusinessQuery(sources: OpenCLISourceSlot[]): string | undefined {
  for (const source of sources) {
    const key = queryKey(source.args)
    if (key && typeof source.args[key] === "string") return source.args[key] as string
  }
  return undefined
}

export function updateSourceBusinessQuery(
  sources: OpenCLISourceSlot[],
  value: string,
): OpenCLISourceSlot[] {
  return sources.map((source) => {
    const key = queryKey(source.args)
    return key ? { ...source, args: { ...source.args, [key]: value } } : source
  })
}

export function sourceMarket(sources: OpenCLISourceSlot[]): string | undefined {
  for (const source of sources) {
    if (typeof source.args.market === "string") return source.args.market
  }
  return undefined
}

export function updateSourceMarket(
  sources: OpenCLISourceSlot[],
  value: string,
): OpenCLISourceSlot[] {
  return sources.map((source) => (
    Object.prototype.hasOwnProperty.call(source.args, "market")
      ? { ...source, args: { ...source.args, market: value } }
      : source
  ))
}

export function sourceBusinessArguments(
  source: OpenCLISourceSlot,
): Array<[string, string | number | boolean]> {
  return Object.entries(source.args).flatMap(([key, value]) => {
    if (
      QUERY_KEYS.includes(key as (typeof QUERY_KEYS)[number]) ||
      key === "market" ||
      (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    ) {
      return []
    }
    return [[key, value]]
  })
}

function queryKey(args: Record<string, unknown>): (typeof QUERY_KEYS)[number] | undefined {
  return QUERY_KEYS.find((key) => Object.prototype.hasOwnProperty.call(args, key))
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
