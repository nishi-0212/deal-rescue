/* Email draft editor: edit, approve, then open in mail app / mark as sent / send by SMTP. Nothing sends without approval. */
import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { cx, timeAgo } from '../lib/format'
import { usePipelines } from '../lib/pipelines'
import { useToast } from '../lib/toast'
import type { Draft } from '../lib/types'
import { EvidenceChips } from './Evidence'
import Confirm from './Confirm'
import Icon from './Icon'
import { Spinner } from './ui'

export function DraftStatus({ s }: { s: Draft['status'] }) {
  const cls = { draft: 'border-line/10 text-muted', approved: 'border-mint-ink/30 text-mint-ink', sent: 'border-sky-ink/30 text-sky-ink' }[s]
  return <span className={cx('chip ml-auto flex-none py-0 text-[11px] capitalize', cls)}>{s}</span>
}

export default function DraftEditor({ draft, onChanged, showEvidence = true, className }: { draft: Draft; onChanged: () => void; showEvidence?: boolean; className?: string }) {
  const { refresh: refreshPipelines } = usePipelines()
  const toast = useToast()
  const [f, setF] = useState({ to_name: draft.to_name || '', to_email: draft.to_email || '', subject: draft.subject, body: draft.body })
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  const dirty = f.to_name !== (draft.to_name || '') || f.to_email !== (draft.to_email || '') || f.subject !== draft.subject || f.body !== draft.body
  const sent = draft.status === 'sent'
  const mailto = useMemo(() => `mailto:${encodeURIComponent(f.to_email)}?subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body)}`, [f])

  const call = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label)
    try { await fn(); toast.push('success', ok); onChanged(); refreshPipelines().catch(() => {}) } catch (e) { toast.push('error', 'Something went wrong', (e as Error).message) } finally { setBusy(null) }
  }
  const save = () => call('save', () => api(`/api/drafts/${draft.id}`, { method: 'PATCH', body: f }), 'Draft saved')
  const approve = () => call('approve', async () => {
    if (dirty) await api(`/api/drafts/${draft.id}`, { method: 'PATCH', body: f })
    await api(`/api/drafts/${draft.id}/approve`, { method: 'POST' })
  }, 'Approved. Ready to send.')
  const send = () => call('send', () => api(`/api/drafts/${draft.id}/send`, { body: { confirm: true } }), 'Email sent')
  const markSent = () => call('mark', () => api(`/api/drafts/${draft.id}/mark-sent`, { method: 'POST' }), 'Marked as sent')
  const remove = () => call('delete', () => api(`/api/drafts/${draft.id}`, { method: 'DELETE' }), 'Draft deleted')
  const copy = async () => {
    try { await navigator.clipboard.writeText(`Subject: ${f.subject}\n\n${f.body}`); toast.push('success', 'Copied to clipboard') } catch { toast.push('error', 'Copy failed') }
  }

  return (
    <div className={cx('card min-w-0 overflow-hidden', className)}>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2 border-b border-line/[0.06] px-4 py-2.5 text-[13px]">
        <span className="text-faint">To</span>
        <div className="flex flex-wrap gap-2">
          <label className="min-w-[120px] flex-1"><span className="sr-only">Recipient name</span><input disabled={sent} value={f.to_name} onChange={(e) => setF({ ...f, to_name: e.target.value })} placeholder="Name" className="w-full bg-transparent text-text placeholder:text-faint outline-none focus-visible:ring-0" /></label>
          <label className="min-w-[160px] flex-[2]"><span className="sr-only">Recipient email</span><input disabled={sent} type="email" value={f.to_email} onChange={(e) => setF({ ...f, to_email: e.target.value })} placeholder="email@company.com" className="w-full bg-transparent text-muted placeholder:text-faint outline-none focus-visible:ring-0" /></label>
        </div>
      </div>
      <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2 border-b border-line/[0.06] px-4 py-2.5 text-[13px]">
        <span className="text-faint">Subject</span>
        <input disabled={sent} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} className="bg-transparent text-text outline-none focus-visible:ring-0" />
      </label>
      <label className="block"><span className="sr-only">Email body</span>
        <textarea disabled={sent} rows={11} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
          className="block w-full resize-y bg-transparent px-4 py-3.5 text-sm leading-relaxed text-body outline-none focus-visible:ring-0" />
      </label>
      <div className="flex flex-wrap items-center gap-2 border-t border-line/[0.06] px-4 py-3">
        <div className="mr-auto min-w-0 text-xs text-faint">
          {draft.action_title ? <>For: <span className="text-muted">{draft.action_title}</span>. Sending it marks this action done. </> : null}{draft.source === 'ai' ? 'Written by AI' : 'Template'} from this deal's history. {sent ? `Sent ${timeAgo(draft.sent_at)}.` : 'Nothing is sent without your approval.'}
          {showEvidence && draft.evidence_ids.length > 0 && <EvidenceChips ids={draft.evidence_ids} className="mt-1.5" />}
        </div>
        {!sent && <button type="button" className="btn-ghost" onClick={remove} disabled={!!busy} aria-label="Delete draft"><Icon name="trash" size={14} /></button>}
        <button type="button" className="btn" onClick={copy}><Icon name="copy" size={14} />Copy</button>
        {!sent && dirty && <button type="button" className="btn" onClick={save} disabled={!!busy}>{busy === 'save' && <Spinner />}Save</button>}
        {draft.status === 'draft' && <button type="button" className="btn-mint" onClick={approve} disabled={!!busy || !f.to_email}>{busy === 'approve' ? <Spinner /> : <Icon name="check" size={14} strokeWidth={2.4} />}Approve</button>}
        {draft.status === 'approved' && !dirty && (
          <>
            <a href={mailto} className="btn"><Icon name="mail" size={14} />Open in mail app</a>
            <button type="button" className="btn" onClick={markSent} disabled={!!busy}>Mark as sent</button>
            <button type="button" className="btn-primary" onClick={() => setConfirmSend(true)} disabled={!!busy}>{busy === 'send' ? <Spinner /> : <Icon name="send" size={14} />}Send…</button>
          </>
        )}
      </div>
      <Confirm open={confirmSend} title="Send this email now?" confirmLabel="Send email"
        body={<>It will be sent to <span className="text-text">{f.to_name || f.to_email}</span> ({f.to_email}) from your server's email account.</>}
        onClose={() => setConfirmSend(false)} onConfirm={send} />
    </div>
  )
}

