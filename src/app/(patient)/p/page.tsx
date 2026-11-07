import Link from 'next/link'
import { CalendarDays, Camera, ClipboardList, FileText, History, Mail, Send, ShieldCheck, Share2, Stethoscope } from 'lucide-react'
import { ActionCard } from '@/components/portal/ActionCard'
import { DisputeDocument } from '@/components/portal/DisputeDocument'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { LookingItem } from '@/components/portal/LookingItem'
import { EmptyState, Frame, SectionHeader } from '@/components/ui'
import { withOrg } from '@/db'
import { tp } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadHomeData } from '@/server/portal/home'
import { buildHomeSummary } from '@/server/portal/summary'

export default async function PatientHome({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const data = await withOrg(ctx.session.orgId, (tx) => loadHomeData(tx, ctx.session.orgId, ctx.session.patientId))
  const sum = buildHomeSummary(data, ctx.disclosure, lang)
  const q = `?lang=${lang}`
  const parts = ctx.session.displayName.trim().split(/\s+/)
  // "Mohd.", "Dr.", "K." are not names: greet with the whole name
  const firstName = !parts[0] || parts[0].endsWith('.') || parts[0].length < 3 ? ctx.session.displayName.trim() : parts[0]

  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'homeKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'homeHello', { name: firstName })}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'homeIntro')}</p>

      <section aria-label={tp(lang, 'navLabel')} className="mt-8 grid gap-3">
        <ActionCard href={`/p/upload${q}`} icon={<Camera />} title={tp(lang, 'cardUploadTitle')} text={tp(lang, 'cardUploadText')} />
        <ActionCard href={`/p/visit${q}`} icon={<ClipboardList />} title={tp(lang, 'cardVisitTitle')} text={tp(lang, 'cardVisitText')} note={sum.visit} />
        <ActionCard href={`/p/requests${q}`} icon={<Mail />} title={tp(lang, 'cardRequestsTitle')} text={tp(lang, 'cardRequestsText')} note={sum.requests} />
        <ActionCard href={`/p/share${q}`} icon={<Share2 />} title={tp(lang, 'cardShareTitle')} text={tp(lang, 'cardShareText')} note={sum.shares} />
        <ActionCard href={`/p/consent${q}`} icon={<ShieldCheck />} title={tp(lang, 'cardConsentTitle')} text={tp(lang, 'cardConsentText')} />
        <ActionCard href={`/p/access${q}`} icon={<History />} title={tp(lang, 'cardAccessTitle')} text={tp(lang, 'cardAccessText')} />
      </section>

      <section className="mt-12" aria-labelledby="docs-h">
        <SectionHeader title={<span id="docs-h">{tp(lang, 'secDocs')}</span>} />
        {sum.documents.length ? (
          <ul className="mt-4 grid gap-2">
            {sum.documents.map((d) => (
              <li key={d.id}>
                <Frame className="flex items-start gap-3 px-4 py-3">
                  <FileText aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-[17px]">{d.label}</span>
                    <span className="text-[16px] text-muted">{[d.dated, d.received].filter(Boolean).join(' · ')}</span>
                    <DisputeDocument lang={lang} documentId={d.id} flagged={d.disputed} />
                  </div>
                </Frame>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="mt-4" icon={<Send />} title={tp(lang, 'docsEmpty')} />
        )}
      </section>

      {(sum.doctor || sum.writtenDates.length > 0) && (
        <section className="mt-12" aria-labelledby="written-h">
          <SectionHeader title={<span id="written-h">{tp(lang, 'secWritten')}</span>} description={tp(lang, 'writtenIntro')} />
          <ul className="mt-4 grid gap-2">
            {sum.doctor && (
              <li>
                <Frame className="flex items-start gap-3 px-4 py-3">
                  <Stethoscope aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                  <span className="text-[17px]">{sum.doctor}</span>
                </Frame>
              </li>
            )}
            {sum.writtenDates.map((d) => (
              <li key={d.id}>
                <Frame className="flex items-start gap-3 px-4 py-3">
                  <CalendarDays aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-[17px]">{d.text}</span>
                    {d.source && <span className="text-[16px] text-muted">{d.source}</span>}
                  </div>
                </Frame>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12" aria-labelledby="look-h">
        <SectionHeader title={<span id="look-h">{tp(lang, 'secLooking')}</span>} description={tp(lang, 'lookingIntro')} />
        {sum.looking.length ? (
          <ul className="mt-6 grid gap-5">
            {sum.looking.map((m) => (
              <li key={m.id}>
                <LookingItem text={m.text} note={m.ask} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-muted">{tp(lang, 'lookingEmpty')}</p>
        )}
        {sum.looking.length > 0 && (
          <p className="mt-6">
            <Link href={`/p/upload${q}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
              {tp(lang, 'cardUploadTitle')}
            </Link>
          </p>
        )}
      </section>
    </PortalFrame>
  )
}
