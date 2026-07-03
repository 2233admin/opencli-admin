import { apiClient, rootClient } from './client.ts'
import type {
  AIAgent,
  AdvisoryReport,
  ApiResponse,
  ModelProvider,
  BrowserBinding,
  ChromeEndpoint,
  CollectedRecord,
  CollectionTask,
  ControlActionRecord,
  CronSchedule,
  DataSource,
  DashboardActivity,
  DashboardStats,
  EdgeNode,
  EdgeNodeEvent,
  KillSwitchState,
  NodeStats,
  NotificationLog,
  NotificationRule,
  OdpSystemState,
  PlanGraph,
  PlanHealthRead,
  PlanRead,
  PlanRunRead,
  PresetsGrouped,
  Skill,
  SourceControlState,
  SourceMeasurementRecord,
  SystemConfig,
  TaskRun,
  TaskRunEvent,
  WorkerNode,
} from './types.ts'

// ── Dashboard ──────────────────────────────────────────────────────────────────
export const getDashboardStats = (params?: { range?: string; start?: string; end?: string }) =>
  apiClient.get<ApiResponse<DashboardStats>>('/dashboard/stats', { params }).then((r) => r.data.data)

export const getDashboardActivity = (params?: { days?: number; tz_offset?: number }) =>
  apiClient.get<ApiResponse<DashboardActivity>>('/dashboard/activity', { params }).then((r) => r.data.data)

// ── Sources ────────────────────────────────────────────────────────────────────
export const listSources = (params?: { page?: number; limit?: number; enabled?: boolean }) =>
  apiClient.get<ApiResponse<DataSource[]>>('/sources', { params }).then((r) => r.data)

export const getSource = (id: string) =>
  apiClient.get<ApiResponse<DataSource>>(`/sources/${id}`).then((r) => r.data.data)

export const createSource = (data: Partial<DataSource>) =>
  apiClient.post<ApiResponse<DataSource>>('/sources', data).then((r) => r.data.data)

export const updateSource = (id: string, data: Partial<DataSource>) =>
  apiClient.patch<ApiResponse<DataSource>>(`/sources/${id}`, data).then((r) => r.data.data)

export const deleteSource = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/sources/${id}`).then((r) => r.data)

export const testSourceConnectivity = (id: string) =>
  apiClient
    .post<ApiResponse<{ connected: boolean; errors: string[] }>>(`/sources/${id}/test`)
    .then((r) => r.data.data)

// Encrypted credential store (backend.auth.AuthManager) — key names only ever
// come back; the secret is write-only once stored.
export const listSourceCredentials = (id: string) =>
  apiClient.get<ApiResponse<{ key_name: string }[]>>(`/sources/${id}/credentials`).then((r) => r.data.data)

export const storeSourceCredential = (id: string, data: { key_name: string; secret: string }) =>
  apiClient.post<ApiResponse<null>>(`/sources/${id}/credentials`, data).then((r) => r.data)

export const deleteSourceCredential = (id: string, keyName: string) =>
  apiClient.delete<ApiResponse<null>>(`/sources/${id}/credentials/${keyName}`).then((r) => r.data)

// Read-only sensor-honesty view (C0 Control Room v0) — poll this, don't infer
// health from anything else. See SourceControlState: an incomplete-sensor
// source reports confidence "low" / control_state "unknown", never a fake
// "healthy". No websocket in v0 — TanStack Query refetchInterval only.
export const getSourceControlState = (id: string) =>
  apiClient.get<ApiResponse<SourceControlState>>(`/sources/${id}/control-state`).then((r) => r.data.data)

// Set, update, or clear (objective_override: null) a source's per-source
// SourceObjective override. The resolved objective (override merged over
// defaults) is what control-state actually classifies against.
export const setSourceObjective = (id: string, objectiveOverride: Record<string, unknown> | null) =>
  apiClient
    .patch<ApiResponse<DataSource>>(`/sources/${id}/objective`, { objective_override: objectiveOverride })
    .then((r) => r.data.data)

// Raw per-run sensor history behind control-state's folded latest-measurement
// + trend summary — the Source Control Room's trend chart data. Paginated,
// newest-first, like every other list endpoint. Zero rows is a legitimate
// "pre-measurement source" state, not an error.
export const listSourceMeasurements = (id: string, params?: { page?: number; limit?: number }) =>
  apiClient
    .get<ApiResponse<SourceMeasurementRecord[]>>(`/sources/${id}/measurements`, { params })
    .then((r) => r.data)

// ── Control (issue 07 — topology ODP node + action history) ────────────────────
// System-level ODP data-plane snapshot: no source_id, singleton. Same
// "never fake healthy" contract as control-state — each section degrades to
// `available: false` independently rather than the whole endpoint erroring.
export const getOdpState = () =>
  apiClient.get<ApiResponse<OdpSystemState>>('/control/odp-state').then((r) => r.data.data)

// Row-level Evidence Ledger listing (control_actions) — the operator's audit
// surface over every suggestion/execution the controller has ever produced.
// Read-only; paginated like every other list endpoint.
export const listControlActions = (params?: {
  source_id?: string
  mode?: string
  outcome?: string
  page?: number
  limit?: number
}) => apiClient.get<ApiResponse<ControlActionRecord[]>>('/control/actions', { params }).then((r) => r.data)

// Global actuator kill switch (issue 03) — the Control Cycle checks this
// before ever executing anything in "automatic" mode. GET is a snapshot;
// POST sets the in-memory runtime override (resets to config on restart).
export const getKillSwitch = () =>
  apiClient.get<ApiResponse<KillSwitchState>>('/control/kill-switch').then((r) => r.data.data)

export const setKillSwitch = (engaged: boolean) =>
  apiClient.post<ApiResponse<KillSwitchState>>('/control/kill-switch', { engaged }).then((r) => r.data.data)

// Agreement/recovery report over the control_actions evidence ledger
// (PR-Control-3.5) — the gate data for ever flipping CONTROL_MODE to
// "automatic" per state class. Runs a lazy outcome-evaluation pass before
// aggregating, so no separate "evaluate" button is needed in the UI.
export const getAdvisoryReport = () =>
  apiClient.get<ApiResponse<AdvisoryReport>>('/control/advisory-report').then((r) => r.data.data)

// ── Tasks ──────────────────────────────────────────────────────────────────────
export const listTasks = (params?: {
  source_id?: string
  status?: string
  page?: number
  limit?: number
}) => apiClient.get<ApiResponse<CollectionTask[]>>('/tasks', { params }).then((r) => r.data)

export const triggerTask = (
  source_id: string,
  parameters?: Record<string, unknown>,
  agent_id?: string,
) =>
  apiClient
    .post<ApiResponse<{ task_id: string; celery_task_id: string }>>('/tasks/trigger', {
      source_id,
      parameters: parameters ?? {},
      ...(agent_id ? { agent_id } : {}),
    })
    .then((r) => r.data.data)

export const getTask = (id: string) =>
  apiClient.get<ApiResponse<CollectionTask>>(`/tasks/${id}`).then((r) => r.data.data)

export const listTaskRuns = (task_id: string) =>
  apiClient.get<ApiResponse<TaskRun[]>>(`/tasks/${task_id}/runs`).then((r) => r.data)

export const listRunEvents = (task_id: string, run_id: string) =>
  apiClient.get<ApiResponse<TaskRunEvent[]>>(`/tasks/${task_id}/runs/${run_id}/events`).then((r) => r.data.data)

// ── Records ────────────────────────────────────────────────────────────────────
export const listRecords = (params?: {
  source_id?: string
  task_id?: string
  status?: string
  search?: string
  page?: number
  limit?: number
}) => apiClient.get<ApiResponse<CollectedRecord[]>>('/records', { params }).then((r) => r.data)

export const getRecord = (id: string) =>
  apiClient.get<ApiResponse<CollectedRecord>>(`/records/${id}`).then((r) => r.data.data)

export const deleteRecord = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/records/${id}`).then((r) => r.data)

export const batchDeleteRecords = (ids: string[]) =>
  apiClient.post<ApiResponse<{ deleted: number }>>('/records/batch-delete', { ids }).then((r) => r.data)

export const clearAllRecords = (source_id?: string) =>
  apiClient.delete<ApiResponse<{ deleted: number }>>('/records', { params: source_id ? { source_id } : {} }).then((r) => r.data)

// ── Skills (record→distill→execute→correct loop, ADR-0003) ─────────────────────
export const listSkills = (params?: { domain?: string; enabled?: boolean; page?: number; limit?: number }) =>
  apiClient.get<ApiResponse<Skill[]>>('/skills', { params }).then((r) => r.data)

export const getSkill = (id: string) =>
  apiClient.get<ApiResponse<Skill>>(`/skills/${id}`).then((r) => r.data.data)

// trace omitted → backend falls back to skill.last_failing_trace.
export const redistillSkill = (id: string, trace?: Record<string, unknown>) =>
  apiClient
    .post<ApiResponse<{ skill_id: string; version: number; domain: string; capability: string }>>(
      `/skills/${id}/redistill`,
      trace ? { trace } : {},
    )
    .then((r) => r.data.data)

export const dismissCorrection = (id: string) =>
  apiClient.post<ApiResponse<Skill>>(`/skills/${id}/dismiss-correction`).then((r) => r.data.data)

export const rollbackSkill = (id: string) =>
  apiClient.post<ApiResponse<Skill>>(`/skills/${id}/rollback`).then((r) => r.data.data)

// ── Record leg (2026-07-01 addendum): capture a demo → journey_trace_v1 ─────────
export const recordStart = (data: { domain: string; capability: string; cdp_endpoint?: string }) =>
  apiClient
    .post<ApiResponse<{ session_id: string; cdp_endpoint: string }>>('/skills/record/start', data)
    .then((r) => r.data.data)

export const recordStop = (sessionId: string, data: { status: string; note?: string }) =>
  apiClient
    .post<ApiResponse<{ trace: Record<string, unknown> }>>(`/skills/record/${sessionId}/stop`, data)
    .then((r) => r.data.data.trace)

export const distillSkill = (data: {
  trace: Record<string, unknown>
  domain?: string
  capability?: string
}) =>
  apiClient
    .post<ApiResponse<{ id: string; domain: string; capability: string; name: string; version: number; status: string }>>(
      '/skills/distill',
      data,
    )
    .then((r) => r.data.data)

// ── Schedules ──────────────────────────────────────────────────────────────────
export const listSchedules = (params?: { source_id?: string; enabled?: boolean }) =>
  apiClient.get<ApiResponse<CronSchedule[]>>('/schedules', { params }).then((r) => r.data)

export const createSchedule = (data: Partial<CronSchedule>) =>
  apiClient.post<ApiResponse<CronSchedule>>('/schedules', data).then((r) => r.data.data)

export const updateSchedule = (id: string, data: Partial<CronSchedule>) =>
  apiClient.patch<ApiResponse<CronSchedule>>(`/schedules/${id}`, data).then((r) => r.data.data)

export const deleteSchedule = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/schedules/${id}`).then((r) => r.data)

// ── Notifications ──────────────────────────────────────────────────────────────
export const listNotificationRules = () =>
  apiClient.get<ApiResponse<NotificationRule[]>>('/notifications/rules').then((r) => r.data)

export const createNotificationRule = (data: Partial<NotificationRule>) =>
  apiClient
    .post<ApiResponse<NotificationRule>>('/notifications/rules', data)
    .then((r) => r.data.data)

export const updateNotificationRule = (id: string, data: Partial<NotificationRule>) =>
  apiClient
    .patch<ApiResponse<NotificationRule>>(`/notifications/rules/${id}`, data)
    .then((r) => r.data.data)

export const deleteNotificationRule = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/notifications/rules/${id}`).then((r) => r.data)

export const listNotificationLogs = (params?: { rule_id?: string }) =>
  apiClient
    .get<ApiResponse<NotificationLog[]>>('/notifications/logs', { params })
    .then((r) => r.data)

// ── Model Providers ────────────────────────────────────────────────────────────
export const listProviders = () =>
  apiClient.get<ApiResponse<ModelProvider[]>>('/providers').then((r) => r.data)

export const createProvider = (data: Partial<ModelProvider>) =>
  apiClient.post<ApiResponse<ModelProvider>>('/providers', data).then((r) => r.data.data)

export const updateProvider = (id: string, data: Partial<ModelProvider>) =>
  apiClient.patch<ApiResponse<ModelProvider>>(`/providers/${id}`, data).then((r) => r.data.data)

export const deleteProvider = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/providers/${id}`).then((r) => r.data)

// ── Agents ─────────────────────────────────────────────────────────────────────
export const listAgents = (params?: { enabled?: boolean }) =>
  apiClient.get<ApiResponse<AIAgent[]>>('/agents', { params }).then((r) => r.data)

export const createAgent = (data: Partial<AIAgent>) =>
  apiClient.post<ApiResponse<AIAgent>>('/agents', data).then((r) => r.data.data)

export const updateAgent = (id: string, data: Partial<AIAgent>) =>
  apiClient.patch<ApiResponse<AIAgent>>(`/agents/${id}`, data).then((r) => r.data.data)

export const deleteAgent = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/agents/${id}`).then((r) => r.data)

// ── Browser bindings ───────────────────────────────────────────────────────────
export const listBrowserBindings = () =>
  apiClient.get<ApiResponse<BrowserBinding[]>>('/browsers/bindings').then((r) => r.data)

export const createBrowserBinding = (data: { browser_endpoint: string; site: string; notes?: string }) =>
  apiClient.post<ApiResponse<BrowserBinding>>('/browsers/bindings', data).then((r) => r.data.data)

export const deleteBrowserBinding = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/browsers/bindings/${id}`).then((r) => r.data)

export const addChromeInstance = (count = 1, mode: 'bridge' | 'cdp' = 'bridge', agent_url = '', agent_protocol: 'http' | 'ws' | '' = '') => {
  const params = new URLSearchParams({ count: String(count), mode })
  if (agent_url) params.set('agent_url', agent_url)
  if (agent_protocol) params.set('agent_protocol', agent_protocol)
  return apiClient.post<ApiResponse<{ created: { endpoint: string; novnc_port: number }[]; total: number }>>(`/browsers/chrome-instances?${params}`).then((r) => r.data.data)
}

export const updateChromeInstanceConfig = (endpoint: string, data: { mode?: string; agent_url?: string | null; agent_protocol?: string | null }) => {
  const b64 = btoa(endpoint).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return apiClient.patch<ApiResponse<{ id: string; endpoint: string; mode: string; agent_url: string | null; agent_protocol: string | null }>>(`/browsers/instances/${b64}`, data).then((r) => r.data.data)
}

export const removeChromeInstance = (n: number) =>
  apiClient.delete<ApiResponse<{ removed: string; total: number }>>(`/browsers/chrome-instances/${n}`).then((r) => r.data)

export const restartApi = () =>
  apiClient.post<ApiResponse<{ restarting: boolean }>>('/browsers/restart-api').then((r) => r.data)

// ── System ─────────────────────────────────────────────────────────────────────
// Liveness only — /health is auth-exempt and deliberately leaks nothing
// (issue 04). For deployment detail (task_executor, ...) use getSystemConfig.
export const getHealth = () =>
  rootClient.get<{ status: string }>('/health').then((r) => r.data)

export const getSystemConfig = () =>
  apiClient.get<ApiResponse<SystemConfig>>('/system/config').then((r) => r.data.data)

export const updateSystemConfig = (data: Partial<SystemConfig>) =>
  apiClient.patch<ApiResponse<SystemConfig>>('/system/config', data).then((r) => r.data.data)

export const getWsAgentStatus = () =>
  apiClient.get<ApiResponse<{ connected: string[] }>>('/browsers/agents/ws-status').then((r) => r.data.data)

// ── Workers ────────────────────────────────────────────────────────────────────
export const listWorkers = () =>
  apiClient.get<ApiResponse<WorkerNode[]>>('/workers').then((r) => r.data)

export const getCeleryStats = () =>
  apiClient.get<ApiResponse<Record<string, unknown>>>('/workers/celery-stats').then((r) => r.data.data)

// ── Edge Nodes ─────────────────────────────────────────────────────────────────
export const listNodes = () =>
  apiClient.get<ApiResponse<EdgeNode[]>>('/nodes').then((r) => r.data)

export const getNodeEvents = (id: string) =>
  apiClient.get<ApiResponse<EdgeNodeEvent[]>>(`/nodes/${id}/events`).then((r) => r.data)

export const getNodeStats = (id: string, params?: { range?: string; start?: string; end?: string }) =>
  apiClient.get<ApiResponse<NodeStats>>(`/nodes/${id}/stats`, { params }).then((r) => r.data.data)

export const deleteNode = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/nodes/${id}`).then((r) => r.data)

export const getInstallScriptUrl = (base: string) =>
  `${base}/api/v1/nodes/install/agent.sh`

export const getChromePool = () =>
  apiClient
    .get<ApiResponse<{ endpoints: ChromeEndpoint[]; total: number; available: number }>>('/workers/chrome-pool')
    .then((r) => r.data.data)

export const updateChromeEndpointMode = (endpoint: string, mode: 'bridge' | 'cdp') => {
  const b64 = btoa(endpoint).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return apiClient
    .patch<ApiResponse<{ endpoint: string; mode: string }>>(`/workers/chrome-pool/${b64}/mode`, { mode })
    .then((r) => r.data.data)
}

// ── Presets (Plan IR issue 06) ──────────────────────────────────────────────────
// Read-only, grouped by channel_type — palette (issue 07) source of truth.
export const listPresets = () =>
  apiClient.get<ApiResponse<PresetsGrouped>>('/presets').then((r) => r.data.data)

// ── Plans (Plan IR issue 02) — Collection Canvas persistence ────────────────────
// Save (create/update) validates server-side and 422s with a node-anchored
// error list (backend.plan_ir.validation.PlanValidationError.to_dict()) on an
// invalid graph. client.ts's normalizeApiError attaches that raw array onto
// the thrown Error as `.detail` (see PlanSaveError in planCanvasModel.ts for
// the typed accessor) — callers that only want the message keep working
// unchanged; callers that need node-anchored errors read `.detail`.
export const listPlans = (params?: { draft?: boolean; page?: number; limit?: number }) =>
  apiClient.get<ApiResponse<PlanRead[]>>('/plans', { params }).then((r) => r.data)

export const getPlan = (id: string) =>
  apiClient.get<ApiResponse<PlanRead>>(`/plans/${id}`).then((r) => r.data.data)

export const createPlan = (data: { name: string; graph: PlanGraph }) =>
  apiClient.post<ApiResponse<PlanRead>>('/plans', data).then((r) => r.data.data)

export const updatePlan = (id: string, data: { name?: string; graph?: PlanGraph }) =>
  apiClient.patch<ApiResponse<PlanRead>>(`/plans/${id}`, data).then((r) => r.data.data)

export const deletePlan = (id: string) =>
  apiClient.delete<ApiResponse<null>>(`/plans/${id}`).then((r) => r.data)

// ── Plan run + health (Plan IR issue 03/04/08) — Collection Canvas observe lens ──
// runPlan invokes the SYNCHRONOUS manual whole-plan run endpoint
// (backend/api/v1/plans.py run_plan) — the response already reflects the
// completed run (or its per-source/shared-segment failure detail), no
// polling needed. getPlanHealth is read-only Plan Health for the observe
// lens's shared-node badges (issue 04's per-node health dimension).
export const runPlan = (id: string, parameters: Record<string, unknown> = {}) =>
  apiClient.post<ApiResponse<PlanRunRead>>(`/plans/${id}/run`, parameters).then((r) => r.data.data)

export const getPlanHealth = (id: string, params?: { run_key?: string; page?: number; limit?: number }) =>
  apiClient.get<ApiResponse<PlanHealthRead[]>>(`/plans/${id}/health`, { params }).then((r) => r.data)
