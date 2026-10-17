/* Step 3 — a rescue queue: only the stuck deals, the reason each one is stuck, and the single next move. */
import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import Icon from '../components/Icon'
import { EmptyState, ErrorNote, RiskBadge, Skeleton, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { cx, money } from '../lib/format'
import { useAsync, useCountUp } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { usePipelines } from '../lib/pipelines'
import { useToast } from '../lib/toast'
import type { DealList, Draft, Job } from '../lib/types'

const REASON_TONE: Record<string, string> = {
  unanswered: 'rose', engagement: 'butter', security: 'rose', procurement: 'butter', legal: 'mist', approval: 'blush',
  pricing: 'butter', stakeholders: 'blush', meeting: 'rose', no_reply: 'butter', followup: 'rose', forecast: 'mist',
  stage: 'mist', close_date: 'butter', competitor: 'blush', deadline: 'rose',
}

export default function Stalled() {
  const { refreshKey, track, active } = useJobs()
  const { refresh: refreshPipelines, current } = usePipelines()
  const pending = current?.stats.needs_recheck ?? 0
  const [rechecking, setRechecking] = useState(false)
  const recheck = async () => {
    setRechecking(true)
    try {
      const r = await api<{ job: Job | null }>('/api/deals/reanalyze', { body: { pending_only: true } })
      track(r.job)
      toast.push('info', `Re-checking ${pending} changed deal${pending === 1 ? '' : 's'}`)
    } catch (e) { toast.push('error', 'Could not start the re-check', (e as Error).message) } finally { setRechecking(false) }
  }
  const toast = useToast()
  const nav = useNavigate()
  const [reason, setReason] = useState('')
  const [drafting, setDrafting] = useState<string | null>(null)
  const res = useAsync(() => api<DealList>('/api/deals', { params: { stalled: true, sort: 'at_risk', limit: 200 } }), [refreshKey])
  const deals = res.data?.items || []
  const atRisk = deals.reduce((s, d) => s + (d.latest?.value_at_risk || 0), 0)
  const waitingOf = (d: (typeof deals)[number]) => !!d.latest?.waiting_on_customer
  // deals that need you first, then the ones waiting on the customer
  const shown = deals.filter((d) => !reason || d.latest?.stall_category === reason)
    .sort((a, b) => Number(waitingOf(a)) - Number(waitingOf(b)))
  const firstWaiting = shown.findIndex(waitingOf)
  const needYou = deals.filter((d) => !waitingOf(d)).length
  const reasons = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>()
    deals.forEach((d) => {
      const k = d.latest?.stall_category || 'engagement'
      const cur = m.get(k) || { label: d.latest?.stall_reason || k, n: 0 }
      m.set(k, { ...cur, n: cur.n + 1 })
    })
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [deals])
  const counter = useCountUp(atRisk)

  const draft = async (dealId: string) => {
    setDrafting(dealId)
    try {
      await api<Draft>(`/api/deals/${encodeURIComponent(dealId)}/drafts`, { body: { type: 'follow_up' } })
      refreshPipelines().catch(() => {})
      toast.push('success', 'Follow-up drafted', 'Review and approve it in Drafts & outreach.')
      nav('/app/drafts')
    } catch (e) { toast.push('error', 'Could not draft', (e as Error).message) } finally { setDrafting(null) }
  }

  return (
    <main className="min-w-0 flex-1 pb-12">
      <PageHeader crumbs={[{ label: 'Step 3' }, { label: 'Stalled deals' }]} />
      <section className="anim-rise px-4 pt-8 sm:px-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.028em]">
          {!deals.length ? 'Stalled deals'
            : needYou ? <>{needYou} deal{needYou === 1 ? ' needs' : 's need'} you · <span className="text-rose-ink">{money(counter)}</span> at risk</>
              : <>You've done your part on every stuck deal</>}
        </h1>
        <p className="mt-1.5 max-w-[680px] text-[15px] text-muted">
          Only the deals that need you, most valuable first. Each card says why it's stuck and the one thing to do next.
          {deals.length - needYou > 0 && ` ${deals.length - needYou} more ${deals.length - needYou === 1 ? 'is' : 'are'} waiting on the customer, listed at the end.`}
        </p>
        {pending > 0 && (
          <div role="status" className="card mt-5 flex flex-wrap items-center gap-3 border-butter-ink/25 bg-butter/[0.14] px-4 py-3 text-[13px]">
            <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-butter text-onpastel"><Icon name="refresh" size={13} strokeWidth={2} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-strong">You've worked on {pending} deal{pending === 1 ? '' : 's'} since the last check</div>
              <div className="mt-0.5 text-muted">This list and the risk scores update when you re-check. Until then, deals stay here even if their actions are done.</div>
            </div>
            <button type="button" className="btn" onClick={recheck} disabled={rechecking || active.length > 0}>
              {rechecking || active.length > 0 ? <Spinner /> : <Icon name="refresh" size={14} strokeWidth={2} />}Re-check {pending} changed
            </button>
          </div>
        )}
      </section>

      {reasons.length > 1 && (
        <div className="flex flex-wrap gap-2 px-4 pt-5 sm:px-8">
          <button type="button" onClick={() => setReason('')} className={cx('chip h-8 px-3 text-xs transition', !reason ? 'border-sky-ink/40 bg-sky-ink/10 text-sky-ink' : 'border-line/10 text-muted hover:text-text')}>All · {deals.length}</button>
          {reasons.map(([k, v]) => (
            <button key={k} type="button" onClick={() => setReason(k === reason ? '' : k)}
              className={cx('chip h-8 px-3 text-xs transition', reason === k ? 'border-sky-ink/40 bg-sky-ink/10 text-sky-ink' : 'border-line/10 text-muted hover:text-text')}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: `rgb(var(--${REASON_TONE[k] || 'mist'}-ink))` }} />{v.label} · {v.n}
            </button>
          ))}
        </div>
      )}

      <section className="grid gap-3 px-4 pt-5 sm:px-8 lg:grid-cols-2">
        {res.error && <div className="lg:col-span-2"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
        {!res.data && !res.error && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[190px]" />)}
        {res.data && deals.length === 0 && (
          <div className="lg:col-span-2">
            <EmptyState icon="check" title="Nothing is stuck" body="No deal in this pipeline is stalled right now. Upload new activity and Deal Rescue will re-check.">
              <Link to="/app/uploads" className="btn">Upload new activity</Link>
            </EmptyState>
          </div>
        )}
        {shown.map((d, i) => {
          const l = d.latest!
          const tone = REASON_TONE[l.stall_category || ''] || 'mist'
          const moved = l.previous_risk_score != null && l.previous_risk_score !== l.risk_score ? l.risk_score - l.previous_risk_score : 0
          const waiting = waitingOf(d)
          return (
            <Fragment key={d.id}>
            {i === firstWaiting && (
              <div className="flex items-center gap-3 pt-4 lg:col-span-2">
                <span className="eyebrow text-mint-ink">Waiting on the customer</span>
                <span className="h-px flex-1 bg-line/[0.08]" />
                <span className="text-xs text-faint">Every recovery step is done. These come back to you if the customer replies or goes quiet too long.</span>
              </div>
            )}
            <article className={cx('card card-hover anim-rise relative flex flex-col overflow-hidden p-5', waiting && 'opacity-80')} style={{ animationDelay: `${Math.min(i, 10) * 0.04}s` }}>
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `rgb(var(--${tone}-ink))` }} />
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-base font-medium">{d.account}</span>
                    {waiting && <span className="flex-none rounded-md bg-mint/50 px-1.5 py-px text-[11px] font-medium text-mint-ink">waiting on customer</span>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-faint">{d.name} · {d.stage} · {d.owner}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{money(d.value, d.currency)}</div>
                  <div className="mt-1"><RiskBadge level={l.risk_level} score={l.risk_score} /></div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 text-[13px]">
                <span className="eyebrow pt-0.5">Stuck</span>
                <span style={{ color: `rgb(var(--${tone}-ink))` }}>{l.stall_reason}{l.days_silent != null ? <span className="text-faint"> · {l.days_silent} days since the customer last engaged</span> : null}</span>
                <span className="eyebrow pt-0.5">{waiting ? 'Now' : 'Next'}</span>
                <span className="text-body">{l.next_action || '—'}</span>
                {(l.recovery.started ?? 0) > 0 && (<>
                  <span className="eyebrow pt-0.5">Progress</span>
                  <span className="text-mint-ink">
                    {l.recovery.done} of {l.recovery.total} actions done{l.recovery.started! > l.recovery.done ? `, ${l.recovery.started! - l.recovery.done} in progress` : ''}
                    {d.needs_recheck && <span className="text-faint"> · not re-checked yet</span>}
                  </span>
                </>)}
                {moved !== 0 && (<>
                  <span className="eyebrow pt-0.5">Change</span>
                  <span className={moved < 0 ? 'text-mint-ink' : 'text-rose-ink'}>{moved < 0 ? '↓' : '↑'} risk {Math.abs(moved)} points since last check</span>
                </>)}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                <Link to={`/app/deals/${encodeURIComponent(d.deal_id)}`} className="btn-primary">Why it's stuck <Icon name="arrowRight" size={14} /></Link>
                <Link to={`/app/deals/${encodeURIComponent(d.deal_id)}?tab=plan`} className="btn">Recovery plan · {l.recovery.done}/{l.recovery.total}</Link>
                <button type="button" className="btn" onClick={() => draft(d.deal_id)} disabled={drafting === d.deal_id}>
                  {drafting === d.deal_id ? <Spinner /> : <Icon name="mail" size={14} />}Draft follow-up
                </button>
              </div>
            </article>
            </Fragment>
          )
        })}
      </section>
      {deals.length > 0 && <NextStep to="/app/actions" step={4} title="Work through the recovery plan" body="All recommended actions across these deals, with owners and due dates." />}
    </main>
  )
}
