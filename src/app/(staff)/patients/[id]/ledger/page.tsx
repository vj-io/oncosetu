import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowUpRight, Copy } from 'lucide-react'
import { BrassSeal, Chip, EmptyFrame, Frame, ProgressMeter, SectionHeader } from '@/components/ui'
import { ConflictCard } from '@/components/ledger/ConflictCard'
import { LedgerItem } from '@/components/ledger/LedgerItem'
import { LedgerToolbar } from '@/components/ledger/LedgerToolbar'
import { now } from '@/server/clock'
import { PRIORITY_BUCKETS, type LedgerView } from '@/server/ledger/core'
import { loadLedger } from '@/server/ledger/record'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = { title: 'Change ledger · OncoSetu' }

function Section({ n, title, count, description, children, empty }: { n: string; title: string; count: number; description: string; children?: React.ReactNode; empty?: string }) {
  return (
    <section aria-labelledby={`sec-${n}`} className="grid gap-5">
      <header className="grid gap-1 border-b border-rule pb-3">
        <div className="flex items-baseline gap-x-4">
          <span className="font-mono text-xs tracking-[0.16em] text-faint">{n}</span>
          <h2 id={`sec-${n}`} className="text-xl tracking-[-0.02em] sm:text-2xl">{title}</h2>
          <span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs text-muted tabular-nums">{count}</span>
        </div>
        <p className="max-w-3xl text-[15px] text-muted">{description}</p>
      </header>
      {count ? children : <p className="text-[15px] text-faint">{empty ?? 'None.'}</p>}
    </section>
  )
}

function SealPlaque({ v, patientId }: { v: LedgerView; patientId: string }) {
  const s = v.snapshot
  if (!s) {
    return (
      <div className="flex items-center gap-5">
        <span aria-hidden className="grid size-24 shrink-0 place-items-center rounded-full border-2 border-dashed border-control font-mono text-[10px] tracking-[0.16em] text-faint uppercase">Unsealed</span>
        <div className="grid gap-1">
          <p className="ds-kicker">Initial record · first visit</p>
          <p className="max-w-md text-[15px] text-muted">No snapshot sealed yet. Items are ordered by document type for onboarding — {PRIORITY_BUCKETS.join(' → ')} — an administrative order, never clinical importance.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-5">
      <BrassSeal code={s.sha256} label={`S${s.seq} sealed`} size={104} />
      <div className="grid gap-1">
        <p className="ds-kicker">Changes since snapshot S{s.seq}</p>
        <p className="text-[15px]">Sealed {s.sealedLabel}{s.signerName && <> by {s.signerName}</>}</p>
        <p className="font-mono text-[12px] tracking-[0.06em] text-muted">SHA-256 {s.sha256.slice(0, 16)}… · key {s.keyId}</p>
        <p className="flex flex-wrap gap-x-4 text-sm">
          <Link href={`/verify/${s.id}`} className="inline-flex items-center gap-0.5 text-setu-ink underline decoration-brass underline-offset-4">Verify seal<ArrowUpRight aria-hidden className="size-3.5" /></Link>
          <Link href={`/patients/${patientId}/timeline?asOf=${s.id}`} className="text-setu-ink underline decoration-brass underline-offset-4">Record as of S{s.seq}</Link>
        </p>
      </div>
    </div>
  )
}

export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const session = await requireStaff(['desk', 'records', 'clinician'])
  const v = await withPatientAccess(id, async (tx, s) => loadLedger(tx, id, s, now(s.orgId)))
  if (!v) return null // the workspace layout explains the denial

  const items = Object.values(v.events).flat()
  const eligible = items.filter((i) => i.status === 'unverified' && i.bulk.eligible && i.permits.verify === true).map((i) => i.id)
  const total = v.counts.verified + v.counts.unverified + v.counts.disputed
  const sealedDay = v.snapshot ? v.snapshot.sealedLabel.split(',')[0] : ''
  const canAct = session.role !== 'desk'

  return (
    <div className="grid gap-12 py-8">
      <div className="grid gap-6">
        <SectionHeader
          kicker="Change ledger"
          title={v.mode === 'initial' ? 'Initial record' : `What changed since S${v.snapshot!.seq}`}
          description={v.mode === 'initial'
            ? 'Everything received so far, with its source. Verify what you can; the first snapshot (S0) can be sealed with partial verification — unverified items carry forward, labelled.'
            : `Each item shows what it is, where it is written, who verified it and when. Grouped by kind of change, ordered by date — never by clinical importance.`}
          actions={canAct ? <LedgerToolbar patientId={id} eligibleIds={eligible} counts={v.counts} nextSeq={(v.snapshot?.seq ?? -1) + 1} canSeal={session.role === 'clinician'} /> : undefined}
        />
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_minmax(16rem,22rem)]">
          <SealPlaque v={v} patientId={id} />
          <ProgressMeter label="Verified in the current record" value={v.counts.verified} max={Math.max(total, 1)} detail={`${v.counts.verified} / ${total}`} tone="verified" />
        </div>
        {!canAct && <Chip kicker="Desk" tone="shadow">Headline list only — quotes and verification are for records staff and clinicians</Chip>}
      </div>

      {v.mode === 'initial' ? (
        <Section n="01" title="Initial record" count={v.events.initial_record.length} description="Ordered by document type for onboarding (pathology and molecular first), then by date." empty="Nothing received yet. Documents appear here once processed.">
          <div className="grid gap-5 lg:grid-cols-2">{v.events.initial_record.map((i, k) => <LedgerItem key={i.id} item={i} index={k} />)}</div>
        </Section>
      ) : (
        <>
          <Section n="01" title="New since last visit" count={v.events.new_since_last_visit.length} description={`Dated after the last seal (${sealedDay}).`}>
            <div className="grid gap-5 lg:grid-cols-2">{v.events.new_since_last_visit.map((i, k) => <LedgerItem key={i.id} item={i} index={k} />)}</div>
          </Section>
          <Section n="02" title="Newly received older records" count={v.events.newly_received_older.length} description="Dated on or before the last seal but not in it: older records that arrived since. The event date leads.">
            <div className="grid gap-6">{v.events.newly_received_older.map((i, k) => <LedgerItem key={i.id} item={i} index={k} />)}</div>
          </Section>
          <Section n="03" title="Amended and corrected" count={v.events.amended.length} description="Corrections and amended reports that replace an item in the last seal. The original version is kept.">
            <div className="grid gap-5 lg:grid-cols-2">{v.events.amended.map((i, k) => <LedgerItem key={i.id} item={i} index={k} />)}</div>
          </Section>
        </>
      )}

      <Section n={v.mode === 'initial' ? '02' : '04'} title="Conflicts" count={v.conflicts.length} description="Two sources disagree on a compared field. Both quotes are shown; a clinician resolves.">
        <div className="grid gap-5">{v.conflicts.map((c) => <ConflictCard key={c.key} c={c} />)}</div>
      </Section>

      <Section n={v.mode === 'initial' ? '03' : '05'} title="Patient said" count={v.patientSaid.length} description="The patient’s or caregiver’s own words from pre-visit questions. Not yet supported by a document.">
        <div className="grid gap-4 md:grid-cols-2">
          {v.patientSaid.map((s, k) => (
            <Frame key={s.id} animate delay={Math.min(k * 40, 400)} className="grid gap-3 border-l-[3px] border-l-violet px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="ds-kicker">{s.question} · {s.captured}</p>
                <Chip kicker="Patient said" tone="patient">{s.confirmed ? 'Confirmed by patient' : 'Not confirmed'} · not yet supported by a document</Chip>
              </div>
              {s.transcript && <blockquote className="font-display text-lg leading-snug tracking-[-0.01em]">“{s.transcript}”</blockquote>}
              {(s.medicines.length > 0 || s.scans.length > 0 || s.institution) && (
                <p className="font-mono text-[13px] text-muted">
                  {[s.medicines.length ? `Medicines: ${s.medicines.join(', ')}` : null, s.scans.length ? `Scans: ${s.scans.join(', ')}` : null, s.institution ? `Place: ${s.institution}` : null].filter(Boolean).join(' · ')}
                </p>
              )}
            </Frame>
          ))}
        </div>
      </Section>

      <Section n={v.mode === 'initial' ? '04' : '06'} title="Missing records" count={v.missing.length} description="Documents referenced in the record but not in file (from reviewed completeness rules). Missing does not mean it did not happen.">
        <div className="grid gap-6 md:grid-cols-2">
          {v.missing.map((m, k) => (
            <EmptyFrame key={m.dedupeKey} animate delay={Math.min(k * 60, 400)} title={m.title} status={m.state === 'closed' || m.state === 'dismissed' ? 'expected' : m.state} accession={m.ruleId}
              action={<Link href={`/patients/${id}/completeness`} className="font-mono text-[11px] tracking-[0.12em] text-setu-ink uppercase underline decoration-brass underline-offset-4">Completeness checklist</Link>} />
          ))}
        </div>
      </Section>

      <Section n={v.mode === 'initial' ? '05' : '07'} title="Duplicates suppressed" count={v.duplicates.count} description="Same type, date and details as an item already listed (or from a duplicate document). The earliest received is kept.">
        <details className="group border border-rule bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-[15px]"><Copy aria-hidden className="size-4 text-faint" />Show {v.duplicates.count} suppressed {v.duplicates.count === 1 ? 'item' : 'items'}</summary>
          <ul className="grid divide-y divide-rule border-t border-rule">
            {v.duplicates.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-[15px]">
                <span>{d.typeLabel}{d.headline && <span className="text-muted"> · {d.headline}</span>}</span>
                <span className="font-mono text-[13px] text-muted">{d.docLabel} · {d.date}</span>
              </li>
            ))}
          </ul>
        </details>
      </Section>

      {v.mode === 'diff' && (
        <Section n="08" title="Errata" count={v.errata.length} description="Documents in the last seal that have since been detached (wrong patient). Their items are withdrawn from the record; the seal itself is never altered.">
          <div className="grid gap-3">
            {v.errata.map((x) => (
              <Frame key={x.documentId} className="flex flex-wrap items-baseline justify-between gap-2 border-l-[3px] border-l-madder px-5 py-4">
                <span className="text-[15px]"><span className="ds-kicker mr-2 text-madder-ink">Erratum</span>{x.docLabel} detached {x.detached}</span>
                <span className="font-mono text-[13px] text-muted">{x.withdrawn} {x.withdrawn === 1 ? 'item' : 'items'} withdrawn from S{v.snapshot!.seq}</span>
              </Frame>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
