/* Evidence chips open a side drawer showing the exact record behind a finding. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { cx, longDate, money, shortDate, TYPE_LABEL } from '../lib/format'
import type { Activity, Deal } from '../lib/types'
import Icon from './Icon'

interface EvidenceCtx { open: (id: string) => void; find: (id: string) => Activity | undefined }
const Ctx = createContext<EvidenceCtx | null>(null)

export function EvidenceProvider({ deal, timeline, children }: { deal: Deal; timeline: Activity[]; children: ReactNode }) {
  const [current, setCurrent] = useState<string | null>(null)
  const byId = useMemo(() => new Map(timeline.map((a) => [a.activity_id, a])), [timeline])
  const value = useMemo(() => ({ open: setCurrent, find: (id: string) => byId.get(id) }), [byId])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCurrent(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current])

  const act = current && current !== 'CRM' ? byId.get(current) : undefined
  return (
    <Ctx.Provider value={value}>
      {children}
      {current && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Evidence ${current}`}>
          <button type="button" aria-label="Close evidence" className="anim-fade absolute inset-0 h-full w-full cursor-default bg-black/30 backdrop-blur-[2px]" onClick={() => setCurrent(null)} />
          <aside className="anim-slide-in absolute right-0 top-0 flex h-full w-[min(480px,100vw)] flex-col border-l border-line/[0.08] bg-panel shadow-pop">
            <header className="flex items-center gap-3 border-b border-line/[0.07] px-5 py-4">
              <span className="text-sm font-medium">{current === 'CRM' ? 'CRM record' : act ? `${TYPE_LABEL[act.type]} · ${longDate(act.date)}` : 'Record'}</span>
              {current !== 'CRM' && <span className="font-mono text-[11px] text-faint" title="Record ID used to cite this source">#{current}</span>}
              <button type="button" className="btn-ghost ml-auto" onClick={() => setCurrent(null)} aria-label="Close"><Icon name="x" /></button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5 text-sm">
              {current === 'CRM' ? <CrmRecord deal={deal} /> : act ? <ActivityRecord a={act} /> : (
                <p className="text-muted">This record isn't in the deal's timeline any more.</p>
              )}
            </div>
          </aside>
        </div>
      )}
    </Ctx.Provider>
  )
}

function Row({ k, v }: { k: string; v?: ReactNode }) {
  if (v === undefined || v === null || v === '') return null
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-line/[0.05] py-2">
      <span className="text-muted">{k}</span><span className="break-words">{v}</span>
    </div>
  )
}

function ActivityRecord({ a }: { a: Activity }) {
  return (
    <div>
      <div className="text-base font-medium">{a.subject || TYPE_LABEL[a.type]}</div>
      <div className="mt-4">
        <Row k="Date" v={longDate(a.date)} />
        <Row k="Type" v={TYPE_LABEL[a.type]} />
        <Row k="Direction" v={a.direction.replace('_', '-')} />
        <Row k="From" v={a.from_} />
        <Row k="To" v={a.to} />
        <Row k="Participants" v={a.participants} />
        <Row k="Outcome" v={a.outcome} />
        <Row k="Due" v={a.due_date ? longDate(a.due_date) : undefined} />
        <Row k="Source file" v={a.source_file} />
      </div>
      {a.body && <p className="mt-5 whitespace-pre-wrap leading-relaxed text-body">{a.body}</p>}
    </div>
  )
}

function CrmRecord({ deal }: { deal: Deal }) {
  return (
    <div>
      <div className="text-base font-medium">{deal.name}</div>
      <p className="mt-1 text-muted">Fields from your CRM export.</p>
      <div className="mt-4">
        <Row k="Account" v={deal.account} />
        <Row k="Value" v={money(deal.value, deal.currency, false)} />
        <Row k="Stage" v={deal.stage} />
        <Row k="In stage since" v={deal.stage_entered ? longDate(deal.stage_entered) : undefined} />
        <Row k="Owner" v={deal.owner} />
        <Row k="Expected close" v={deal.expected_close ? longDate(deal.expected_close) : undefined} />
        <Row k="Probability" v={deal.probability != null ? `${deal.probability}%` : undefined} />
        <Row k="Forecast" v={deal.forecast_category} />
        <Row k="Contacts" v={deal.contacts.length ? deal.contacts.map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}`).join(', ') : 'None listed'} />
      </div>
    </div>
  )
}

export function useEvidence(): EvidenceCtx | null {
  return useContext(Ctx)
}

export function EvidenceChips({ ids, className }: { ids: string[]; className?: string }) {
  const ctx = useContext(Ctx)
  if (!ids?.length) return null
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {ids.map((id) => {
        const a = ctx?.find(id)
        // Readable label ("Email · Sep 16 · Security questionnaire"); the record ID stays in the tooltip.
        const kind = id === 'CRM' ? 'CRM record' : a ? `${TYPE_LABEL[a.type]} · ${shortDate(a.date)}` : id
        const subject = id === 'CRM' ? 'deal fields' : a?.subject
        return (
          <button key={id} type="button" onClick={() => ctx?.open(id)} title={`Source record ${id}. Click to read it.`}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-mist-ink/20 bg-mist-ink/[0.05] px-2.5 text-xs text-body transition duration-150 hover:-translate-y-px hover:border-mist-ink/40 hover:bg-mist-ink/[0.12] hover:text-text">
            <Icon name={id === 'CRM' ? 'database' : a?.type === 'email' ? 'mail' : 'file'} size={12} className="flex-none text-mist-ink" />
            <span className="flex-none text-mist-ink">{kind}</span>
            {subject && <span className="truncate text-muted">· {subject}</span>}
          </button>
        )
      })}
    </div>
  )
}
