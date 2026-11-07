import { RoleRestricted } from '@/components/shell/RoleRestricted'
// Missing-papers checklist: documents that other documents mention but that are not in the file.
// Production items only; shadow-mode items are never shown to desk, records or clinicians (FR-RAD-05).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowUpRight, EyeOff } from 'lucide-react'
import { MissingActions } from '@/components/completeness/MissingActions'
import { Badge, Chip, EmptyFrame, EmptyState, EXPLAIN, Explainer, InfoTip, KeyValue, LanguageToggle, SectionHeader, StatusBadge } from '@/components/ui'
import { formatDateIN, istDate, patientDocLabel, staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import { now } from '@/server/clock'
import { can } from '@/server/rbac'
import { loadCompleteness, type DescribedItem, type HistoryEntry } from '@/server/radar-ui/completeness'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Missing papers · OncoSetu' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const d = (iso: string | null | undefined) => (iso ? formatDateIN(istDate(iso)) : '—')
/** Desk screens: no quotes or source links (evidence.read), and neutral labels/wording unless disclosure is cleared (FR-VOX-06). */
type View = { neutral: boolean; desk: boolean }
const docLabelFor = (v: View) => (t: DocType | null) => (t ? (v.neutral ? patientDocLabel(t, 'not_cleared') : staffDocLabel(t)) : 'Unclassified document')
const OPEN = ['expected', 'requested', 'received']
const ACTION_WORD: Record<string, string> = {
  request: 'Requested', receive: 'A paper arrived that may match', confirm: 'Match confirmed, item closed', reject_match: 'Match set aside', unobtainable: 'Marked as not obtainable',
  dismiss: 'Dismissed', reopen: 'Reopened',
}
const STATE_WORD: Record<string, string> = { expected: 'not in file', requested: 'requested', received: 'arrived, to confirm', closed: 'closed', unobtainable: 'not obtainable', dismissed: 'dismissed' }

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="grid content-start gap-1 sm:border-l sm:border-rule sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <dt className="ds-kicker">{label}</dt>
      <dd className="font-display text-3xl leading-none tracking-[-0.03em] tabular-nums">{value}</dd>
      {note && <dd className="text-[13px] text-faint">{note}</dd>}
    </div>
  )
}

function History({ created, entries }: { created: string; entries: HistoryEntry[] }) {
  return (
    <ol className="grid gap-1 font-mono text-[12px] text-muted">
      <li>{d(created)} · Noticed as missing</li>
      {entries.map((h, i) => (
        <li key={i}>{d(h.at)} · {ACTION_WORD[h.action] ?? h.action}{h.from && h.to ? ` (${STATE_WORD[h.from] ?? h.from} to ${STATE_WORD[h.to] ?? h.to})` : ''} · {h.role === 'system' ? 'the system' : h.role}</li>
      ))}
    </ol>
  )
}

function Item({ it, patientId, lang, today, history, requests, canAct, canRequest, index, view }: {
  it: DescribedItem; patientId: string; lang: 'en' | 'hi'; today: string; history: HistoryEntry[]
  requests: { id: string; state: string; institution: string }[]; canAct: boolean; canRequest: boolean; index: number; view: View
}) {
  const docLabel = docLabelFor(view)
  const t = it.trigger
  const src = t?.documentId ? `/patients/${patientId}/documents/${t.documentId}?event=${t.eventId}` : null
  const from = it.window.from ?? t?.date ?? undefined
  const to = it.window.to && it.window.to < today ? it.window.to : today
  const proposed = it.proposedDoc
  const rows = [
    {
      label: 'Mentioned in',
      value: t ? (
        <span className="grid gap-1">
          {t.quote && !view.desk && <q className="font-display text-[17px] leading-snug">{t.quote}</q>}
          <span className="text-[14px] text-muted">
            {docLabel(it.triggerDoc?.docType ?? null)}{t.pageNo ? `, p.${t.pageNo}` : ''}{t.institution ? ` · ${t.institution}` : ''} · documented {formatDateIN(t.date, 'en', t.precision)}
            {src && !view.desk && <> · <Link href={src} className="inline-flex items-center gap-0.5 text-setu-ink underline decoration-brass underline-offset-4">Show the exact words<ArrowUpRight aria-hidden className="size-3.5" /></Link></>}
          </span>
        </span>
      ) : 'Patient statement',
    },
    { label: 'Looking for', value: it.expectedTypes.map(docLabel).join(' or ') },
    ...(it.cycles.length ? [{ label: 'Covers', value: <span>Cycles {it.cycles.join(', ')}, asked for together in one request</span> }] : []),
    { label: 'Dated about', value: it.window.from || it.window.to ? `${d(it.window.from)} to ${d(it.window.to)}` : '—' },
    ...(proposed ? [{
      label: it.state === 'closed' ? 'Matched' : 'Proposed',
      value: (
        <span className="grid gap-1.5">
          <span>{docLabel(proposed.docType)} · {proposed.documentDate ? d(proposed.documentDate) : 'document date not stated'} · {proposed.institution ?? 'institution not stated'}</span>
          {it.institutionDiffers && <Chip kicker="Note" tone="unverified">From a different hospital than the one that mentioned it</Chip>}
        </span>
      ),
    }] : it.matchedDoc ? [{ label: 'Matched', value: `${docLabel(it.matchedDoc.docType)} · ${d(it.matchedDoc.documentDate)}` }] : []),
    ...(it.reason ? [{ label: 'Reason', value: it.reason }] : []),
    ...(requests.length ? [{
      label: 'Requests',
      value: (
        <span className="flex flex-wrap gap-2">
          {requests.map((r) => <Link key={r.id} href={`/patients/${patientId}/requests#r-${r.id}`} className="underline decoration-brass underline-offset-4">{r.institution} · {r.state.replace('_', ' ')}</Link>)}
        </span>
      ),
    }] : []),
    { label: 'What happened', value: <History created={it.createdAt} entries={history} /> },
  ]
  const listed = (view.neutral ? it.neutral : it.wording)[lang]
  // A received item is still open, but "not in file" next to a "Received" badge reads as a contradiction (mentor review).
  const title = it.state === 'received' && lang === 'en' ? listed.replace(/\b(?:(is|are) )?not in file\b/, (_, v?: string) => `${v ? (v === 'is' ? 'was' : 'were') + ' ' : ''}listed as not in file`) : listed
  const actions = (
    <MissingActions id={it.id} patientId={patientId} state={it.state} institutionDiffers={it.institutionDiffers} canAct={canAct} canRequest={canRequest}
      proposed={proposed ? { label: docLabel(proposed.docType), date: proposed.documentDate ? d(proposed.documentDate) : 'not stated', institution: proposed.institution, href: `/patients/${patientId}/documents/${proposed.id}` } : null}
      prefill={{ missingIds: [it.id], institution: t?.institution ?? undefined, documents: it.expectedTypes, dateRange: { from, to } }} />
  )
  return (
    <article id={`m-${it.id}`} data-tour={it.expectedTypes.includes('pathology_report') ? 'missing-histopath' : 'missing'} className="grid scroll-mt-32 gap-4 border-b border-rule pb-8 last:border-b-0">
      {OPEN.includes(it.state) ? (
        <EmptyFrame animate delay={Math.min(index * 60, 400)} title={title} status={it.state} action={actions}
          detail={it.state === 'received' ? 'A paper that may close this item has arrived. It stays open until a person confirms the match or sets it aside.' : undefined} />
      ) : (
        // Resolved: no longer an empty frame on the wall, so no "Not in file" kicker.
        <div className="grid gap-2 sm:pl-25">
          <h3 className="text-lg leading-snug tracking-[-0.015em] text-muted">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={it.state} />
                        {actions}
          </div>
        </div>
      )}
      <KeyValue className="sm:ml-25" items={rows} />
    </article>
  )
}

export default async function CompletenessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const lang = (await searchParams).lang === 'hi' ? 'hi' : 'en'
  const session = await requireStaff()
  if (!['desk', 'records', 'clinician', 'org_admin'].includes(session.role)) return <RoleRestricted roles={['desk', 'records', 'clinician', 'org_admin']} role={session.role} backHref={`/patients/${id}/overview`} />
  const data = await withPatientAccess(id, async (tx, s) => ({ c: await loadCompleteness(tx, id, s), today: istDate((await now(s.orgId)).toISOString()) }))
  if (!data) return null // the workspace layout explains the denial
  const { c, today } = data
  const canAct = can(session.role, 'radar.update')
  const canRequest = can(session.role, 'request.manage')
  const m = c.metrics
  const view: View = { desk: session.role === 'desk', neutral: session.role === 'desk' && c.disclosure !== 'cleared' }

  return (
    <div className="grid gap-12 py-8">
      <div className="grid gap-6">
        <SectionHeader
          kicker="Missing papers"
          title="Papers mentioned but not in this file"
          description="Each box below is a paper that another document mentions and that we do not hold. The wording is about papers only; a person confirms every closure."
          actions={<LanguageToggle value={lang} langs={['en', 'hi']} />}
        />
        <Explainer>{EXPLAIN.completeness} {EXPLAIN.letter}</Explainer>
        <dl className="grid grid-cols-2 gap-6 border border-rule bg-surface px-5 py-5 sm:grid-cols-5">
          <Metric label="Noticed" value={m.detected} />
          <Metric label="Asked for" value={m.requested} />
          <Metric label="Arrived" value={m.received} />
          <Metric label="Closed" value={m.closed} />
          <Metric label="Closed before the next visit" value={m.closure.den ? `${m.closure.num} of ${m.closure.den}` : '—'}
            note={m.closure.den ? 'Counted among items noticed before a sealed visit' : 'No visit sealed since they were noticed'} />
        </dl>
      </div>

      <section aria-labelledby="open-h" className="grid gap-8">
        <header className="flex flex-wrap items-baseline gap-x-4 border-b border-rule pb-3">
          <h2 id="open-h" className="text-xl tracking-[-0.02em] sm:text-2xl">Not in file</h2>
          <InfoTip>{EXPLAIN.completeness}</InfoTip>
          <span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs text-muted tabular-nums">{c.open.length}</span>
        </header>
        {c.open.length ? c.open.map((it, i) => (
          <Item key={it.id} it={it} index={i} patientId={id} lang={lang} today={today} history={c.history[it.id] ?? []} requests={c.requests[it.id] ?? []} canAct={canAct} canRequest={canRequest} view={view} />
        )) : (
          <EmptyState title="No mentioned paper is missing" description="Nothing in the file points to a paper that we do not hold. This list covers only what the documents themselves mention; a paper nobody mentioned cannot appear here." />
        )}
      </section>

      {c.resolved.length > 0 && (
        <details className="group grid gap-6">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-4 border-b border-rule pb-3">
            <h2 className="text-xl tracking-[-0.02em] sm:text-2xl">Resolved</h2>
            <span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs text-muted tabular-nums">{c.resolved.length}</span>
            <span className="text-sm text-muted">Closed, not obtainable and dismissed · <span className="group-open:hidden">show</span><span className="hidden group-open:inline">hide</span></span>
          </summary>
          <div className="mt-6 grid gap-8">
            {c.resolved.map((it, i) => (
              <Item key={it.id} it={it} index={i} patientId={id} lang={lang} today={today} history={c.history[it.id] ?? []} requests={c.requests[it.id] ?? []} canAct={canAct} canRequest={canRequest} view={view} />
            ))}
          </div>
        </details>
      )}

      {c.shadow && (
        <details className="group border border-dashed border-slate bg-slate-tint/40 px-5 py-4">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-3">
            <StatusBadge status="shadow_mode" />
            <span className="font-display text-lg">Checks still under review: not shown to clinicians</span>
            <span className="text-sm text-muted">{c.shadow.reduce((n, r) => n + r.n, 0)} open items from checks that no clinician has reviewed yet</span>
          </summary>
          <div className="mt-4 grid gap-3">
            <p className="max-w-3xl text-[15px] text-muted">Counts only. These checks run quietly, but what they find stays hidden from desk, records and clinicians until a clinician has reviewed that check.</p>
            {c.shadow.length ? (
              <ul className="flex flex-wrap gap-2">
                {c.shadow.map((r) => <li key={r.ruleId}><Badge tone="shadow" icon={<EyeOff />}>{r.ruleId} · {r.n}</Badge></li>)}
              </ul>
            ) : <p className="text-sm text-faint">Nothing from checks under review for this patient.</p>}
          </div>
        </details>
      )}
    </div>
  )
}
