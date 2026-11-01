import Link from 'next/link'
import { EmptyState, SectionHeader, Table } from '@/components/ui'
import { MeasureForm } from '@/components/admin/MeasureForm'
import { withOrg } from '@/db'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import { istDateTime, shortId } from '@/server/admin/format'
import { istToday, myRecentForms, recentEncounters } from '@/server/admin/measurement'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Measure · OncoSetu' }

const TYPE: Record<string, string> = { onboarding: 'first visit', returning: 'returning', between: 'between visits' }
const IMPACT: Record<string, string> = { none: 'No impact', delayed_decision: 'Decision delayed', repeat_test_ordered: 'Repeat test ordered', visit_rescheduled: 'Visit rescheduled' }

export default async function MeasurePage() {
  const s = await requireStaff(['clinician'])
  const { encs, mine } = await withOrg(s.orgId, async (tx) => ({ encs: await recentEncounters(tx), mine: await myRecentForms(tx, s.staffId) }))
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker="Measure · 60-second consultation form" title="Record this consultation"
        description="Answer after the consultation. The form carries no patient details: it can be linked to an encounter by its id only. These answers feed the baseline measurement study."
        actions={<Link href="/admin/metrics" className="text-sm underline">View metrics</Link>} />
      <MeasureForm today={istToday()} encounters={encs.map((e) => ({ id: e.id, type: e.type, label: `ENC ${shortId(e.id)} · ${TYPE[e.type] ?? e.type} · ${istDateTime(e.startedAt)}` }))} />
      <section aria-labelledby="mine-h" className="grid gap-3">
        <h2 id="mine-h" className="text-xl tracking-[-0.02em]">Your recent forms</h2>
        {mine.length === 0 ? <EmptyState title="Nothing recorded yet" className="py-8" /> : (
          <Table caption="Your last forms">
            <thead><tr><th>Date</th><th>Phase</th><th>Missing</th><th>Impact</th><th>Repeat test</th></tr></thead>
            <tbody>
              {mine.map((f) => (
                <tr key={f.id}>
                  <td className="font-mono text-[13px]">{f.consultationDate}</td><td className="capitalize">{f.phase}</td>
                  <td>{f.missingRecordPresent ? `${f.missingRecordCount}: ${f.missingTypes.map((t) => staffDocLabel(t as DocType)).join(', ') || 'types not given'}` : 'None'}</td>
                  <td>{IMPACT[f.impact]}</td><td>{f.repeatTestOrdered ? f.repeatTestReason?.replace('_', ' ') : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}
