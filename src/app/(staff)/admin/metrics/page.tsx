import Link from 'next/link'
import { Badge, EmptyState, SectionHeader, Table } from '@/components/ui'
import { QaReview } from '@/components/admin/QaReview'
import { BarRows, Block, Stat, StackedBar } from '@/components/admin/charts'
import { withOrg } from '@/db'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import { daysText, istDate, pctText } from '@/server/admin/format'
import { loadMetrics } from '@/server/admin/metrics'
import { PREVISIT_WINDOW_DAYS } from '@/server/admin/metrics-compute'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Metrics · Admin · OncoSetu' }

const docLabel = (t: string) => (t === 'no_document' ? 'No source document' : staffDocLabel(t as DocType))
const eventLabel = (t: string) => t.replace(/_documented$/, '').replace(/_/g, ' ')

export default async function MetricsPage() {
  const s = await requireStaff(sectionRoles('metrics'))
  const m = await withOrg(s.orgId, (tx) => loadMetrics(tx))
  const { prov, corrections, radar, fulfilment, previsit, disclosure, census, safety, qa } = m
  const f = fulfilment.overall
  const unsupportedBad = prov.unsupported > 0

  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker="Admin · Metrics (PRD §16)" title="Metrics and safety targets"
        description="Computed from the live tables on every load. Each ratio shows its numerator and denominator; a dash means there is no denominator yet, never zero." />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Headline metrics">
        <li><Stat label="Provenance coverage" value={pctText(prov.coverage)} detail={`${prov.coverage.num} of ${prov.coverage.den} live events have evidence or are patient statements`} tone={prov.coverage.den > 0 && !unsupportedBad ? 'verified' : unsupportedBad ? 'conflict' : 'neutral'} /></li>
        <li><Stat label="Unsupported facts displayed" value={prov.unsupported} detail="Target 0. Live events without evidence that are not patient statements" tone={unsupportedBad ? 'conflict' : 'verified'} /></li>
        <li><Stat label="Pre-visit completion" value={pctText(previsit)} detail={`${previsit.num} of ${previsit.den} returning visits with a confirmed statement, linked or captured in the ${PREVISIT_WINDOW_DAYS} days before`} /></li>
        <li><Stat label="Not-cleared disclosure" value={pctText(disclosure.nonCleared)} detail={`${disclosure.nonCleared.num} of ${disclosure.total} active patients: disclosure not cleared`} /></li>
      </ul>

      <Block kicker="§16.2" title="Safety KPIs" note="Reviewed weekly in the pilot; any non-zero S0 metric pauses the pilot. Zero targets are outlined; a target that is not measured here says so instead of showing a number.">
        <Table caption="Safety KPIs">
          <thead><tr><th>KPI</th><th>Target</th><th>Observed</th><th>Status</th><th>How it is measured</th></tr></thead>
          <tbody>
            {safety.map((k) => (
              <tr key={k.key} className={k.status === 'breach' ? 'bg-madder-tint' : undefined}>
                <td className={k.zeroTarget ? 'border-l-[3px] border-l-ink font-medium' : undefined}>{k.label}</td>
                <td className="font-mono text-[13px] whitespace-nowrap">{k.target}{k.zeroTarget && <span className="ml-1 text-[11px] tracking-[0.12em] uppercase">· zero</span>}</td>
                <td className="font-mono text-[15px] tabular-nums">{k.observed}</td>
                <td><Badge tone={k.status === 'on_target' ? 'verified' : k.status === 'breach' ? 'conflict' : 'shadow'}>{k.status === 'on_target' ? 'On target' : k.status === 'breach' ? 'Breach' : 'Not measured'}</Badge></td>
                <td className="max-w-md text-sm text-muted">{k.basis}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Block>

      <div className="grid gap-8 lg:grid-cols-2">
        <Block kicker="§16.1" title="Provenance" note="A live event is supported by at least one evidence row (document quote or patient statement) or is itself a patient statement. Withdrawn and rejected events are left out.">
          <StackedBar label="Live events by support" segments={[
            { label: 'Supported', value: prov.coverage.num, tone: 'verified' },
            { label: 'Unsupported', value: prov.unsupported, tone: 'conflict' },
          ]} />
          {prov.unsupported > 0 && (
            <BarRows label="Unsupported events by type" rows={Object.entries(prov.unsupportedByType).map(([t, n]) => ({ label: eventLabel(t), text: eventLabel(t), value: n, of: prov.unsupported, tone: 'conflict' as const }))} />
          )}
        </Block>

        <Block kicker="§16.1" title="Correction rate by document type" note="Edited or rejected items over every machine-extracted item a person has verified, edited or rejected.">
          {corrections.byType.length === 0 ? <EmptyState title="No verified items yet" description="The rate appears once people verify extracted items." className="py-8" /> : (
            <>
              <BarRows label="Correction rate by document type" rows={corrections.byType.map((r) => ({
                label: docLabel(r.docType), text: docLabel(r.docType), value: r.num, of: r.den, value_text: `${pctText(r)} · ${r.num}/${r.den}`, tone: 'setu' as const,
              }))} />
              <p className="font-mono text-sm text-muted">All types: {pctText(corrections.total)} ({corrections.total.num} of {corrections.total.den})</p>
            </>
          )}
        </Block>

        <Block kicker="FR-RAD-06" title="Missing-record Radar" note="Production items only; shadow items are counted separately and never shown to staff. Closure counts an item received or closed before the next sealed snapshot of that patient.">
          <BarRows label="Radar funnel" rows={[
            { label: 'Detected', text: 'Detected', value: radar.detected, of: Math.max(radar.detected, 1), value_text: String(radar.detected), tone: 'neutral' },
            { label: 'Requested', text: 'Requested', value: radar.requested, of: Math.max(radar.detected, 1), value_text: String(radar.requested), tone: 'setu' },
            { label: 'Received', text: 'Received', value: radar.received, of: Math.max(radar.detected, 1), value_text: String(radar.received), tone: 'unverified' },
            { label: 'Closed', text: 'Closed', value: radar.closed, of: Math.max(radar.detected, 1), value_text: String(radar.closed), tone: 'verified' },
          ]} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-sm">
            <dt className="text-muted">Closed before next sealed snapshot</dt><dd className="tabular-nums">{pctText(radar.closure)} ({radar.closure.num} of {radar.closure.den})</dd>
            <dt className="text-muted">Awaiting a sealed snapshot</dt><dd className="tabular-nums">{radar.awaitingSnapshot}</dd>
            <dt className="text-muted">Shadow-mode hits (not shown)</dt><dd className="tabular-nums">{radar.shadow}</dd>
          </dl>
        </Block>

        <Block kicker="FR-REQ-06" title="Request fulfilment" note="Sent requests only. Days run from the sent date to the date the document arrived and was matched.">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-sm">
            <dt className="text-muted">Fulfilment rate</dt><dd className="tabular-nums">{pctText(f.rate)} ({f.fulfilled} of {f.sent} sent)</dd>
            <dt className="text-muted">Median days to fulfilment</dt><dd className="tabular-nums">{daysText(f.medianDays)}</dd>
          </dl>
          <Table caption="By institution type">
            <thead><tr><th>Institution type</th><th>Sent</th><th>Fulfilled</th><th>Rate</th><th>Median days</th></tr></thead>
            <tbody>
              {fulfilment.byType.map((t) => (
                <tr key={t.institutionType}><td>{t.institutionType === 'unknown' ? 'Not recorded' : t.institutionType}</td><td className="font-mono tabular-nums">{t.sent}</td><td className="font-mono tabular-nums">{t.fulfilled}</td><td className="font-mono tabular-nums">{pctText(t.rate)}</td><td className="font-mono tabular-nums">{daysText(t.medianDays)}</td></tr>
              ))}
            </tbody>
          </Table>
          <p className="text-sm text-faint">Institution type is not captured: a request records the institution as free text, so all requests fall under “Not recorded”.</p>
        </Block>

        <Block kicker="§16.4 · K3" title="Document census" note="Pages of non-duplicate documents. Printed, handwritten and image-only are exclusive; low confidence overlaps them.">
          <StackedBar label="Pages by class" segments={[
            { label: 'Printed text', value: census.printed, tone: 'setu' },
            { label: 'Handwritten', value: census.handwritten, tone: 'patient' },
            { label: 'Image only', value: census.imageOnly, tone: 'shadow' },
          ]} />
          <p className="font-mono text-sm text-muted">Low OCR confidence: {census.lowConfidence} of {census.total} pages ({pctText({ num: census.lowConfidence, den: census.total })})</p>
        </Block>

        <Block kicker="§16.4" title="Disclosure status" note="Active patients by disclosure status. Not cleared and unknown both count as not cleared.">
          <StackedBar label="Patients by disclosure status" segments={[
            { label: 'Cleared', value: disclosure.cleared, tone: 'verified' },
            { label: 'Not cleared', value: disclosure.notCleared, tone: 'unverified' },
            { label: 'Unknown', value: disclosure.unknown, tone: 'shadow' },
          ]} />
        </Block>
      </div>

      <Block kicker="FR-VER-04" title="Verification sampling QA"
        note={`A reproducible 5% sample of records-verified items per ISO week (the lowest SHA-256 of "qa-v1:" plus the verification id) goes to a second reviewer who is not the verifier. ${qa.eligible} records-verified item${qa.eligible === 1 ? '' : 's'} so far.`}>
        <p className="font-mono text-sm" role="status">
          Disagreement rate: {qa.rate == null ? '—' : `${(qa.rate * 100).toFixed(1).replace(/\.0$/, '')}% (${qa.disagree} of ${qa.reviewed} reviewed)`}
        </p>
        {qa.items.length === 0 ? <EmptyState title="Nothing sampled yet" description="Items appear here once records staff have verified some." className="py-8" /> : (
          <Table caption="Sampled items for second review">
            <thead><tr><th>Week</th><th>Item</th><th>Verified by</th><th>Verified</th><th>Second review</th></tr></thead>
            <tbody>
              {qa.items.map((it) => (
                <tr key={it.verificationId}>
                  <td className="font-mono text-[13px]">{it.week ?? '—'}</td>
                  <td>{eventLabel(it.eventType)}<span className="block text-sm text-muted">{it.docType ? docLabel(it.docType) : 'No source document'}</span></td>
                  <td>{it.verifierName ?? '—'}</td>
                  <td className="font-mono text-[13px] whitespace-nowrap">{istDate(it.verifiedAt)}</td>
                  <td>
                    {it.review ? <><Badge tone={it.review.outcome === 'agree' ? 'verified' : 'conflict'}>{it.review.outcome === 'agree' ? 'Agree' : 'Disagree'}</Badge><span className="mt-1 block text-sm text-muted">{it.review.reviewerName} · {istDate(it.review.at)}</span></>
                      : s.role === 'clinician' && it.verifierId !== s.staffId ? (
                        <div className="grid gap-2">
                          {it.documentId && <Link className="text-sm underline" href={`/patients/${it.patientId}/documents/${it.documentId}?event=${it.eventId}`}>Open source</Link>}
                          <QaReview verificationId={it.verificationId} />
                        </div>
                      ) : <span className="text-sm text-muted">{it.verifierId === s.staffId ? 'You verified this' : 'Awaiting a clinician'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Block>
    </div>
  )
}
