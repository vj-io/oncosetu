import { eq } from 'drizzle-orm'
import { Eye } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { StopCard } from '@/components/portal/StopCard'
import { Kicker } from '@/components/portal/ui'
import { EmptyState } from '@/components/ui'
import { withOrg } from '@/db'
import { patients } from '@/db/schema'
import { tp } from '@/i18n/patient'
import { loadAccessLog } from '@/server/portal/access'
import { loadPortal, type PortalSearch } from '@/server/portal/context'

export default async function AccessPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const [log, [card]] = await withOrg(ctx.session.orgId, (tx) => Promise.all([
    loadAccessLog(tx, ctx.session.patientId, lang, ctx.session.kind === 'patient'),
    tx.select({ revokedAt: patients.tokenRevokedAt }).from(patients).where(eq(patients.id, ctx.session.patientId)),
  ]))
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'accessKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'accessTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'accessIntro')}</p>
      {log.length === 0 ? (
        <EmptyState className="mt-8" icon={<Eye />} title={tp(lang, 'accessEmpty')} />
      ) : (
        <>
          <ol className="mt-8 divide-y divide-rule border border-rule bg-surface">
            {log.map((e) => (
              <li key={e.id} className="grid gap-0.5 px-4 py-3">
                <span className="text-[17px] leading-snug">{e.text}</span>
                <span className="text-[16px] text-muted">{e.at}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[16px] text-muted">{tp(lang, 'accessNote')}</p>
        </>
      )}
      <section aria-labelledby="card-h" className="mt-12 grid gap-3 border-t border-rule pt-8">
        <h2 id="card-h" className="text-xl">{tp(lang, 'cardLostTitle')}</h2>
        {card?.revokedAt ? (
          <p role="status" className="text-[17px]">{tp(lang, 'cardStopped')}</p>
        ) : (
          <>
            <p className="max-w-prose text-[16px] text-muted">{tp(lang, 'cardLostText')}</p>
            <StopCard lang={lang} />
          </>
        )}
      </section>
    </PortalFrame>
  )
}
