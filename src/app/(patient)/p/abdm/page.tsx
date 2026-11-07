// J6: the patient approves or declines ABDM record requests here (stands in for the ABHA app with the in-process consent
// manager), and can withdraw an approval, which removes what it brought in. Reached from the request SMS.
import { AbdmConsentCards } from '@/components/abdm/AbdmConsentCards'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { withOrg } from '@/db'
import { ta } from '@/i18n/abdm'
import { eraseDue, patientAbdmView } from '@/server/abdm/flow'
import { writeAudit } from '@/server/audit'
import { loadPortal, type PortalSearch } from '@/server/portal/context'

export default async function AbdmPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang, session } = ctx
  const requests = await withOrg(session.orgId, async (tx) => {
    await eraseDue({ // PRD §10.5 on read
      db: tx, orgId: session.orgId,
      audit: async (action, targetType, targetId, details) => {
        await writeAudit(tx, { orgId: session.orgId, actorId: ctx.actor.id, actorRole: ctx.actor.kind, action, targetType, targetId, details })
      },
    }, session.patientId)
    return patientAbdmView(tx, session.patientId)
  })
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{ta(lang, 'kicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{ta(lang, 'title')}</h1>
      <p data-testid="abdm-planned" className="mt-3 inline-flex border border-amber bg-amber-tint px-3 py-1.5 text-[16px] text-amber-ink">{ta(lang, 'planned')}</p>
      <p className="mt-3 max-w-prose text-muted">{ta(lang, 'intro')}</p>
      <AbdmConsentCards lang={lang} requests={requests} />
    </PortalFrame>
  )
}
