/* Live view of an analysis run: every deal moves through the stages as the backend works on it. */
import { useEffect, useState } from 'react'
import { cx } from '../lib/format'
import { useJobs } from '../lib/jobs'
import { useToast } from '../lib/toast'
import type { Job, JobStage } from '../lib/types'
import Confirm from './Confirm'
import Icon, { type IconName } from './Icon'
import { LiveDot, RiskBadge, Spinner } from './ui'

const STAGES: { key: JobStage; label: string; hint: string; icon: IconName; tone: string }[] = [
  { key: 'queued', label: 'Waiting', hint: 'In the queue', icon: 'clock', tone: 'mist' },
  { key: 'reading', label: 'Reading records', hint: 'Emails, calls, CRM', icon: 'file', tone: 'sky' },
  { key: 'detecting', label: 'Finding warning signs', hint: 'Silence, blockers, gaps', icon: 'warning', tone: 'butter' },
  { key: 'diagnosing', label: 'Explaining why', hint: 'Root causes + proof', icon: 'sparkle', tone: 'blush' },
  { key: 'planning', label: 'Building the plan', hint: 'Actions, owners, dates', icon: 'list', tone: 'rose' },
  { key: 'done', label: 'Done', hint: 'Results ready', icon: 'check', tone: 'mint' },
]

function elapsed(from?: string, to?: string | null): string {
  if (!from) return ''
  const s = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function LiveRun({ job }: { job: Job }) {
  const { cancel, dismiss } = useJobs()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [, tick] = useState(0)
  const running = job.status === 'queued' || job.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  const deals = job.deals || []
  const byStage = (k: JobStage) => deals.filter((d) => (k === 'done' ? ['done', 'failed'].includes(d.stage) : d.stage === k))
  const stopped = deals.filter((d) => d.stage === 'stopped')
  const levels = ['High', 'Medium', 'Low'].map((l) => ({ l, n: deals.filter((d) => d.risk_level === l).length }))
  const pct = (job.done / Math.max(1, job.total)) * 100

  return (
    <section className="anim-rise px-4 pt-8 sm:px-8" aria-live="polite">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-xs text-faint">
            {running ? <LiveDot tone="sky" /> : <Icon name={job.status === 'cancelled' ? 'x' : 'check'} size={13} className={job.status === 'cancelled' ? 'text-rose-ink' : 'text-mint-ink'} />}
            {job.label || 'Analysis'} · {elapsed(job.created_at, running ? null : job.finished_at)}
          </div>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.028em]">
            {running ? `Analyzing ${job.total} deal${job.total === 1 ? '' : 's'}…`
              : job.status === 'cancelled' ? `Analysis stopped · ${deals.filter((d) => d.stage === 'done').length} of ${job.total} finished`
                : `Analysis complete · ${job.total} deal${job.total === 1 ? '' : 's'}`}
          </h1>
          {!running && job.status !== 'cancelled' && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              {levels.filter((x) => x.n).map((x) => <span key={x.l} className="inline-flex items-center gap-1.5"><RiskBadge level={x.l as 'High'} /> × {x.n}</span>)}
            </div>
          )}
        </div>
        {running ? (
          <button type="button" className="btn border-rose-ink/30 text-rose-ink hover:bg-rose-ink/10" onClick={() => setConfirm(true)}>
            <Icon name="x" size={14} />Stop analysis
          </button>
        ) : (
          <button type="button" className="btn-primary h-9" onClick={dismiss}>See results <Icon name="arrowRight" size={14} /></button>
        )}
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line/[0.06]">
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, rgb(var(--sky-ink)), rgb(var(--blush-ink)), rgb(var(--mint-ink)))' }} />
      </div>

      <div className="relative mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((s, i) => {
          const items = byStage(s.key)
          const busy = running && items.length > 0 && s.key !== 'done' && s.key !== 'queued'
          return (
            <div key={s.key} className="relative">
              {i < STAGES.length - 1 && (
                <div aria-hidden="true" className="absolute -right-3 top-7 z-10 hidden h-px w-3 xl:block" style={{ background: `rgb(var(--${s.tone}-ink) / .5)` }} />
              )}
              <div className={cx('card flex h-full min-h-[220px] flex-col p-3 transition duration-300', busy && 'shadow-[0_0_0_1px_rgb(var(--sky-ink)/0.35),0_18px_40px_-20px_rgb(var(--sky-ink)/0.5)]')}>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-onpastel" style={{ background: `rgb(var(--${s.tone}))` }}>
                    {busy ? <Spinner size={13} /> : <Icon name={s.icon} size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.label}</div>
                    <div className="truncate text-[11px] text-faint">{s.hint}</div>
                  </div>
                  <span className="font-mono text-xs text-muted">{items.length}</span>
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  {items.map((d) => (
                    <div key={d.deal_id} className="anim-rise flex items-center gap-2 rounded-md border border-line/[0.07] bg-line/[0.02] px-2 py-1.5 text-xs">
                      <span className="truncate text-body">{d.account}</span>
                      {d.stage === 'failed' && <span className="ml-auto text-rose-ink">failed</span>}
                      {d.stage === 'done' && d.risk_level && <span className="ml-auto"><RiskBadge level={d.risk_level} className="py-0 text-[10px]" /></span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {stopped.length > 0 && (
        <p className="mt-4 text-xs text-faint">Not analyzed because the run was stopped: {stopped.map((d) => d.account).join(', ')}. They keep their previous results.</p>
      )}

      <Confirm open={confirm} danger title="Stop this analysis?" confirmLabel="Stop analysis"
        body="Deals that already finished keep their new results. The rest keep their previous analysis. You can re-analyze any time."
        onClose={() => setConfirm(false)}
        onConfirm={async () => { await cancel(job.id); toast.push('info', 'Analysis stopped') }} />
    </section>
  )
}
