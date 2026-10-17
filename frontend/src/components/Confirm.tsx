import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { Spinner } from './ui'

/** Accessible confirmation dialog. `onConfirm` may be async; the dialog closes when it resolves. */
export default function Confirm({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean
  onConfirm: () => Promise<void> | void; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null
  const go = async () => {
    setBusy(true)
    try { await onConfirm(); onClose() } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <button type="button" aria-label="Close" className="anim-fade absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-[2px]" onClick={() => !busy && onClose()} />
      <div className="anim-toast relative w-full max-w-[400px] rounded-2xl border border-line/[0.09] bg-panel2 p-5 shadow-pop">
        <h2 id="confirm-title" className="text-base font-semibold">{title}</h2>
        {body && <div className="mt-2 text-sm leading-relaxed text-muted">{body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={go} disabled={busy}
            className={cx(danger ? 'btn border-rose-ink/40 bg-rose-ink/10 text-rose-ink hover:bg-rose-ink/15' : 'btn-primary')}>
            {busy && <Spinner />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
