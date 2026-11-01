import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { RequestList } from '@/components/requests/RequestList' // Radar-share: list, letters, "I sent it", tracking
import { tp } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'

export default async function RequestsPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'requestsKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'requestsTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'requestsIntro')}</p>
      <div className="mt-8">
        <RequestList patientId={ctx.session.patientId} actor="patient" lang={lang} />
      </div>
    </PortalFrame>
  )
}
