import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import LiveRun from '../components/LiveRun'
import Icon from '../components/Icon'
import { EmptyState, ErrorNote, LiveDot, RiskBadge, Skeleton, Sparkline, Spinner, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { cx, money, timeAgo } from '../lib/format'
import { useAsync, useCountUp } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { usePipelines } from '../lib/pipelines'
import { useToast } from '../lib/toast'
import type { Dashboard as DashboardData, DealList, Job } from '../lib/types'

const TINTS = ['bg-rose', 'bg-blush', 'bg-butter', 'bg-mist', 'bg-sky', 'bg-mint']
const REASON_TONE = ['bg-rose-ink', 'bg-blush-ink', 'bg-butter-ink', 'bg-mist-ink', 'bg-sky-ink', 'bg-mint-ink']

export default function Dashboard() {
  const { refreshKey, track, active, live } = useJobs()
  const { current: currentPipeline, refresh: refreshPipelines } = usePipelines()
  const pending = currentPipeline?.stats.needs_recheck ?? 0
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = useState<string | null>(null)
  const filters = {
    risk: params.get('risk') || '',
    owner: params.get('owner') || '',
    stage: params.get('stage') || '',
    reason: params.get('reason') || '',
    stalled: params.get('stalled') || '',
    q: params.get('q') || '',
    min_value: params.get('min_value') || '',
    sort: params.get('sort') || 'risk',
  }
  const dash = useAsync(() => api<DashboardData>('/api/dashboard'), [refreshKey])
  const deals = useAsync(() => api<DealList>('/api/deals', { params: { ...filters } }), [refreshKey, params.toString()])

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }

  const run = async (label: string, fn: () => Promise<{ job: Job | null }>, ok: string) => {
    setBusy(label)
    try {
      const r = await fn()
      track(r.job)
      toast.push('info', ok, 'Watch each deal move through the analysis below.')
    } catch (e) {
      toast.push('error', 'Something went wrong', (e as Error).message)
    } finally { setBusy(null) }
  }
  const loadSample = () => run('sample', async () => { const r = await api<{ job: Job | null }>('/api/demo/sample', { method: 'POST' }); refreshPipelines().catch(() => {}); return r }, 'Sample pipeline loaded')
  const reanalyze = () => run('re', () => api<{ job: Job | null }>('/api/deals/reanalyze', { body: {} }), 'Re-analyzing all deals')
  const recheckChanged = () => run('pending', () => api<{ job: Job | null }>('/api/deals/reanalyze', { body: { pending_only: true } }),
    `Re-checking ${pending} changed deal${pending === 1 ? '' : 's'}`)

  const d = dash.data
  const hasFilters = Object.entries(filters).some(([k, v]) => v && k !== 'sort')

  return (
    <main className="min-w-0 flex-1 pb-12">
      <PageHeader crumbs={[{ label: 'Step 2' }, { label: 'Pipeline overview' }]}>
        {d?.has_data && pending > 0 && (
          <button type="button" className="btn-mint" onClick={recheckChanged} disabled={!!busy || active.length > 0}
            title="Actions or emails changed since these deals were last analyzed">
            {busy === 'pending' ? <Spinner /> : <Icon name="refresh" size={14} strokeWidth={2} />}Re-check {pending} changed
          </button>
        )}
        {d?.has_data && (
          <button type="button" className="btn" onClick={reanalyze} disabled={!!busy || active.length > 0}>
            {busy === 're' || active.length ? <Spinner /> : <Icon name="refresh" size={14} />}Re-analyze
          </button>
        )}
        <Link to="/app/uploads" className="btn-primary"><Icon name="upload" size={14} strokeWidth={2} />Upload data</Link>
      </PageHeader>

      {dash.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={dash.error} onRetry={dash.reload} /></div>}

      {live && <LiveRun job={live} />}

      {!live && !d && !dash.error && <DashboardSkeleton />}

      {!live && d && !d.has_data && (
        <div className="px-4 pt-10 sm:px-8">
          <EmptyState icon="upload" title="Start with step 1: upload your data" body="This pipeline is empty. Upload a CRM export (and any emails, call notes or meeting notes), or load the sample pipeline to try it out.">
            <Link to="/app/uploads" className="btn-primary h-10 px-4"><Icon name="upload" size={14} />Go to step 1 · Upload data</Link>
            <button type="button" className="btn h-10 px-4" onClick={loadSample} disabled={!!busy}>
              {busy === 'sample' ? <Spinner /> : <Icon name="sparkle" size={14} />}Use the sample pipeline
            </button>
          </EmptyState>
        </div>
      )}

      {!live && d && d.has_data && (
        <>
          <Headline d={d} />
          <Kpis d={d} />
          <section className="flex flex-wrap gap-3 px-4 pb-6 sm:px-8">
            <StageChart d={d} />
            <Reasons d={d} onPick={(r) => set('reason', r)} />
            <Feed d={d} />
          </section>

          <section className="px-4 sm:px-8">
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <Segmented label="Risk" value={filters.risk || 'All'} onChange={(v) => set('risk', v === 'All' ? '' : v)} options={[
                { value: 'All', label: 'All', dot: 'bg-sky-ink' },
                { value: 'High', label: 'High', dot: 'bg-rose-ink' },
                { value: 'Medium', label: 'Medium', dot: 'bg-butter-ink' },
                { value: 'Low', label: 'Low', dot: 'bg-mint-ink' },
              ]} />
              <FilterSelect label="Owner" value={filters.owner} options={deals.data?.facets.owners.map((o) => ({ value: o, label: o })) || []} onChange={(v) => set('owner', v)} />
              <FilterSelect label="Stage" value={filters.stage} options={deals.data?.facets.stages.map((o) => ({ value: o, label: o })) || []} onChange={(v) => set('stage', v)} />
              <FilterSelect label="Stall reason" value={filters.reason} options={deals.data?.facets.reasons || []} onChange={(v) => set('reason', v)} />
              <FilterSelect label="Value" value={filters.min_value} options={[
                { value: '50000', label: '≥ $50k' }, { value: '100000', label: '≥ $100k' }, { value: '250000', label: '≥ $250k' },
              ]} onChange={(v) => set('min_value', v)} />
              <label className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border border-line/[0.09] px-2.5 text-xs text-muted transition hover:text-text">
                <input type="checkbox" className="accent-[rgb(var(--sky-ink))]" checked={filters.stalled === 'true'} onChange={(e) => set('stalled', e.target.checked ? 'true' : '')} />
                Stalled only
              </label>
              {filters.q && <span className="chip border-sky-ink/30 bg-sky-ink/10 text-sky-ink">“{filters.q}” <button type="button" aria-label="Clear search" onClick={() => set('q', '')}><Icon name="x" size={12} /></button></span>}
              {hasFilters && <button type="button" className="btn-ghost text-xs" onClick={() => setParams({}, { replace: true })}>Clear filters</button>}
              <label className="ml-auto flex items-center gap-2 text-xs text-faint">Sort
                <select value={filters.sort} onChange={(e) => set('sort', e.target.value === 'risk' ? '' : e.target.value)} className="input h-8 w-auto py-0 text-xs">
                  <option value="risk">Risk</option><option value="at_risk">Value at risk</option><option value="value">Deal value</option><option value="silent">Days silent</option><option value="name">Account</option>
                </select>
              </label>
            </div>
            <DealTable list={deals.data} loading={deals.loading && !deals.data} error={deals.error} />
          </section>
          {d.kpis.stalled_count > 0 && (
            <NextStep to="/app/stalled" step={3} title={`See why ${d.kpis.stalled_count} deal${d.kpis.stalled_count === 1 ? ' is' : 's are'} stuck`} body="One card per stalled deal: the reason, the proof, and the next move." />
          )}
        </>
      )}
    </main>
  )
}

function Headline({ d }: { d: DashboardData }) {
  const v = useCountUp(d.kpis.stalled_value)
  return (
    <section className="anim-rise px-4 pb-1.5 pt-8 sm:px-8">
      <div className="font-mono text-xs text-faint">
        {d.last_analyzed_at ? `Last analyzed ${timeAgo(d.last_analyzed_at)}` : 'Not analyzed yet'} · {d.kpis.open_deals} open deals · {d.activity_count.toLocaleString()} activities
      </div>
      <h1 className="mt-2.5 text-[28px] font-semibold leading-tight tracking-[-0.028em] sm:text-[32px]">
        <span style={{ background: 'linear-gradient(90deg, rgb(var(--rose-ink)), rgb(var(--blush-ink)) 50%, rgb(var(--butter-ink)))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{money(v)}</span>
        {' '}of pipeline is stalled.
      </h1>
      <p className="mt-2 max-w-[640px] text-[15px] leading-relaxed text-muted">
        {d.kpis.stalled_count === 0 ? 'Nothing is stuck right now. Deal Rescue keeps watching as new activity comes in.'
          : `${d.kpis.stalled_count} deal${d.kpis.stalled_count === 1 ? ' has' : 's have'} gone quiet or are blocked, and ${d.kpis.high_risk} ${d.kpis.high_risk === 1 ? 'is' : 'are'} high risk. ${money(d.kpis.value_at_risk)} of value is at risk.`}
      </p>
    </section>
  )
}

function Kpi({ label, value, fmt, sub, tone, points, delay }: { label: string; value: number; fmt: (n: number) => string; sub: string; tone: string; points: number[]; delay: number }) {
  const v = useCountUp(value)
  return (
    <div className="card card-hover anim-rise px-4 pb-3 pt-4" style={{ animationDelay: `${delay}s` }}>
      <div className="flex items-center gap-2 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-sm" style={{ background: `rgb(var(--${tone}-ink))` }} />{label}</div>
      <div className="mt-2.5 text-2xl font-semibold tabular-nums tracking-[-0.02em]">{fmt(v)}</div>
      <div className="mt-2"><Sparkline points={points} tone={tone} /></div>
      <div className="mt-1 font-mono text-xs text-faint">{sub}</div>
    </div>
  )
}

function Kpis({ d }: { d: DashboardData }) {
  const k = d.kpis
  const t = d.trend
  const series = (f: (x: DashboardData['trend'][number]) => number, now: number) => (t.length ? t.map(f) : [now])
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3 px-4 py-5 sm:px-8">
      <Kpi label="Total pipeline" value={k.total_pipeline} fmt={(n) => money(n)} sub={`${k.open_deals} open deals`} tone="sky" points={series((x) => x.total_pipeline, k.total_pipeline)} delay={0} />
      <Kpi label="Stalled value" value={k.stalled_value} fmt={(n) => money(n)} sub={`${k.stalled_share}% of pipeline`} tone="rose" points={series((x) => x.stalled_value, k.stalled_value)} delay={0.06} />
      <Kpi label="High-risk deals" value={k.high_risk} fmt={(n) => String(Math.round(n))} sub={`${k.stalled_count} stalled in total`} tone="blush" points={series((x) => x.high_risk, k.high_risk)} delay={0.12} />
      <Kpi label="Median days silent" value={k.median_days_silent} fmt={(n) => String(Math.round(n))} sub="stalled deals only" tone="butter" points={series((x) => x.median_days_silent, k.median_days_silent)} delay={0.18} />
      <Kpi label="Recovery actions done" value={k.actions_done} fmt={(n) => `${Math.round(n)} / ${k.actions_total}`} sub={`${k.actions_in_progress} in progress`} tone="mint" points={series((x) => x.actions_done, k.actions_done)} delay={0.24} />
    </section>
  )
}

function StageChart({ d }: { d: DashboardData }) {
  const max = Math.max(1, ...d.stages.map((s) => s.moving + s.stalled))
  return (
    <div className="card anim-rise min-w-0 flex-[2_1_420px] px-5 py-[18px]">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="text-[13px] font-medium">Pipeline by stage</div>
        <div className="ml-auto flex gap-3.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-sky-ink" />Moving</span>
          <span className="inline-flex items-center gap-1.5"><span className="hatch h-2.5 w-2.5 rounded-[3px] bg-rose-ink" />Stalled</span>
        </div>
      </div>
      <div className="mt-[18px] flex flex-col gap-3.5" role="list">
        {d.stages.map((s, i) => (
          <div key={s.stage} role="listitem" className="grid grid-cols-[112px_minmax(0,1fr)_64px] items-center gap-3 text-xs"
            aria-label={`${s.stage}: ${money(s.moving)} moving, ${money(s.stalled)} stalled`}>
            <span className="truncate text-muted">{s.stage}</span>
            <div className="flex h-3.5 gap-0.5">
              {s.moving > 0 && <div className="anim-bar rounded-l bg-sky-ink" style={{ width: `${(s.moving / max) * 100}%`, animationDelay: `${0.15 + i * 0.07}s` }} />}
              {s.stalled > 0 && <div className="anim-bar hatch rounded-r bg-rose-ink" style={{ width: `${(s.stalled / max) * 100}%`, animationDelay: `${0.45 + i * 0.07}s` }} />}
            </div>
            <span className="text-right font-mono text-body">{money(s.moving + s.stalled)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Reasons({ d, onPick }: { d: DashboardData; onPick: (r: string) => void }) {
  const max = Math.max(1, ...d.reasons.map((r) => r.count))
  return (
    <div className="card anim-rise min-w-0 flex-[1_1_280px] px-5 py-[18px]" style={{ animationDelay: '.1s' }}>
      <div className="text-[13px] font-medium">Why deals stall</div>
      {d.reasons.length === 0 && <p className="mt-4 text-xs text-faint">No stalled deals.</p>}
      <div className="mt-4 flex flex-col gap-3">
        {d.reasons.map((r, i) => (
          <button key={r.category} type="button" onClick={() => onPick(r.category)} className="group rounded-md text-left">
            <div className="flex justify-between text-xs"><span className="text-body group-hover:text-text">{r.label}</span><span className="font-mono text-faint">{r.count} · {money(r.value)}</span></div>
            <div className="mt-1.5 h-[5px] overflow-hidden rounded bg-line/[0.05]">
              <div className={cx('anim-bar h-full rounded', REASON_TONE[i % REASON_TONE.length])} style={{ width: `${(r.count / max) * 100}%`, animationDelay: `${0.2 + i * 0.08}s` }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function Feed({ d }: { d: DashboardData }) {
  const tone = (k: string) => ({ risk_change: 'bg-rose-ink', action: 'bg-mint-ink', draft: 'bg-blush-ink', upload: 'bg-sky-ink', job: 'bg-mist-ink' }[k] || 'bg-sky-ink')
  return (
    <div className="card anim-rise min-w-0 flex-[1_1_280px] px-5 py-[18px]" style={{ animationDelay: '.2s' }}>
      <div className="flex items-center gap-2 text-[13px] font-medium">Live activity {d.active_jobs.length > 0 && <LiveDot tone="sky" />}</div>
      <div className="mt-4 flex max-h-[230px] flex-col gap-3.5 overflow-y-auto pr-1">
        {d.feed.length === 0 && <p className="text-xs text-faint">Nothing yet.</p>}
        {d.feed.map((f, i) => {
          const inner = (
            <>
              <span className="relative mt-1 h-2 w-2 flex-none">
                {i === 0 && <span className={cx('anim-ping absolute inset-0 rounded-full', tone(f.kind))} />}
                <span className={cx('absolute inset-0 rounded-full', tone(f.kind))} />
              </span>
              <div className="min-w-0"><div className="leading-snug text-body">{f.text}</div><div className="mt-0.5 font-mono text-[11px] text-faint">{timeAgo(f.at)}</div></div>
            </>
          )
          return f.deal_id ? (
            <Link key={f.id} to={`/app/deals/${encodeURIComponent(f.deal_id)}`} className="flex gap-2.5 rounded-md text-xs transition hover:opacity-80">{inner}</Link>
          ) : <div key={f.id} className="flex gap-2.5 text-xs">{inner}</div>
        })}
      </div>
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className={cx('relative inline-flex h-[34px] items-center rounded-lg border px-2.5 text-xs transition',
      value ? 'border-sky-ink/35 bg-sky-ink/[0.08] text-sky-ink' : 'border-dashed border-line/[0.14] text-muted hover:text-text')}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="cursor-pointer appearance-none bg-transparent pr-4 outline-none focus-visible:ring-0">
        <option value="">{value ? `Any ${label.toLowerCase()}` : `+ ${label}`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-2" />
    </label>
  )
}

const COLS = 'grid-cols-[2.2fr_1fr_1.1fr_1fr_.8fr_1.7fr_1.1fr_1.1fr_20px]'

function DealTable({ list, loading, error }: { list: DealList | null; loading: boolean; error: string | null }) {
  if (error) return <ErrorNote message={error} />
  return (
    <div className="card overflow-x-auto">
      <div className="min-w-[980px]">
        <div className={cx('grid gap-3 border-b border-line/[0.06] px-4 py-2.5 text-[11px] uppercase tracking-[0.05em] text-faint', COLS)}>
          <div>Deal</div><div>Value</div><div>Stage</div><div>Owner</div><div>Silent</div><div>Stall reason</div><div>Risk</div><div>Recovery</div><div />
        </div>
        {loading && [0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line/[0.045] px-4 py-3.5"><Skeleton className="h-7 w-7 rounded-lg" /><Skeleton className="h-3 w-1/3" /><Skeleton className="ml-auto h-3 w-1/4" /></div>
        ))}
        {list && list.items.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">No deals match these filters.</div>}
        {list?.items.map((r, i) => {
          const l = r.latest
          const pct = l && l.recovery.total ? (l.recovery.done / l.recovery.total) * 100 : 0
          return (
            <Link key={r.id} to={`/app/deals/${encodeURIComponent(r.deal_id)}`}
              className={cx('group anim-rise grid items-center gap-3 border-b border-line/[0.045] px-4 py-3 text-[13px] transition-colors hover:bg-sky-ink/[0.035]', COLS)}
              style={{ animationDelay: `${Math.min(i, 12) * 0.035}s` }}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={cx('inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] text-[10px] font-semibold text-onpastel', TINTS[i % TINTS.length])}>
                  {r.account.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5"><span className="truncate">{r.name}</span>
                    {r.needs_recheck && <span title={r.recheck_reason ? `Not re-checked yet: ${r.recheck_reason}` : 'Changed since last check'}
                      className="flex-none rounded bg-butter/40 px-1 py-px text-[10px] font-medium text-butter-ink">changed</span>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-faint">{r.account}</div>
                </div>
              </div>
              <div className="tabular-nums">{money(r.value, r.currency, false)}</div>
              <div className="truncate text-muted">{r.stage}</div>
              <div className="truncate text-muted">{r.owner}</div>
              <div className={cx('font-mono text-xs', (l?.days_silent ?? 0) > 20 ? 'text-rose-ink' : 'text-muted')}>{l?.days_silent != null ? `${l.days_silent}d` : '—'}</div>
              <div className="truncate text-muted">{l?.stalled ? (l.waiting_on_customer ? <span className="text-mint-ink">Waiting on customer</span> : l.stall_reason) : <span className="text-faint">—</span>}</div>
              <div><RiskBadge level={l?.risk_level} score={l?.risk_score} /></div>
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded bg-line/[0.07]"><div className="anim-bar h-full rounded bg-mint-ink" style={{ width: `${pct}%` }} /></div>
                <span className="font-mono text-[11px] text-faint">{l ? `${l.recovery.done}/${l.recovery.total}` : '—'}</span>
              </div>
              <Icon name="chevronRight" size={14} className="-translate-x-1 text-sky-ink opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="px-4 pt-8 sm:px-8" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-64" />
      <Skeleton className="mt-4 h-8 w-96 max-w-full" />
      <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="card h-[132px] p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-6 w-20" /><Skeleton className="mt-5 h-6 w-full" /></div>)}
      </div>
      <div className="card mt-6 h-[260px]" />
    </div>
  )
}
