export type RiskLevel = 'High' | 'Medium' | 'Low' | 'Closed'
export type ActionStatus = 'open' | 'in_progress' | 'done' | 'dismissed'
export type DraftType =
  | 'follow_up'
  | 'objection_handling'
  | 'meeting_request'
  | 'procurement_escalation'
  | 'decision_maker_outreach'

export interface User { id: string; name: string; email: string }

export interface Contact { name: string; role?: string | null; email?: string | null }

export interface DealLatest {
  /** Every recovery step is done and nothing new came up: the next move is the customer's. */
  waiting_on_customer?: boolean
  analysis_version: number
  analyzed_at: string
  source: 'ai' | 'rules'
  risk_score: number
  risk_level: RiskLevel
  stalled: boolean
  stall_reason?: string | null
  stall_category?: string | null
  confidence: number
  days_silent?: number | null
  days_in_stage?: number | null
  value_at_risk: number
  previous_risk_score?: number | null
  first_risk_score?: number | null
  next_action?: string
  change_summary?: string
  recovery: { done: number; total: number; started?: number }
}

export interface Deal {
  id: string
  deal_id: string
  name: string
  account: string
  value: number
  currency: string
  stage: string
  owner: string
  expected_close?: string | null
  last_activity_date?: string | null
  probability?: number | null
  forecast_category?: string | null
  status: 'open' | 'won' | 'lost'
  stage_entered?: string | null
  contacts: Contact[]
  latest?: DealLatest | null
  /** Set when actions/emails changed after the latest analysis. Cleared by a re-check the user starts. */
  needs_recheck?: boolean
  pending_changes?: number
  recheck_reason?: string | null
  recheck_since?: string | null
}

export interface Signal {
  code: string
  category: string
  label: string
  weight: number
  evidence_ids: string[]
  detail: string
  mitigated: boolean
  severity: 'high' | 'medium' | 'low' | 'positive'
}

export interface Stakeholder {
  name: string | null
  role: string | null
  email?: string | null
  category: string
  status: 'engaged' | 'quiet' | 'never' | 'missing'
  last_seen: string | null
  evidence_ids: string[]
}

export interface RootCause {
  title: string
  explanation: string
  category: string
  status: 'confirmed' | 'likely' | 'possible'
  confidence: number
  evidence_ids: string[]
}

export interface PlanItem {
  title: string
  action_type: string
  owner: string
  due_in_days: number
  expected_outcome: string
  why: string
  priority: 'P1' | 'P2' | 'P3'
  evidence_ids: string[]
  addresses: string[]
}

export interface Diagnosis {
  summary: string
  stage_assessment: string
  root_causes: RootCause[]
  unresolved_objections: { objection: string; raised_by?: string | null; evidence_ids: string[] }[]
  missing_stakeholders: { role: string; why_needed: string; evidence_ids: string[] }[]
  last_meaningful_interaction: { activity_id: string | null; summary: string }
  recommended_next_action: string
  recovery_plan: PlanItem[]
}

export interface Change { kind: string; text: string; evidence_ids?: string[]; before?: unknown; after?: unknown }

export interface Analysis {
  id: string
  deal_id: string
  version: number
  created_at: string
  trigger: string
  source: 'ai' | 'rules'
  model?: string | null
  grounding_notes: string[]
  risk_score: number
  risk_level: RiskLevel
  stalled: boolean
  stall_reason?: string | null
  confidence: number
  days_silent?: number | null
  days_in_stage?: number | null
  stage_benchmark?: number | null
  value_at_risk: number
  signals: Signal[]
  stakeholders: Stakeholder[]
  engagement: { week_start: string; customer: number; ours: number }[]
  diagnosis: Diagnosis
  changes: Change[]
  change_summary: string
  previous?: { version: number; risk_score: number; risk_level: RiskLevel } | null
  last_customer_touch?: { activity_id: string; date: string; type: string; subject?: string | null } | null
}

export interface Activity {
  id: string
  activity_id: string
  deal_id: string
  type: 'email' | 'call' | 'meeting' | 'note' | 'follow_up'
  date: string
  direction: string
  from_?: string | null
  to?: string | null
  participants?: string | null
  subject?: string | null
  body?: string | null
  outcome?: string | null
  due_date?: string | null
  source_file?: string | null
}

export interface Action {
  id: string
  deal_id: string
  title: string
  action_type: string
  why: string
  owner: string
  priority: 'P1' | 'P2' | 'P3'
  due_date: string | null
  expected_outcome: string
  evidence_ids: string[]
  addresses: string[]
  status: ActionStatus
  completed_at?: string | null
  history: { at: string; status: ActionStatus; note?: string | null }[]
  deal?: { name: string; account: string; value: number; risk_level?: RiskLevel }
}

export interface Draft {
  id: string
  deal_id: string
  type: DraftType
  status: 'draft' | 'approved' | 'sent'
  source: 'ai' | 'rules'
  to_name?: string | null
  to_email?: string | null
  subject: string
  body: string
  evidence_ids: string[]
  created_at: string
  updated_at: string
  approved_at?: string | null
  sent_at?: string | null
  action_id?: string | null
  action_title?: string | null
  deal?: { name: string; account: string }
}

export interface HistoryItem {
  version: number
  created_at: string
  trigger: string
  source: string
  risk_score: number
  risk_level: RiskLevel
  stalled: boolean
  stall_reason?: string | null
  change_summary?: string
  changes: Change[]
}

export interface DealDetail {
  deal: Deal
  analysis: Analysis | null
  timeline: Activity[]
  actions: Action[]
  drafts: Draft[]
  history: HistoryItem[]
}

export type JobStage = 'queued' | 'reading' | 'detecting' | 'diagnosing' | 'planning' | 'done' | 'failed' | 'stopped'

export interface Job {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  total: number
  done: number
  failed: number
  label?: string | null
  trigger?: string
  deal_ids: string[]
  deals?: { deal_id: string; account: string; stage: JobStage; risk_level?: RiskLevel | null }[]
  created_at?: string
  finished_at?: string | null
}

export interface PipelineStats {
  deals: number
  analyzed: number
  stalled: number
  high_risk: number
  pipeline_value: number
  stalled_value: number
  activities: number
  actions_total: number
  actions_done: number
  drafts: number
  sent: number
  running: boolean
  needs_recheck: number
  stalled_started: number
  waiting: number
}

export interface Pipeline { id: string; name: string; created_at: string; updated_at: string; stats: PipelineStats }

export interface UploadError { row: number | null; field: string | null; message: string; sheet?: string | null; level?: string }

export interface UploadRecord {
  id: string
  filename: string
  size: number
  kind: string
  status: 'done' | 'partial' | 'failed' | 'processing'
  rows_total: number
  rows_imported: number
  rows_skipped: number
  duplicates: number
  errors: UploadError[]
  deals_created: number
  deals_updated: number
  deals_affected: string[]
  job_id?: string | null
  created_at: string
}

export interface Dashboard {
  has_data: boolean
  last_analyzed_at: string | null
  activity_count: number
  kpis: {
    total_pipeline: number
    open_deals: number
    stalled_value: number
    stalled_count: number
    stalled_share: number
    value_at_risk: number
    high_risk: number
    median_days_silent: number
    actions_done: number
    actions_total: number
    actions_in_progress: number
  }
  trend: { at: string; total_pipeline: number; stalled_value: number; high_risk: number; median_days_silent: number; actions_done: number }[]
  stages: { stage: string; moving: number; stalled: number; count: number }[]
  reasons: { category: string; label: string; count: number; value: number }[]
  feed: { id: string; kind: string; text: string; at: string; deal_id?: string | null }[]
  top_at_risk: { deal_id: string; account: string; name: string; value_at_risk: number; risk_level: RiskLevel }[]
  active_jobs: Job[]
}

export interface DealList {
  items: Deal[]
  total: number
  facets: { owners: string[]; stages: string[]; reasons: { value: string; label: string }[] }
}
