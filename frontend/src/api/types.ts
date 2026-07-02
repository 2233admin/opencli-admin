export interface ModelProvider {
  id: string
  name: string
  provider_type: 'claude' | 'openai' | 'local'
  base_url?: string
  api_key?: string
  default_model?: string
  notes?: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface AIAgent {
  id: string
  name: string
  description?: string
  processor_type: 'claude' | 'openai' | 'local'
  model?: string
  prompt_template: string
  processor_config: Record<string, unknown>
  enabled: boolean
  provider_id?: string
  created_at: string
  updated_at: string
}

export interface PaginationMeta {
  total: number
  page: number
  limit: number
  pages: number
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
  meta?: PaginationMeta
}

export interface DataSource {
  id: string
  name: string
  description?: string
  channel_type: 'opencli' | 'web_scraper' | 'api' | 'rss' | 'cli' | 'skill' | 'crawl4ai'
  channel_config: Record<string, unknown>
  ai_config?: Record<string, unknown>
  enabled: boolean
  tags: string[]
  created_at: string
  updated_at: string
}

// A distilled browser skill (record→distill→execute→correct loop, ADR-0003).
// `list` only ever returns the brief projection (no skill_md/elements/evidence
// body); `detail` (GET /skills/{id}) returns every field.
export interface SkillEvidenceEntry {
  event: string
  at?: string
  [key: string]: unknown
}

export interface Skill {
  id: string
  domain: string
  capability: string
  name: string
  version: number
  status: string
  enabled: boolean
  evidence_count: number
  has_open_proposal: boolean
  scope?: string | null
  skill_md?: string
  elements?: Record<string, string[]>
  source_trace?: string | null
  distill_model?: string | null
  evidence?: SkillEvidenceEntry[]
  last_failing_trace?: Record<string, unknown> | null
}

export interface CollectionTask {
  id: string
  source_id: string
  source_name?: string
  agent_id?: string
  trigger_type: string
  parameters: Record<string, unknown>
  priority: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  error_message?: string
  created_at: string
  updated_at: string
}

export interface TaskRun {
  id: string
  task_id: string
  status: string
  worker_id?: string
  celery_task_id?: string
  started_at?: string
  finished_at?: string
  duration_ms?: number
  records_collected: number
  error_message?: string
  created_at: string
}

export interface TaskRunEvent {
  id: string
  run_id: string
  level: 'info' | 'warning' | 'error'
  step: string
  message: string
  detail?: Record<string, unknown>
  elapsed_ms?: number
  created_at: string
}

export interface CollectedRecord {
  id: string
  task_id: string
  source_id: string
  raw_data: Record<string, unknown>
  normalized_data: Record<string, unknown>
  ai_enrichment?: Record<string, unknown>
  content_hash: string
  status: string
  error_message?: string
  created_at: string
  updated_at: string
}

export interface CronSchedule {
  id: string
  source_id: string
  agent_id?: string
  name: string
  cron_expression: string
  timezone: string
  parameters: Record<string, unknown>
  enabled: boolean
  is_one_time: boolean
  last_run_at?: string
  next_run_at?: string
  created_at: string
  updated_at: string
}

export interface NotificationRule {
  id: string
  name: string
  source_id?: string
  trigger_event: string
  notifier_type: string
  notifier_config: Record<string, unknown>
  filter_conditions?: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface NotificationLog {
  id: string
  rule_id: string
  record_id?: string
  status: string
  response_data?: Record<string, unknown>
  error_message?: string
  ack_status: string
  ack_data?: Record<string, unknown>
  acked_at?: string
  created_at: string
}

export interface ChromeEndpoint {
  url: string
  available: boolean
  novnc_port: number
  container_status?: string
  mode: 'bridge' | 'cdp'
  agent_url?: string | null
  agent_protocol?: 'http' | 'ws' | null
}

export interface BrowserBinding {
  id: string
  browser_endpoint: string
  site: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface WorkerNode {
  id: string
  worker_id: string
  hostname: string
  status: string
  active_tasks: number
  last_heartbeat?: string
  created_at: string
  updated_at: string
}

export interface EdgeNode {
  id: string
  url: string
  label: string
  protocol: 'http' | 'ws'
  mode: 'bridge' | 'cdp'
  node_type: 'docker' | 'shell'
  status: 'online' | 'offline'
  last_seen_at?: string | null
  ip?: string | null
  created_at: string
  updated_at: string
}

export interface EdgeNodeEvent {
  id: string
  node_id: string
  event: 'registered' | 'online' | 'offline'
  ip?: string | null
  event_meta?: Record<string, unknown> | null
  created_at: string
}

export interface SystemConfig {
  collection_mode: 'local' | 'agent'
  task_executor: 'local' | 'celery'
  image_tag: string
}

export interface NodeStats {
  total: number
  success: number
  failed: number
  success_rate: number
  records_collected: number
}

export interface DashboardStats {
  sources: { total: number; enabled: number; disabled: number }
  tasks: { total: number; running: number; failed: number }
  runs: { total: number; success: number; failed: number; success_rate: number }
  records: { total: number; ai_processed: number }
  recent_runs: Array<{
    id: string
    task_id: string
    task_trigger_type: string
    source_name: string
    status: string
    records_collected: number
    duration_ms?: number
    created_at: string
  }>
}

export interface DailyActivity {
  date: string
  total_runs: number
  success_runs: number
  failed_runs: number
  new_records: number
}

export interface DashboardActivity {
  daily: DailyActivity[]
}

// ── Control-state (C0 Control Room v0 — docs/CONTROL_THEORY_ARCHITECTURE.md §0) ─
// Read-only sensor-honesty view of a source: GET /sources/{id}/control-state.
// `measurement`/`control_state`/`confidence`/`sensor_coverage` are all null when
// the source has never run. The point of this shape is that an incomplete
// sensor system can never present as a confident "healthy" — see confidence +
// missing_signals, which the UI must render prominently, not as an afterthought.
export interface SourceMeasurement {
  source_id: string
  run_id: string
  accepted: number
  duplicates: number
  rejected: number
  fetch_latency_ms: number
  ingest_latency_ms?: number | null
  store_latency_ms?: number | null
  error_rate: number
  duplicate_rate: number
  freshness_lag_seconds?: number | null
  cursor_advanced: boolean
  odp_stream_lag?: number | null
  odp_pending?: number | null
  dlq_count: number
  observed_at: string
}

export type SourceControlStateValue =
  | 'healthy'
  | 'degraded'
  | 'backpressured'
  | 'rate_limited'
  | 'auth_failed'
  | 'schema_drift'
  // PR-Control-3: the source itself may be fine, but the shared ODP data plane
  // is backpressured beyond objective — bottleneck is system-wide, not this
  // source. Distinct from 'backpressured' (legacy, per-measurement signal).
  | 'blocked_by_odp'
  | 'paused'
  | 'dead'
  | 'unknown'

export type SensorConfidence = 'high' | 'medium' | 'low'

// Which sensor signals behind control_state are real vs. still a placeholder —
// see backend.control.coverage. `run` is true whenever a measurement exists;
// the other four are only true once that specific signal is actually wired up.
export interface SensorCoverage {
  run: boolean
  cursor: boolean
  freshness: boolean
  error_kinds: boolean
  odp: boolean
}

export interface SourceObjective {
  max_error_rate: number
  max_duplicate_rate: number
  max_freshness_lag_seconds?: number | null
  max_run_latency_ms: number
  max_pending: number
  min_accepted_per_run?: number | null
}

// PR-Control-3 (docs/CONTROL_THEORY_ARCHITECTURE.md §4): the advisory decision
// engine's inputs/outputs, layered on top of C0/C1/C2's sensor facts. All
// fields are optional/nullable-tolerant because the backend evaluator may land
// slightly after this UI change (pinned contract, not yet shipped when this
// was written) — an unknown/missing field must never crash the render, only
// degrade to "nothing to show" (same C0 rule: silence, not a fake positive).

// Rolling-window summary from backend.control.aggregation.build_trend.
export interface SourceControlTrend {
  window: number
  zero_accepted_streak: number
  avg_error_rate: number
  rate_limited_runs: number
}

// Shared-infrastructure (ODP) context the evaluator folds in alongside the
// source's own measurement — see SourceControlStateValue.blocked_by_odp.
// `available: false` means the ODP collector itself couldn't be read (degrade
// honestly, never fabricate `odp_backpressured`).
export interface SourceSystemContext {
  odp_backpressured: boolean
  stream_lag: number | null
  pending: number | null
  available: boolean
}

// A candidate control action the evaluator would take — ADVISORY ONLY.
// control_mode 'advisory' means nothing here is ever executed automatically;
// there is intentionally no id/status/apply-endpoint on this shape because the
// UI must never offer to execute one (see ControlBadge/atoms — display only).
export interface SuggestedControlAction {
  action_type: string
  reason: string
  payload: Record<string, unknown>
}

export type ControlMode = 'advisory' | 'automatic'

export interface SourceControlState {
  source_id: string
  measurement: SourceMeasurement | null
  control_state: SourceControlStateValue | null
  objective: SourceObjective
  confidence: SensorConfidence | null
  sensor_coverage: SensorCoverage | null
  missing_signals: string[]
  // PR-Control-3 additions — optional so this type stays valid against both
  // the pre-Control-3 API response and the enriched one.
  trend?: SourceControlTrend | null
  system_context?: SourceSystemContext | null
  suggested_actions?: SuggestedControlAction[]
  control_mode?: ControlMode | null
}
