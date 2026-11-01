import { Link2 } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { RevokeShare } from '@/components/portal/RevokeShare'
import { CreateShareForm } from '@/components/shares/CreateShareForm' // Radar-share: creates the link, encrypting in the browser
import { EmptyState, Frame } from '@/components/ui'
import { formatDateIN, istDate } from '@/core/copy'
import { withOrg } from '@/db'
import { tp, type PatientKey } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadShares } from '@/server/portal/shares'

export default async function SharePage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const shares = await withOrg(ctx.session.orgId, (tx) => loadShares(tx, ctx.session.orgId, ctx.session.patientId))
  const date = (iso: string) => formatDateIN(istDate(iso), lang)
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'shareKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'shareTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'shareIntro')}</p>

      <section className="mt-8" aria-labelledby="new-h">
        <h2 id="new-h" className="mb-4 text-2xl">{tp(lang, 'shareNewTitle')}</h2>
        <CreateShareForm patientId={ctx.session.patientId} actor="patient" lang={lang} />
      </section>

      <section className="mt-12" aria-labelledby="list-h">
        <h2 id="list-h" className="mb-4 text-2xl">{tp(lang, 'shareListTitle')}</h2>
        {shares.length === 0 ? (
          <EmptyState icon={<Link2 />} title={tp(lang, 'shareNoLinks')} />
        ) : (
          <ul className="grid gap-3">
            {shares.map((s) => (
              <li key={s.id}>
                <Frame className="grid gap-2 px-5 py-4">
                  <p className="text-xl leading-snug">{tp(lang, `scope_${s.scope}` as PatientKey)}</p>
                  <p className="text-[17px]"><span className="font-medium">{tp(lang, `shareStatus_${s.status}` as PatientKey)}</span></p>
                  <p className="text-[15px] text-muted">
                    {[tp(lang, 'shareMadeOn', { date: date(s.createdAt) }), tp(lang, 'shareExpires', { date: date(s.expiresAt) }), tp(lang, 'shareOpened', { n: s.opened })].join(' · ')}
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
