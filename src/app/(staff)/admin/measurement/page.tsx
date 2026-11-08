import { Download } from 'lucide-react'
import { ButtonLink, EmptyState, SectionHeader, Table } from '@/components/ui'
import { BarRows, Block } from '@/components/admin/charts'
import { withOrg } from '@/db'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import { daysText, minutesText, pctText } from '@/server/admin/format'
import { loadMeasureRows } from '@/server/admin/measurement'
import { summariseMeasurement } from '@/server/admin/measurement-core'
import { loadMetrics } from '@/server/admin/metrics'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Measurement study · Admin · OncoSetu' }

const REASON: Record<string, string> = { unavailable: 'Earlier result unavailable', quality: 'Poor quality', clinical_need: 'Clinical need' }
const PHASE: Record<string, string> = { baseline: 'Baseline', shadow: 'Trial run', live: 'Live' }

export default async function MeasurementPage() {
  const s = await requireStaff(sectionRoles('measurement'))
  const { rows, sys } = await withOrg(s.orgId, async (tx) => ({ rows: await loadMeasureRows(tx), sys: await loadMetrics(tx) }))
  const sum = summariseMeasurement(rows)
  const canExport = s.role === 'org_admin' || s.role === 'auditor'

  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker="Admin · Baseline measurement study" title="Measurement study"
        description="Consultation forms from clinicians, plus the measures the system collects itself. The export has no names, phones, dates of birth, encounter ids, clinician ids or exact dates."
        actions={canExport ? <ButtonLink href="/api/measure/export.csv" prefetch={false} variant="secondary" icon={<Download aria-hidden />}>Export anonymised CSV</ButtonLink> : undefined} />

      <Block kicker="Clinician form" title={`Consultations recorded: ${sum.total}`} note="Missing-record rate uses first visits only. Repeat-test rate uses all consultations. Every rate shows n.">
        {sum.total === 0 ? <EmptyState title="No consultation forms yet" description="Clinicians record each consultation under Measure." className="py-8" /> : (
          <Table caption="By study phase">
            <thead><tr><th>Phase</th><th>Consultations</th><th>Missing-record rate (first visits)</th><th>Repeat-test rate</th><th>Impact: none / delayed / repeat / rescheduled</th><th>Median prep (min)</th></tr></thead>
            <tbody>
              {sum.phases.map((p) => (
                <tr key={p.phase}>
                  <td>{PHASE[p.phase]}</td>
                  <td className="font-mono tabular-nums">{p.n}</td>
                  <td className="font-mono tabular-nums">{pctText(p.missingRate)} <span className="text-faint">({p.missingRate.num}/{p.missingRate.den})</span></td>
                  <td className="font-mono tabular-nums">{pctText(p.repeatRate)} <span className="text-faint">({p.repeatRate.num}/{p.repeatRate.den})</span></td>
                  <td className="font-mono tabular-nums">{p.impact.none} / {p.impact.delayed_decision} / {p.impact.repeat_test_ordered} / {p.impact.visit_rescheduled}</td>
                  <td className="font-mono tabular-nums">{p.prepMedian ?? '—'} <span className="text-faint">(n={p.prepN})</span></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Block>

      <div className="grid gap-8 lg:grid-cols-2">
        <Block kicker="Clinician form" title="Missing document types">
          {sum.typeCounts.length === 0 ? <p className="text-sm text-muted">No missing documents recorded.</p> : (
            <BarRows label="Missing document types" rows={sum.typeCounts.map((t) => ({ label: staffDocLabel(t.docType as DocType), text: staffDocLabel(t.docType as DocType), value: t.n, of: Math.max(...sum.typeCounts.map((x) => x.n)), value_text: String(t.n), tone: 'setu' as const }))} />
          )}
        </Block>
        <Block kicker="Clinician form" title="Repeat-test reasons">
          <BarRows label="Repeat-test reasons" rows={sum.reasons.map((r) => ({ label: REASON[r.reason], text: REASON[r.reason], value: r.n, of: Math.max(1, ...sum.reasons.map((x) => x.n)), value_text: String(r.n), tone: 'unverified' as const }))} />
        </Block>
      </div>

      <Block kicker="System measures" title="Collected by the system" note="Same definitions as the Metrics page.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 font-mono text-sm">
          <dt className="text-muted">Request fulfilment rate</dt><dd className="tabular-nums">{pctText(sys.fulfilment.overall.rate)} ({sys.fulfilment.overall.fulfilled} of {sys.fulfilment.overall.sent} sent)</dd>
          <dt className="text-muted">Median days to fulfilment</dt><dd className="tabular-nums">{daysText(sys.fulfilment.overall.medianDays)}</dd>
          <dt className="text-muted">Disclosure not cleared at enrolment</dt><dd className="tabular-nums">{pctText(sys.disclosure.nonCleared)} ({sys.disclosure.nonCleared.num} of {sys.disclosure.total})</dd>
          <dt className="text-muted">Pages: printed / handwritten / image only</dt><dd className="tabular-nums">{sys.census.printed} / {sys.census.handwritten} / {sys.census.imageOnly} of {sys.census.total}</dd>
          <dt className="text-muted">Arrival to clinician opening the record, median</dt><dd className="tabular-nums">returning {minutesText(sys.prep.returning.medianMinutes)} (n={sys.prep.returning.visits}) · first {minutesText(sys.prep.firstVisit.medianMinutes)} (n={sys.prep.firstVisit.visits})</dd>
        </dl>
        <p className="text-sm text-faint">“Median prep” in the table comes from the clinician form. The arrival-to-opening time is measured by the system from the activity log and includes any wait for the clinician.</p>
      </Block>
    </div>
  )
}
