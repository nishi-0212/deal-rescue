import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import DraftEditor, { DraftStatus } from '../components/DraftEditor'
import { EvidenceChips, EvidenceProvider, useEvidence } from '../components/Evidence'
import Icon from '../components/Icon'
import { ErrorNote, LiveDot, RiskBadge, Skeleton, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { ACTION_TYPE_LABEL, cx, DRAFT_LABEL, longDate, money, shortDate, STATUS_LABEL, timeAgo, TRIGGER_LABEL, TYPE_LABEL } from '../lib/format'
import { actionLabel, useActionRunner } from '../lib/actionRunner'
import { useAsync, useCountUp } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { usePipelines } from '../lib/pipelines'
import { useToast } from '../lib/toast'
import type { Action, ActionStatus, Activity, Analysis, DealDetail, Draft, DraftType, Job } from '../lib/types'

type Tab = 'diagnosis' | 'plan' | 'drafts' | 'history'

export default function DealPage() {
  const { dealId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'diagnosis'
  const { refreshKey, track, active } = useJobs()
  const toast = useToast()
  // Reload when a new draft is opened from an action, so it's in the list straight away
  const res = useAsync(() => api<DealDetail>(`/api/deals/${encodeURIComponent(dealId)}`), [dealId, refreshKey, params.get('draft')])
  const [busy, setBusy] = useState(false)
  const data = res.data
  const analyzing = active.some((j) => j.deal_ids.includes(dealId))

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    next.delete('draft')
    setParams(next, { replace: true })
  }

  const reanalyze = async () => {
    setBusy(true)
    try {
      const r = await api<{ job: Job }>('/api/deals/reanalyze', { body: { deal_ids: [dealId] } })
      track(r.job)
      toast.push('info', 'Re-checking this deal')
    } catch (e) { toast.push('error', 'Could not start analysis', (e as Error).message) } finally { setBusy(false) }
  }

  if (res.error && !data) {
    return (
      <main className="flex-1">
        <PageHeader crumbs={[{ label: 'Pipeline', to: '/app' }, { label: dealId }]} />
        <div className="px-4 pt-8 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>
      </main>
    )
  }
  if (!data) return <DealSkeleton dealId={dealId} />

  const { deal, analysis: a, timeline, actions, drafts, history } = data
  return (
    <EvidenceProvider deal={deal} timeline={timeline}>
      <main className="relative min-w-0 flex-1 pb-12">
        <div aria-hidden="true" className="anim-drift pointer-events-none absolute left-[-260px] top-[-420px] h-[760px] w-[1300px]"
          style={{ background: 'radial-gradient(closest-side, rgb(var(--rose-ink) / .09), rgb(var(--blush-ink) / .04) 55%, transparent)' }} />
        <PageHeader crumbs={[{ label: 'Pipeline', to: '/app' }, { label: deal.account }]}>
          <span className="hidden font-mono text-xs text-faint sm:inline">{deal.deal_id}</span>
          <Link to="/app/uploads" className="btn"><Icon name="upload" size={14} />Add activity</Link>
          <button type="button" className="btn-primary" onClick={reanalyze} disabled={busy || analyzing}>
            {busy || analyzing ? <Spinner /> : <Icon name="refresh" size={14} strokeWidth={2} />}{analyzing ? 'Re-checking…' : deal.needs_recheck ? 'Re-check now' : 'Re-analyze deal'}
          </button>
        </PageHeader>

        {a && deal.needs_recheck && !analyzing && (
          <div className="relative px-4 pt-5 sm:px-8">
            <div role="status" className="card anim-rise flex flex-wrap items-center gap-3 border-butter-ink/25 bg-butter/[0.14] px-4 py-3 text-[13px]">
              <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-butter text-onpastel"><Icon name="refresh" size={13} strokeWidth={2} /></span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-strong">
                  {deal.pending_changes && deal.pending_changes > 1 ? `${deal.pending_changes} changes` : 'A change'} since the last check
                </div>
                <div className="mt-0.5 truncate text-muted">
                  {deal.recheck_reason ? `Latest: ${deal.recheck_reason}. ` : ''}The score and diagnosis below don't include {deal.pending_changes && deal.pending_changes > 1 ? 'them' : 'it'} yet.
                </div>
              </div>
              <button type="button" className="btn" onClick={reanalyze} disabled={busy}>
                {busy ? <Spinner /> : <Icon name="refresh" size={14} strokeWidth={2} />}Re-check now
              </button>
            </div>
          </div>
        )}

        {a && !deal.needs_recheck && deal.latest?.waiting_on_customer && (
          <div className="relative px-4 pt-5 sm:px-8">
            <div role="status" className="card anim-rise flex items-center gap-3 border-mint-ink/25 bg-mint/[0.14] px-4 py-3 text-[13px]">
              <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-mint text-onpastel"><Icon name="check" size={13} strokeWidth={2.5} /></span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-strong">Waiting on the customer</div>
                <div className="mt-0.5 text-muted">{deal.latest.next_action}</div>
              </div>
            </div>
          </div>
        )}

        <Hero deal={deal} a={a} actions={actions} />

        {!a ? (
          <div className="px-4 pt-8 sm:px-8">
            <div className="card flex items-center gap-3 px-5 py-6 text-sm text-muted"><Spinner className="text-sky-ink" />This deal hasn't been analyzed yet. Results appear here automatically.</div>
          </div>
        ) : (
          <>
            <Engagement a={a} />
            <div className="relative mx-auto flex max-w-[1400px] flex-wrap gap-6 px-4 pb-12 pt-6 sm:px-8">
              <div className="min-w-0 flex-[999_1_560px]">
                <div role="tablist" aria-label="Deal sections" className="no-scrollbar flex gap-6 overflow-x-auto overflow-y-hidden border-b border-line/[0.07]">
                  {([['diagnosis', 'Diagnosis', a.diagnosis.root_causes.length], ['plan', 'Recovery plan', actions.filter((x) => x.status !== 'dismissed').length], ['drafts', 'Drafts', drafts.length], ['history', 'History', history.length]] as [Tab, string, number][]).map(([k, label, n]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                      className={cx('relative inline-flex items-center gap-1.5 whitespace-nowrap pb-3 pt-2.5 text-[13px] transition-colors', tab === k ? 'text-text' : 'text-muted hover:text-text')}>
                      {label}<span className="rounded bg-line/[0.06] px-1.5 py-px font-mono text-[10px] text-muted">{n}</span>
                      <span aria-hidden="true" className={cx('absolute inset-x-0 -bottom-px h-0.5 rounded-sm transition duration-300 ease-out', tab === k ? 'scale-x-100 bg-sky-ink' : 'scale-x-[.3] bg-transparent')} />
                    </button>
                  ))}
                </div>
                <div key={tab} className="anim-rise pt-5">
                  {tab === 'diagnosis' && <DiagnosisTab a={a} actions={actions} onOpenPlan={() => setTab('plan')} onChanged={res.reload} />}
                  {tab === 'plan' && <PlanTab actions={actions} onChanged={res.reload} />}
                  {tab === 'drafts' && <DraftsTab dealId={deal.deal_id} drafts={drafts} contacts={deal.contacts} onChanged={res.reload} />}
                  {tab === 'history' && <HistoryTab history={history} />}
                </div>
              </div>
              <aside className="flex min-w-0 max-w-[440px] flex-[1_1_320px] flex-col gap-3">
                <WhatChanged a={a} />
                <Stakeholders a={a} />
                <Timeline items={timeline} />
              </aside>
            </div>
          </>
        )}
      </main>
    </EvidenceProvider>
  )
}

function Hero({ deal, a, actions }: { deal: DealDetail['deal']; a: Analysis | null; actions: Action[] }) {
  const score = useCountUp(a?.risk_score ?? 0, 1400)
  const live = actions.filter((x) => x.status !== 'dismissed')
  const done = live.filter((x) => x.status === 'done').length
  const mismatch = a?.signals.some((s) => s.code === 'FORECAST_MISMATCH')
  const circ = 2 * Math.PI * 42
  const lt = a?.last_customer_touch
  return (
    <section className="anim-rise relative mx-auto flex max-w-[1400px] flex-wrap items-center gap-8 px-4 pt-8 sm:px-8">
      <div className="min-w-0 flex-[999_1_520px]">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="chip border-line/[0.09] text-muted">{deal.stage}{a?.days_in_stage != null ? ` · ${a.days_in_stage} days in stage` : ''}</span>
          {deal.probability != null && <span className="chip border-line/[0.09] text-muted">CRM {deal.probability}%{deal.forecast_category ? ` · ${deal.forecast_category}` : ''}</span>}
          {mismatch && <span className="chip border-butter-ink/30 bg-butter-ink/[0.06] text-butter-ink"><Icon name="warning" size={12} strokeWidth={2} />CRM forecast is ahead of the customer</span>}
          {deal.status !== 'open' && <span className="chip border-mint-ink/30 text-mint-ink">Closed {deal.status}</span>}
        </div>
        <h1 className="mt-3.5 text-[28px] font-semibold tracking-[-0.028em] sm:text-[32px]">{deal.name}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{deal.account} · Owner {deal.owner}{deal.expected_close ? ` · Expected close ${longDate(deal.expected_close)}` : ''}</p>
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line/[0.07] bg-line/[0.07] sm:grid-cols-4">
          {[
            ['Deal value', money(deal.value, deal.currency, false), ''],
            ['Value at risk', a ? money(a.value_at_risk, deal.currency, false) : '—', 'text-rose-ink'],
            ['Last customer contact', lt ? (a?.days_silent != null ? `${a.days_silent} days ago` : shortDate(lt.date)) : 'None on record', ''],
            ['Recovery', `${done} of ${live.length} done`, ''],
          ].map(([k, v, c]) => (
            <div key={k} className="bg-panel px-4 py-3.5"><div className="text-xs text-muted">{k}</div><div className={cx('mt-1.5 text-lg font-semibold tabular-nums sm:text-xl', c)}>{v}</div></div>
          ))}
        </div>
      </div>
      {a && (
        <div className="flex flex-[1_1_220px] items-center gap-5">
          <div className="relative h-[112px] w-[112px]" role="img" aria-label={`Risk score ${a.risk_score} out of 100`}>
            <svg width="112" height="112" viewBox="0 0 100 100" aria-hidden="true">
              <defs>
                <linearGradient id="riskg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" style={{ stopColor: 'rgb(var(--butter-ink))' }} />
                  <stop offset=".55" style={{ stopColor: 'rgb(var(--blush-ink))' }} />
                  <stop offset="1" style={{ stopColor: 'rgb(var(--rose-ink))' }} />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth="7" style={{ stroke: 'rgb(var(--ink) / .07)' }} />
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth="7" strokeLinecap="round" stroke="url(#riskg)" transform="rotate(-90 50 50)"
                strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[26px] font-semibold tabular-nums tracking-[-0.02em]">{Math.round(score)}</span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-faint">risk</span>
            </div>
          </div>
          <div>
            <RiskBadge level={a.risk_level} />
            <div className="mt-2 text-xs text-muted">{Math.round(a.confidence * 100)}% confidence</div>
            <div className="mt-0.5 text-xs text-faint">{a.source === 'ai' ? `AI · ${a.model}` : 'Rule-based analysis'}</div>
            <div className="mt-0.5 text-xs text-faint">v{a.version} · {timeAgo(a.created_at)}</div>
          </div>
        </div>
      )}
    </section>
  )
}

function Engagement({ a }: { a: Analysis }) {
  const max = Math.max(1, ...a.engagement.map((w) => Math.max(w.customer, w.ours)))
  return (
    <section className="anim-rise relative mx-auto max-w-[1400px] px-4 pt-6 sm:px-8" style={{ animationDelay: '.1s' }}>
      <div className="card px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="text-[13px] font-medium">Engagement · last 10 weeks</div>
          <div className="ml-auto flex gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-sky-ink" />Customer</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-mist-ink/50" />Your team</span>
          </div>
        </div>
        <div className="mt-4 flex h-[130px] items-end gap-2 sm:gap-3" role="img" aria-label="Weekly customer and team activity">
          {a.engagement.map((w, i) => (
            <div key={w.week_start} className="flex h-full flex-1 flex-col justify-end">
              <div className="flex h-[110px] items-end justify-center gap-[3px]">
                <div className="anim-col w-full max-w-[16px] rounded-t bg-sky-ink" style={{ height: `${Math.max(w.customer ? 8 : 3, (w.customer / max) * 100)}%`, opacity: w.customer ? 1 : 0.25, animationDelay: `${0.2 + i * 0.05}s` }} title={`${w.customer} customer touches`} />
                <div className="anim-col w-full max-w-[16px] rounded-t bg-mist-ink/50" style={{ height: `${Math.max(w.ours ? 8 : 3, (w.ours / max) * 100)}%`, animationDelay: `${0.25 + i * 0.05}s` }} title={`${w.ours} outreach from your team`} />
              </div>
              <div className="mt-1.5 text-center font-mono text-[10px] text-faint">{shortDate(w.week_start)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const STATUS_TONE: Record<string, string> = { confirmed: 'mint', likely: 'butter', possible: 'mist' }

function DiagnosisTab({ a, actions, onOpenPlan, onChanged }: { a: Analysis; actions: Action[]; onOpenPlan: () => void; onChanged: () => void }) {
  const { run, busyId } = useActionRunner()
  const nextAction = actions.find((x) => x.title === a.diagnosis.recommended_next_action && x.status !== 'done' && x.status !== 'dismissed')
    || actions.find((x) => x.status === 'open' || x.status === 'in_progress')
  const nextLabel = nextAction ? actionLabel(nextAction) : null
  const d = a.diagnosis
  const [showSignals, setShowSignals] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div className="card px-5 py-[18px]" style={{ backgroundImage: 'linear-gradient(180deg, rgb(var(--sky-ink) / .04), transparent 60%)' }}>
        <div className="eyebrow flex items-center gap-2 text-sky-ink"><Icon name="sparkle" size={13} strokeWidth={2} />In short</div>
        <p className="mt-2.5 text-[15px] leading-relaxed text-body">{d.summary}</p>
        {d.stage_assessment && <p className="mt-2 text-[13px] text-muted">{d.stage_assessment}</p>}
      </div>
      {(nextAction || d.recommended_next_action) && (
        <div className="group flex flex-wrap items-center gap-3 rounded-xl border border-mint-ink/25 bg-mint-ink/[0.05] px-5 py-3.5 transition hover:border-mint-ink/45">
          <Icon name="arrowRight" size={16} className="flex-none text-mint-ink transition group-hover:translate-x-0.5" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="eyebrow text-mint-ink">Do this next</div>
            <div className="mt-1 text-sm">{nextAction?.title || d.recommended_next_action}</div>
            {nextAction && <div className="mt-0.5 text-xs text-faint">{nextAction.owner} · due {shortDate(nextAction.due_date)}</div>}
          </div>
          {nextAction && nextLabel ? (
            <button type="button" className="btn-mint h-9" onClick={() => run(nextAction, { onChanged })} disabled={busyId === nextAction.id}>
              {busyId === nextAction.id ? <Spinner /> : <Icon name={nextLabel.startsWith('Start') || nextLabel.startsWith('Mark') ? 'check' : 'mail'} size={14} />}{nextLabel}
            </button>
          ) : (
            <button type="button" className="btn h-9" onClick={onOpenPlan}>See the plan</button>
          )}
        </div>
      )}
      <div className="eyebrow px-0.5 pt-2">Why it stalled</div>
      {d.root_causes.length === 0 && <p className="text-sm text-muted">No stall reasons found. The deal looks healthy.</p>}
      {d.root_causes.map((c, i) => {
        const tone = STATUS_TONE[c.status]
        return (
          <div key={i} className="card relative overflow-hidden px-[18px] py-4 transition duration-200 hover:translate-x-0.5 hover:border-line/[0.13]">
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] opacity-80" style={{ background: `rgb(var(--${tone}-ink))` }} />
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
              <span className="font-medium">{c.title}</span>
              <span className="ml-auto inline-flex items-center gap-2 text-xs capitalize" style={{ color: `rgb(var(--${tone}-ink))` }}>
                {c.status} · {Math.round(c.confidence * 100)}%
                <span className="inline-block h-1 w-10 overflow-hidden rounded bg-line/[0.08]"><span className="block h-full" style={{ width: `${c.confidence * 100}%`, background: `rgb(var(--${tone}-ink))` }} /></span>
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{c.explanation}</p>
            <EvidenceChips ids={c.evidence_ids} className="mt-3" />
          </div>
        )
      })}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card px-[18px] py-4">
          <div className="eyebrow">Missing people</div>
          {d.missing_stakeholders.length === 0 && <p className="mt-3 text-[13px] text-faint">Everyone who needs to be involved is.</p>}
          <div className="mt-3 flex flex-col gap-3">
            {d.missing_stakeholders.map((m, i) => (
              <div key={i} className="text-[13px]">
                <div className="flex items-center gap-2.5"><span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border-[1.5px] border-dashed border-rose-ink/60 text-xs text-rose-ink">?</span><span>{m.role}</span></div>
                <p className="mt-1 pl-[38px] text-xs text-muted">{m.why_needed}</p>
                <EvidenceChips ids={m.evidence_ids} className="mt-1.5 pl-[38px]" />
              </div>
            ))}
          </div>
        </div>
        <div className="card px-[18px] py-4">
          <div className="eyebrow">Open objections</div>
          {d.unresolved_objections.length === 0 && <p className="mt-3 text-[13px] text-faint">No open objections found.</p>}
          <div className="mt-3 flex flex-col gap-3">
            {d.unresolved_objections.map((o, i) => (
              <div key={i} className="text-[13px]"><div>{o.objection}</div><EvidenceChips ids={o.evidence_ids} className="mt-1.5" /></div>
            ))}
          </div>
        </div>
      </div>
      <div className="card px-[18px] py-4">
        <div className="eyebrow">Last meaningful customer interaction</div>
        <p className="mt-2 text-[13px] text-body">{d.last_meaningful_interaction.summary}</p>
        {d.last_meaningful_interaction.activity_id && <EvidenceChips ids={[d.last_meaningful_interaction.activity_id]} className="mt-2" />}
      </div>
      <div className="card px-[18px] py-4">
        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setShowSignals((s) => !s)} aria-expanded={showSignals}>
          <span className="eyebrow">All signals ({a.signals.length})</span>
          <span className="text-xs text-faint">how the risk score was built</span>
          <Icon name="chevronDown" size={14} className={cx('ml-auto text-muted transition', showSignals && 'rotate-180')} />
        </button>
        {showSignals && (
          <div className="anim-fade mt-3 flex flex-col divide-y divide-line/[0.05]">
            {a.signals.map((s) => (
              <div key={s.code} className="flex flex-wrap items-start gap-3 py-2.5 text-[13px]">
                <span className={cx('w-10 flex-none font-mono text-xs', s.weight < 0 ? 'text-mint-ink' : 'text-muted')}>{s.weight > 0 ? '+' : ''}{s.weight}</span>
                <div className="min-w-0 flex-1">
                  <div>{s.label}{s.mitigated && <span className="chip ml-2 border-mint-ink/30 text-[11px] text-mint-ink">being fixed</span>}</div>
                  <div className="mt-0.5 text-xs text-muted">{s.detail}</div>
                  <EvidenceChips ids={s.evidence_ids} className="mt-1.5" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {a.grounding_notes.length > 0 && (
        <div className="rounded-xl border border-line/[0.07] px-4 py-3 text-xs text-faint">
          <span className="text-muted">Checks applied: </span>{a.grounding_notes.join(' ')}
        </div>
      )}
    </div>
  )
}

function PlanTab({ actions, onChanged }: { actions: Action[]; onChanged: () => void }) {
  const { refresh: refreshPipelines } = usePipelines()
  const { run, busyId } = useActionRunner()
  const { track } = useJobs()
  const toast = useToast()
  const [saving, setSaving] = useState<string | null>(null)
  const [local, setLocal] = useState(actions)
  useEffect(() => setLocal(actions), [actions])
  const live = local.filter((x) => x.status !== 'dismissed')
  const done = live.filter((x) => x.status === 'done').length

  const update = async (x: Action, status: ActionStatus) => {
    setSaving(x.id)
    setLocal((xs) => xs.map((y) => (y.id === x.id ? { ...y, status } : y)))
    try {
      const r = await api<{ action: Action; job: Job | null }>(`/api/actions/${x.id}`, { method: 'PATCH', body: { status } })
      track(r.job, true)
      toast.push('success', `Marked “${STATUS_LABEL[status]}”`, 'Saved. Re-check the deal when you want the score updated.')
      refreshPipelines().catch(() => {})
      onChanged()
    } catch (e) {
      setLocal(actions)
      toast.push('error', 'Could not update the action', (e as Error).message)
    } finally { setSaving(null) }
  }

  if (!local.length) return <p className="text-sm text-muted">No recovery actions yet.</p>
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>Progress</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/[0.06]">
          <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${live.length ? (done / live.length) * 100 : 0}%`, background: 'linear-gradient(90deg, rgb(var(--sky-ink)), rgb(var(--mint-ink)))' }} />
        </div>
        <span className="font-mono">{done}/{live.length}</span>
      </div>
      {local.map((x) => {
        const isDone = x.status === 'done'
        return (
          <div key={x.id} className={cx('card flex flex-wrap items-start gap-3.5 px-[18px] py-4 transition hover:border-line/[0.12]', x.status === 'dismissed' && 'opacity-50')}>
            <button type="button" onClick={() => update(x, isDone ? 'open' : 'done')} disabled={saving === x.id}
              aria-label={isDone ? 'Mark as not done' : 'Mark as done'} aria-pressed={isDone}
              className={cx('mt-0.5 inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] border-[1.5px] text-onpastel transition duration-200',
                isDone ? 'border-mint bg-mint' : 'border-line/25 hover:border-mint-ink')}>
              {saving === x.id ? <Spinner size={11} className="text-muted" /> : isDone && <Icon name="check" size={12} strokeWidth={3} className="anim-check" />}
            </button>
            <div className="min-w-0 flex-[1_1_320px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('rounded px-1.5 py-px font-mono text-[11px]', x.priority === 'P1' ? 'bg-rose-ink/10 text-rose-ink' : x.priority === 'P2' ? 'bg-butter-ink/10 text-butter-ink' : 'bg-line/[0.06] text-muted')}>{x.priority}</span>
                <span className={cx('font-medium transition-colors', isDone && 'text-faint line-through')}>{x.title}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{x.why}</p>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
                <span>Owner · {x.owner}</span><span>Due · {x.due_date ? shortDate(x.due_date) : '—'}</span>
                <span>{ACTION_TYPE_LABEL[x.action_type] || x.action_type}</span>
                {x.expected_outcome && <span>Expected · {x.expected_outcome}</span>}
              </div>
              <EvidenceChips ids={x.evidence_ids} className="mt-2.5" />
              {actionLabel(x) && (
                <button type="button" onClick={() => run(x, { onChanged })} disabled={busyId === x.id}
                  className={cx('mt-3', x.priority === 'P1' ? 'btn-primary' : 'btn')}>
                  {busyId === x.id ? <Spinner /> : <Icon name={actionLabel(x)!.startsWith('Start') || actionLabel(x)!.startsWith('Mark') ? 'check' : 'mail'} size={14} />}
                  {actionLabel(x)}
                </button>
              )}
            </div>
            <label className="relative">
              <span className="sr-only">Status</span>
              <select value={x.status} disabled={saving === x.id} onChange={(e) => update(x, e.target.value as ActionStatus)}
                className={cx('h-7 cursor-pointer appearance-none rounded-full border bg-transparent pl-3 pr-7 text-xs outline-none transition',
                  x.status === 'done' ? 'border-mint-ink/30 text-mint-ink' : x.status === 'in_progress' ? 'border-sky-ink/30 text-sky-ink' : 'border-line/10 text-muted')}>
                {(['open', 'in_progress', 'done', 'dismissed'] as ActionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-2.5 top-2 text-muted" />
            </label>
          </div>
        )
      })}
    </div>
  )
}

const DRAFT_TYPES = Object.keys(DRAFT_LABEL) as DraftType[]

function DraftsTab({ dealId, drafts, contacts, onChanged }: { dealId: string; drafts: Draft[]; contacts: DealDetail['deal']['contacts']; onChanged: () => void }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [type, setType] = useState<DraftType>('follow_up')
  const [contact, setContact] = useState('')
  const [creating, setCreating] = useState(false)
  const selectedId = params.get('draft') || drafts[0]?.id
  const selected = drafts.find((d) => d.id === selectedId)

  const select = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('draft', id)
    setParams(next, { replace: true })
  }
  const create = async () => {
    setCreating(true)
    try {
      const d = await api<Draft>(`/api/deals/${encodeURIComponent(dealId)}/drafts`, { body: { type, contact_email: contact || null } })
      toast.push('success', 'Draft ready', 'Review and edit it before approving.')
      onChanged()
      select(d.id)
    } catch (e) { toast.push('error', 'Could not create a draft', (e as Error).message) } finally { setCreating(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-end gap-3 px-[18px] py-4">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5"><span className="label">Email type</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as DraftType)}>
            {DRAFT_TYPES.map((t) => <option key={t} value={t}>{DRAFT_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5"><span className="label">Recipient</span>
          <select className="input" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">Pick the best person for me</option>
            {contacts.filter((c) => c.email).map((c) => <option key={c.email!} value={c.email!}>{c.name}{c.role ? ` · ${c.role}` : ''}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primary h-9" onClick={create} disabled={creating}>{creating ? <Spinner /> : <Icon name="sparkle" size={14} />}Write draft</button>
      </div>
      {drafts.length === 0 ? (
        <p className="text-sm text-muted">No drafts yet. Pick a type and let Deal Rescue write one from this deal's history.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
            {drafts.map((d) => (
              <button key={d.id} type="button" onClick={() => select(d.id)}
                className={cx('rounded-lg border px-3 py-2.5 text-left transition', d.id === selected?.id ? 'border-sky-ink/40 bg-sky-ink/[0.06]' : 'border-line/[0.07] hover:border-line/[0.14]')}>
                <div className="flex items-center gap-2"><span className="truncate text-[13px] text-text">{d.subject}</span><DraftStatus s={d.status} /></div>
                <div className="mt-0.5 text-xs text-faint">{DRAFT_LABEL[d.type]} · {timeAgo(d.created_at)}</div>
              </button>
            ))}
          </div>
          {selected && <DraftEditor key={selected.id + selected.updated_at} draft={selected} onChanged={onChanged} className="flex-[3_1_420px]" />}
        </div>
      )}
    </div>
  )
}

function HistoryTab({ history }: { history: DealDetail['history'] }) {
  return (
    <ol className="relative flex flex-col gap-3">
      {history.map((h, i) => (
        <li key={h.version} className="card px-[18px] py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xs text-faint">v{h.version}</span>
            <RiskBadge level={h.risk_level} score={h.risk_score} />
            <span className="text-xs text-muted">{TRIGGER_LABEL[h.trigger] || h.trigger} · {h.source === 'ai' ? 'AI' : 'Rules'}</span>
            <span className="ml-auto text-xs text-faint">{longDate(h.created_at)} · {timeAgo(h.created_at)}</span>
          </div>
          {h.change_summary && <p className={cx('mt-2 text-[13px]', i === 0 ? 'text-text' : 'text-body')}>{h.change_summary}</p>}
          {h.changes.length > 1 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
              {h.changes.slice(1).map((c, j) => <li key={j} className="flex gap-2"><span className="text-faint">·</span>{c.text}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

function WhatChanged({ a }: { a: Analysis }) {
  const first = a.version === 1
  return (
    <div className="card anim-rise relative overflow-hidden px-[18px] py-4" style={{ animationDelay: '.2s', borderColor: first ? undefined : 'rgb(var(--rose-ink) / .22)', backgroundImage: first ? undefined : 'linear-gradient(180deg, rgb(var(--rose-ink) / .06), transparent 70%)' }}>
      <div className="eyebrow flex items-center gap-2" style={{ color: first ? undefined : 'rgb(var(--rose-ink))' }}>
        {!first && <LiveDot tone="rose" />}{first ? 'Latest analysis' : `What changed · v${a.previous?.version} → v${a.version}`}
      </div>
      {a.previous && a.previous.risk_level !== a.risk_level && (
        <div className="mt-3 flex items-center gap-2.5 text-[13px]">
          <RiskBadge level={a.previous.risk_level} score={a.previous.risk_score} />
          <Icon name="arrowRight" size={15} className="text-faint" />
          <RiskBadge level={a.risk_level} score={a.risk_score} />
        </div>
      )}
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{a.change_summary}</p>
      {a.changes.length > 1 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
          {a.changes.slice(1, 6).map((c, i) => <li key={i} className="flex gap-2"><span className="text-faint">·</span>{c.text}</li>)}
        </ul>
      )}
      <div className="mt-2.5 text-xs text-faint">{TRIGGER_LABEL[a.trigger] || a.trigger} · {timeAgo(a.created_at)}</div>
    </div>
  )
}

function Stakeholders({ a }: { a: Analysis }) {
  const tone = { engaged: 'text-mint-ink', quiet: 'text-butter-ink', never: 'text-muted', missing: 'text-rose-ink' }
  const label = { engaged: 'Engaged', quiet: 'Gone quiet', never: 'Never engaged', missing: 'Missing' }
  return (
    <div className="card anim-rise px-[18px] py-4" style={{ animationDelay: '.25s' }}>
      <div className="eyebrow flex items-center gap-2"><Icon name="users" size={13} />People</div>
      <div className="mt-3 flex flex-col gap-3">
        {a.stakeholders.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 text-[13px]">
            {s.name ? (
              <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-mist text-[10px] font-semibold text-onpastel">
                {s.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
              </span>
            ) : (
              <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border-[1.5px] border-dashed border-rose-ink/60 text-xs text-rose-ink">?</span>
            )}
            <div className="min-w-0 flex-1"><div className="truncate">{s.name || s.role}</div>{s.name && s.role && <div className="truncate text-xs text-faint">{s.role}</div>}</div>
            <span className={cx('text-right text-xs', tone[s.status])}>{label[s.status]}{s.last_seen ? <span className="block text-faint">{shortDate(s.last_seen)}</span> : null}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Timeline({ items }: { items: Activity[] }) {
  const rows: ({ gap: number } | Activity)[] = []
  items.forEach((t, i) => {
    rows.push(t)
    const next = items[i + 1]
    if (next) {
      const days = Math.round((new Date(t.date).getTime() - new Date(next.date).getTime()) / 86400000)
      if (days >= 10) rows.push({ gap: days })
    }
  })
  const dot: Record<string, string> = { email: 'bg-sky-ink', call: 'bg-mist-ink', meeting: 'bg-blush-ink', note: 'bg-butter-ink', follow_up: 'bg-mint-ink' }
  return (
    <div className="card anim-rise px-[18px] py-4" style={{ animationDelay: '.3s' }}>
      <div className="eyebrow pb-3.5">Timeline · {items.length} records</div>
      <div className="max-h-[640px] overflow-y-auto pr-1">
        {rows.map((r, i) => 'gap' in r ? (
          <div key={`g${i}`} className="flex gap-3">
            <div className="flex w-2 justify-center"><span className="h-[42px] w-0.5" style={{ background: 'repeating-linear-gradient(180deg, rgb(var(--rose-ink)) 0 4px, transparent 4px 8px)', opacity: 0.7 }} /></div>
            <div className="py-3 text-xs text-rose-ink">{r.gap} days with no activity</div>
          </div>
        ) : (
          <div key={r.id} className="anim-rise flex gap-3" style={{ animationDelay: `${0.3 + Math.min(i, 10) * 0.05}s` }}>
            <div className="flex flex-col items-center">
              <span className={cx('mt-[5px] h-2 w-2 rounded-full', r.outcome && ['declined', 'cancelled', 'no_show', 'missed', 'no_answer'].includes(r.outcome) ? 'bg-rose-ink' : dot[r.type])}
                style={{ boxShadow: '0 0 0 3px rgb(var(--panel)), 0 0 0 4px rgb(var(--ink) / .07)' }} />
              <span className="my-1 w-px flex-1 bg-line/[0.08]" />
            </div>
            <div className="min-w-0 pb-4">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="flex-none rounded bg-line/[0.05] px-1.5 py-px text-[10px] text-muted">{TYPE_LABEL[r.type]}</span>
                <span className="truncate">{r.subject || r.body?.slice(0, 60)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-faint">
                <span>{shortDate(r.date)}</span>
                {r.direction === 'inbound' && <span>from customer</span>}
                {r.direction === 'outbound' && <span>from your team</span>}
                {r.outcome && <span className={['declined', 'cancelled', 'no_show', 'missed', 'no_answer'].includes(r.outcome) ? 'text-rose-ink' : ''}>{r.outcome.replace('_', ' ')}</span>}
                <OpenRecord id={r.activity_id} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DealSkeleton({ dealId }: { dealId: string }) {
  return (
    <main className="flex-1" aria-busy="true">
      <PageHeader crumbs={[{ label: 'Pipeline', to: '/app' }, { label: dealId }]} />
      <div className="px-4 pt-8 sm:px-8">
        <Skeleton className="h-5 w-48" /><Skeleton className="mt-4 h-8 w-80 max-w-full" /><Skeleton className="mt-3 h-4 w-64" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        <Skeleton className="mt-6 h-[170px]" />
        <div className="mt-6 flex gap-6"><Skeleton className="h-[300px] flex-[2]" /><Skeleton className="hidden h-[300px] flex-1 md:block" /></div>
      </div>
    </main>
  )
}

function OpenRecord({ id }: { id: string }) {
  const ev = useEvidence()
  return (
    <button type="button" onClick={() => ev?.open(id)} className="text-sky-ink transition hover:underline">Read</button>
  )
}
