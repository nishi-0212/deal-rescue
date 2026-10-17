import type { ReactNode } from 'react'
import { useTheme, type ThemeMode } from '../lib/theme'
import { cx } from '../lib/format'
import type { RiskLevel } from '../lib/types'
import Icon, { type IconName } from './Icon'

export function Logo({ size = 22, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="inline-block flex-none"
        style={{
          width: size, height: size, borderRadius: size * 0.28,
          background: 'conic-gradient(from 210deg, rgb(var(--sky)), rgb(var(--blush)), rgb(var(--butter)), rgb(var(--sky)))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6), 0 0 0 1px rgb(var(--ink) / .06)',
        }}
        aria-hidden="true"
      />
      {withText && <span className="font-semibold tracking-[-0.01em] text-text">Deal Rescue</span>}
    </span>
  )
}

const THEME_OPTS: { k: ThemeMode; label: string; icon: IconName }[] = [
  { k: 'light', label: 'Light theme', icon: 'sun' },
  { k: 'dark', label: 'Dark theme', icon: 'moon' },
  { k: 'system', label: 'Match system', icon: 'monitor' },
]

export function ThemeSwitch() {
  const { mode, setMode } = useTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-0.5 rounded-[9px] border border-line/[0.08] bg-line/[0.03] p-[3px]">
      {THEME_OPTS.map((o) => (
        <button
          key={o.k}
          type="button"
          role="radio"
          aria-checked={mode === o.k}
          aria-label={o.label}
          title={o.label}
          onClick={() => setMode(o.k)}
          className={cx(
            'inline-flex h-[26px] w-7 items-center justify-center rounded-md transition duration-200',
            mode === o.k ? 'bg-panel text-text shadow-[0_1px_3px_rgb(var(--shadow)/0.2),inset_0_0_0_1px_rgb(var(--ink)/0.09)]' : 'text-faint hover:text-text',
          )}
        >
          <Icon name={o.icon} size={14} />
        </button>
      ))}
    </div>
  )
}

const RISK_STYLE: Record<string, { cls: string; n: number }> = {
  High: { cls: 'border-rose-ink/25 bg-rose-ink/[0.08] text-rose-ink', n: 3 },
  Medium: { cls: 'border-butter-ink/25 bg-butter-ink/[0.07] text-butter-ink', n: 2 },
  Low: { cls: 'border-mint-ink/25 bg-mint-ink/[0.07] text-mint-ink', n: 1 },
  Closed: { cls: 'border-line/10 text-muted', n: 0 },
}

/** Risk pill with 1–3 pips, so the level never depends on colour alone. */
export function RiskBadge({ level, score, className }: { level?: RiskLevel | null; score?: number; className?: string }) {
  if (!level) return <span className="text-xs text-faint">Not analyzed</span>
  const s = RISK_STYLE[level] ?? RISK_STYLE.Low
  return (
    <span className={cx('chip pl-[7px]', s.cls, className)}>
      <span className="inline-flex gap-[2px]" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx('h-[9px] w-[3px] rounded-[1px]', i <= s.n ? 'bg-current' : 'bg-line/[0.15]')} />
        ))}
      </span>
      {level}{score !== undefined && level !== 'Closed' ? ` · ${score}` : ''}
    </span>
  )
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('anim-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9" /></svg>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-md', className)} aria-hidden="true" />
}

export function LiveDot({ tone = 'mint' }: { tone?: 'mint' | 'sky' | 'rose' }) {
  const bg = { mint: 'bg-mint-ink', sky: 'bg-sky-ink', rose: 'bg-rose-ink' }[tone]
  return (
    <span className="relative inline-block h-[7px] w-[7px] flex-none" aria-hidden="true">
      <span className={cx('anim-ping absolute inset-0 rounded-full', bg)} />
      <span className={cx('absolute inset-0 rounded-full', bg)} />
    </span>
  )
}

export function Sparkline({ points, tone = 'sky', height = 34 }: { points: number[]; tone?: string; height?: number }) {
  const pts = points.length >= 2 ? points : points.length === 1 ? [points[0], points[0]] : [0, 0]
  const w = 160
  const mx = Math.max(...pts)
  const mn = Math.min(...pts)
  const xy = pts.map((v, i) => [i * (w / (pts.length - 1)), height - 3 - ((v - mn) / (mx - mn || 1)) * (height - 8)])
  const line = 'M' + xy.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true" className="block">
      <path d={`${line} L${w} ${height} L0 ${height} Z`} style={{ fill: `rgb(var(--${tone}-ink) / 0.08)` }} />
      <path d={line} className="anim-draw" style={{ stroke: `rgb(var(--${tone}-ink))`, strokeDasharray: 400, strokeDashoffset: 400 }}
        strokeWidth="1.6" fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function EmptyState({ icon = 'database', title, body, children }: { icon?: IconName; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="card anim-rise flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-sky text-onpastel"><Icon name={icon} size={20} /></span>
      <div className="text-base font-medium">{title}</div>
      {body && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{body}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-ink/25 bg-rose-ink/[0.06] px-4 py-3 text-sm">
      <span className="text-rose-ink">{message}</span>
      {onRetry && <button type="button" className="btn ml-auto" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; dot?: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-0.5 rounded-[9px] border border-line/[0.06] bg-line/[0.03] p-[3px]">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cx('inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs transition duration-200',
            o.value === value ? 'border-line/[0.08] bg-line/[0.08] text-text' : 'border-transparent text-muted hover:text-text')}>
          {o.dot && <span className={cx('h-1.5 w-1.5 rounded-full', o.dot)} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
