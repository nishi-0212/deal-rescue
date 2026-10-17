/* Step 4 — recovery plan: what happened, how far recovery has got, then the to-do list. */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import Icon, { type IconName } from '../components/Icon'
import { EmptyState, ErrorNote, RiskBadge, Segmented, Skeleton, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { ACTION_TYPE_LABEL, cx, money, shortDate, STATUS_LABEL } from '../lib/format'
import { actionLabel, useActionRunner } from '../lib/actionRunner'
import { useAsync, useCountUp } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { usePipelines } from '../lib/pipelines'
import { useToast } from '../lib/toast'
import type { Action, ActionStatus, DealList, Job } from '../lib/types'

type View = 'todo' | 'in_progress' | 'done' | 'all'

export default function Actions() {
  const { refreshKey, track } = useJobs()
  const { refresh: refreshPipelines } = usePipelines()
  const toast = useToast()
  const [view, setView] = useState<View>('todo')
  const [owner, setOwner] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const { run, busyId } = useActionRunner()
  const res = useAsync(() => Promise.all([
    api<Action[]>('/api/actions'),
    api<DealList>('/api/deals', { params: { limit: 500 } }),
  ]), [refreshKey])
  const actions = res.data?.[0] || []
  const deals = res.data?.[1]?.items || []
  const owners = useMemo(() => Array.from(new Set(actions.map((a) => a.owner))).sort(), [actions])
  const today = new Date().toISOString().slice(0, 10)

  const live = actions.filter((a) => a.status !== 'dismissed')
  const counts = {
    open: live.filter((a) => a.status === 'open').length,
    in_progress: live.filter((a) => a.status === 'in_progress').length,
    done: live.filter((a) => a.status === 'done').length,
  }
  const stalled = deals.filter((d) => d.latest?.stalled)
  const improving = deals.filter((d) => d.latest && d.latest.first_risk_score != null && d.latest.risk_score < d.latest.first_risk_score)
  const urgent = live.filter((a) => a.status !== 'done').sort((a, b) => a.priority.localeCompare(b.priority) || (a.due_date || '').localeCompare(b.due_date || ''))[0]
  const overdue = live.filter((a) => a.status !== 'done' && a.due_date && a.due_date < today).length

  const items = live
    .filter((a) => (view === 'all' ? true : view === 'todo' ? a.status === 'open' : a.status === view))
    .filter((a) => !owner || a.owner === owner)

  const update = async (a: Action, status: ActionStatus) => {
    setSaving(a.id)
    try {
      const r = await api<{ action: Action; job: Job | null }>(`/api/actions/${a.id}`, { method: 'PATCH', body: { status } })
      track(r.job, true)
      toast.push('success', `“${a.title}” → ${STATUS_LABEL[status]}`, 'Saved. The deal’s score updates when you re-check it.')
      refreshPipelines().catch(() => {})
      res.reload()
    } catch (e) { toast.push('error', 'Could not update', (e as Error).message) } finally { setSaving(null) }
  }

  return (
    <main className="min-w-0 flex-1 pb-12">
      <PageHeader crumbs={[{ label: 'Step 4' }, { label: 'Recovery plan' }]} />
      <section className="anim-rise px-4 pt-8 sm:px-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.028em]">Recovery plan</h1>
      </section>

      {res.error && <div className="px-4 pt-4 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!res.data && !res.error && <div className="flex flex-col gap-3 px-4 pt-6 sm:px-8"><Skeleton className="h-24" /><Skeleton className="h-36" /><Skeleton className="h-60" /></div>}

      {res.data && live.length === 0 && (
        <div className="px-4 pt-6 sm:px-8">
          <EmptyState icon="list" title="No recovery actions yet" body="Actions are recommended once deals are analyzed. Upload your data to start.">
            <Link to="/app/uploads" className="btn-primary h-9">Upload data</Link>
          </EmptyState>
        </div>
      )}

      {res.data && live.length > 0 && (
        <>
          <section className="anim-rise px-4 pt-4 sm:px-8" style={{ animationDelay: '.05s' }}>
            <div className="card px-5 py-4" style={{ backgroundImage: 'linear-gradient(180deg, rgb(var(--sky-ink) / .05), transparent 70%)' }}>
              <div className="eyebrow flex items-center gap-2 text-sky-ink"><Icon name="sparkle" size={13} strokeWidth={2} />Summary</div>
              <p className="mt-2 text-[15px] leading-relaxed text-body">
                Deal Rescue found <b className="font-medium text-text">{stalled.length} stalled deal{stalled.length === 1 ? '' : 's'}</b> worth{' '}
                <b className="font-medium text-text">{money(stalled.reduce((s, d) => s + d.value, 0))}</b> and recommended{' '}
                <b className="font-medium text-text">{live.length} actions</b>. {counts.done} {counts.done === 1 ? 'is' : 'are'} done, {counts.in_progress} in progress and {counts.open} still to do
                {overdue > 0 && <> (<span className="text-rose-ink">{overdue} overdue</span>)</>}.{' '}
                {improving.length > 0
                  ? <>{improving.length} deal{improving.length === 1 ? ' is' : 's are'} already at lower risk than when first checked.</>
                  : <>No deal has moved to a lower risk yet.</>}
              </p>
              {urgent && (
                <p className="mt-2 text-[13px] text-muted">
                  Most urgent: <Link to={`/app/deals/${encodeURIComponent(urgent.deal_id)}?tab=plan`} className="text-text hover:text-sky-ink">“{urgent.title}”</Link> for {urgent.deal?.account}, due {shortDate(urgent.due_date)}.
                  {actionLabel(urgent) && (
                    <button type="button" onClick={() => run(urgent, { onChanged: res.reload })} disabled={busyId === urgent.id} className="btn-primary ml-3 h-7 align-middle">
                      {busyId === urgent.id ? <Spinner /> : null}{actionLabel(urgent)}
                    </button>
                  )}
                </p>
              )}
            </div>
          </section>

          <Flow stalled={stalled.length} planned={live.length} doing={counts.in_progress} done={counts.done} improving={improving.length}
            onPick={(v) => setView(v)} />

          <section className="px-4 pt-6 sm:px-8">
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <Segmented label="Status" value={view} onChange={setView} options={[
                { value: 'todo', label: `To do · ${counts.open}`, dot: 'bg-butter-ink' },
                { value: 'in_progress', label: `In progress · ${counts.in_progress}`, dot: 'bg-sky-ink' },
                { value: 'done', label: `Done · ${counts.done}`, dot: 'bg-mint-ink' },
                { value: 'all', label: 'All' },
              ]} />
              <label className="ml-auto flex items-center gap-2 text-xs text-faint">Owner
                <select value={owner} onChange={(e) => setOwner(e.target.value)} className="input h-8 w-auto py-0 text-xs">
                  <option value="">Everyone</option>{owners.map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
            </div>
            {items.length === 0 && <p className="py-10 text-center text-sm text-muted">Nothing here.</p>}
            <div className="flex flex-col gap-2">
              {items.map((a, i) => {
                const done = a.status === 'done'
                const late = a.due_date && a.due_date < today && !done
                return (
                  <div key={a.id} className="card anim-rise flex flex-wrap items-center gap-4 px-[18px] py-3.5 transition hover:border-line/[0.12]" style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
                    <button type="button" onClick={() => update(a, done ? 'open' : 'done')} disabled={saving === a.id} aria-label={done ? 'Mark as not done' : 'Mark as done'} aria-pressed={done}
                      className={cx('inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] border-[1.5px] text-onpastel transition', done ? 'border-mint bg-mint' : 'border-line/25 hover:border-mint-ink')}>
                      {saving === a.id ? <Spinner size={11} className="text-muted" /> : done && <Icon name="check" size={12} strokeWidth={3} className="anim-check" />}
                    </button>
                    <div className="min-w-0 flex-[1_1_320px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx('rounded px-1.5 py-px font-mono text-[11px]', a.priority === 'P1' ? 'bg-rose-ink/10 text-rose-ink' : a.priority === 'P2' ? 'bg-butter-ink/10 text-butter-ink' : 'bg-line/[0.06] text-muted')}>{a.priority}</span>
                        <span className={cx('text-sm font-medium', done ? 'text-faint line-through' : 'text-text')}>{a.title}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
                        <Link to={`/app/deals/${encodeURIComponent(a.deal_id)}?tab=plan`} className="text-muted hover:text-sky-ink">{a.deal?.account} · {money(a.deal?.value)}</Link>
                        <span>{a.owner}</span>
                        <span className={late ? 'text-rose-ink' : ''}>{late ? 'Overdue · ' : 'Due '}{shortDate(a.due_date)}</span>
                        <span>{ACTION_TYPE_LABEL[a.action_type] || a.action_type}</span>
                      </div>
                    </div>
                    {actionLabel(a) && (
                      <button type="button" onClick={() => run(a, { onChanged: res.reload })} disabled={busyId === a.id}
                        className={a.priority === 'P1' ? 'btn-primary' : 'btn'}>
                        {busyId === a.id ? <Spinner /> : <Icon name={actionLabel(a)!.startsWith('Start') || actionLabel(a)!.startsWith('Mark') ? 'check' : 'mail'} size={14} />}
                        {actionLabel(a)}
                      </button>
                    )}
                    <RiskBadge level={a.deal?.risk_level} />
                    <select value={a.status} disabled={saving === a.id} onChange={(e) => update(a, e.target.value as ActionStatus)} aria-label="Status"
                      className="h-7 cursor-pointer rounded-full border border-line/10 bg-transparent px-2.5 text-xs text-muted outline-none">
                      {(['open', 'in_progress', 'done', 'dismissed'] as ActionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </section>
          <NextStep to="/app/drafts" step={5} title="Review the emails to send" body="Approve the drafted follow-ups and send them from your mail app." />
        </>
      )}
    </main>
  )
}

function Node({ n, label, hint, tone, icon, delay, onClick }: { n: number; label: string; hint: string; tone: string; icon: IconName; delay: number; onClick?: () => void }) {
  const v = useCountUp(n)
  const cls = cx('card anim-rise relative flex min-w-[150px] flex-1 flex-col items-start gap-2 p-4 text-left transition duration-200', onClick && 'hover:-translate-y-0.5 hover:border-line/[0.14]')
  const inner = (
    <>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-onpastel" style={{ background: `rgb(var(--${tone}))` }}><Icon name={icon} size={15} /></span>
      <span className="text-2xl font-semibold tabular-nums">{Math.round(v)}</span>
      <span className="text-[13px] font-medium">{label}</span>
      <span className="text-[11px] text-faint">{hint}</span>
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={cls} style={{ animationDelay: `${delay}s` }}>{inner}</button>
    : <div className={cls} style={{ animationDelay: `${delay}s` }}>{inner}</div>
}

function Arrow({ tone }: { tone: string }) {
  return (
    <svg aria-hidden="true" width="40" height="16" viewBox="0 0 40 16" className="hidden flex-none self-center md:block">
      <path d="M0 8h34" strokeWidth="1.6" fill="none" style={{ stroke: `rgb(var(--${tone}-ink) / .6)`, strokeDasharray: '4 4', animation: 'dash 1s linear infinite' }} />
      <path d="M30 3l6 5-6 5" strokeWidth="1.6" fill="none" style={{ stroke: `rgb(var(--${tone}-ink) / .8)` }} />
    </svg>
  )
}

function Flow({ stalled, planned, doing, done, improving, onPick }: { stalled: number; planned: number; doing: number; done: number; improving: number; onPick: (v: View) => void }) {
  return (
    <section className="px-4 pt-4 sm:px-8" aria-label="Recovery progress">
      <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-0">
        <Node n={stalled} label="Stalled deals" hint="Found by the analysis" tone="rose" icon="clock" delay={0.05} />
        <Arrow tone="rose" />
        <Node n={planned} label="Actions planned" hint="Recommended steps" tone="blush" icon="list" delay={0.1} onClick={() => onPick('all')} />
        <Arrow tone="blush" />
        <Node n={doing} label="In progress" hint="Being worked on" tone="sky" icon="refresh" delay={0.15} onClick={() => onPick('in_progress')} />
        <Arrow tone="sky" />
        <Node n={done} label="Done" hint="Completed actions" tone="mint" icon="check" delay={0.2} onClick={() => onPick('done')} />
        <Arrow tone="mint" />
        <Node n={improving} label="Deals improving" hint="Lower risk than at first check" tone="butter" icon="arrowRight" delay={0.25} />
      </div>
    </section>
  )
}
