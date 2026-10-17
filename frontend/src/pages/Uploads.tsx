import { useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import Confirm from '../components/Confirm'
import Icon from '../components/Icon'
import { ErrorNote, Skeleton, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { cx, timeAgo } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { usePipelines } from '../lib/pipelines'
import { useToast } from '../lib/toast'
import type { Job, UploadRecord } from '../lib/types'

const ACCEPT = '.csv,.xlsx,.xls,.txt,.md,.docx,.pdf,.eml'
const MAX_MB = 10

const TEMPLATES = {
  'crm_deals_template.csv':
    'Deal ID,Deal Name,Account,Amount,Stage,Owner,Close Date,Last Activity,Probability,Forecast Category,Status,Stage Entered,Contacts\n' +
    'DL-2001,Example Platform,Acme Corp,"$120,000",Proposal,Your Name,2026-12-15,2026-10-10,60%,Best Case,Open,2026-09-20,"Jane Doe (CFO) <jane@acme.com>; Sam Lee (IT Director) <sam@acme.com>"\n',
  'activities_template.csv':
    'deal_id,type,date,direction,from,to,subject,body,outcome,due_date\n' +
    'DL-2001,email,2026-10-10,inbound,Jane Doe <jane@acme.com>,Your Name,Pricing question,"Can you share pricing for 200 seats?",,\n' +
    'DL-2001,call,2026-10-12,,Your Name,Sam Lee,Technical review,"Sam asked about SSO and data residency.",completed,\n',
}

interface Pending { name: string; state: 'waiting' | 'uploading' | 'done' | 'error'; result?: UploadRecord; error?: string }

export default function Uploads() {
  const { refreshKey, track } = useJobs()
  const { current, refresh: refreshPipelines } = usePipelines()
  const nav = useNavigate()
  const toast = useToast()
  const history = useAsync(() => api<UploadRecord[]>('/api/uploads'), [refreshKey])
  const [kind, setKind] = useState('auto')
  const [drag, setDrag] = useState(false)
  const [queue, setQueue] = useState<Pending[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const send = async (files: File[]) => {
    if (!files.length) return
    // CRM exports first so documents can be matched to deals in the same batch
    const ordered = [...files].sort((a, b) => Number(/\.(csv|xlsx|xls)$/i.test(b.name)) - Number(/\.(csv|xlsx|xls)$/i.test(a.name)))
    setQueue(ordered.map((f) => ({ name: f.name, state: 'waiting' })))
    for (const f of ordered) {
      const set = (p: Partial<Pending>) => setQueue((q) => q.map((x) => (x.name === f.name ? { ...x, ...p } : x)))
      if (f.size > MAX_MB * 1024 * 1024) { set({ state: 'error', error: `Larger than ${MAX_MB} MB` }); continue }
      set({ state: 'uploading' })
      const form = new FormData()
      form.append('file', f)
      if (kind !== 'auto') form.append('kind', kind)
      try {
        const r = await api<{ upload: UploadRecord; job: Job | null }>('/api/uploads', { form, method: 'POST' })
        set({ state: 'done', result: r.upload })
        track(r.job)
      } catch (e) {
        set({ state: 'error', error: (e as Error).message })
      }
    }
    history.reload()
    refreshPipelines().catch(() => {})
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    send(Array.from(e.dataTransfer.files))
  }

  const demo = async (which: 'sample' | 'update') => {
    setBusy(which)
    try {
      const r = await api<{ job: Job | null; deals_affected: string[] }>(`/api/demo/${which}`, { method: 'POST' })
      track(r.job)
      toast.push('success', which === 'sample' ? 'Sample pipeline loaded' : 'New activity loaded', `${r.deals_affected.length} deal(s) are being analyzed.`)
      refreshPipelines().catch(() => {})
      nav('/app')
    } catch (e) { toast.push('error', 'Could not load sample data', (e as Error).message) } finally { setBusy(null) }
  }

  const reset = async () => {
    setBusy('reset')
    try {
      await api('/api/demo/data', { method: 'DELETE' })
      toast.push('success', 'Pipeline cleared')
      setQueue([])
      history.reload()
      refreshPipelines().catch(() => {})
    } catch (e) { toast.push('error', 'Could not clear data', (e as Error).message) } finally { setBusy(null) }
  }

  const download = (name: keyof typeof TEMPLATES) => {
    const url = URL.createObjectURL(new Blob([TEMPLATES[name]], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main className="min-w-0 flex-1 pb-12">
      <PageHeader crumbs={[{ label: 'Step 1' }, { label: 'Upload data' }]} />
      <section className="anim-rise px-4 pt-8 sm:px-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.028em]">Bring in your data</h1>
        <p className="mt-1.5 max-w-[680px] text-[15px] text-muted">Start with your CRM export, then add emails, call transcripts and meeting notes. Analysis starts automatically, and every later upload re-checks the deals it touches.</p>
      </section>

      <div className="flex flex-wrap gap-4 px-4 pt-6 sm:px-8">
        <div className="flex min-w-0 flex-[2_1_460px] flex-col gap-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cx('relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-[1.5px] border-dashed px-6 py-12 text-center transition duration-200',
              drag ? 'scale-[1.01] border-sky-ink/70 bg-sky-ink/[0.07]' : 'border-sky-ink/30 bg-sky-ink/[0.03]')}>
            <span className={cx('inline-flex h-12 w-12 items-center justify-center rounded-xl bg-sky text-onpastel transition duration-300', drag && '-translate-y-1')}><Icon name="upload" size={22} /></span>
            <div className="text-base font-medium">{drag ? 'Drop to upload' : 'Drag files here'}</div>
            <div className="text-xs text-muted">CSV, XLSX, TXT, MD, DOCX, PDF, EML · up to {MAX_MB} MB each</div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="btn-primary" onClick={() => input.current?.click()}>Choose files</button>
              <label className="flex items-center gap-2 text-xs text-muted">File holds
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="input h-8 w-auto py-0 text-xs">
                  <option value="auto">Detect automatically</option><option value="deals">CRM deals</option><option value="activities">Activities</option>
                </select>
              </label>
            </div>
            <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose files to upload"
              onChange={(e) => { send(Array.from(e.target.files || [])); e.target.value = '' }} />
          </div>

          {queue.length > 0 && (
            <div className="card divide-y divide-line/[0.05]">
              {queue.map((q) => <QueueRow key={q.name} q={q} />)}
              {queue.every((q) => q.state === 'done' || q.state === 'error') && queue.some((q) => q.result?.deals_affected.length) && (
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <span className="text-[13px] text-muted">Analysis has started for the deals in these files.</span>
                  <Link to="/app" className="btn-primary ml-auto">Watch it live <Icon name="arrowRight" size={14} /></Link>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between border-b border-line/[0.06] px-5 py-3.5">
              <div className="text-[13px] font-medium">Upload history</div>
              <span className="text-xs text-faint">{history.data?.length ?? 0} files</span>
            </div>
            {history.error && <div className="p-4"><ErrorNote message={history.error} onRetry={history.reload} /></div>}
            {!history.data && !history.error && <div className="flex flex-col gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
            {history.data?.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No uploads yet.</p>}
            <div className="divide-y divide-line/[0.05]">
              {history.data?.map((u) => <HistoryRow key={u.id} u={u} />)}
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <div className="card p-5">
            <div className="eyebrow text-blush-ink">Try it with sample data</div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">A realistic pipeline of 12 deals with email threads, a call transcript and meeting notes.</p>
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" className="btn-primary h-9 justify-start" onClick={() => demo('sample')} disabled={!!busy}>
                {busy === 'sample' ? <Spinner /> : <Icon name="sparkle" size={14} />}1. Load sample pipeline
              </button>
              <button type="button" className="btn h-9 justify-start" onClick={() => demo('update')} disabled={!!busy}>
                {busy === 'update' ? <Spinner /> : <Icon name="refresh" size={14} />}2. Add a week of new activity
              </button>
              <p className="text-xs leading-relaxed text-faint">Step 2 adds new emails and call notes, so you can watch risk change and read why.</p>
            </div>
            <div className="mt-4 border-t border-line/[0.06] pt-4">
              <button type="button" className="btn-ghost -ml-2.5 text-xs" onClick={() => setConfirmReset(true)}><Icon name="trash" size={13} />Clear this pipeline</button>
              <Confirm open={confirmReset} danger title="Clear this pipeline?" confirmLabel="Clear pipeline"
                body="All deals, uploads, analyses, actions and drafts in this pipeline will be deleted. Other pipelines in Recents are not affected."
                onClose={() => setConfirmReset(false)} onConfirm={reset} />
            </div>
          </div>

          <div className="card p-5 text-[13px]">
            <div className="eyebrow">What to upload</div>
            <div className="mt-3 flex flex-col gap-4">
              <div>
                <div className="font-medium">CRM export · CSV or Excel</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">One row per deal. Needs a deal ID or name, amount and stage. Close date, owner, probability, stage date and contacts help a lot. Column names like “Opportunity ID” or “Close Date” are recognised.</p>
                <button type="button" className="mt-1.5 text-xs text-sky-ink hover:underline" onClick={() => download('crm_deals_template.csv')}>Download template</button>
              </div>
              <div>
                <div className="font-medium">Activity log · CSV or Excel</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">One row per email, call, meeting, note or follow-up, with a date, a deal ID (or account) and the text.</p>
                <button type="button" className="mt-1.5 text-xs text-sky-ink hover:underline" onClick={() => download('activities_template.csv')}>Download template</button>
              </div>
              <div>
                <div className="font-medium">Documents · TXT, DOCX, PDF, EML</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">Email threads, transcripts and notes. Add these lines at the top for exact matching, and separate several records with a line of dashes:</p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-line/[0.04] p-3 font-mono text-[11px] leading-relaxed text-body">{'Deal: DL-1042\nType: call\nDate: 2026-10-15\n\nNotes go here…\n---\nDeal: DL-1042\nType: email\n…'}</pre>
              </div>
            </div>
          </div>
        </aside>
      </div>
      {!!current?.stats.deals && <NextStep to="/app" step={2} title="See the pipeline overview" body="Risk, stalled value and why deals stall, across everything you uploaded." />}
    </main>
  )
}

function QueueRow({ q }: { q: Pending }) {
  const r = q.result
  return (
    <div className="anim-fade px-5 py-3.5 text-[13px]">
      <div className="flex items-center gap-3">
        <Icon name="file" className="text-muted" />
        <span className="min-w-0 flex-1 truncate">{q.name}</span>
        {q.state === 'waiting' && <span className="text-xs text-faint">Waiting</span>}
        {q.state === 'uploading' && <span className="flex items-center gap-1.5 text-xs text-sky-ink"><Spinner size={12} />Reading file</span>}
        {q.state === 'error' && <span className="text-xs text-rose-ink">Failed</span>}
        {q.state === 'done' && r && <StatusChip s={r.status} />}
      </div>
      {q.state === 'uploading' && <div className="mt-2 h-1 overflow-hidden rounded bg-line/[0.06]"><div className="h-full w-1/2 rounded bg-sky-ink" style={{ animation: 'stuck 1.6s ease-in-out infinite alternate' }} /></div>}
      {q.error && <p className="mt-1.5 text-xs text-rose-ink">{q.error}</p>}
      {r && <UploadSummary u={r} open />}
    </div>
  )
}

function HistoryRow({ u }: { u: UploadRecord }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-5 py-3 text-[13px]">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="file" className="text-muted" />
        <span className="min-w-0 flex-1 truncate">{u.filename}</span>
        <span className="hidden text-xs text-faint sm:inline">{u.rows_imported} imported{u.rows_skipped ? ` · ${u.rows_skipped} skipped` : ''} · {timeAgo(u.created_at)}</span>
        <StatusChip s={u.status} />
        <Icon name="chevronDown" size={14} className={cx('text-faint transition', open && 'rotate-180')} />
      </button>
      {open && <UploadSummary u={u} open />}
    </div>
  )
}

function StatusChip({ s }: { s: UploadRecord['status'] }) {
  const map = { done: ['Imported', 'border-mint-ink/30 text-mint-ink'], partial: ['Imported with issues', 'border-butter-ink/30 text-butter-ink'], failed: ['Nothing imported', 'border-rose-ink/30 text-rose-ink'], processing: ['Processing', 'border-sky-ink/30 text-sky-ink'] }[s]
  return <span className={cx('chip flex-none py-0 text-[11px]', map[1])}>{map[0]}</span>
}

function UploadSummary({ u, open }: { u: UploadRecord; open?: boolean }) {
  if (!open) return null
  return (
    <div className="anim-fade mt-2.5 pl-7 text-xs text-muted">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>{u.kind === 'deals' ? 'CRM deals' : u.kind === 'documents' ? 'Documents' : u.kind === 'activities' ? 'Activities' : u.kind}</span>
        <span>{u.rows_imported} of {u.rows_total} imported</span>
        {u.deals_created > 0 && <span>{u.deals_created} new deals</span>}
        {u.deals_updated > 0 && <span>{u.deals_updated} deals updated</span>}
        {u.duplicates > 0 && <span>{u.duplicates} already imported</span>}
        {u.deals_affected.length > 0 && <span className="text-sky-ink">Re-checking {u.deals_affected.length} deal{u.deals_affected.length === 1 ? '' : 's'}</span>}
      </div>
      {u.errors.length > 0 && (
        <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line/[0.06] bg-line/[0.02] p-2.5">
          {u.errors.map((e, i) => (
            <li key={i} className={e.level === 'warning' ? 'text-butter-ink' : 'text-rose-ink'}>
              {e.row ? `Row ${e.row}` : 'File'}{e.sheet && e.sheet !== 'csv' ? ` (${e.sheet})` : ''}{e.field ? ` · ${e.field}` : ''}: <span className="text-body">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
