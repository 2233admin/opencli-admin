"use client"

import { useQuery } from "@tanstack/react-query"

import { getApiAuthToken } from "@/lib/api/auth-token"

export type BackendPluginBlocker = {
  code: string
  message: string
}

export type BackendPluginCapability = {
  id: string
  family: "tool" | "model" | "datasource" | "trigger" | "agent_strategy" | "endpoint"
  key: string
  label: string
  sourcePath?: string | null
  status: "READY" | "BLOCKED"
  runtimeAdapterId?: string | null
  blockers: BackendPluginBlocker[]
  flowCapability: boolean
}

export type BackendPluginNodeDefinition = {
  id: string
  label: string
  family: string
  status: "READY" | "BLOCKED"
  locked: boolean
  lockReason?: string | null
  installationId: string
  providerKey: string
  pluginVersion: string
  capabilityId: string
}

export type BackendPluginInstallation = {
  id: string
  providerKey: string
  name: string
  author: string
  version: string
  sourceKind: "manifest" | "difypkg" | "bundled"
  sourceDigest: string
  manifestSpecVersion: string
  signatureState: "unsigned" | "present_unverified" | "bundled"
  labels: Record<string, string>
  descriptions: Record<string, string>
  icon?: string | null
  pluginTypes: string[]
  manifest: Record<string, unknown>
  capabilities: BackendPluginCapability[]
  permissions: Record<string, unknown>
  runtimeStatus: "READY" | "BLOCKED"
  blockers: BackendPluginBlocker[]
  nodeDefinitions: BackendPluginNodeDefinition[]
  bundled: boolean
  installedAt: string
  updatedAt: string
}

type ApiResponse<T> = {
  success?: boolean
  data?: T | null
  error?: string | null
  detail?: { code?: string; message?: string } | string
}

export const PLUGIN_CATALOG_QUERY_KEY = ["plugin-installations"] as const

export async function fetchPluginInstallations(): Promise<BackendPluginInstallation[]> {
  const response = await fetch("/api/v1/plugins", {
    cache: "no-store",
    headers: apiAuthHeaders(),
  })
  const payload = (await response.json().catch(() => null)) as
    | ApiResponse<BackendPluginInstallation[]>
    | null
  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(readApiError(payload, `插件目录读取失败 (${response.status})`))
  }
  return payload.data
}

export async function importDifyPluginPackage(file: File): Promise<BackendPluginInstallation> {
  const body = new FormData()
  body.append("file", file)
  const response = await fetch("/api/v1/plugins/import/dify", {
    method: "POST",
    headers: apiAuthHeaders(),
    body,
  })
  const payload = (await response.json().catch(() => null)) as
    | ApiResponse<BackendPluginInstallation>
    | null
  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(readApiError(payload, `Dify 插件导入失败 (${response.status})`))
  }
  return payload.data
}

export function useBackendPluginCatalog(enabled = true) {
  const query = useQuery({
    queryKey: PLUGIN_CATALOG_QUERY_KEY,
    queryFn: fetchPluginInstallations,
    enabled,
    staleTime: 15_000,
    retry: 1,
  })
  return {
    installations: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}

function readApiError<T>(payload: ApiResponse<T> | null, fallback: string): string {
  if (typeof payload?.detail === "string") return payload.detail
  if (payload?.detail && typeof payload.detail === "object") {
    return payload.detail.message ?? payload.detail.code ?? fallback
  }
  return payload?.error ?? fallback
}

function apiAuthHeaders(): HeadersInit {
  const token = getApiAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
