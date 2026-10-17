import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Icon, { type IconName } from '../components/Icon'
import { LiveDot, Logo, ThemeSwitch } from '../components/ui'
import { useAuth } from '../lib/auth'
import { cx } from '../lib/format'
import { useReducedMotion } from '../lib/hooks'

const SCAN_ROWS = [
  { ini: 'NL', name: 'Northwind Logistics', meta: 'Negotiation · Priya S.', value: '$420k', tint: 'bg-rose', flag: 0 },
  { ini: 'OF', name: 'Oslo Freight', meta: 'Discovery · Dev K.', value: '$74k', tint: 'bg-mint', flag: -1 },
  { ini: 'HM', name: 'Harbor Mutual', meta: 'Proposal · Arjun M.', value: '$268k', tint: 'bg-rose', flag: 1 },
  { ini: 'LH', name: 'Lumen Health', meta: 'Negotiation · Arjun M.', value: '$96k', tint: 'bg-sky', flag: -1 },
  { ini: 'KR', name: 'Kestrel Retail', meta: 'Technical eval · Priya S.', value: '$185k', tint: 'bg-butter', flag: -1 },
  { ini: 'MU', name: 'Meridian Utilities', meta: 'Proposal · Sara L.', value: '$118k', tint: 'bg-mist', flag: -1 },
]

const SOURCES = [
  ['CSV export', 'bg-sky-ink'], ['Excel sheets', 'bg-mint-ink'], ['Email threads', 'bg-blush-ink'],
  ['Call transcripts', 'bg-butter-ink'], ['Meeting notes', 'bg-mist-ink'], ['Follow-up logs', 'bg-rose-ink'],
]

const STEPS: { title: string; body: string; tint: string; icon: IconName }[] = [
  { title: 'Upload', body: 'Drop in your CRM export, emails, call notes or meeting notes.', tint: 'bg-sky', icon: 'upload' },
  { title: 'Connect', body: 'Every touchpoint is matched to its deal and laid out on one timeline.', tint: 'bg-mist', icon: 'list' },
  { title: 'Spot', body: 'Deals that went silent or stayed stuck too long get flagged.', tint: 'bg-blush', icon: 'warning' },
  { title: 'Explain', body: 'You get the real reasons, each one linked to its proof.', tint: 'bg-butter', icon: 'sparkle' },
  { title: 'Recover', body: 'A step-by-step plan with owners, dates and ready-to-edit emails.', tint: 'bg-mint', icon: 'arrowRight' },
]

function Section({ id, eyebrow, tone, title, body, children, className }: {
  id?: string; eyebrow: string; tone: string; title: string; body?: string; children?: ReactNode; className?: string
}) {
  return (
    <section id={id} className={cx('relative mx-auto max-w-[1200px] px-6 pt-28', className)}>
      <div className="max-w-[640px]">
        <div className={cx('font-mono text-[13px]', tone)}>{eyebrow}</div>
        <h2 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">{title}</h2>
        {body && <p className="mt-3.5 text-[17px] leading-relaxed text-muted">{body}</p>}
      </div>
      {children}
    </section>
  )
}

export default function Home() {
  const { user } = useAuth()
  const reduce = useReducedMotion()
  const [hovered, setHovered] = useState<number | null>(null)
  const a = (v: string): CSSProperties => (reduce ? {} : { animation: v })
  const start = user ? '/app' : '/register'

  return (
    <div className="relative overflow-hidden bg-bg text-[15px]">
      <div aria-hidden="true" className="anim-drift pointer-events-none absolute left-1/2 top-[-360px] h-[760px] w-[1200px] -translate-x-[58%]"
        style={{ background: 'radial-gradient(closest-side, rgb(var(--sky-ink) / .16), rgb(var(--mist-ink) / .07) 50%, transparent)' }} />
      <div aria-hidden="true" className="anim-drift pointer-events-none absolute left-1/2 top-[-200px] h-[620px] w-[900px] translate-x-[5%]"
        style={{ background: 'radial-gradient(closest-side, rgb(var(--blush-ink) / .11), rgb(var(--butter-ink) / .04) 55%, transparent)', animationDelay: '-6s' }} />
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[900px]" />

      <header className="relative mx-auto flex max-w-[1200px] flex-wrap items-center gap-6 px-6 py-5">
        <Logo size={24} />
        <nav aria-label="Primary" className="hidden gap-6 text-sm sm:flex">
          <a href="#how" className="text-muted transition hover:text-text">How it works</a>
          <a href="#finds" className="text-muted transition hover:text-text">What it finds</a>
          <a href="#control" className="text-muted transition hover:text-text">Your control</a>
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <ThemeSwitch />
          {user
            ? <Link to="/app" className="btn h-[34px] rounded-[9px] px-3.5 text-sm">Open app</Link>
            : <Link to="/login" className="btn h-[34px] rounded-[9px] px-3.5 text-sm">Sign in</Link>}
        </div>
      </header>

      <section className="relative mx-auto flex max-w-[1200px] flex-wrap items-center gap-14 px-6 pb-10 pt-16 sm:pt-[72px]">
        <div className="min-w-0 flex-[1_1_460px]">
          <div className="anim-rise inline-flex items-center gap-2 rounded-full border border-line/[0.09] bg-line/[0.03] py-[5px] pl-1.5 pr-3 text-[13px] text-muted">
            <span className="rounded-full bg-butter px-2 py-0.5 text-[11px] font-semibold text-onpastel">NEW</span>
            Reads emails, calls and CRM data together
          </div>
          <h1 className="anim-rise text-gradient mt-6 text-[42px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[56px]" style={{ animationDelay: '.08s' }}>
            Find out why your deals went quiet.
          </h1>
          <p className="anim-rise mt-5 max-w-[520px] text-lg leading-relaxed text-muted" style={{ animationDelay: '.16s' }}>
            Upload your CRM export, emails and call notes. Deal Rescue reads all of it, tells you which deals are really stuck and
            why, and helps you write the next message.
          </p>
          <div className="anim-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: '.24s' }}>
            <Link to={start} className="btn-primary h-11 rounded-[10px] px-[18px] text-[15px]">
              Open the demo pipeline <Icon name="arrowRight" size={16} />
            </Link>
            <a href="#how" className="btn h-11 rounded-[10px] px-[18px] text-[15px]">See how it works</a>
          </div>
          <div className="anim-rise mt-7 flex flex-wrap gap-4 text-[13px] text-faint" style={{ animationDelay: '.32s' }}>
            <span>No integrations needed to start</span><span aria-hidden="true">·</span><span>Nothing is sent without you</span>
          </div>
        </div>

        <div className="anim-rise relative min-w-0 flex-[1_1_460px]" style={{ animationDelay: '.16s' }}>
          <div className="relative overflow-hidden rounded-2xl border border-line/[0.09] bg-panel shadow-pop">
            <div className="flex items-center gap-2 border-b border-line/[0.06] px-4 py-3 text-xs text-muted">
              <LiveDot tone="sky" /> Scanning 41 deals
              <span className="ml-auto font-mono text-faint">1,286 activities</span>
            </div>
            <div className="relative">
              {!reduce && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 h-10"
                  style={{ background: 'linear-gradient(180deg, transparent, rgb(var(--sky-ink) / .12) 60%, rgb(var(--sky-ink) / .45) 98%, transparent)', animation: 'scan 7.5s cubic-bezier(.45,0,.55,1) infinite' }} />
              )}
              {SCAN_ROWS.map((r) => (
                <div key={r.ini} className="flex items-center gap-3 border-b border-line/[0.045] px-4 py-[13px] text-[13px]">
                  <span className={cx('inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[11px] font-semibold text-onpastel', r.tint)}>{r.ini}</span>
                  <div className="min-w-0 flex-1"><div>{r.name}</div><div className="mt-0.5 text-xs text-faint">{r.meta}</div></div>
                  <span className="tabular-nums text-muted">{r.value}</span>
                  {r.flag >= 0 ? (
                    <span className="chip border-rose-ink/30 bg-rose-ink/10 text-[11px] text-rose-ink"
                      style={a(`flag 7.5s ease infinite ${r.flag * 1.6}s`)}>Stalled</span>
                  ) : (
                    <span className="chip border-mint-ink/25 text-[11px] text-mint-ink">Healthy</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative pt-20" aria-label="Supported data">
        <div className="mb-4 text-center text-[13px] text-faint">Works with what you already have</div>
        <div className="overflow-hidden" style={{ maskImage: 'linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)' }}>
          {/* Two identical halves, each wider than the screen, so the loop never shows a gap */}
          <div className="flex w-max" style={a('marquee 40s linear infinite')}>
            {[0, 1].map((half) => (
              <div key={half} className="flex flex-none" aria-hidden={half === 1}>
                {[...SOURCES, ...SOURCES, ...SOURCES].map(([label, dot], i) => (
                  <span key={i} className="mr-3.5 inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-full border border-line/[0.08] bg-line/[0.02] px-4 py-2 text-sm text-muted">
                    <span className={cx('h-[7px] w-[7px] rounded-full', dot)} />{label}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="relative mx-auto max-w-[1200px] px-6 pt-28">
        <div className="mx-auto max-w-[640px] text-center">
          <div className="font-mono text-[13px] text-sky-ink">HOW IT WORKS</div>
          <h2 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">From messy files to a clear next step</h2>
          <p className="mt-3.5 text-[17px] leading-relaxed text-muted">You upload. It reads, connects and explains. Five steps, in plain words.</p>
        </div>
        <div className="relative mt-14">
          <div aria-hidden="true" className="absolute left-[6%] right-[6%] top-9 hidden h-px lg:block"
            style={{ background: 'linear-gradient(90deg, rgb(var(--sky-ink) / .05), rgb(var(--sky-ink) / .3), rgb(var(--blush-ink) / .3), rgb(var(--butter-ink) / .3), rgb(var(--mint-ink) / .05))' }} />
          {!reduce && (
            <div aria-hidden="true" className="absolute top-[31px] -ml-[5px] hidden h-[11px] w-[11px] rounded-full bg-strong lg:block"
              style={{ boxShadow: '0 0 0 4px rgb(var(--sky-ink) / .18), 0 0 24px 6px rgb(var(--sky-ink) / .55)', animation: 'travel 10s linear infinite', animationPlayState: hovered === null ? 'running' : 'paused' }} />
          )}
          <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-5" onMouseLeave={() => setHovered(null)}>
            {STEPS.map((s, i) => (
              <div key={s.title} onMouseEnter={() => setHovered(i)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)} tabIndex={0}
                className={cx('flex cursor-default flex-col gap-3 rounded-[14px] border bg-panel p-[18px] transition duration-300 ease-out',
                  hovered === i ? '-translate-y-1 border-sky-ink/50 shadow-[0_0_0_1px_rgb(var(--sky-ink)/0.18),0_18px_50px_-18px_rgb(var(--sky-ink)/0.45)]' : 'border-line/[0.07]',
                  hovered !== null && hovered !== i && 'opacity-60')}
                style={hovered === null ? a(`lit 10s ease infinite ${0.2 + i * 2}s`) : undefined}>
                <div className={cx('flex h-10 w-10 items-center justify-center rounded-[11px] text-onpastel', s.tint)}><Icon name={s.icon} size={20} /></div>
                <div className="font-mono text-[11px] text-faint">0{i + 1}</div>
                <div className="text-base font-medium">{s.title}</div>
                <div className="text-sm leading-relaxed text-muted">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Section id="finds" eyebrow="WHAT IT FINDS" tone="text-blush-ink" title="The quiet problems a CRM doesn't show"
        body={'Your CRM says "90% likely to close." Your inbox says the customer stopped replying. Deal Rescue checks both.'}>
        <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FindCard title="Emails no one answered" body="Questions from the customer that are still waiting on your team.">
            <div className="relative flex h-[58px] w-[82px] items-start justify-center rounded-[10px] border-[1.5px] border-sky-ink" style={a('shake 3s ease infinite')}>
              <svg width="82" height="40" viewBox="0 0 82 40" fill="none" aria-hidden="true" className="-mt-px"><path d="M2 2l39 26L80 2" className="stroke-sky-ink" strokeWidth="1.5" /></svg>
              <span className="absolute -right-[18px] -top-3 rounded-full bg-rose px-2 py-[3px] font-mono text-[11px] font-semibold text-onpastel">31d</span>
            </div>
          </FindCard>
          <FindCard title="The person who signs is missing" body="Spots when the budget owner or technical evaluator was never brought in.">
            <div className="flex flex-col items-center gap-3.5">
              <div className="rounded-lg border-[1.5px] border-dashed border-rose-ink/50 px-3 py-1.5 text-xs text-rose-ink" style={a('empty 2.4s ease-in-out infinite')}>CFO · not in deal</div>
              <div className="flex gap-2.5">
                <span className="rounded-lg bg-sky-ink/10 px-2.5 py-1.5 text-xs text-sky-ink">VP Ops</span>
                <span className="rounded-lg bg-mist-ink/10 px-2.5 py-1.5 text-xs text-mist-ink">IT lead</span>
                <span className="rounded-lg bg-blush-ink/10 px-2.5 py-1.5 text-xs text-blush-ink">Analyst</span>
              </div>
            </div>
          </FindCard>
          <FindCard title="Forecast vs reality" body={'Deals marked "likely" while the customer has gone silent.'}>
            <div className="w-full px-4">
              <div className="flex justify-between text-[11px]"><span className="text-butter-ink">— CRM forecast</span><span className="text-blush-ink">— Customer replies</span></div>
              <svg width="100%" height="88" viewBox="0 0 240 92" preserveAspectRatio="none" aria-hidden="true" className="mt-1.5 block">
                <path d="M0 30 C60 26 120 18 240 12" className="stroke-butter-ink" strokeWidth="2" fill="none" style={{ strokeDasharray: 400, ...a('drawloop 3.2s cubic-bezier(.4,0,.2,1) infinite') }} />
                <path d="M0 22 C50 18 80 30 120 52 S200 86 240 86" className="stroke-blush-ink" strokeWidth="2" fill="none" style={{ strokeDasharray: 400, ...a('drawloop 3.2s cubic-bezier(.4,0,.2,1) .4s infinite') }} />
              </svg>
            </div>
          </FindCard>
          <FindCard title="Stuck in one stage too long" body="Compares each deal with how long that stage normally takes.">
            <div className="flex w-full flex-col gap-2.5 px-4">
              <div className="flex justify-between text-[11px] text-faint"><span>Discovery</span><span>Proposal</span><span className="text-butter-ink">Negotiation</span><span>Closed</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-line/[0.06]">
                <div className="h-full rounded-full" style={{ width: '62%', background: 'linear-gradient(90deg, rgb(var(--mint-ink)), rgb(var(--butter-ink)))', ...a('stuck 3s cubic-bezier(.4,0,.2,1) infinite') }} />
              </div>
              <div className="font-mono text-xs text-butter-ink">47 days in Negotiation · usual is 14</div>
            </div>
          </FindCard>
        </div>
      </Section>

      <section className="relative mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-6 pt-28">
        <div className="min-w-0 flex-[1_1_380px]">
          <div className="font-mono text-[13px] text-mist-ink">PROOF, NOT GUESSES</div>
          <h2 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">Every finding links to the record behind it</h2>
          <p className="mt-3.5 text-[17px] leading-relaxed text-muted">Click any reason and you see the exact email, call note or CRM field it came from. If something can't be backed by your data, it isn't shown as a fact.</p>
        </div>
        <div className="relative h-[340px] min-w-0 flex-[1_1_480px] overflow-hidden rounded-2xl border border-line/[0.07] bg-panel">
          <svg width="100%" height="100%" viewBox="0 0 520 340" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0">
            {[['M260 120 C200 170 140 190 110 240', 'stroke-sky-ink'], ['M260 120 L260 240', 'stroke-blush-ink'], ['M260 120 C320 170 380 190 410 240', 'stroke-butter-ink']].map(([d, c]) => (
              <path key={d} d={d} className={c} strokeOpacity="0.55" strokeWidth="1.5" fill="none" style={{ strokeDasharray: '6 6', ...a('dash 1.2s linear infinite') }} />
            ))}
          </svg>
          <div className="absolute left-1/2 top-11 w-[270px] -translate-x-1/2 rounded-xl border border-rose-ink/30 bg-panel2 px-4 py-3.5 shadow-pop">
            <div className="eyebrow text-rose-ink">Finding · 92% sure</div>
            <div className="mt-1.5 text-sm">Security review is blocking the deal</div>
          </div>
          {[['4%', 'Email · Sep 16', 'Questionnaire received', 'text-sky-ink border-sky-ink/25'], ['35%', 'Call · Sep 22', 'IT raised data residency', 'text-blush-ink border-blush-ink/25'], ['66%', 'Meeting · Oct 14', 'Review call declined', 'text-butter-ink border-butter-ink/25']].map(([left, id, label, cls]) => (
            <div key={id} className={cx('absolute top-[240px] w-[30%] rounded-[10px] border bg-panel2 p-3 text-xs', cls.split(' ')[1])} style={{ left }}>
              <div className={cx('font-medium', cls.split(' ')[0])}>{id}</div>
              <div className="mt-1 text-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="control" className="relative mx-auto grid max-w-[1200px] gap-4 px-6 pt-28 md:grid-cols-2">
        <div className="card flex flex-col gap-5 rounded-2xl p-6 sm:p-7">
          <div>
            <div className="font-mono text-[13px] text-mint-ink">YOU STAY IN CONTROL</div>
            <h3 className="mt-2.5 text-[26px] font-semibold tracking-[-0.02em]">It drafts. You decide.</h3>
            <p className="mt-2.5 leading-relaxed text-muted">Follow-ups, objection replies and meeting requests are written from the real conversation. Edit them, approve them, then send.</p>
          </div>
          <div className="rounded-xl border border-line/[0.08] bg-bg p-4 text-sm leading-[1.7] text-body">
            <div className="mb-2 text-xs text-faint">To: Marcus Hale · IT Director</div>
            {['Hi Marcus, all 64 security items are done,', 'including Okta SSO and EU data residency.', 'Could we take 30 minutes Thursday?'].map((line, i) => (
              <div key={i} className="overflow-hidden whitespace-nowrap" style={reduce ? {} : { maxWidth: 0, animation: `type 6s steps(40) ${i * 0.9}s infinite` }}>
                {line}{i === 2 && <span className="ml-0.5 inline-block h-4 w-0.5 bg-sky-ink align-[-3px]" style={a('caret 1s steps(1) infinite')} />}
              </div>
            ))}
            <div className="mt-3.5 flex gap-2"><span className="rounded-lg border border-line/10 px-3 py-1.5 text-[13px]">Edit</span><span className="rounded-lg bg-mint px-3 py-1.5 text-[13px] font-medium text-onpastel">Approve</span></div>
          </div>
        </div>
        <div className="card flex flex-col gap-5 rounded-2xl p-6 sm:p-7">
          <div>
            <div className="font-mono text-[13px] text-butter-ink">IT KEEPS WATCHING</div>
            <h3 className="mt-2.5 text-[26px] font-semibold tracking-[-0.02em]">Upload new notes, see what changed</h3>
            <p className="mt-2.5 leading-relaxed text-muted">Each new email or call is checked against the old analysis. You see the new risk and the reason it moved.</p>
          </div>
          <div className="flex flex-col gap-3.5 rounded-xl border border-line/[0.08] bg-bg p-[18px]">
            <div className="flex justify-between text-[13px]"><span>Northwind Logistics</span><span className="font-mono text-xs text-faint">Oct 15 upload</span></div>
            <div className="relative h-7">
              {!reduce && <span className="chip absolute left-0 top-0 border-butter-ink/30 bg-butter-ink/10 py-1 text-[13px] text-butter-ink" style={a('swapA 5s ease infinite')}>Medium risk</span>}
              <span className="chip absolute left-0 top-0 border-rose-ink/30 bg-rose-ink/10 py-1 text-[13px] text-rose-ink" style={a('swapB 5s ease infinite')}>High risk ↑</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line/[0.06]">
              <div className="h-full rounded-full" style={{ width: '84%', background: 'linear-gradient(90deg, rgb(var(--butter-ink)), rgb(var(--rose-ink)))', ...a('grow 5s cubic-bezier(.2,.8,.2,1) infinite') }} />
            </div>
            <div className="text-[13px] leading-relaxed text-muted">New call notes: the IT lead declined the review and the CFO is freezing spend from November.</div>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-[1200px] px-6 pb-20 pt-32 text-center">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-10 h-[360px] w-[700px] -translate-x-1/2"
          style={{ background: 'radial-gradient(closest-side, rgb(var(--blush-ink) / .12), rgb(var(--sky-ink) / .06) 60%, transparent)' }} />
        <h2 className="relative text-[38px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[46px]">Rescue the deals worth saving.</h2>
        <p className="relative mx-auto mt-4 max-w-[520px] text-[17px] leading-relaxed text-muted">Start with our sample pipeline, then upload your own CSV or Excel export.</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link to={start} className="btn-primary h-[46px] rounded-[10px] px-5 text-[15px]">{user ? 'Open app' : 'Get started free'}</Link>
          {!user && <Link to="/login" className="btn h-[46px] rounded-[10px] px-5 text-[15px]">Sign in</Link>}
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1200px] flex-wrap gap-4 border-t border-line/[0.06] px-6 pb-10 pt-7 text-[13px] text-faint">
        <span>Deal Rescue</span>
        <span className="ml-auto">Built for sales teams who'd rather fix deals than forecast them.</span>
      </footer>
    </div>
  )
}

function FindCard({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="card card-hover flex flex-col gap-4 rounded-2xl p-[22px]">
      <div className="flex h-[140px] items-center justify-center rounded-xl border border-line/[0.05] bg-line/[0.02]">{children}</div>
      <div>
        <div className="text-base font-medium">{title}</div>
        <div className="mt-1.5 text-sm leading-relaxed text-muted">{body}</div>
      </div>
    </div>
  )
}
