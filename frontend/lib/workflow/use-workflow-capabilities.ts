"use client"

import { useEffect, useState } from "react"
import { fetchWorkflowCapabilities } from "./backend-capabilities"
import type { WorkflowCapabilitiesResponse } from "./capabilities"

let cachedCapabilities: WorkflowCapabilitiesResponse | null = null
let inFlight: Promise<WorkflowCapabilitiesResponse> | null = null

export function useWorkflowCapabilities(enabled = true) {
  const [capabilities, setCapabilities] = useState<WorkflowCapabilitiesResponse | null>(
    cachedCapabilities,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || cachedCapabilities) return
    let cancelled = false
    inFlight ??= fetchWorkflowCapabilities()
    inFlight
      .then((value) => {
        cachedCapabilities = value
        if (!cancelled) {
          setCapabilities(value)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Workflow capability fetch failed")
        }
      })
      .finally(() => {
        inFlight = null
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { capabilities, error }
}
