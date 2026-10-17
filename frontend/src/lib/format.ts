const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' }

export function money(v: number | null | undefined, currency = 'USD', compact = true): string {
  const n = Number(v || 0)
  const s = SYMBOL[currency] ?? ''
  if (!compact) return s + Math.round(n).toLocaleString('en-US')
  if (Math.abs(n) >= 1_000_000) return `${s}${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${s}${Math.round(n / 1_000)}k`
  return `${s}${Math.round(n)}`
}

export function shortDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function longDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export const DRAFT_LABEL: Record<string, string> = {
  follow_up: 'Follow-up',
  objection_handling: 'Objection handling',
  meeting_request: 'Meeting request',
  procurement_escalation: 'Procurement escalation',
  decision_maker_outreach: 'Decision-maker outreach',
}

export const ACTION_TYPE_LABEL: Record<string, string> = {
  contact_customer: 'Contact customer',
  involve_decision_maker: 'Involve decision-maker',
  technical_meeting: 'Technical meeting',
  security_questionnaire: 'Security questionnaire',
  revise_pricing: 'Revise pricing',
  escalate_internally: 'Escalate internally',
  update_forecast: 'Update forecast',
  procurement_help: 'Procurement help',
  other: 'Other',
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'In progress', done: 'Done', dismissed: 'Dismissed',
}

export const TRIGGER_LABEL: Record<string, string> = {
  upload: 'New data uploaded', manual: 'Manual re-analysis', action_update: 'Action status changed',
}

export const TYPE_LABEL: Record<string, string> = {
  email: 'Email', call: 'Call', meeting: 'Meeting', note: 'Note', follow_up: 'Follow-up',
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}
