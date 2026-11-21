import type { Metadata } from 'next'
import { Check, CircleDashed, Minus } from 'lucide-react'
import { PublicShell } from '@/components/shell/PublicShell'
import { DEMO_NOTE, HEADLINE, NOT_CLAIMED, SECTIONS, STATUS_LABEL, tally, type Status } from '@/core/compliance'
import { getSession } from '@/server/session'

export const metadata: Metadata = { title: 'Security & compliance', description: 'What OncoSetu has built for India’s DPDP Act and ABDM, how it follows HIPAA’s safeguards, and what is still planned.' }

const ICON: Record<Status, React.ReactNode> = { in_place: <Check aria-hidden className="size-4" />, partly: <Minus aria-hidden className="size-4" />, planned: <CircleDashed aria-hidden className="size-4" /> }
const TONE: Record<Status, string> = { in_place: 'border-sage/40 bg-sage-tint text-sage-ink', partly: 'border-amber/40 bg-amber-tint text-amber-ink', planned: 'border-control bg-matte text-muted' }

/** Public, read-only. Staff who are signed in also see where in the product each item lives. */
export default async function SecurityPage() {
  // Public page: the session only adds a "Where" column for staff. Never let a slow database hold the page up.
  const s = await Promise.race([getSession().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
  const staff = s?.kind === 'staff'
  const t = tally()
  return (
    <PublicShell>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-8 sm:py-12">
        <div className="grid max-w-3xl gap-4">
          <p className="ds-kicker">Security & compliance</p>
          <h1 className="text-[2rem] leading-tight tracking-[-0.02em] sm:text-[2.75rem]" data-testid="security-headline">{HEADLINE}</h1>
          <p className="text-[17px] text-muted">{NOT_CLAIMED}</p>
          <p className="text-[15px] text-muted">{DEMO_NOTE}</p>
          <ul className="flex flex-wrap gap-2" aria-label="Summary">
            {(['in_place', 'partly', 'planned'] as const).map((k) => <li key={k} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${TONE[k]}`}>{ICON[k]}{t[k]} {STATUS_LABEL[k].toLowerCase()}</li>)}
          </ul>
        </div>

        {SECTIONS.map((sec) => (
          <section key={sec.id} aria-labelledby={`${sec.id}-h`} className="grid gap-3" data-testid={`section-${sec.id}`}>
            <h2 id={`${sec.id}-h`} className="text-xl sm:text-2xl">{sec.title}</h2>
            <p className="max-w-3xl text-muted">{sec.intro}</p>
            <div className="overflow-hidden rounded-lg border border-rule bg-surface shadow-card sm:overflow-x-auto" role="region" aria-label={sec.title}>
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
                      <td className="order-2 sm:table-cell sm:px-4 sm:py-3"><span data-status={r.status} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap ${TONE[r.status]}`}>{ICON[r.status]}{STATUS_LABEL[r.status]}</span></td>
                      {staff && <td className="order-4 text-[12px] text-faint sm:table-cell sm:px-4 sm:py-3">{r.evidence}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="max-w-3xl text-[15px] text-muted">A blank [ ] is something the hospital still has to fill in, such as the Data Protection Officer and the grievance officer.</p>
      </div>
    </PublicShell>
  )
}
