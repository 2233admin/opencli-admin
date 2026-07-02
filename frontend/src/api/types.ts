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
  // Issue 02: the raw stored per-source SourceObjective override, null when
  // none is set — the UNRESOLVED override dict. See SourceControlState.objective
  // for the RESOLVED shape (override merged over defaults) control-state
  // actually classifies against. Optional so this type stays valid against
  // any DataSource response predating issue 02.
  objective_override?: Record<string, unknown> | null
  // Issue 03 (Control Cycle + Actuator): set by an executed require_review
  // action; a human clears it, the Control Cycle never does.
  review_required?: boolean
  // Issue 03: set alongside enabled=false by an executed pause action; null
  // once resumed (manually or by the Control Cycle's TTL auto-resume).
  paused_until?: string | null
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
  // source | observed_fallback | missing | invalid | synthetic — mirrors
  // backend.control.measurements.SourceMeasurement.source_ts_quality. Absent
  // (not just null) on measurements built from the pre-C1 TaskRunEvent
  // fallback path, which has no freshness quality signal at all.
  source_ts_quality?: string | null
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
// `provenance` (issue 06, additive): present as 'run_history' only when the
// source has zero source_measurements rows and the trend was derived from
// task-run history instead; absent means measurement-backed. Display-only —
// never treat a fallback trend as full sensor coverage.
export interface SourceControlTrend {
  window: number
  zero_accepted_streak: number
  avg_error_rate: number
  rate_limited_runs: number
  provenance?: 'run_history'
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

// ── ODP system-level state (issue 07 — GET /control/odp-state) ───────────────
// Distinct from SourceSystemContext (the evaluator's folded-in per-source
// view): this is the raw system snapshot the topology ODP node renders.
// Every section carries its own `available` flag (+ optional `error`) so a
// down Redis/odp-ingest degrades that section to unavailable, never a
// fabricated healthy zero — mirrors backend/schemas/odp_state.py exactly.
export interface OdpIngestHealth {
  available: boolean
  healthy: boolean | null
  error?: string | null
}

export interface OdpStreamGroupState {
  available: boolean
  name: string
  group: string
  lag: number | null
  pending: number | null
  oldest_pending_idle_ms: number | null
  error?: string | null
}

export interface OdpDlqSummary {
  available: boolean
  total: number | null
  last_24h: number | null
  error?: string | null
}

export interface OdpStoreHealth {
  available: boolean
  healthy: boolean | null
  heartbeat_age_seconds: number | null
  note: string
}

export interface OdpOutboxState {
  available: boolean
  unpublished: number | null
  note: string
}

export interface OdpSystemState {
  ingest: OdpIngestHealth
  stream: OdpStreamGroupState
  dlq: OdpDlqSummary
  store: OdpStoreHealth
  outbox: OdpOutboxState
  collected_at: string
}

// ── Evidence Ledger row (issue 07 — GET /control/actions) ────────────────────
// Row-level control_actions listing — mirrors backend/schemas/control.py's
// ControlActionRecordRead. `outcome`/`evaluated_at` are null until
// backend.control.outcomes judges the row ("pending" is the absence of a
// value, not a stored verdict — see the ?outcome=pending query convention).
export type ControlActionOutcome = 'recovered' | 'persisted' | 'insufficient_data'

export interface ControlActionRecord {
  id: string
  source_id: string
  run_id: string | null
  measurement_id: string | null
  mode: ControlMode
  state: string
  action_type: string
  reason: string | null
  payload: Record<string, unknown>
  executed: boolean
  evaluated_at: string | null
  outcome: ControlActionOutcome | null
  outcome_detail: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// ── Kill switch (PR-Control issue 03 — GET/POST /control/kill-switch) ────────
// `engaged` is the effective state the Control Cycle actually checks: the
// in-memory runtime override when one has been set via POST, else
// Settings.control_kill_switch. `runtime_override` is null when no runtime
// toggle has been set this process lifetime (purely following config) —
// mirrors backend/schemas/control.py's KillSwitchRead exactly.
export interface KillSwitchState {
  engaged: boolean
  runtime_override: boolean | null
  config_default: boolean
}

// ── Advisory report (PR-Control-3.5 — GET /control/advisory-report) ─────────
// The gate data for ever flipping Settings.control_mode to "automatic" per
// state class. `recovery_rate` = recovered / (recovered + persisted); null
// when no row in the set has reached a recovered/persisted verdict yet — a
// 0-of-0 rate would be a fabricated signal, not a measurement. Mirrors
// backend/schemas/control.py's AdvisoryReportTotalsRead/AdvisoryReportRead.
export interface AdvisoryReportTotals {
  total: number
  pending: number
  evaluated: number
  recovered: number
  persisted: number
  insufficient_data: number
  recovery_rate: number | null
}

// One (state, action_type) bucket of the advisory evidence ledger — e.g.
// "everything we suggested pause_source for while auth_failed".
export interface AdvisoryReportBucket extends AdvisoryReportTotals {
  state: string
  action_type: string
}

export interface AdvisoryReport {
  buckets: AdvisoryReportBucket[]
  totals: AdvisoryReportTotals
  mode_breakdown: Record<string, number>
  evaluation: {
    evaluated: number
    recovered: number
    persisted: number
    insufficient_data: number
    still_pending: number
  }
}

// ── Source measurement history (Source Control Room — GET /sources/{id}/measurements) ─
// One persisted source_measurements row — the raw per-run sensor reading, NOT
// the same shape as SourceMeasurement above (that one is the in-memory,
// decision-time contract embedded in SourceControlState; this one is the
// stored DB row, with id/created_at/updated_at and the full derivation
// inputs). Mirrors backend/schemas/control.py's SourceMeasurementRecordRead.
export interface SourceMeasurementRecord {
  id: string
  source_id: string
  run_id: string
  measured_at: string
  accepted: number
  duplicates: number
  rejected: number
  error_rate: number
  duplicate_rate: number
  error_kinds: Record<string, number>
  fetch_latency_ms: number | null
  ingest_latency_ms: number | null
  store_latency_ms: number | null
  cursor_advanced: boolean
  newest_source_ts: string | null
  newest_observed_at: string | null
  freshness_lag_seconds: number | null
  source_ts_quality: string
  raw: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ── Plan IR (Plan IR issues 01/02/06 — docs/plan-ir-PRD.md) ────────────────────
// Mirrors backend.schemas.plan_ir.{PlanPort,PlanNode,PlanEdge,PlanGraph} and
// backend.schemas.plan.{PlanRead,...} field-for-field. This is the wire shape;
// frontend/src/lib/planCanvasModel.ts owns the pure IR↔canvas projection.

export type PlanNodeKind = 'source' | 'transform' | 'merge' | 'sink'

export interface PlanPort {
  name: string
  type: string
}

export interface PlanNode {
  id: string
  kind: PlanNodeKind
  type: string
  label?: string | null
  params: Record<string, unknown>
  required_params: string[]
  inputs: PlanPort[]
  outputs: PlanPort[]
  source_id?: string | null
  draft: boolean
}

export interface PlanEdge {
  id: string
  source_node: string
  source_port: string
  target_node: string
  target_port: string
}

export interface PlanGraph {
  ir_version: string
  name?: string | null
  draft: boolean
  nodes: PlanNode[]
  edges: PlanEdge[]
}

export interface PlanRead {
  id: string
  name: string
  graph: PlanGraph
  version: number
  draft: boolean
  runnable: boolean
  created_at: string
  updated_at: string
}

// One node-anchored structural-validation error (backend.plan_ir.validation.
// PlanValidationError.to_dict()) — returned as the 422 `detail` array on a
// failed plan save. node_id/edge_id are the anchors the canvas renders on.
export interface PlanValidationErrorItem {
  code: string
  message: string
  node_id?: string
  edge_id?: string
}

// ── Presets (Plan IR issue 06) ──────────────────────────────────────────────────
// Mirrors backend.plan_ir.presets.Preset. Read-only, grouped by channel_type;
// the palette (issue 07) renders these dynamically — nothing hardcoded here.
export interface Preset {
  id: string
  channel_type: string
  node_type: string
  label: string
  description: string
  params: Record<string, unknown>
}

export type PresetsGrouped = Record<string, Preset[]>

// ── Plan run + health (Plan IR issue 03/04/08) ───────────────────────────────
// Mirrors backend.schemas.plan.{SourceSegmentRead,SharedSegmentRead,
// PlanRunRead,PlanHealthRead} field-for-field. Consumed by lib/planRunModel.ts
// to project a completed run onto per-node execution state (issue 08).

export interface SourceSegmentRead {
  node_id: string
  source_id?: string | null
  task_id?: string | null
  run_id?: string | null
  success: boolean
  collected: number
  stored: number
  skipped: number
  error?: string | null
}

export interface SharedSegmentRead {
  run_key: string
  success: boolean
  failed_node_id?: string | null
  error?: string | null
  items_in: number
  stored: number
  skipped: number
}

export interface PlanRunRead {
  plan_id: string
  source_id: string
  task_id: string
  run_id?: string | null
  success: boolean
  collected: number
  stored: number
  skipped: number
  error?: string | null
  source_results: SourceSegmentRead[]
  shared_segment?: SharedSegmentRead | null
}

export interface PlanHealthRead {
  id: string
  plan_id: string
  run_key: string
  node_id: string
  node_type: string
  success: boolean
  duration_ms: number
  items_in: number
  items_out: number
  error_message?: string | null
  detail: Record<string, unknown>
  recorded_at: string
}
