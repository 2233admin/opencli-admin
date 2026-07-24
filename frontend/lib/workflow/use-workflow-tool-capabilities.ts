"use client"

import { useEffect, useState } from "react"

import {
  fetchWorkflowToolCapabilities,
  type WorkflowToolCapability,
} from "./backend-tool-capabilities"

let cachedTools: WorkflowToolCapability[] | null = null
let inFlight: Promise<WorkflowToolCapability[]> | null = null

export function useWorkflowToolCapabilities(enabled = true) {
  const [tools, setTools] = useState<WorkflowToolCapability[]>(cachedTools ?? [])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled && cachedTools === null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    const request =
      inFlight ??
      fetchWorkflowToolCapabilities().then((response) =>
        response.tools.filter((tool) => tool.executor.mode === "native_intelligence"),
      )
    inFlight = request
    request
      .then((value) => {
        cachedTools = value
        if (!cancelled) {
          setTools(value)
          setError(null)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Tool capability fetch failed")
        }
      })
      .finally(() => {
        if (inFlight === request) inFlight = null
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { tools, error, loading }
}
