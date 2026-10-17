import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cx } from './format'

type Kind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: Kind; title: string; body?: string }
interface ToastCtx { push: (kind: Kind, title: string, body?: string) => void }

const Ctx = createContext<ToastCtx | null>(null)
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = ++seq
    setItems((x) => [...x.slice(-3), { id, kind, title, body }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4500)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'anim-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-panel2 px-3.5 py-3 shadow-pop',
              t.kind === 'error' ? 'border-rose-ink/30' : 'border-line/[0.09]',
            )}
          >
            <span
              className={cx(
                'mt-0.5 inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[11px] font-semibold',
                t.kind === 'success' && 'bg-mint-ink/15 text-mint-ink',
                t.kind === 'error' && 'bg-rose-ink/15 text-rose-ink',
                t.kind === 'info' && 'bg-sky-ink/15 text-sky-ink',
              )}
              aria-hidden="true"
            >
              {t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] text-text">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-muted">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast outside ToastProvider')
  return v
}
