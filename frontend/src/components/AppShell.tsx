import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { cx, money, timeAgo } from '../lib/format'
import { JobsProvider, useJobs } from '../lib/jobs'
import { isEmptyPipeline, PipelinesProvider, usePipelines } from '../lib/pipelines'
import { useToast } from '../lib/toast'
import type { PipelineStats } from '../lib/types'
import Confirm from './Confirm'
import Icon from './Icon'
import { LiveDot, Logo, Spinner, ThemeSwitch } from './ui'

type StepState = { state: 'done' | 'active' | 'todo'; progress?: number; badge?: string; tip?: string }

/** The app's flow, in order. A step is ticked when finished, shows a ring while it needs you, and is grey until reached. */
const STEPS: { to: string; label: string; hint: string; status: (s: PipelineStats) => StepState }[] = [
  { to: '/app/uploads', label: 'Upload data', hint: 'CRM export, emails, notes',
    status: (s) => (s.deals > 0 ? { state: 'done' } : { state: 'active', badge: 'start here' }) },
  { to: '/app', label: 'Pipeline overview', hint: 'Risk across all deals',
    status: (s) => (s.analyzed > 0 ? { state: 'done' } : s.deals > 0 ? { state: 'active', badge: 'analyzing' } : { state: 'todo' }) },
  { to: '/app/stalled', label: 'Stalled deals', hint: 'Why each one is stuck',
    status: (s) => {
      if (!s.analyzed) return { state: 'todo' }
      if (!s.stalled) return { state: 'done' }
      const needYou = s.stalled - (s.waiting ?? 0)
      if (!needYou) return { state: 'done', badge: `${s.stalled} waiting`, tip: 'You finished every recovery step. These deals are waiting on the customer.' }
      return {
        state: 'active', badge: `${needYou} stuck`, progress: (s.stalled_started ?? 0) / s.stalled,
        tip: `Ring: ${s.stalled_started ?? 0} of ${s.stalled} stuck deals have a recovery step started or done. The tick comes when every stuck deal is either fixed or waiting on the customer.`,
      }
    } },
  { to: '/app/actions', label: 'Recovery plan', hint: 'What to do, who, by when',
    status: (s) => (!s.actions_total ? { state: 'todo' } : s.actions_done >= s.actions_total ? { state: 'done' }
      : { state: 'active', progress: s.actions_done / s.actions_total, badge: `${s.actions_done}/${s.actions_total} done`,
          tip: `Ring: ${s.actions_done} of ${s.actions_total} recovery actions are done.` }) },
  { to: '/app/drafts', label: 'Drafts & outreach', hint: 'Review, approve, send',
    status: (s) => (s.drafts ? { state: 'active', badge: `${s.drafts} to review` } : s.sent ? { state: 'done' } : { state: 'todo' }) },
]

function StepDot({ n, st, on }: { n: number; st: StepState; on: boolean }) {
  if (st.state === 'done') {
    return <span className="relative z-10 inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-mint text-onpastel"><Icon name="check" size={11} strokeWidth={3} /></span>
  }
  const p = st.state === 'active' ? (st.progress ?? 0) : 0
  const c = 2 * Math.PI * 9.5
  return (
    <span className="relative z-10 inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-bg">
      <svg width="22" height="22" viewBox="0 0 22 22" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="11" cy="11" r="9.5" fill="none" strokeWidth="1.5" style={{ stroke: 'rgb(var(--ink) / .15)' }} />
        {st.state === 'active' && <circle cx="11" cy="11" r="9.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0.04, Math.min(1, p)))} style={{ stroke: 'rgb(var(--butter-ink))', transition: 'stroke-dashoffset .6s ease' }} />}
      </svg>
      <span className={cx('text-[11px] font-medium', st.state === 'active' ? 'text-butter-ink' : on ? 'text-text' : 'text-faint')}>{n}</span>
    </span>
  )
}

export default function AppShell() {
  return (
    <PipelinesProvider>
      <JobsProvider>
        <Shell />
      </JobsProvider>
    </PipelinesProvider>
  )
}

function Shell() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const { current, loading } = usePipelines()
  useEffect(() => setOpen(false), [loc.pathname, loc.search])
  return (
    <div className="relative flex h-screen overflow-hidden bg-bg">
      <div aria-hidden="true" className="anim-drift pointer-events-none absolute left-1/2 top-[-440px] h-[760px] w-[1200px] -translate-x-[30%]"
        style={{ background: 'radial-gradient(closest-side, rgb(var(--sky-ink) / .10), rgb(var(--blush-ink) / .04) 55%, transparent)' }} />
      <Sidebar className="hidden lg:flex" />
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="anim-fade absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <Sidebar className="anim-slide-in relative z-10 flex bg-panel" />
        </div>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" id="main-scroll">
        <div className="flex items-center gap-3 border-b border-line/[0.06] px-4 py-3 lg:hidden">
          <button type="button" className="btn-ghost" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <Link to="/app"><Logo size={20} /></Link>
          <span className="truncate text-xs text-faint">{current?.name}</span>
        </div>
        {loading || !current ? (
          <div className="flex flex-1 items-center justify-center gap-3 text-sm text-muted"><Spinner className="text-sky-ink" />Loading your pipelines…</div>
        ) : (
          <Outlet key={current.id} />
        )}
      </div>
    </div>
  )
}

function Sidebar({ className }: { className?: string }) {
  const loc = useLocation()
  const nav = useNavigate()
  const toast = useToast()
  const { user, logout } = useAuth()
  const { list, current, select, create, remove, clearAll } = usePipelines()
  const recents = list.filter((p) => !isEmptyPipeline(p))
  const { active, live, cancel } = useJobs()
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; id: string; name: string; running: boolean } | { kind: 'clear' } | { kind: 'stop'; id: string }>(null)
  const [creating, setCreating] = useState(false)
  const job = active.find((j) => j.id === live?.id) || active[0]
  const stats = current?.stats

  const newPipeline = async () => {
    setCreating(true)
    try { await create(); nav('/app/uploads') } catch (e) { toast.push('error', 'Could not create a pipeline', (e as Error).message) } finally { setCreating(false) }
  }

  return (
    <nav aria-label="Main" className={cx('relative h-screen w-[260px] flex-none flex-col overflow-y-auto border-r border-line/[0.06] px-3 py-[18px]', className)}>
      <Link to="/" className="mb-4 px-2.5 py-1.5"><Logo /></Link>
      <button type="button" onClick={newPipeline} disabled={creating} className="btn-primary mb-5 h-9 w-full justify-start rounded-[9px] px-3">
        {creating ? <Spinner /> : <span className="text-base leading-none">+</span>}New pipeline
      </button>

      <div className="eyebrow mb-2 flex items-center gap-2 px-2.5">
        <span className="truncate normal-case tracking-normal text-faint" title={current?.name}>{current && isEmptyPipeline(current) ? 'New pipeline · add data to start' : current?.name}</span>
      </div>
      <ol className="relative flex flex-col gap-0.5">
        {STEPS.map((s, i) => {
          const on = s.to === '/app' ? loc.pathname === '/app' : loc.pathname.startsWith(s.to)
          const st: StepState = stats ? s.status(stats) : { state: 'todo' }
          const done = st.state === 'done'
          const badge = st.badge
          return (
            <li key={s.to} className="relative">
              {i < STEPS.length - 1 && <span aria-hidden="true" className={cx('absolute left-[21px] top-[34px] h-[calc(100%-22px)] w-px', done ? 'bg-mint-ink/40' : 'bg-line/[0.08]')} />}
              <NavLink to={s.to} title={st.tip}
                className={cx('relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition duration-150', on ? 'bg-line/[0.06]' : 'hover:bg-line/[0.045]')}>
                <StepDot n={i + 1} st={st} on={on} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[13px]', on ? 'text-text' : 'text-muted')}>{s.label}</span>
                  <span className="block truncate text-[11px] text-faint">{s.hint}</span>
                </span>
                {badge && <span className={cx('whitespace-nowrap rounded-md px-1.5 py-px text-[11px]', st.state === 'active' ? 'bg-butter-ink/10 text-butter-ink' : 'bg-line/[0.06] text-muted')}>{badge}</span>}
              </NavLink>
            </li>
          )
        })}
      </ol>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-2.5 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-mint" />done</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2 border-butter-ink" />needs you</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-line/30" />not started</span>
      </div>

      {job && (
        <div className="anim-rise relative mt-4 overflow-hidden rounded-xl border border-sky-ink/25 bg-sky-ink/[0.05] p-3">
          <div aria-hidden="true" className="anim-sweep absolute bottom-0 top-0 w-[30%]" style={{ background: 'linear-gradient(90deg, transparent, rgb(var(--sky-ink) / .08), transparent)' }} />
          <div className="relative flex items-center gap-2 text-xs">
            <Spinner size={12} className="text-sky-ink" /><span className="text-text">Analyzing deals</span>
            <button type="button" className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-rose-ink transition hover:bg-rose-ink/10" onClick={() => setConfirm({ kind: 'stop', id: job.id })}>Stop</button>
          </div>
          <div className="relative mt-2 h-1 overflow-hidden rounded bg-line/[0.07]">
            <div className="h-full rounded bg-sky-ink transition-[width] duration-500" style={{ width: `${Math.max(6, (job.done / Math.max(1, job.total)) * 100)}%` }} />
          </div>
          <Link to="/app" className="relative mt-1.5 block font-mono text-[11px] text-faint hover:text-sky-ink">{job.done} / {job.total} deals · watch live →</Link>
        </div>
      )}

      <div className="mt-6 flex items-center px-2.5">
        <span className="eyebrow">Recents</span>
        {recents.length > 0 && <button type="button" className="ml-auto text-[11px] text-faint transition hover:text-rose-ink" onClick={() => setConfirm({ kind: 'clear' })}>Clear all</button>}
      </div>
      {recents.length === 0 && <p className="px-2.5 pt-2 text-[12px] leading-relaxed text-faint">Pipelines show up here once you add data to them.</p>}
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {recents.map((p) => (
          <li key={p.id} className="group relative">
            <button type="button" onClick={() => { select(p.id); nav(p.stats.deals ? '/app' : '/app/uploads') }}
              className={cx('flex w-full items-center gap-2 rounded-lg py-2 pl-2.5 pr-8 text-left transition', p.id === current?.id ? 'bg-line/[0.06]' : 'hover:bg-line/[0.045]')}>
              {p.stats.running ? <LiveDot tone="sky" /> : <span className={cx('h-[7px] w-[7px] flex-none rounded-full', p.stats.high_risk ? 'bg-rose-ink' : p.stats.deals ? 'bg-mint-ink' : 'bg-line/20')} />}
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate text-[13px]', p.id === current?.id ? 'text-text' : 'text-muted')}>{p.name}</span>
                <span className="block truncate text-[11px] text-faint">{p.stats.deals ? `${p.stats.deals} deals · ${money(p.stats.pipeline_value)}` : 'Empty'} · {timeAgo(p.updated_at)}</span>
              </span>
            </button>
            <button type="button" aria-label={`Delete ${p.name}`} title="Delete"
              onClick={() => setConfirm({ kind: 'delete', id: p.id, name: p.name, running: p.stats.running })}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint opacity-0 transition hover:bg-rose-ink/10 hover:text-rose-ink focus-visible:opacity-100 group-hover:opacity-100">
              <Icon name="trash" size={13} />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center gap-2 px-1 pt-6">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-mist text-[11px] font-semibold text-onpastel">{(user?.name || '?').slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]">{user?.name}</div>
          <div className="truncate text-[11px] text-faint">{user?.email}</div>
        </div>
        <button type="button" className="btn-ghost px-2" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
      </div>

      <Confirm open={confirm?.kind === 'stop'} danger title="Stop this analysis?" confirmLabel="Stop analysis"
        body="Deals that already finished keep their new results. The rest keep their previous analysis. You can re-analyze any time."
        onClose={() => setConfirm(null)}
        onConfirm={async () => { if (confirm?.kind === 'stop') { await cancel(confirm.id); toast.push('info', 'Analysis stopped') } }} />
      <Confirm open={confirm?.kind === 'delete'} danger title={`Delete “${confirm?.kind === 'delete' ? confirm.name : ''}”?`} confirmLabel="Delete pipeline"
        body={<>All deals, analyses, actions and drafts in this pipeline will be deleted. This can't be undone.{confirm?.kind === 'delete' && confirm.running ? ' Its running analysis will be stopped first.' : ''}</>}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { if (confirm?.kind === 'delete') { await remove(confirm.id); toast.push('success', 'Pipeline deleted'); nav('/app') } }} />
      <Confirm open={confirm?.kind === 'clear'} danger title="Clear all pipelines?" confirmLabel="Delete everything"
        body="Every pipeline in Recents and all of its data will be deleted, and any running analysis stopped. You'll start with a fresh, empty pipeline."
        onClose={() => setConfirm(null)}
        onConfirm={async () => { await clearAll(); toast.push('success', 'All pipelines cleared'); nav('/app/uploads') }} />
    </nav>
  )
}

export function PageHeader({ crumbs, children }: { crumbs: { label: string; to?: string }[]; children?: ReactNode }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    nav(q.trim() ? `/app?q=${encodeURIComponent(q.trim())}` : '/app')
  }
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line/[0.06] bg-bg/80 px-4 py-3 backdrop-blur-md sm:px-8">
      <div className="flex min-w-0 items-center text-[13px] text-muted">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center">
            {i > 0 && <span className="px-1.5 text-dim">/</span>}
            {c.to ? <Link to={c.to} className="hover:text-text">{c.label}</Link> : <span className="truncate text-text">{c.label}</span>}
          </span>
        ))}
      </div>
      <form onSubmit={submit} role="search" className="ml-auto hidden md:block">
        <label className="flex h-8 w-[240px] items-center gap-2 rounded-lg border border-line/[0.08] bg-line/[0.02] px-2.5 text-[13px] text-faint transition focus-within:border-sky-ink/50">
          <Icon name="search" size={14} />
          <span className="sr-only">Search deals</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals, owners…" className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-faint focus-visible:ring-0" />
        </label>
      </form>
      <div className="ml-auto flex flex-wrap items-center gap-2 md:ml-0">
        <ThemeSwitch />
        {children}
      </div>
    </header>
  )
}

/** "Next step" card shown at the bottom of each page so the flow is always obvious. */
export function NextStep({ to, step, title, body }: { to: string; step: number; title: string; body: string }) {
  return (
    <Link to={to} className="card card-hover group mx-4 mt-10 flex items-center gap-4 px-5 py-4 sm:mx-8">
      <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full bg-sky font-mono text-sm text-onpastel">{step}</span>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">Next step</div>
        <div className="mt-0.5 text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{body}</div>
      </div>
      <Icon name="arrowRight" size={18} className="text-sky-ink transition group-hover:translate-x-1" />
    </Link>
  )
}
