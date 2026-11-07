import { desc, eq } from 'drizzle-orm'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { VisitFlow } from '@/components/portal/VisitFlow'
import { formatDateIN, istDate } from '@/core/copy'
import { withOrg } from '@/db'
import { patientStatements } from '@/db/schema'
import { tp } from '@/i18n/patient'
import { now } from '@/server/clock'
import { loadPortal } from '@/server/portal/context'

export default async function VisitPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[]; station?: string | string[] }> }) {
  const ctx = await loadPortal(searchParams)
  const station = (await searchParams).station === '1'
  const { lang } = ctx
  const [last] = await withOrg(ctx.session.orgId, (tx) =>
    tx.select({ at: patientStatements.createdAt }).from(patientStatements)
      .where(eq(patientStatements.patientId, ctx.session.patientId)).orderBy(desc(patientStatements.createdAt)).limit(1))
  const year = Number((await now(ctx.session.orgId)).toISOString().slice(0, 4))
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'visitKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'visitTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'visitIntro')}</p>
      <VisitFlow
        lang={lang}
        canVoice={ctx.flags.voice}
        // Spoken read-back needs the org flag AND a cleared disclosure (FR-CON-07, V05-E2E-08); otherwise the control is not rendered at all.
        canSpeak={ctx.flags.tts && ctx.disclosure === 'cleared'}
        sarvam={!!process.env.SARVAM_API_KEY}
        currentYear={year}
        lastAnswered={last ? formatDateIN(istDate(last.at.toISOString()), lang) : null}
        station={station}
      />
    </PortalFrame>
  )
}
