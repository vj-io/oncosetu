import { CalendarClock, Link2 } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { RevokeShare } from '@/components/portal/RevokeShare'
import { CreateShareForm } from '@/components/shares/CreateShareForm' // Radar-share: creates the link, encrypting in the browser
import { EmptyState, Frame } from '@/components/ui'
import { formatDateIN, istDate } from '@/core/copy'
import { withOrg } from '@/db'
import { tp, type PatientKey } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { hasSealedRecord, loadShares } from '@/server/portal/shares'

export default async function SharePage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const { shares, sealed } = await withOrg(ctx.session.orgId, async (tx) => ({
    shares: await loadShares(tx, ctx.session.orgId, ctx.session.patientId),
    sealed: await hasSealedRecord(tx, ctx.session.patientId),
  }))
  const date = (iso: string) => formatDateIN(istDate(iso), lang)
  const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date(iso))
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'shareKicker')}</Kicker>
      <h1 className="mt-2 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'shareTitle')}</h1>
      <p className="mt-2 max-w-prose text-muted">{tp(lang, 'shareIntro')}</p>

      <section className="mt-8" aria-labelledby="new-h">
        {sealed ? (
          <>
            <h2 id="new-h" className="mb-4 text-2xl">{tp(lang, 'shareNewTitle')}</h2>
            <CreateShareForm patientId={ctx.session.patientId} actor="patient" lang={lang} />
          </>
        ) : (
          // Nothing sealed yet: say what happens next instead of a form that cannot work
          <Frame tone="feature" className="grid gap-3 px-5 py-5">
            <div className="flex items-start gap-3">
              <CalendarClock aria-hidden className="mt-1 size-6 shrink-0 text-setu-ink" strokeWidth={1.5} />
              <h2 id="new-h" className="text-2xl leading-snug">{tp(lang, 'shareWaitTitle')}</h2>
            </div>
            <p className="max-w-prose">{tp(lang, 'shareWaitText')}</p>
            <p className="max-w-prose text-muted">{tp(lang, 'shareWaitDesk')}</p>
          </Frame>
        )}
      </section>

      <section className="mt-10" aria-labelledby="list-h">
        <h2 id="list-h" className="mb-4 text-2xl">{tp(lang, 'shareListTitle')}</h2>
        {shares.length === 0 ? (
          <EmptyState icon={<Link2 />} title={tp(lang, 'shareNoLinks')} />
        ) : (
          <ul className="grid gap-3">
            {shares.map((s) => (
              <li key={s.id}>
                <Frame className="grid gap-2 px-5 py-4">
                  <p className="text-xl leading-snug">{s.label ?? tp(lang, `scope_${s.scope}` as PatientKey)}</p>
                  {s.label && <p className="text-[15px] text-muted">{tp(lang, `scope_${s.scope}` as PatientKey)}</p>}
                  <p className="text-[17px]"><span className="font-medium">{tp(lang, `shareStatus_${s.status}` as PatientKey)}</span></p>
                  <p className="text-[15px] text-muted">
                    {[tp(lang, 'shareMadeOn', { date: `${date(s.createdAt)}, ${time(s.createdAt)}` }), tp(lang, 'shareExpires', { date: date(s.expiresAt) }), tp(lang, 'shareOpened', { n: s.opened })].join(' · ')}
                  </p>
                  {s.status === 'active' || s.status === 'locked' ? <RevokeShare lang={lang} shareId={s.id} /> : null}
                </Frame>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalFrame>
  )
}
