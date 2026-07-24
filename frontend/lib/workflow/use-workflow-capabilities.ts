"use client"

import { useEffect, useMemo, useState } from "react"
import { useBackendNodeCapabilityCatalog } from "@/lib/plugins/backend-node-capabilities"
import { mergeBackendNodeCapabilityCatalog } from "./backend-node-capability-adapter"
import { fetchWorkflowCapabilities } from "./backend-capabilities"
import type { WorkflowCapabilitiesResponse } from "./capabilities"

let cachedCapabilities: WorkflowCapabilitiesResponse | null = null
let inFlight: Promise<WorkflowCapabilitiesResponse> | null = null

export function useWorkflowCapabilities(enabled = true) {
  const nodeCatalog = useBackendNodeCapabilityCatalog(enabled)
  const [capabilities, setCapabilities] = useState<WorkflowCapabilitiesResponse | null>(
    cachedCapabilities,
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled && cachedCapabilities === null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(cachedCapabilities === null)
    const request = inFlight ?? fetchWorkflowCapabilities()
    inFlight = request
    request
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
        if (inFlight === request) inFlight = null
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const projectedCapabilities = useMemo(
    () => mergeBackendNodeCapabilityCatalog(capabilities, nodeCatalog.catalog),
    [capabilities, nodeCatalog.catalog],
  )

  return {
    capabilities: projectedCapabilities,
    nodeCatalog: nodeCatalog.catalog,
    error: error && !nodeCatalog.catalog ? error : null,
    catalogError: nodeCatalog.error,
    loading: loading || nodeCatalog.loading,
  }
}
