import type { ReactNode } from 'react'
import { CalendarDays, Camera, ClipboardList, FileText, History, Mail, Send, ShieldCheck, Share2, Stethoscope } from 'lucide-react'
import { ActionCard } from '@/components/portal/ActionCard'
import { DisputeDocument } from '@/components/portal/DisputeDocument'
import { MissingPaper } from '@/components/portal/MissingPaper'
import { MoreLink } from '@/components/portal/MoreLink'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { EmptyState, Frame } from '@/components/ui'
import { withOrg } from '@/db'
import type { Lang } from '@/core/types'
import { tp } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadHomeData } from '@/server/portal/home'
import { buildHomeSummary, type HomeSummary } from '@/server/portal/summary'

const H2 = 'text-2xl leading-tight tracking-[-0.02em]'
const SHOWN_PAPERS = 3

function Dates({ rows }: { rows: HomeSummary['coming'] }) {
  return (
    <ul className="grid gap-2">
      {rows.map((d) => (
        <li key={d.id}>
          <Frame className="flex items-start gap-3 px-4 py-3">
            <CalendarDays aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-[17px] font-medium">{d.date}</span>
              {/* the words are copied from the paper, so they stay as written (often English) */}
              <span className="text-[17px] break-words">{d.what}</span>
              {d.source && <span className="text-[16px] text-muted">{d.source}</span>}
            </div>
          </Frame>
        </li>
      ))}
    </ul>
  )
}

function Papers({ rows, lang }: { rows: HomeSummary['documents']; lang: Lang }) {
  return (
    <ul className="grid gap-2">
      {rows.map((d) => (
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
  )
}

/** A native "show more" row: works without scripts, and is a full-height tap target. */
function Fold({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-3">
      <summary className="flex min-h-12 cursor-pointer list-none items-center border border-rule bg-surface px-4 py-2 text-[17px] underline underline-offset-4 marker:hidden [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

export default async function PatientHome({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const data = await withOrg(ctx.session.orgId, (tx) => loadHomeData(tx, ctx.session.orgId, ctx.session.patientId))
  const sum = buildHomeSummary(data, ctx.disclosure, lang)
  const q = `?lang=${lang}`
  const parts = ctx.session.displayName.trim().split(/\s+/)
  // "Mohd.", "Dr.", "K." are not names: greet with the whole name
  const firstName = !parts[0] || parts[0].endsWith('.') || parts[0].length < 3 ? ctx.session.displayName.trim() : parts[0]
  const hasDates = sum.coming.length > 0 || sum.earlier.length > 0 || !!sum.doctor

  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'homeKicker')}</Kicker>
      <h1 className="mt-2 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'homeHello', { name: firstName })}</h1>
      <p className="mt-2 max-w-prose text-muted">{tp(lang, 'homeIntro')}</p>

      {/* 1. What is missing and where to ask: the thing a family member most needs */}
      <section className="mt-8" aria-labelledby="look-h" id="missing">
        <h2 id="look-h" className={H2}>{tp(lang, 'secLooking')}</h2>
        {sum.looking.length ? (
          <>
            <p className="mt-2 max-w-prose text-muted">{tp(lang, 'lookingIntro')}</p>
            <ul className="mt-4 grid gap-3">
              {sum.looking.map((m) => (
                <li key={m.id}><MissingPaper row={m} lang={lang} /></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-muted">{tp(lang, 'lookingEmpty')}</p>
        )}
      </section>

      {/* 2. Dates already written in the papers: coming up first, earlier ones folded away */}
      {hasDates && (
        <section className="mt-10" aria-labelledby="written-h">
          <h2 id="written-h" className={H2}>{tp(lang, 'secComing')}</h2>
          <p className="mt-2 max-w-prose text-muted">{tp(lang, 'writtenIntro')}</p>
          <div className="mt-4">
            {sum.coming.length ? <Dates rows={sum.coming} /> : <p className="text-muted">{tp(lang, 'comingNone')}</p>}
            {sum.earlier.length > 0 && (
              <Fold summary={tp(lang, 'secEarlier', { n: sum.earlier.length })}><Dates rows={sum.earlier} /></Fold>
            )}
            {sum.doctor && (
              <p className="mt-3 flex items-start gap-3 text-[16px] text-muted">
                <Stethoscope aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                <span>{sum.doctor}</span>
              </p>
            )}
          </div>
        </section>
      )}

      {/* 3. One big way to send papers */}
      <section className="mt-10" aria-label={tp(lang, 'cardUploadTitle')}>
        <ActionCard href={`/p/upload${q}`} icon={<Camera />} title={tp(lang, 'cardUploadTitle')} text={tp(lang, 'cardUploadText')} />
      </section>

      {/* 4. Papers the clinic has: newest three, the rest one tap away */}
      <section className="mt-10" aria-labelledby="docs-h">
        <h2 id="docs-h" className={H2}>{tp(lang, 'secDocs')}</h2>
        {sum.documents.length ? (
          <div className="mt-4">
            <Papers rows={sum.documents.slice(0, SHOWN_PAPERS)} lang={lang} />
            {sum.documents.length > SHOWN_PAPERS && (
              <Fold summary={tp(lang, 'docsShowAll', { n: sum.documents.length })}><Papers rows={sum.documents.slice(SHOWN_PAPERS)} lang={lang} /></Fold>
            )}
          </div>
        ) : (
          <EmptyState className="mt-4" icon={<Send />} title={tp(lang, 'docsEmpty')} />
        )}
      </section>

      {/* 5. Everything else, as quiet rows */}
      <section className="mt-10" aria-labelledby="more-h">
        <h2 id="more-h" className={H2}>{tp(lang, 'secMore')}</h2>
        <ul className="mt-4 grid gap-2">
          <li><MoreLink href={`/p/visit${q}`} icon={<ClipboardList />} title={tp(lang, 'cardVisitTitle')} note={sum.visit} /></li>
          <li><MoreLink href={`/p/requests${q}`} icon={<Mail />} title={tp(lang, 'cardRequestsTitle')} note={sum.requests} /></li>
          <li><MoreLink href={`/p/share${q}`} icon={<Share2 />} title={tp(lang, 'cardShareTitle')} note={sum.shares} /></li>
          <li><MoreLink href={`/p/consent${q}`} icon={<ShieldCheck />} title={tp(lang, 'cardConsentTitle')} note={tp(lang, 'cardConsentText')} /></li>
          <li><MoreLink href={`/p/access${q}`} icon={<History />} title={tp(lang, 'cardAccessTitle')} note={tp(lang, 'cardAccessText')} /></li>
        </ul>
      </section>
    </PortalFrame>
  )
}
