import { ConsentPanel } from '@/components/portal/ConsentPanel'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { PrivacyNotice } from '@/components/portal/PrivacyNotice'
import { SignConsent } from '@/components/portal/SignConsent'
import { Kicker } from '@/components/portal/ui'
import { withOrg } from '@/db'
import { ID_TYPE_LABEL } from '@/core/idcheck'
import { tp } from '@/i18n/patient'
import { tv } from '@/i18n/privacy'
import { loadErasure } from '@/server/erasure/erasure'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadConsentView } from '@/server/portal/consent'
import { formatDateTimeIN } from '@/server/portal/summary'
import { loadPrivacyView } from '@/server/privacy/privacy'
import { listSignedConsents } from '@/server/privacy/sign'
import { caregivers } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function ConsentPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const { view, erasure, privacy, signed, guardian } = await withOrg(ctx.session.orgId, async (tx) => ({
    signed: await listSignedConsents(tx, ctx.session.patientId),
    guardian: ctx.session.caregiverId ? !!(await tx.select({ g: caregivers.isGuardian }).from(caregivers).where(eq(caregivers.id, ctx.session.caregiverId)))[0]?.g : false,
    view: await loadConsentView(tx, ctx.session.patientId), erasure: await loadErasure(tx, ctx.session.patientId),
    privacy: await loadPrivacyView(tx, ctx.session.patientId, ctx.actor.id),
  }))
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tv(lang, 'kicker')}</Kicker>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tv(lang, 'title')}</h1>
        <span data-testid="draft-badge" className="inline-flex items-center border border-amber bg-amber-tint px-2.5 py-1 font-mono text-[12px] tracking-[0.06em] text-amber-ink uppercase">{tv(lang, 'badge')}</span>
      </div>
      <p className="mt-3 max-w-prose text-muted">{tv(lang, 'intro')}</p>

      <div className="mt-8 grid gap-10">
        <PrivacyNotice lang={lang} version={privacy.noticeVersion} initial={privacy.mine} />

        <div>
          <h2 className="text-xl">{tv(lang, 'purposesTitle')}</h2>
          <p className="mt-1 max-w-prose text-[16px] text-muted">{tv(lang, 'purposesIntro')}</p>
          <ConsentPanel
            lang={lang}
            initial={view.purposes}
            caregivers={view.caregivers}
            isPatient={ctx.session.kind === 'patient'}
            erasure={erasure && erasure.state !== 'cancelled' ? { state: erasure.state, eligibleAfter: erasure.eligibleAfter, completedAt: erasure.completedAt } : null}
            lastUpdated={view.recordedAt ? formatDateTimeIN(view.recordedAt, lang) : null}
          />
        </div>

        <SignConsent
          lang={lang} purposes={view.purposes} relation={ctx.session.kind === 'patient' ? 'self' : guardian ? 'guardian' : 'caregiver'} defaultName={ctx.session.displayName}
          signed={signed.map((x) => ({ id: x.id, action: x.action, signer: x.signer, signedAt: x.signedAt, dateText: formatDateTimeIN(new Date(x.signedAt), lang) }))}
        />

        <section aria-labelledby="rights-h" className="grid gap-3 border border-rule bg-surface px-5 py-5">
          <h2 id="rights-h" className="text-xl">{tv(lang, 'rightsTitle')}</h2>
          <ul className="grid gap-1.5 text-[17px]">
            <li>{tv(lang, 'rightAccess')}</li>
            <li>{tv(lang, 'rightCorrect')}</li>
            <li>{tv(lang, 'rightErase')}</li>
            <li>{tv(lang, 'rightGrievance')}</li>
          </ul>
          <p className="font-mono text-[16px]" data-testid="grievance">{tv(lang, 'grievanceOfficer')}</p>
          <p className="text-[16px] text-muted">{tv(lang, 'grievanceBlank')}</p>
        </section>

        <section aria-labelledby="id-h" className="grid gap-2 border border-rule bg-surface px-5 py-5">
          <h2 id="id-h" className="text-xl">{tv(lang, 'idTitle')}</h2>
          <p data-testid="id-record" className="text-[17px]">
            {privacy.idRecord
              ? tv(lang, 'idRecorded', { type: ID_TYPE_LABEL[privacy.idRecord.idType][lang], masked: privacy.idRecord.masked, by: privacy.idRecord.verifiedBy, date: formatDateTimeIN(new Date(privacy.idRecord.verifiedAt), lang) })
              : tv(lang, 'idNone')}
          </p>
          <p className="text-[16px] text-muted">{tv(lang, 'idNote')}</p>
        </section>

        <section aria-labelledby="future-h" className="grid gap-2 border border-dashed border-rule px-5 py-4">
          <h2 id="future-h" className="text-lg">{tv(lang, 'futureTitle')}</h2>
          <p className="text-[16px] text-muted">{tv(lang, 'futureText')}</p>
        </section>
      </div>
      <p className="sr-only">{tp(lang, 'consentTitle')}</p>
    </PortalFrame>
  )
}
