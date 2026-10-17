/* Outbox: every draft in this pipeline, reviewed and approved in one place. */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import DraftEditor, { DraftStatus } from '../components/DraftEditor'
import Icon from '../components/Icon'
import { EmptyState, ErrorNote, Segmented, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { cx, DRAFT_LABEL, timeAgo } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import type { Draft } from '../lib/types'

type Filter = 'review' | 'approved' | 'sent' | 'all'

export default function Drafts() {
  const { refreshKey } = useJobs()
  const [filter, setFilter] = useState<Filter>('review')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const res = useAsync(() => api<Draft[]>('/api/drafts'), [refreshKey])
  const all = res.data || []
  const counts = {
    review: all.filter((d) => d.status === 'draft').length,
    approved: all.filter((d) => d.status === 'approved').length,
    sent: all.filter((d) => d.status === 'sent').length,
    all: all.length,
  }
  const items = all.filter((d) => filter === 'all' || (filter === 'review' ? d.status === 'draft' : d.status === filter))
  const selected = items.find((d) => d.id === selectedId) || items[0]

  useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id) }, [selected, selectedId])

  return (
    <main className="min-w-0 flex-1 pb-12">
      <PageHeader crumbs={[{ label: 'Step 5' }, { label: 'Drafts & outreach' }]} />
      <section className="anim-rise px-4 pt-8 sm:px-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.028em]">Drafts & outreach</h1>
        <p className="mt-1.5 max-w-[680px] text-[15px] text-muted">Every email written for this pipeline, in one place. Review it, approve it, then send it from your mail app or mark it as sent. Nothing goes out without your approval.</p>
      </section>

      <section className="px-4 pt-6 sm:px-8">
        <div className="pb-3">
          <Segmented label="Draft status" value={filter} onChange={(v) => { setFilter(v); setSelectedId(null) }} options={[
            { value: 'review', label: `Needs review · ${counts.review}`, dot: 'bg-butter-ink' },
            { value: 'approved', label: `Approved · ${counts.approved}`, dot: 'bg-mint-ink' },
            { value: 'sent', label: `Sent · ${counts.sent}`, dot: 'bg-sky-ink' },
            { value: 'all', label: `All · ${counts.all}` },
          ]} />
        </div>
        {res.error && <ErrorNote message={res.error} onRetry={res.reload} />}
        {!res.data && !res.error && <div className="flex gap-4"><Skeleton className="h-[360px] flex-1" /><Skeleton className="hidden h-[360px] flex-[2] md:block" /></div>}
        {res.data && all.length === 0 && (
          <EmptyState icon="mail" title="No drafts yet" body="Open a stalled deal and use “Write draft” to create a follow-up, meeting request or objection reply from its history.">
            <Link to="/app/stalled" className="btn-primary h-9">Go to stalled deals</Link>
          </EmptyState>
        )}
        {res.data && all.length > 0 && items.length === 0 && <p className="py-10 text-center text-sm text-muted">Nothing in this list.</p>}
        {items.length > 0 && (
          <div className="flex flex-wrap items-start gap-4">
            <ul className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
              {items.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setSelectedId(d.id)} aria-current={d.id === selected?.id}
                    className={cx('w-full rounded-xl border px-3.5 py-3 text-left transition duration-150',
                      d.id === selected?.id ? 'border-sky-ink/40 bg-sky-ink/[0.07]' : 'border-line/[0.07] bg-panel hover:border-line/[0.14]')}>
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text">{d.deal?.account}</span>
                      <DraftStatus s={d.status} />
                    </div>
                    <div className="mt-1 truncate text-[13px] text-body">{d.subject}</div>
                    <div className="mt-1 truncate text-xs text-faint">{DRAFT_LABEL[d.type]} · to {d.to_name || d.to_email || '—'} · {timeAgo(d.updated_at)}</div>
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <div className="flex min-w-0 flex-[3_1_480px] flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted">
                  <span className="text-text">{selected.deal?.name}</span><span>· {DRAFT_LABEL[selected.type]}</span>
                  <Link to={`/app/deals/${encodeURIComponent(selected.deal_id)}?tab=diagnosis`} className="ml-auto inline-flex items-center gap-1 text-sky-ink hover:underline">
                    Why this email? See the deal <Icon name="arrowRight" size={12} />
                  </Link>
                </div>
                <DraftEditor key={selected.id + selected.updated_at} draft={selected} onChanged={res.reload} showEvidence={false} />
              </div>
            )}
          </div>
        )}
      </section>
      {counts.sent > 0 && counts.review === 0 && (
        <NextStep to="/app/uploads" step={1} title="Upload new replies and notes" body="Deal Rescue re-checks the deals they touch and shows what changed." />
      )}
    </main>
  )
}
