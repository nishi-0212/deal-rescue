/* Turns a recovery action into the actual work: an email draft for customer-facing steps,
   or a status change for internal steps. */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api'
import { useJobs } from './jobs'
import { usePipelines } from './pipelines'
import { useToast } from './toast'
import type { Action, ActionStatus, Draft, DraftType, Job } from './types'

export function draftTypeFor(a: Pick<Action, 'action_type' | 'title'>): DraftType | null {
  switch (a.action_type) {
    case 'contact_customer': return /meeting|re-?book|session|call/i.test(a.title) ? 'meeting_request' : 'follow_up'
    case 'involve_decision_maker': return 'decision_maker_outreach'
    case 'procurement_help': return 'procurement_escalation'
    case 'technical_meeting': return 'meeting_request'
    case 'revise_pricing': return 'objection_handling'
    default: return null
  }
}

/** Button label for the action's next step, or null when nothing is left to do. */
export function actionLabel(a: Pick<Action, 'action_type' | 'title' | 'status' | 'addresses'>): string | null {
  if (a.status === 'done' || a.status === 'dismissed') return null
  const t = draftTypeFor(a)
  if (t === 'follow_up') return a.addresses?.includes('UNANSWERED_CUSTOMER_EMAIL') ? 'Write the reply' : 'Write follow-up'
  if (t === 'meeting_request') return 'Draft meeting request'
  if (t === 'decision_maker_outreach') return 'Draft intro request'
  if (t === 'procurement_escalation') return 'Email procurement'
  if (t === 'objection_handling') return 'Draft pricing reply'
  return a.status === 'open' ? 'Start this' : 'Mark done'
}

export function useActionRunner() {
  const nav = useNavigate()
  const toast = useToast()
  const { track } = useJobs()
  const { refresh: refreshPipelines } = usePipelines()
  const [busyId, setBusyId] = useState<string | null>(null)

  const setStatus = async (a: Action, status: ActionStatus) => {
    const r = await api<{ action: Action; job: Job | null }>(`/api/actions/${a.id}`, { method: 'PATCH', body: { status } })
    track(r.job, true)
    refreshPipelines().catch(() => {})
  }

  const run = async (a: Action, opts: { onChanged?: () => void } = {}) => {
    setBusyId(a.id)
    try {
      const type = draftTypeFor(a)
      if (type) {
        const d = await api<Draft>(`/api/deals/${encodeURIComponent(a.deal_id)}/drafts`, { body: { type, action_id: a.id } })
        if (a.status === 'open') await setStatus(a, 'in_progress')
        refreshPipelines().catch(() => {})
        toast.push('success', 'Draft ready', 'Check it, then approve. Sending it marks this action done.')
        nav(`/app/deals/${encodeURIComponent(a.deal_id)}?tab=drafts&draft=${d.id}`)
      } else {
        const next: ActionStatus = a.status === 'open' ? 'in_progress' : 'done'
        await setStatus(a, next)
        toast.push('success', next === 'done' ? `Done: ${a.title}` : `Started: ${a.title}`, 'Saved. Re-check the deal whenever you want the score updated.')
        opts.onChanged?.()
      }
    } catch (e) {
      toast.push('error', 'Something went wrong', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return { run, busyId }
}
