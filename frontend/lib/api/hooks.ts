'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import * as api from './endpoints'
import type { ModelDefaultCandidate, ModelProviderInput, ModelRole } from './types'

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => api.getDashboardStats(),
    refetchInterval: 30_000,
  })
}

export function useDashboardActivity(days = 14) {
  return useQuery({
    queryKey: ['dashboard', 'activity', days],
    queryFn: () => api.getDashboardActivity({ days }),
  })
}

export function useOpinionMonitor() {
  return useQuery({
    queryKey: ['dashboard', 'opinion-monitor'],
    queryFn: () => api.getOpinionMonitor({ range: '7d', limit: 8 }),
    refetchInterval: 30_000,
  })
}

export function useSources(params?: { page?: number; limit?: number; enabled?: boolean }) {
  return useQuery({
    queryKey: ['sources', params],
    queryFn: () => api.listSources(params),
  })
}

export function useTasks(params?: { source_id?: string; status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api.listTasks(params),
  })
}

export function useRecords(params?: {
  source_id?: string
  status?: string
  search?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: ['records', params],
    queryFn: () => api.listRecords(params),
  })
}

export function usePresets() {
  return useQuery({
    queryKey: ['presets'],
    queryFn: () => api.listPresets(),
    staleTime: 5 * 60_000,
  })
}

export function useBrowserActPacks() {
  return useQuery({
    queryKey: ['browser-act-packs'],
    queryFn: () => api.listBrowserActPacks(),
    staleTime: 5 * 60_000,
  })
}

export function usePlans(params?: { draft?: boolean; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['plans', params],
    queryFn: () => api.listPlans(params),
  })
}

export function usePlan(id: string | null) {
  return useQuery({
    queryKey: ['plans', id],
    queryFn: () => api.getPlan(id as string),
    enabled: !!id,
  })
}

export function useSource(id: string | null) {
  return useQuery({
    queryKey: ['sources', id],
    queryFn: () => api.getSource(id as string),
    enabled: !!id,
  })
}

export function useSourceControlState(id: string | null) {
  return useQuery({
    queryKey: ['sources', id, 'control-state'],
    queryFn: () => api.getSourceControlState(id as string),
    enabled: !!id,
    refetchInterval: 15_000,
  })
}

export function useSourceMeasurements(id: string | null, params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['sources', id, 'measurements', params],
    queryFn: () => api.listSourceMeasurements(id as string, params),
    enabled: !!id,
  })
}

export function useSchedules(params?: { source_id?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: ['schedules', params],
    queryFn: () => api.listSchedules(params),
  })
}

export function useAgents(params?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['agents', params],
    queryFn: () => api.listAgents(params),
  })
}

export function useSkills(params?: { domain?: string; enabled?: boolean; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['skills', params],
    queryFn: () => api.listSkills(params),
  })
}

export function useNotificationRules() {
  return useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api.listNotificationRules(),
  })
}

export function useNotificationLogs(params?: { rule_id?: string }) {
  return useQuery({
    queryKey: ['notification-logs', params],
    queryFn: () => api.listNotificationLogs(params),
  })
}

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => api.listProviders(),
  })
}

export function useProviderModels(providerId: string | null) {
  return useQuery({
    queryKey: ['providers', providerId, 'models'],
    queryFn: () => api.listProviderModels(providerId as string),
    enabled: !!providerId,
  })
}

export function useModelDefaults() {
  return useQuery({
    queryKey: ['model-defaults'],
    queryFn: () => api.listModelDefaults(),
  })
}

export function useCreateProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ModelProviderInput) => api.createProvider(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  })
}

export function useUpdateProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ModelProviderInput }) => api.updateProvider(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  })
}

export function useDeleteProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteProvider(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  })
}

// Result is intentionally NOT cached in react-query state long-term by the
// caller — GET /providers never returns the last test outcome, so callers
// keep it in local component state keyed by provider id for the page session.
export function useTestProvider() {
  return useMutation({
    mutationFn: (id: string) => api.testProvider(id),
  })
}

export function useSyncProviderModels() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.syncProviderModels(id),
    onSuccess: (_result, id) => queryClient.invalidateQueries({ queryKey: ['providers', id, 'models'] }),
  })
}

export function useAddProviderModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      data,
    }: {
      providerId: string
      data: Parameters<typeof api.addProviderModel>[1]
    }) => api.addProviderModel(providerId, data),
    onSuccess: (_result, { providerId }) =>
      queryClient.invalidateQueries({ queryKey: ['providers', providerId, 'models'] }),
  })
}

export function useUpdateProviderModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      modelRowId,
      data,
    }: {
      providerId: string
      modelRowId: string
      data: Parameters<typeof api.updateProviderModel>[2]
    }) => api.updateProviderModel(providerId, modelRowId, data),
    onSuccess: (_result, { providerId }) =>
      queryClient.invalidateQueries({ queryKey: ['providers', providerId, 'models'] }),
  })
}

export function useDeleteProviderModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, modelRowId }: { providerId: string; modelRowId: string }) =>
      api.deleteProviderModel(providerId, modelRowId),
    onSuccess: (_result, { providerId }) =>
      queryClient.invalidateQueries({ queryKey: ['providers', providerId, 'models'] }),
  })
}

export function usePutModelDefault() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ role, candidates }: { role: ModelRole; candidates: ModelDefaultCandidate[] }) =>
      api.putModelDefault(role, candidates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['model-defaults'] }),
  })
}

export function useNodes() {
  return useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.listNodes(),
    refetchInterval: 20_000,
  })
}

export function useWorkers() {
  return useQuery({
    queryKey: ['workers'],
    queryFn: () => api.listWorkers(),
    refetchInterval: 20_000,
  })
}

export function useControlActions(params?: {
  source_id?: string
  mode?: string
  outcome?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: ['control-actions', params],
    queryFn: () => api.listControlActions(params),
  })
}
