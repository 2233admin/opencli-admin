"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  fetchWorkflowOpenCLIAdapterNodes,
  type WorkflowOpenCLIAdapterNodesResponse,
} from "@/lib/workflow/backend-opencli-adapter-nodes"
import {
  groupOpenCLIAdapterPlugins,
  summarizeOpenCLIAdapterPlugins,
} from "./opencli-adapter-catalog"

type RegistryState = {
  response: WorkflowOpenCLIAdapterNodesResponse | null
  error: string | null
  loading: boolean
}

const INITIAL_STATE: RegistryState = {
  response: null,
  error: null,
  loading: false,
}

export function useOpenCLIAdapterRegistry(enabled = true) {
  const [state, setState] = useState<RegistryState>(INITIAL_STATE)

  const load = useCallback(async ({
    forceRefresh = false,
    signal,
  }: {
    forceRefresh?: boolean
    signal?: AbortSignal
  } = {}) => {
    setState((current) => ({ ...current, error: null, loading: true }))
    try {
      const response = await fetchWorkflowOpenCLIAdapterNodes({
        includeWrite: true,
        limit: 5000,
        refresh: forceRefresh,
        signal,
      })
      if (signal?.aborted) return
      setState({ response, error: null, loading: false })
    } catch (error) {
      if (signal?.aborted) return
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "OpenCLI adapter registry unavailable",
        loading: false,
      }))
    }
  }, [])

  const refresh = useCallback(() => load({ forceRefresh: true }), [load])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void load({ signal: controller.signal })
    return () => controller.abort()
  }, [enabled, load])

  const plugins = useMemo(
    () => groupOpenCLIAdapterPlugins(state.response?.nodes ?? []),
    [state.response],
  )
  const summary = useMemo(() => summarizeOpenCLIAdapterPlugins(plugins), [plugins])

  return { ...state, plugins, summary, refresh }
}
