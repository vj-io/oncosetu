import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, CircleDashed, Minus } from 'lucide-react'
import { Wordmark } from '@/components/ui'
import { DEMO_NOTE, HEADLINE, NOT_CLAIMED, SECTIONS, STATUS_LABEL, tally, type Status } from '@/core/compliance'
import { roleHome } from '@/lib/staff-nav'
import { getSession } from '@/server/session'

export const metadata: Metadata = { title: 'Security & compliance', description: 'What OncoSetu has built for India’s DPDP Act and ABDM, how it follows HIPAA’s safeguards, and what is still planned.' }

const ICON: Record<Status, React.ReactNode> = { in_place: <Check aria-hidden className="size-4" />, partly: <Minus aria-hidden className="size-4" />, planned: <CircleDashed aria-hidden className="size-4" /> }
const TONE: Record<Status, string> = { in_place: 'border-sage bg-sage-tint text-sage-ink', partly: 'border-amber bg-amber-tint text-amber-ink', planned: 'border-control bg-matte text-muted' }

/** Public, read-only. Staff who are signed in also see where in the product each item lives. */
export default async function SecurityPage() {
  // Public page: the session only adds a "Where" column for staff. Never let a slow database hold the page up.
  const s = await Promise.race([getSession().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
  const staff = s?.kind === 'staff'
  const t = tally()
  return (
    <div className="min-h-dvh bg-gallery">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-4 px-4 sm:px-8">
          <Link href={s?.kind === 'staff' ? roleHome(s.role) : '/'} aria-label="OncoSetu home"><Wordmark /></Link>
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
            <div className="border border-rule bg-surface sm:overflow-x-auto" role="region" aria-label={sec.title}>
              <table className="block w-full border-collapse text-left text-[15px] sm:table sm:min-w-[40rem]">
                <thead className="hidden sm:table-header-group"><tr className="border-b border-rule bg-alcove">
                  <th scope="col" className="w-1/4 px-4 py-3 font-medium">What</th>
                  <th scope="col" className="px-4 py-3 font-medium">What we have today</th>
                  <th scope="col" className="w-28 px-4 py-3 font-medium">Status</th>
                  {staff && <th scope="col" className="w-1/5 px-4 py-3 font-medium">Where</th>}
                </tr></thead>
                <tbody className="block divide-y divide-rule sm:table-row-group">
                  {sec.rows.map((r) => (
                    <tr key={r.area} className="flex flex-col gap-1 px-4 py-3 align-top sm:table-row sm:gap-0 sm:px-0 sm:py-0">
                      <th scope="row" className="order-1 text-left font-medium sm:table-cell sm:px-4 sm:py-3">{r.area}</th>
                      <td className="order-3 text-muted sm:table-cell sm:px-4 sm:py-3">{r.today}</td>
                      <td className="order-2 sm:table-cell sm:px-4 sm:py-3"><span data-status={r.status} className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[13px] whitespace-nowrap ${TONE[r.status]}`}>{ICON[r.status]}{STATUS_LABEL[r.status]}</span></td>
                      {staff && <td className="order-4 font-mono text-[12px] text-faint sm:table-cell sm:px-4 sm:py-3">{r.evidence}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="max-w-3xl text-[15px] text-muted">A blank [ ] is something the hospital still has to fill in, such as the Data Protection Officer and the grievance officer.</p>
      </main>
    </div>
  )
}
