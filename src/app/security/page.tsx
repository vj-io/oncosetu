import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, CircleDashed, Minus } from 'lucide-react'
import { Wordmark } from '@/components/ui'
import { DEMO_NOTE, HEADLINE, NOT_CLAIMED, SECTIONS, STATUS_LABEL, tally, type Status } from '@/core/compliance'
import { getSession } from '@/server/session'

export const metadata: Metadata = { title: 'Security & compliance', description: 'What OncoSetu has built against HIPAA safeguards, India’s DPDP Act and ABDM, and what is still planned.' }

const ICON: Record<Status, React.ReactNode> = { in_place: <Check aria-hidden className="size-4" />, partly: <Minus aria-hidden className="size-4" />, planned: <CircleDashed aria-hidden className="size-4" /> }
const TONE: Record<Status, string> = { in_place: 'border-sage bg-sage-tint text-sage-ink', partly: 'border-amber bg-amber-tint text-amber-ink', planned: 'border-control bg-matte text-muted' }

/** Public, read-only. Staff who are signed in also see where in the product each item lives. */
export default async function SecurityPage() {
  const s = await getSession().catch(() => null)
  const staff = s?.kind === 'staff'
  const t = tally()
  return (
    <div className="min-h-dvh bg-gallery">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-4 px-4 sm:px-8">
          <Link href={staff ? '/admin' : '/login'} aria-label="OncoSetu"><Wordmark /></Link>
          <span className="hidden font-mono text-[11px] tracking-[0.16em] text-faint uppercase sm:inline">Security & compliance</span>
          <Link href="/login" className="ml-auto inline-flex h-11 items-center font-mono text-[12px] tracking-[0.12em] text-muted uppercase hover:text-ink">Staff sign-in</Link>
        </div>
      </header>
      <main id="main" className="mx-auto grid max-w-gallery gap-10 px-4 py-10 sm:px-8 sm:py-14">
        <div className="grid max-w-3xl gap-4">
          <p className="ds-kicker">Security & compliance</p>
          <h1 className="text-[2rem] leading-tight tracking-[-0.03em] sm:text-5xl" data-testid="security-headline">{HEADLINE}</h1>
          <p className="text-[17px] text-muted">{NOT_CLAIMED}</p>
          <p className="text-[15px] text-muted">{DEMO_NOTE}</p>
          <ul className="flex flex-wrap gap-2" aria-label="Summary">
            {(['in_place', 'partly', 'planned'] as const).map((k) => <li key={k} className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm ${TONE[k]}`}>{ICON[k]}{t[k]} {STATUS_LABEL[k].toLowerCase()}</li>)}
          </ul>
        </div>

        {SECTIONS.map((sec) => (
          <section key={sec.id} aria-labelledby={`${sec.id}-h`} className="grid gap-3" data-testid={`section-${sec.id}`}>
            <h2 id={`${sec.id}-h`} className="text-2xl tracking-[-0.02em]">{sec.title}</h2>
            <p className="max-w-3xl text-muted">{sec.intro}</p>
            <div className="overflow-x-auto border border-rule bg-surface" tabIndex={0} role="region" aria-label={sec.title}>
              <table className="w-full min-w-[40rem] border-collapse text-left text-[15px]">
                <thead><tr className="border-b border-rule bg-alcove">
                  <th scope="col" className="w-1/4 px-4 py-3 font-medium">Safeguard</th>
                  <th scope="col" className="px-4 py-3 font-medium">What OncoSetu has today</th>
                  <th scope="col" className="w-28 px-4 py-3 font-medium">Status</th>
                  {staff && <th scope="col" className="w-1/5 px-4 py-3 font-medium">Where</th>}
                </tr></thead>
                <tbody className="divide-y divide-rule">
                  {sec.rows.map((r) => (
                    <tr key={r.area} className="align-top">
                      <th scope="row" className="px-4 py-3 font-medium">{r.area}</th>
                      <td className="px-4 py-3 text-muted">{r.today}</td>
                      <td className="px-4 py-3"><span data-status={r.status} className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[13px] whitespace-nowrap ${TONE[r.status]}`}>{ICON[r.status]}{STATUS_LABEL[r.status]}</span></td>
                      {staff && <td className="px-4 py-3 font-mono text-[12px] text-faint">{r.evidence}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="max-w-3xl text-[15px] text-muted">Blank brackets [ ] are things the hospital still has to fill in, such as the Data Protection Officer and the grievance officer.</p>
      </main>
    </div>
  )
}
