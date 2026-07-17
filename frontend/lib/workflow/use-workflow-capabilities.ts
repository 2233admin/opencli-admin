"use client"

import { useEffect, useState } from "react"
import { fetchWorkflowCapabilities } from "./backend-capabilities"
import type {
  WorkflowCapabilitiesResponse,
  WorkflowRuntimeCapability,
} from "./capabilities"

const CANVAS_SOURCE_CHANNELS = new Set([
  "opencli",
  "web_scraper",
  "api",
  "rss",
  "cli",
  "skill",
  "crawl4ai",
])

let cachedCapabilities: WorkflowCapabilitiesResponse | null = null
let inFlight: Promise<WorkflowCapabilitiesResponse> | null = null

export function projectCanvasSourceCapabilities(
  capabilities: WorkflowCapabilitiesResponse,
): WorkflowCapabilitiesResponse {
  const catalog = new Map(capabilities.catalog.map((item) => [item.id, item]))
  for (const channel of capabilities.channels) {
    if (!channel.channelType || !CANVAS_SOURCE_CHANNELS.has(channel.channelType)) continue
    const catalogId = `intelligence.source.channel.${channel.channelType}`
    if (!catalog.has(catalogId)) {
      const source = canvasSourceCapability(channel)
      catalog.set(source.id, source)
    }
  }
  return { ...capabilities, catalog: Array.from(catalog.values()) }
}

function canvasSourceCapability(
  channel: WorkflowRuntimeCapability,
): WorkflowRuntimeCapability {
  const manifestCanvas = readRecord(channel.manifest?.canvas)
  const catalogId = readString(manifestCanvas?.catalogId)
    ?? `intelligence.source.channel.${channel.channelType}`
  return {
    ...channel,
    id: catalogId,
    label: readString(manifestCanvas?.label) ?? channel.label,
    surface: "catalog",
    tags: Array.from(new Set([...channel.tags, "catalog"])),
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

export function useWorkflowCapabilities(enabled = true) {
  const [capabilities, setCapabilities] = useState<WorkflowCapabilitiesResponse | null>(
    cachedCapabilities,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const request = inFlight ?? fetchWorkflowCapabilities()
    inFlight = request
    request
      .then((value) => {
        const projected = projectCanvasSourceCapabilities(value)
        cachedCapabilities = projected
        if (!cancelled) {
          setCapabilities(projected)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Workflow capability fetch failed")
        }
      })
      .finally(() => {
        if (inFlight === request) inFlight = null
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { capabilities, error }
}
