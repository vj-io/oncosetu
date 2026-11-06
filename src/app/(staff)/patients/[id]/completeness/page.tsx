// Document-completeness checklist (FR-RAD-03..06, E-RAD-01..04): the gallery wall of referenced-but-absent documents.
// Production items only; shadow-mode items are never shown to desk, records or clinicians (FR-RAD-05).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowUpRight, EyeOff } from 'lucide-react'
import { MissingActions } from '@/components/completeness/MissingActions'
import { Badge, Chip, EmptyFrame, EmptyState, KeyValue, LanguageToggle, SectionHeader, StatusBadge } from '@/components/ui'
import { formatDateIN, istDate, patientDocLabel, staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import { now } from '@/server/clock'
import { can } from '@/server/rbac'
import { loadCompleteness, type DescribedItem, type HistoryEntry } from '@/server/radar-ui/completeness'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Completeness checklist · OncoSetu' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const d = (iso: string | null | undefined) => (iso ? formatDateIN(istDate(iso)) : '—')
/** Desk screens: no quotes or source links (evidence.read), and neutral labels/wording unless disclosure is cleared (FR-VOX-06). */
type View = { neutral: boolean; desk: boolean }
const docLabelFor = (v: View) => (t: DocType | null) => (t ? (v.neutral ? patientDocLabel(t, 'not_cleared') : staffDocLabel(t)) : 'Unclassified document')
const OPEN = ['expected', 'requested', 'received']
const ACTION_WORD: Record<string, string> = {
  request: 'Requested', receive: 'Match proposed', confirm: 'Closure confirmed', reject_match: 'Match set aside', unobtainable: 'Marked unobtainable',
  dismiss: 'Dismissed', reopen: 'Reopened',
}

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
      <li>{d(created)} · Detected by the completeness rule</li>
      {entries.map((h, i) => (
        <li key={i}>{d(h.at)} · {ACTION_WORD[h.action] ?? h.action}{h.from && h.to ? ` (${h.from} → ${h.to})` : ''} · {h.role}</li>
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
      label: 'Evidence',
      value: t ? (
        <span className="grid gap-1">
          {t.quote && !view.desk && <q className="font-display text-[17px] leading-snug">{t.quote}</q>}
          <span className="text-[14px] text-muted">
            {docLabel(it.triggerDoc?.docType ?? null)}{t.pageNo ? `, p.${t.pageNo}` : ''}{t.institution ? ` · ${t.institution}` : ''} · documented {formatDateIN(t.date, 'en', t.precision)}
            {src && !view.desk && <> · <Link href={src} className="inline-flex items-center gap-0.5 text-setu-ink underline decoration-brass underline-offset-4">View source<ArrowUpRight aria-hidden className="size-3.5" /></Link></>}
          </span>
        </span>
      ) : 'Patient statement',
    },
    { label: 'Expects', value: it.expectedTypes.map(docLabel).join(' or ') },
    ...(it.cycles.length ? [{ label: 'Grouped', value: <span>Cycles {it.cycles.join(', ')} · one item for all earlier cycles (E-RAD-04)</span> }] : []),
    { label: 'Window', value: it.window.from || it.window.to ? `${d(it.window.from)} – ${d(it.window.to)}` : '—' },
    ...(view.neutral ? [] : [{ label: 'Rule', value: <span className="font-mono text-[13px]">{it.ruleId} · v{it.ruleVersion}</span> }]), // rule ids name test types
    ...(proposed ? [{
      label: it.state === 'closed' ? 'Matched' : 'Proposed',
      value: (
        <span className="grid gap-1.5">
          <span>{docLabel(proposed.docType)} · {proposed.documentDate ? d(proposed.documentDate) : 'document date not stated'} · {proposed.institution ?? 'institution not stated'}</span>
          {it.institutionDiffers && <Chip kicker="Note" tone="unverified">Institution differs (E-RAD-01)</Chip>}
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
    { label: 'History', value: <History created={it.createdAt} entries={history} /> },
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
    <article id={`m-${it.id}`} className="grid gap-4 border-b border-rule pb-8 last:border-b-0">
      {OPEN.includes(it.state) ? (
        <EmptyFrame animate delay={Math.min(index * 60, 400)} title={title} status={it.state} accession={view.neutral ? undefined : it.ruleId} action={actions}
          detail={it.state === 'received' ? 'A document that may close this item has arrived. The item stays open until a person confirms the match or sets it aside.' : undefined} />
      ) : (
        // Resolved: no longer an empty frame on the wall, so no "Not in file" kicker.
        <div className="grid gap-2 sm:pl-25">
          <h3 className="text-lg leading-snug tracking-[-0.015em] text-muted">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={it.state} />
            {!view.neutral && <span className="font-mono text-xs tracking-[0.1em] text-faint">ACC. {it.ruleId}</span>}
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
  const session = await requireStaff(['desk', 'records', 'clinician', 'org_admin'])
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
          kicker="Document-completeness checklist"
          title="Documents referenced but not in file"
          description="Each empty frame is a document that a recorded item refers to and that is not in this file. The wording is about documents only; a person confirms every closure."
          actions={<LanguageToggle value={lang} langs={['en', 'hi']} />}
        />
        <dl className="grid grid-cols-2 gap-6 border border-rule bg-surface px-5 py-5 sm:grid-cols-5">
          <Metric label="Detected" value={m.detected} />
          <Metric label="Requested" value={m.requested} />
          <Metric label="Received" value={m.received} />
          <Metric label="Closed" value={m.closed} />
          <Metric label="Closed before next consultation" value={m.closure.den ? `${m.closure.num}/${m.closure.den}` : '—'}
            note={m.closure.den ? 'Items detected before a sealed consultation' : 'No consultation sealed since detection'} />
        </dl>
      </div>

      <section aria-labelledby="open-h" className="grid gap-8">
        <header className="flex flex-wrap items-baseline gap-x-4 border-b border-rule pb-3">
          <h2 id="open-h" className="text-xl tracking-[-0.02em] sm:text-2xl">Not in file</h2>
          <span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs text-muted tabular-nums">{c.open.length}</span>
        </header>
        {c.open.length ? c.open.map((it, i) => (
          <Item key={it.id} it={it} index={i} patientId={id} lang={lang} today={today} history={c.history[it.id] ?? []} requests={c.requests[it.id] ?? []} canAct={canAct} canRequest={canRequest} view={view} />
        )) : (
          <EmptyState title="No referenced documents are missing" description="Nothing in the reviewed completeness rules points to a document that is not in this file. Missing does not mean it did not happen; this list covers only what the records refer to." />
        )}
      </section>

      {c.resolved.length > 0 && (
        <details className="group grid gap-6">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-4 border-b border-rule pb-3">
            <h2 className="text-xl tracking-[-0.02em] sm:text-2xl">Resolved</h2>
            <span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs text-muted tabular-nums">{c.resolved.length}</span>
            <span className="text-sm text-muted">Closed, unobtainable and dismissed items · <span className="group-open:hidden">show</span><span className="hidden group-open:inline">hide</span></span>
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
            <span className="font-display text-lg">Shadow mode — not shown to clinicians</span>
            <span className="text-sm text-muted">{c.shadow.reduce((n, r) => n + r.n, 0)} open items from rules without a recorded clinician review</span>
          </summary>
          <div className="mt-4 grid gap-3">
            <p className="max-w-3xl text-[15px] text-muted">Counts only. These rules run and log, but their items stay hidden from desk, records and clinicians until a clinician review is recorded for the rule (FR-RAD-05).</p>
            {c.shadow.length ? (
              <ul className="flex flex-wrap gap-2">
                {c.shadow.map((r) => <li key={r.ruleId}><Badge tone="shadow" icon={<EyeOff />}>{r.ruleId} · {r.n}</Badge></li>)}
              </ul>
            ) : <p className="text-sm text-faint">No shadow-mode items for this patient.</p>}
          </div>
        </details>
      )}
    </div>
  )
}
