export const NATIVE_RESULT_PREVIEW_MAX_CHARS = 4_096
export const NATIVE_RESULT_PREVIEW_MAX_ARRAY_ITEMS = 8
export const NATIVE_RESULT_PREVIEW_MAX_OBJECT_KEYS = 24
export const NATIVE_RESULT_PREVIEW_MAX_STRING_CHARS = 320
export const NATIVE_RESULT_PREVIEW_MAX_DEPTH = 6

const PRIORITY_KEYS = [
  "status",
  "state",
  "domainState",
  "sessionId",
  "version",
  "action",
  "command",
  "artifactId",
  "artifactIds",
  "kind",
  "groundingArtifactIds",
  "question",
  "answer",
  "answers",
  "artifacts",
  "payload",
  "report",
  "sections",
  "timeline",
  "query",
  "result",
] as const

export function formatNativeIntelligenceResultPreview(value: unknown): string {
  const projected = projectPreviewValue(value, 0, new WeakSet<object>())
  const serialized = JSON.stringify(projected, null, 2) ?? String(projected)
  if (serialized.length <= NATIVE_RESULT_PREVIEW_MAX_CHARS) return serialized

  const suffix = `\n… {"$truncated":"preview exceeded ${NATIVE_RESULT_PREVIEW_MAX_CHARS} characters"}`
  return `${serialized.slice(0, NATIVE_RESULT_PREVIEW_MAX_CHARS - suffix.length)}${suffix}`
}

function projectPreviewValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === "string") return truncateString(value)
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value
  }
  if (typeof value === "bigint") return String(value)
  if (value === undefined) return "[undefined]"
  if (typeof value !== "object") return String(value)
  if (depth >= NATIVE_RESULT_PREVIEW_MAX_DEPTH) {
    return {
      $truncated: "depth limit",
      $depth: depth,
      $type: Array.isArray(value) ? "array" : "object",
    }
  }
  if (ancestors.has(value)) return { $truncated: "circular reference" }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, NATIVE_RESULT_PREVIEW_MAX_ARRAY_ITEMS)
        .map((item) => projectPreviewValue(item, depth + 1, ancestors))
      if (value.length <= NATIVE_RESULT_PREVIEW_MAX_ARRAY_ITEMS) return items
      return {
        $count: value.length,
        $items: items,
        $truncated: value.length - items.length,
      }
    }

    const entries = Object.entries(value as Record<string, unknown>)
    const byKey = new Map(entries)
    const selectedKeys = [
      ...PRIORITY_KEYS.filter((key) => byKey.has(key)),
      ...entries.map(([key]) => key).filter(
        (key) => !PRIORITY_KEYS.includes(key as (typeof PRIORITY_KEYS)[number]),
      ),
    ].slice(0, NATIVE_RESULT_PREVIEW_MAX_OBJECT_KEYS)
    const result: Record<string, unknown> = {}
    for (const key of selectedKeys) {
      result[key] = projectPreviewValue(byKey.get(key), depth + 1, ancestors)
    }
    if (entries.length > selectedKeys.length) {
      result.$keyCount = entries.length
      result.$truncated = entries.length - selectedKeys.length
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

function truncateString(value: string): string {
  if (value.length <= NATIVE_RESULT_PREVIEW_MAX_STRING_CHARS) return value
  const omitted = value.length - NATIVE_RESULT_PREVIEW_MAX_STRING_CHARS
  return `${value.slice(0, NATIVE_RESULT_PREVIEW_MAX_STRING_CHARS)}… [truncated ${omitted} chars]`
}
