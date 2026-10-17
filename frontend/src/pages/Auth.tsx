import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { LiveDot, Logo, Spinner, ThemeSwitch } from '../components/ui'
import { useAuth } from '../lib/auth'

function PasswordField({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex h-11 items-center gap-1.5 rounded-[10px] border border-line/[0.09] bg-line/[0.02] pl-3 pr-1.5 transition hover:border-line/[0.16] focus-within:border-sky-ink/60 focus-within:bg-line/[0.035] focus-within:ring-[3px] focus-within:ring-sky-ink/15">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} required minLength={id === 'new-password' ? 8 : 1}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:ring-0" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition hover:bg-line/[0.07] hover:text-text active:scale-95">
        <Icon key={String(show)} name={show ? 'eyeOff' : 'eye'} size={16} className="anim-check" />
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap bg-bg">
      <div className="relative flex flex-[1_1_480px] items-center justify-center px-6 py-12">
        <div className="absolute right-6 top-5"><ThemeSwitch /></div>
        <div className="anim-rise w-full max-w-[380px]">
          <Link to="/"><Logo size={28} /></Link>
          <h1 className="mt-9 text-[30px] font-semibold tracking-[-0.028em]">{title}</h1>
          <p className="mt-2 text-[15px] text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
      <div className="relative hidden min-h-screen flex-[1_1_480px] overflow-hidden border-l border-line/[0.06] bg-panel md:block">
        <div aria-hidden="true" className="anim-drift absolute left-[-10%] top-[-10%] h-[70%] w-[90%]" style={{ background: 'radial-gradient(closest-side, rgb(var(--sky-ink) / .22), transparent)' }} />
        <div aria-hidden="true" className="anim-drift absolute bottom-[-10%] right-[-15%] h-[70%] w-[90%]" style={{ background: 'radial-gradient(closest-side, rgb(var(--blush-ink) / .16), rgb(var(--butter-ink) / .05) 60%, transparent)', animationDelay: '-7s' }} />
        <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgb(var(--ink) / .07) 1px, transparent 1px)', backgroundSize: '22px 22px', maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, #000, transparent)', WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, #000, transparent)' }} />
        <div className="relative flex h-full flex-col justify-center gap-4 p-12">
          <div className="anim-float w-[300px] self-start rounded-2xl border border-line/10 bg-panel2/80 p-4 shadow-pop backdrop-blur-md">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose text-[10px] font-semibold text-onpastel">NL</span>
              <div className="flex-1"><div className="text-[13px]">Northwind Logistics</div><div className="text-[11px] text-faint">$420k · Negotiation</div></div>
              <span className="chip border-rose-ink/25 bg-rose-ink/10 text-[11px] text-rose-ink">High</span>
            </div>
            <div className="mt-2.5 text-xs text-muted">Security questionnaire still waiting on us</div>
          </div>
          <div className="anim-float w-[280px] self-end rounded-2xl border border-line/10 bg-panel2/80 p-4 shadow-pop backdrop-blur-md" style={{ animationDelay: '-2s' }}>
            <div className="flex items-center gap-2 text-xs text-mint-ink"><LiveDot />Recovery action done</div>
            <div className="mt-2 text-[13px]">Questionnaire sent back to IT</div>
            <div className="mt-3 h-[5px] overflow-hidden rounded bg-line/[0.07]"><div className="h-full w-2/3" style={{ background: 'linear-gradient(90deg, rgb(var(--sky-ink)), rgb(var(--mint-ink)))' }} /></div>
          </div>
          <div className="anim-float w-[320px] self-center rounded-2xl border border-line/10 bg-panel2/80 p-4 shadow-pop backdrop-blur-md" style={{ animationDelay: '-4s' }}>
            <div className="eyebrow text-blush-ink">Draft ready</div>
            <div className="mt-1.5 text-[13px] leading-relaxed text-body">“Hi Marcus, all 64 security items are done. Could we take 30 minutes Thursday?”</div>
          </div>
          <p className="mt-4 max-w-[360px] text-xl font-medium leading-snug tracking-[-0.015em]">Know why a deal stopped moving, and what to do next.</p>
        </div>
      </div>
    </div>
  )
}

export function Login() {
  const { login, user } = useAuth()
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/app" replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await login(email, password)
      nav(loc.state?.from || '/app', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to see which deals need you today.">
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate={false}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="label">Work email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="input h-11 rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current-password" className="label">Password</label>
          <PasswordField id="current-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-ink/25 bg-rose-ink/[0.06] px-3 py-2 text-[13px] text-rose-ink">{error}</div>}
        <button type="submit" disabled={busy} className="btn-primary mt-1 h-11 rounded-[10px] text-sm">{busy ? <><Spinner /> Signing in…</> : 'Sign in'}</button>
      </form>
      <p className="mt-6 text-[13px] text-muted">New here? <Link to="/register" className="text-sky-ink hover:underline">Create an account</Link></p>
    </AuthLayout>
  )
}

export function Register() {
  const { register, user } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/app" replace />
  const tooShort = password.length > 0 && password.length < 8
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Use at least 8 characters for your password.'); return }
    setBusy(true); setError(null)
    try {
      await register(name, email, password)
      nav('/app/uploads', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <AuthLayout title="Create your account" subtitle="Start with our sample pipeline, then bring your own data.">
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="label">Your name</label>
          <input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="input h-11 rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="label">Work email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="input h-11 rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="label">Password</label>
          <PasswordField id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
          <span className={tooShort ? 'text-xs text-rose-ink' : 'text-xs text-faint'}>At least 8 characters</span>
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-ink/25 bg-rose-ink/[0.06] px-3 py-2 text-[13px] text-rose-ink">{error}</div>}
        <button type="submit" disabled={busy} className="btn-primary mt-1 h-11 rounded-[10px] text-sm">{busy ? <><Spinner /> Creating…</> : 'Create account'}</button>
      </form>
      <p className="mt-6 text-[13px] text-muted">Already have an account? <Link to="/login" className="text-sky-ink hover:underline">Sign in</Link></p>
    </AuthLayout>
  )
}
