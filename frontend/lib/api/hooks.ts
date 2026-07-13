'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import * as api from './endpoints'
import type { ApprovalDecision, Automation, ModelDefaultCandidate, ModelProviderInput, ModelRole, OperationsAgentMode } from './types'

export function useMyWorkspaces() {
  return useQuery({ queryKey: ['workspaces'], queryFn: api.listMyWorkspaces })
}

export function useWorkspaceProjects(workspaceId: string | null) {
  return useQuery({
    queryKey: ['workspace-projects', workspaceId],
    queryFn: () => api.listWorkspaceProjects(workspaceId as string),
    enabled: !!workspaceId,
  })
}

export function useCreateWorkspaceProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, data }: { workspaceId: string; data: Parameters<typeof api.createWorkspaceProject>[1] }) => api.createWorkspaceProject(workspaceId, data),
    onSuccess: (_project, { workspaceId }) => queryClient.invalidateQueries({ queryKey: ['workspace-projects', workspaceId] }),
  })
}

export function useCreateProjectWorkflow() {
  return useMutation({
    mutationFn: ({ workspaceId, projectId, data }: { workspaceId: string; projectId: string; data: Parameters<typeof api.createProjectWorkflow>[2] }) => api.createProjectWorkflow(workspaceId, projectId, data),
  })
}

export function useOperationsInbox(workspaceId: string | null, status?: string) {
  return useQuery({
    queryKey: ['operations-inbox', workspaceId, status],
    queryFn: () => api.listOperationsInbox(workspaceId as string, { status, limit: 100 }),
    enabled: !!workspaceId,
    refetchInterval: 15_000,
  })
}

export function useDecideOperationsApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      workspaceId,
      approvalId,
      decision,
      reason,
    }: {
      workspaceId: string
      approvalId: string
      decision: ApprovalDecision
      reason: string
    }) => api.decideOperationsApproval(workspaceId, approvalId, { decision, reason }),
    onSuccess: (_result, { workspaceId }) =>
      queryClient.invalidateQueries({ queryKey: ['operations-inbox', workspaceId] }),
  })
}

export function useOperationsAgents(workspaceId: string | null) {
  return useQuery({
    queryKey: ['operations-agents', workspaceId],
    queryFn: () => api.listOperationsAgents(workspaceId as string),
    enabled: !!workspaceId,
    refetchInterval: 15_000,
  })
}

export function useOperationsAgentActivity(workspaceId: string | null) {
  return useQuery({
    queryKey: ['operations-agent-activity', workspaceId],
    queryFn: () => api.listOperationsAgentActivity(workspaceId as string),
    enabled: !!workspaceId,
    refetchInterval: 5_000,
  })
}

export function useAutomations(workspaceId: string | null) {
  return useQuery({ queryKey: ['automations', workspaceId], queryFn: () => api.listAutomations(workspaceId as string), enabled: !!workspaceId, refetchInterval: 15_000 })
}

export function useCreateAutomation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, data }: { workspaceId: string; data: Omit<Automation, 'id' | 'workspace_id' | 'created_by_user_id' | 'created_at' | 'updated_at'> }) => api.createAutomation(workspaceId, data),
    onSuccess: (_result, { workspaceId }) => queryClient.invalidateQueries({ queryKey: ['automations', workspaceId] }),
  })
}

export function usePatchAutomation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, automationId, data }: { workspaceId: string; automationId: string; data: Partial<Automation> }) => api.patchAutomation(workspaceId, automationId, data),
    onSuccess: (_result, { workspaceId }) => queryClient.invalidateQueries({ queryKey: ['automations', workspaceId] }),
  })
}

export function usePatchOperationsAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, agentId, disabled }: { workspaceId: string; agentId: string; disabled: boolean }) =>
      api.patchOperationsAgent(workspaceId, agentId, disabled),
    onSuccess: (_result, { workspaceId }) =>
      queryClient.invalidateQueries({ queryKey: ['operations-agents', workspaceId] }),
  })
}

export function useAssignOperationsAgentProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      workspaceId,
      agentId,
      mode,
      toolScope,
      resourceScope,
      actionScope,
      reason,
    }: {
      workspaceId: string
      agentId: string
      mode: OperationsAgentMode
      toolScope: string[]
      resourceScope: string[]
      actionScope: string[]
      reason: string
    }) => api.assignOperationsAgentProfile(workspaceId, agentId, {
      mode,
      tool_scope: toolScope,
      resource_scope: resourceScope,
      action_scope: actionScope,
      reason,
    }),
    onSuccess: (_result, { workspaceId }) =>
      queryClient.invalidateQueries({ queryKey: ['operations-agents', workspaceId] }),
  })
}

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
