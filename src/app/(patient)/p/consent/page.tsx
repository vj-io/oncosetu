import { ConsentPanel } from '@/components/portal/ConsentPanel'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { withOrg } from '@/db'
import { tp } from '@/i18n/patient'
import { loadErasure } from '@/server/erasure/erasure'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadConsentView } from '@/server/portal/consent'
import { formatDateTimeIN } from '@/server/portal/summary'

export default async function ConsentPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const { view, erasure } = await withOrg(ctx.session.orgId, async (tx) => ({
    view: await loadConsentView(tx, ctx.session.patientId), erasure: await loadErasure(tx, ctx.session.patientId),
  }))
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'consentKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'consentTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'consentIntro')}</p>
      <ConsentPanel
        lang={lang}
        initial={view.purposes}
        caregivers={view.caregivers}
        isPatient={ctx.session.kind === 'patient'}
        erasure={erasure && erasure.state !== 'cancelled' ? { state: erasure.state, eligibleAfter: erasure.eligibleAfter, completedAt: erasure.completedAt } : null}
        lastUpdated={view.recordedAt ? formatDateTimeIN(view.recordedAt, lang) : null}
      />
    </PortalFrame>
  )
}
