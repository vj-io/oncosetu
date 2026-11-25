import type { ReactNode } from 'react'
import { CalendarDays, Camera, ChevronDown, ClipboardList, ExternalLink, FileText, History, KeyRound, Mail, Send, Settings, ShieldCheck, Share2, Stethoscope, Users, Building2 } from 'lucide-react'
import { ActionCard } from '@/components/portal/ActionCard'
import { DisputeDocument } from '@/components/portal/DisputeDocument'
import { MissingPaper } from '@/components/portal/MissingPaper'
import { MoreLink } from '@/components/portal/MoreLink'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker, PLink } from '@/components/portal/ui'
import { EmptyState } from '@/components/ui'
import { withOrg } from '@/db'
import type { Lang } from '@/core/types'
import { tp, tpw } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadHomeData } from '@/server/portal/home'
import { buildHomeSummary, type HomeSummary } from '@/server/portal/summary'

const SHOWN_PAPERS = 3

/**
 * A home section: one white card with a grey title band and an optional count, so each part of the page has its own
 * visible edge. Rows inside are divided by hairlines, not boxed again.
 */
function Section({ id, headingId, title, count, children, className = 'mt-8' }: { id?: string; headingId: string; title: string; count?: number; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={headingId} className={`${className} scroll-mt-4 overflow-hidden rounded-xl border border-edge bg-surface shadow-card`}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-rule bg-alcove px-4 py-2.5">
        <h2 id={headingId} className="text-[1.25rem] leading-tight">{title}</h2>
        {count !== undefined && <span className="grid h-8 min-w-8 place-items-center rounded-full border border-edge bg-surface px-2 text-[16px] font-medium tabular-nums">{count}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

const ROWS = 'grid divide-y divide-rule'
const ROW = 'py-4 first:pt-0 last:pb-0'

function Dates({ rows }: { rows: HomeSummary['coming'] }) {
  return (
    <ul className={ROWS}>
      {rows.map((d) => (
        <li key={d.id} className={`${ROW} flex items-start gap-3`}>
          <CalendarDays aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-[17px] font-medium">{d.date}</span>
            {/* the words are copied from the paper, so they stay as written (often English) */}
            <span className="text-[17px] break-words">{d.what}</span>
            {d.source && <span className="text-[16px] text-muted">{d.source}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Papers({ rows, lang }: { rows: HomeSummary['documents']; lang: Lang }) {
  return (
    <ul className={ROWS}>
      {rows.map((d) => (
        <li key={d.id} className={`${ROW} flex items-start gap-3`}>
          <FileText aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-[17px]">{d.label}</span>
            <span className="text-[16px] text-muted">{[d.dated, d.received].filter(Boolean).join(' · ')}</span>
            {d.reports && (
              <ul className="mt-1 grid gap-1 border-l-2 border-rule pl-3" data-testid="papers-in-file">
                {d.reports.map((r, i) => <li key={i} className="text-[16px]">{r.label}{r.dated ? <span className="text-muted"> · {r.dated}</span> : null}</li>)}
              </ul>
            )}
            {d.open && (
              <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener" data-testid="open-paper" className="inline-flex min-h-11 items-center gap-2 justify-self-start text-[16px] font-medium text-setu-ink underline decoration-link underline-offset-4">
                <ExternalLink aria-hidden className="size-4" />{tp(lang, 'openPaper')}
              </a>
            )}
            <DisputeDocument lang={lang} documentId={d.id} flagged={d.disputed} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** A native "show more" row: works without scripts, and is a full-height tap target. */
function Fold({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mt-3 border-t border-rule pt-3">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-4 py-2 text-[17px] marker:hidden hover:bg-spotlight [&::-webkit-details-marker]:hidden">
        <span className="underline decoration-link underline-offset-4">{summary}</span>
        <ChevronDown aria-hidden className="size-5 shrink-0 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}

export default async function PatientHome({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const data = await withOrg(ctx.session.orgId, (tx) => loadHomeData(tx, ctx.session.orgId, ctx.session.patientId, { disclosure: ctx.disclosure, session: ctx.session }))
  const sum = buildHomeSummary(data, ctx.disclosure, lang)
  const q = `?lang=${lang}`
  const pending = sum.looking.filter((m) => m.state !== 'received')
  const arrived = sum.looking.filter((m) => m.state === 'received')
  const parts = ctx.session.displayName.trim().split(/\s+/)
  // "Mohd.", "Dr.", "K." are not names: greet with the whole name
  const firstName = !parts[0] || parts[0].endsWith('.') || parts[0].length < 3 ? ctx.session.displayName.trim() : parts[0]
  const hasDates = sum.coming.length > 0 || sum.earlier.length > 0 || !!sum.doctor

  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tpw(lang, 'homeKicker', ctx.who)}</Kicker>
      <h1 className="mt-1 text-[1.875rem] leading-tight tracking-[-0.02em] sm:text-[2.25rem]">{tp(lang, 'homeHello', { name: firstName })}</h1>
      <p className="mt-2 max-w-prose text-muted">{tp(lang, 'homeIntro')}</p>

      {/* 1. The one main action: send papers. Everything else on this page is quieter. */}
      <div className="mt-6 grid gap-3">
        <ActionCard primary href={`/p/upload${q}`} icon={<Camera />} title={tp(lang, 'cardUploadTitle')} text={tp(lang, 'cardUploadText')} />
        {/* what the clinic has and what it still needs: one white strip, both cells jump to their list */}
        <ul className="grid grid-cols-2 divide-x divide-rule overflow-hidden rounded-xl border border-edge bg-surface shadow-card">
          <li>
            <a href="#papers" className="block h-full p-4 hover:bg-spotlight focus-visible:-outline-offset-2">
              <span className="block font-display text-[2rem] leading-none tabular-nums">{sum.documents.length}</span>
              <span className="mt-2 block text-[16px] leading-snug text-muted">{tp(lang, 'statHas')}</span>
            </a>
          </li>
          <li>
            <a href="#missing" className="block h-full p-4 hover:bg-spotlight focus-visible:-outline-offset-2">
              <span className={`block font-display text-[2rem] leading-none tabular-nums ${pending.length ? 'text-amber-ink' : ''}`}>{pending.length}</span>
              <span className="mt-2 block text-[16px] leading-snug text-muted">{tp(lang, 'statNeeds')}</span>
            </a>
          </li>
        </ul>
      </div>

      {/* 2. What is missing and where to ask */}
      <Section id="missing" headingId="look-h" title={tp(lang, 'secLooking')} count={pending.length}>
        {pending.length ? (
          <>
            <p className="max-w-prose text-muted">{tp(lang, 'lookingIntro')}</p>
            <ul className={`mt-4 ${ROWS}`}>
              {pending.map((m) => (
                <li key={m.id} className={ROW}><MissingPaper bare row={m} lang={lang} /></li>
              ))}
            </ul>
          </>
        ) : sum.documents.length ? (
          <p className="text-muted">{tp(lang, 'lookingEmpty')}</p>
        ) : (
          // an empty file is not "nothing missing": say the clinic has nothing, and point at the Send button
          <>
            <p className="max-w-prose text-muted">{tp(lang, 'lookingEmptyNoDocs')}</p>
            <div className="mt-4"><PLink variant="secondary" href={`/p/upload${q}`} icon={<Send />} className="w-full sm:w-auto">{tp(lang, 'lookingSend')}</PLink></div>
          </>
        )}
        {arrived.length > 0 && (
          <div className="mt-6 border-t border-rule pt-5">
            <h3 className="text-lg leading-tight">{tp(lang, 'secArrived')}</h3>
            <ul className={`mt-3 ${ROWS}`}>
              {arrived.map((m) => (
                <li key={m.id} className={ROW}><MissingPaper bare row={m} lang={lang} /></li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* 3. The questions before the visit */}
      <div className="mt-8">
        <ActionCard href={`/p/visit${q}`} icon={<ClipboardList />} title={tp(lang, 'cardVisitTitle')} text={tp(lang, 'cardVisitText')} note={sum.visit} />
      </div>

      {/* 4. Papers the clinic has: newest three, the rest one tap away; each can be opened */}
      <Section id="papers" headingId="docs-h" title={tp(lang, 'secDocs')} count={sum.documents.length}>
        {sum.documents.length ? (
          <>
            <Papers rows={sum.documents.slice(0, SHOWN_PAPERS)} lang={lang} />
            {sum.documents.length > SHOWN_PAPERS && (
              <Fold summary={tp(lang, 'docsShowAll', { n: sum.documents.length })}><Papers rows={sum.documents.slice(SHOWN_PAPERS)} lang={lang} /></Fold>
            )}
          </>
        ) : (
          <EmptyState icon={<Send />} title={tp(lang, 'docsEmpty')} />
        )}
      </Section>

      {/* 5. Share with a doctor, and letters to other hospitals */}
      <div className="mt-8 grid gap-3">
        <ActionCard href={`/p/share${q}`} icon={<Share2 />} title={tp(lang, 'cardShareTitle')} text={tp(lang, 'cardShareText')} note={sum.shares} />
        <ActionCard href={`/p/requests${q}`} icon={<Mail />} title={tp(lang, 'cardRequestsTitle')} text={tp(lang, 'cardRequestsText')} note={sum.requests} />
      </div>

      {/* 6. Dates already written in the papers: coming up first, earlier ones folded away */}
      {hasDates && (
        <Section headingId="written-h" title={tp(lang, 'secComing')} className="mt-10">
          <p className="max-w-prose text-muted">{tp(lang, 'writtenIntro')}</p>
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
        </Section>
      )}

      {/* 7. Rare things, tucked away but one tap from here. Without a password, one quiet reminder stays in view. */}
      <div className="mt-10 grid gap-3">
        {!ctx.hasPassword && <MoreLink href={`/p/password${q}`} icon={<KeyRound />} title={tp(lang, 'pwCardTitle')} note={tp(lang, 'pwCardText')} />}
        <details className="group overflow-hidden rounded-xl border border-edge bg-surface shadow-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden hover:bg-spotlight focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-alcove text-pine [&_svg]:size-5 [&_svg]:stroke-[1.5]"><Settings /></span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-[17px] leading-snug font-medium">{tp(lang, 'secSettings')}</span>
              <span className="text-[16px] text-muted">{tp(lang, 'settingsNote')}</span>
            </span>
            <ChevronDown aria-hidden className="size-5 shrink-0 text-faint transition-transform group-open:rotate-180" />
          </summary>
          <ul className="grid gap-2 border-t border-rule bg-alcove/60 p-3">
            <li><MoreLink href={`/p/consent${q}`} icon={<ShieldCheck />} title={tp(lang, 'cardConsentTitle')} note={tp(lang, 'cardConsentText')} /></li>
            <li><MoreLink href={`/p/access${q}`} icon={<History />} title={tp(lang, 'cardAccessTitle')} note={tp(lang, 'cardAccessText')} /></li>
            <li><MoreLink href={`/p/permissions${q}`} icon={<Users />} title={tp(lang, 'navWho')} /></li>
            <li><MoreLink href={`/p/password${q}`} icon={<KeyRound />} title={tp(lang, 'pwTitle')} note={tp(lang, ctx.hasPassword ? 'pwMoreSet' : 'pwMoreNone')} /></li>
            <li><MoreLink href={`/p/abdm${q}`} icon={<Building2 />} title={tp(lang, 'navAbdmShort')} /></li>
          </ul>
        </details>
      </div>
    </PortalFrame>
  )
}
