import { MissingPaper } from '@/components/portal/MissingPaper'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { RequestList } from '@/components/requests/RequestList' // Radar-share: list, letters, "I sent it", tracking
import { withOrg } from '@/db'
import { tp } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadHomeData } from '@/server/portal/home'
import { buildHomeSummary } from '@/server/portal/summary'

export default async function RequestsPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const data = await withOrg(ctx.session.orgId, (tx) => loadHomeData(tx, ctx.session.orgId, ctx.session.patientId))
  // only papers nothing has been asked for yet can get a new letter
  const missing = buildHomeSummary(data, ctx.disclosure, lang).looking.filter((m) => m.canLetter)
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'requestsKicker')}</Kicker>
      <h1 className="mt-2 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'requestsTitle')}</h1>
      <p className="mt-2 max-w-prose text-muted">{tp(lang, 'requestsIntro')}</p>

      <section className="mt-8" aria-labelledby="make-h">
        <h2 id="make-h" className="text-2xl leading-tight tracking-[-0.02em]">{tp(lang, 'requestsMakeTitle')}</h2>
        {missing.length ? (
          <>
            <p className="mt-2 max-w-prose text-muted">{tp(lang, 'requestsMakeIntro')}</p>
            <ul className="mt-4 grid gap-3">
              {missing.map((m) => (
                <li key={m.id}><MissingPaper row={m} lang={lang} showSend={false} /></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-muted">{tp(lang, 'requestsMakeNone')}</p>
        )}
      </section>

      <section className="mt-10" aria-labelledby="letters-h">
        <h2 id="letters-h" className="mb-4 text-2xl leading-tight tracking-[-0.02em]">{tp(lang, 'requestsListTitle')}</h2>
        <RequestList key={missing.length} patientId={ctx.session.patientId} actor="patient" lang={lang} />
      </section>
    </PortalFrame>
  )
}
